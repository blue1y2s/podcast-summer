const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { parseRSSFeed, discoverRSSFromPage, getXiaoyuzhouRSS } = require('./rssParser');

class PodcastSourceError extends Error {
    constructor(message, options = {}) {
        super(message);
        this.name = 'PodcastSourceError';
        this.statusCode = options.statusCode || 400;
        this.code = options.code || 'PODCAST_SOURCE_ERROR';

        if (options.platform) {
            this.platform = options.platform;
        }
    }
}

function getHostname(url) {
    try {
        return new URL(url).hostname.toLowerCase();
    } catch (_error) {
        return '';
    }
}

function matchesHostname(hostname, domains = []) {
    return domains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
}

function getUnsupportedVideoPlatform(url) {
    const hostname = getHostname(url);
    if (!hostname) {
        return null;
    }

    if (matchesHostname(hostname, ['youtube.com', 'youtu.be'])) {
        return 'YouTube';
    }

    if (matchesHostname(hostname, ['bilibili.com', 'b23.tv'])) {
        return 'Bilibili';
    }

    return null;
}

function createUnsupportedPlatformError(platform) {
    return new PodcastSourceError(
        `当前 URL 模式暂不支持 ${platform} 视频页。请改用 RSS、直接音频链接，或先上传导出的音频文件；如需支持该平台，需要接入专门的视频解析器 / ${platform} video pages are not supported in URL mode yet. Use an RSS feed, direct audio URL, or upload exported audio first.`,
        {
            code: 'UNSUPPORTED_VIDEO_PLATFORM',
            platform
        }
    );
}

function decodeHtmlEntities(input) {
    if (!input) {
        return '';
    }

    return String(input)
        .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
        .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
}

function stripHtml(input) {
    return decodeHtmlEntities(String(input || ''))
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function cleanPodcastTitle(input, suffixes = []) {
    if (!input) {
        return '';
    }

    let title = stripHtml(input);
    for (const suffix of suffixes) {
        const escaped = suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        title = title.replace(new RegExp(`\\s*[-|·•]\\s*${escaped}$`, 'i'), '').trim();
    }

    return title;
}

function extractMetaContent(html, property) {
    if (!html) {
        return '';
    }

    const patterns = [
        new RegExp(`<meta\\s+property="${property}"\\s+content="([^"]+)"`, 'i'),
        new RegExp(`<meta\\s+content="([^"]+)"\\s+property="${property}"`, 'i'),
        new RegExp(`<meta\\s+name="${property}"\\s+content="([^"]+)"`, 'i'),
        new RegExp(`<meta\\s+content="([^"]+)"\\s+name="${property}"`, 'i')
    ];

    for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match?.[1]) {
            return decodeHtmlEntities(match[1].trim());
        }
    }

    return '';
}

function extractPageTitle(html, suffixes = []) {
    const ogTitle = cleanPodcastTitle(extractMetaContent(html, 'og:title'), suffixes);
    if (ogTitle) {
        return ogTitle;
    }

    const twitterTitle = cleanPodcastTitle(extractMetaContent(html, 'twitter:title'), suffixes);
    if (twitterTitle) {
        return twitterTitle;
    }

    const h1Match = html?.match(/<h1[^>]*>(.*?)<\/h1>/is);
    const h1Title = cleanPodcastTitle(h1Match?.[1], suffixes);
    if (h1Title) {
        return h1Title;
    }

    const titleMatch = html?.match(/<title>(.*?)<\/title>/is);
    return cleanPodcastTitle(titleMatch?.[1], suffixes);
}

function extractPageDescription(html) {
    return (
        stripHtml(extractMetaContent(html, 'og:description')) ||
        stripHtml(extractMetaContent(html, 'description')) ||
        ''
    );
}

function collectJsonLdNodes(html) {
    if (!html) {
        return [];
    }

    const matches = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || [];
    const nodes = [];

    for (const match of matches) {
        const payload = match
            .replace(/<script[^>]*>/i, '')
            .replace(/<\/script>/i, '')
            .trim();

        if (!payload) {
            continue;
        }

        try {
            const parsed = JSON.parse(payload);
            const queue = Array.isArray(parsed) ? [...parsed] : [parsed];

            while (queue.length > 0) {
                const current = queue.shift();
                if (!current || typeof current !== 'object') {
                    continue;
                }

                nodes.push(current);
                if (Array.isArray(current['@graph'])) {
                    queue.push(...current['@graph']);
                }
            }
        } catch (_error) {
            // ignore malformed JSON-LD blocks
        }
    }

    return nodes;
}

function extractJsonLdValue(html, keys = []) {
    for (const node of collectJsonLdNodes(html)) {
        for (const key of keys) {
            const value = node?.[key];
            if (typeof value === 'string' && value.trim()) {
                return value.trim();
            }
        }
    }

    return '';
}

function extractPagePublishedAt(html) {
    return (
        extractMetaContent(html, 'article:published_time') ||
        extractMetaContent(html, 'og:article:published_time') ||
        extractMetaContent(html, 'datePublished') ||
        extractJsonLdValue(html, ['datePublished', 'uploadDate', 'dateCreated']) ||
        ''
    );
}

/**
 * 下载播客音频文件
 * @param {string} url - 播客链接
 * @returns {Promise<Object>} 包含音频文件路径和播客信息的对象
 */
async function downloadPodcastAudio(url) {
    try {
        console.log(`开始处理播客链接: ${url}`);

        // 检测链接类型并获取音频URL和播客信息
        const extracted = await extractAudioUrl(url);
        const podcastInfo = typeof extracted === 'string'
            ? {
                audioUrl: extracted,
                title: path.basename(url, path.extname(url)) || 'Untitled Podcast',
                description: ''
            }
            : extracted;
        
        if (!podcastInfo || !podcastInfo.audioUrl) {
            throw new Error('无法提取音频链接 / Cannot extract audio URL');
        }

        console.log(`提取到音频URL: ${podcastInfo.audioUrl}`);
        if (podcastInfo.title) {
            console.log(`播客标题: ${podcastInfo.title}`);
        }

        // 下载音频文件
        const audioFilePath = await downloadAudioFile(podcastInfo.audioUrl);
        
        return {
            audioFilePath,
            audioUrl: podcastInfo.audioUrl,
            title: podcastInfo.title || 'Untitled Podcast',
            description: podcastInfo.description || '',
            publishedAt: podcastInfo.publishedAt || null
        };

    } catch (error) {
        console.error('下载播客音频错误:', error);
        if (error instanceof PodcastSourceError) {
            throw error;
        }
        throw error;
    }
}

/**
 * 从播客链接提取音频URL和播客信息
 * @param {string} url - 播客链接
 * @returns {Promise<Object>} 包含音频URL和播客信息的对象
 */
async function extractAudioUrl(url) {
    try {
        // 直接音频文件链接
        if (isDirectAudioUrl(url)) {
            return {
                audioUrl: url,
                title: path.basename(url, path.extname(url)),
                description: ''
            };
        }

        // Apple Podcasts链接处理
        if (url.includes('podcasts.apple.com')) {
            return await extractApplePodcastAudio(url);
        }

        // 小宇宙链接处理
        if (url.includes('xiaoyuzhoufm.com') || url.includes('小宇宙')) {
            return await extractXiaoyuzhouAudio(url);
        }

        const unsupportedPlatform = getUnsupportedVideoPlatform(url);
        if (unsupportedPlatform) {
            throw createUnsupportedPlatformError(unsupportedPlatform);
        }

        // 通用RSS/播客平台处理
        return await extractGenericPodcastAudio(url);

    } catch (error) {
        console.error('提取音频URL错误:', error);
        if (error instanceof PodcastSourceError) {
            throw error;
        }
        throw error;
    }
}

/**
 * 检查是否为直接音频文件链接
 */
function isDirectAudioUrl(url) {
    const audioExtensions = ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.wma'];
    return audioExtensions.some(ext => url.toLowerCase().includes(ext));
}

/**
 * 处理Apple Podcasts链接 - 标准iTunes API → RSS → enclosure流程
 */
async function extractApplePodcastAudio(url) {
    try {
        console.log('处理Apple Podcasts链接（iTunes API → RSS解析）...');
        
        // 提取节目ID
        const podcastIdMatch = url.match(/id(\d+)/);
        if (!podcastIdMatch) {
            throw new Error('无法从URL中提取节目ID');
        }
        
        const podcastId = podcastIdMatch[1];
        const episodeIdMatch = url.match(/i=(\d+)/);
        const episodeId = episodeIdMatch ? episodeIdMatch[1] : null;
        
        console.log(`节目ID: ${podcastId}${episodeId ? `, Episode ID: ${episodeId}` : ''}`);
        
        // 使用iTunes API查询RSS feed
        const itunesApiUrl = `https://itunes.apple.com/lookup?id=${podcastId}&entity=podcast`;
        console.log(`查询iTunes API: ${itunesApiUrl}`);
        
        const itunesResponse = await axios.get(itunesApiUrl, { 
            timeout: 0, // 无超时限制
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });
        
        if (!itunesResponse.data?.results?.length) {
            throw new Error('iTunes API未返回有效结果');
        }
        
        const feedUrl = itunesResponse.data.results[0].feedUrl;
        if (!feedUrl) {
            throw new Error('未找到RSS feed URL');
        }
        
        console.log(`获取到RSS feed: ${feedUrl}`);
        
        // 解析RSS feed
        const audioItems = await parseRSSFeed(feedUrl);
        if (!audioItems?.length) {
            throw new Error('RSS feed中未找到音频项目');
        }
        
        console.log(`RSS中找到 ${audioItems.length} 个音频项目`);
        
        // 如果有episode ID，智能匹配特定episode
        if (episodeId) {
            console.log(`查找episode ID: ${episodeId}`);
            
            // 尝试匹配特定episode
            let matchedItem = audioItems.find(item => {
                // 在RSS的各个字段中查找episode ID
                return item.audioUrl?.includes(episodeId) || 
                       item.guid?.includes(episodeId) ||
                       item.title?.includes(episodeId) ||
                       item.link?.includes(episodeId);
            });
            
            if (matchedItem) {
                console.log(`✅ 找到匹配episode: ${matchedItem.title}`);
                return {
                    audioUrl: matchedItem.audioUrl,
                    title: matchedItem.title || 'Untitled Episode',
                    description: matchedItem.description || '',
                    publishedAt: matchedItem.pubDate || null
                };
            } else {
                console.warn(`⚠️ 未找到episode ${episodeId}的匹配项，使用最新episode`);
            }
        }
        
        // 返回第一个episode（最新）
        const firstItem = audioItems[0];
        console.log(`使用最新episode: ${firstItem.title}`);
        return {
            audioUrl: firstItem.audioUrl,
            title: firstItem.title || 'Untitled Episode',
            description: firstItem.description || '',
            publishedAt: firstItem.pubDate || null
        };

    } catch (error) {
        console.error('Apple Podcasts解析失败:', error);
        
        // 如果是网络连接问题，尝试从网页抓取
        if (error.code === 'EADDRNOTAVAIL' || error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
            console.log('🔄 iTunes API无法访问，尝试网页抓取方案...');
            try {
                return await extractFromApplePodcastsPage(url);
            } catch (pageError) {
                console.error('网页抓取也失败:', pageError);
                
                // 提供通用的网络问题解决方案
                if (pageError.message.includes('Apple Podcasts解析失败')) {
                    throw pageError; // 使用备用方案的详细错误信息
                } else {
                    throw new Error(`网络连接问题 (${error.code}): 无法访问Apple/iTunes服务。建议使用RSS链接或直接音频文件URL。`);
                }
            }
        }
        
        throw new Error(`Apple Podcasts音频解析失败: ${error.message}`);
    }
}

/**
 * 从Apple Podcasts网页抓取音频链接 (备用方案)
 */
async function extractFromApplePodcastsPage(url) {
    console.log('📄 尝试从Apple Podcasts网页抓取音频链接...');
    
    try {
        // 直接抓取网页内容
        const response = await axios.get(url, {
            timeout: 0, // 无超时限制
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Accept-Encoding': 'gzip, deflate, br',
                'DNT': '1',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1'
            }
        });
        
        const html = response.data;
        const pagePublishedAt = extractPagePublishedAt(html);
        
        // 提取页面标题，优先使用完整标题的提取方法
        let pageTitle = 'Untitled Episode';
        
        // 方法1: 优先从og:title提取（通常是完整标题）
        const ogTitleMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i);
        if (ogTitleMatch && ogTitleMatch[1].trim()) {
            pageTitle = ogTitleMatch[1].trim();
            console.log('✅ 使用og:title提取标题:', pageTitle);
        } else {
            // 方法2: 备用 - 从JSON-LD结构化数据中提取
            const jsonLdMatches = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>(.*?)<\/script>/gs);
            if (jsonLdMatches) {
                for (const jsonLdMatch of jsonLdMatches) {
                    try {
                        const jsonLd = JSON.parse(jsonLdMatch.replace(/<script[^>]*>/, '').replace(/<\/script>/, ''));
                        if (jsonLd.name && jsonLd.name.trim()) {
                            pageTitle = jsonLd.name.trim();
                            console.log('✅ 使用JSON-LD提取标题:', pageTitle);
                            break;
                        }
                    } catch (e) {
                        // 忽略JSON解析错误
                    }
                }
            }
            
            // 方法3: 备用 - 从h1标签提取
            if (pageTitle === 'Untitled Episode') {
                const h1Match = html.match(/<h1[^>]*>(.*?)<\/h1>/i);
                if (h1Match) {
                    const h1Title = h1Match[1].replace(/<[^>]*>/g, '').trim();
                    if (h1Title) {
                        pageTitle = h1Title;
                        console.log('✅ 使用h1标签提取标题:', pageTitle);
                    }
                }
            }
            
            // 方法4: 最后备用 - 从页面title标签提取（通常被截断）
            if (pageTitle === 'Untitled Episode') {
                const titleMatch = html.match(/<title>(.*?)<\/title>/i);
                if (titleMatch) {
                    pageTitle = titleMatch[1].replace(/\s*-\s*Apple Podcasts$/, '').trim();
                    console.log('⚠️ 使用title标签提取标题（可能被截断）:', pageTitle);
                }
            }
        }
        
        // 尝试从网页中提取音频链接
        // 方案1: 查找JSON-LD数据
        const jsonLdMatch = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>(.*?)<\/script>/s);
        if (jsonLdMatch) {
            try {
                const jsonLd = JSON.parse(jsonLdMatch[1]);
                if (jsonLd.url && jsonLd.url.includes('.mp3')) {
                    console.log('✅ 从JSON-LD中找到音频链接');
                    return {
                        audioUrl: jsonLd.url,
                        title: jsonLd.name || pageTitle,
                        description: jsonLd.description || '',
                        publishedAt: jsonLd.datePublished || pagePublishedAt || null
                    };
                }
            } catch (e) {
                console.log('JSON-LD解析失败，继续尝试其他方案');
            }
        }
        
        // 方案2: 查找Acast音频链接
        const acastMatch = html.match(/https?:\/\/[^"'\s]*acast[^"'\s]*\.mp3[^"'\s]*/i);
        if (acastMatch) {
            console.log('✅ 从HTML中找到Acast音频链接');
            return {
                audioUrl: acastMatch[0],
                title: pageTitle,
                description: '',
                publishedAt: pagePublishedAt || null
            };
        }
        
        // 方案3: 查找其他直接音频链接  
        const audioLinkMatch = html.match(/https?:\/\/[^"'\s]+\.(mp3|m4a|wav)[^"'\s]*/);
        if (audioLinkMatch) {
            console.log('✅ 从HTML中找到音频链接');
            return {
                audioUrl: audioLinkMatch[0],
                title: pageTitle,
                description: '',
                publishedAt: pagePublishedAt || null
            };
        }
        
        // 方案4: 查找play按钮的data属性或href
        const playButtonMatch = html.match(/data-url=["']([^"']*\.(mp3|m4a))["']/i) || 
                               html.match(/href=["']([^"']*\.(mp3|m4a))["']/i);
        if (playButtonMatch) {
            console.log('✅ 从播放按钮中找到音频链接');
            return {
                audioUrl: playButtonMatch[1],
                title: pageTitle,
                description: '',
                publishedAt: pagePublishedAt || null
            };
        }
        
        // 方案3: 提示用户手动获取RSS
        const podcastIdMatch = url.match(/id(\d+)/);
        const podcastId = podcastIdMatch ? podcastIdMatch[1] : null;
        
        throw new Error(`Apple Podcasts网络访问受限。解决方案：1) 使用RSS订阅链接 2) 使用直接音频文件URL (.mp3/.m4a) 3) 尝试小宇宙等其他播客平台。播客ID: ${podcastId}`);
        
    } catch (error) {
        if (error.message.includes('建议')) {
            throw error;
        }
        throw new Error(`网页抓取失败: ${error.message}`);
    }
}

/**
 * 处理小宇宙链接 - 使用RSS解析
 */
async function extractXiaoyuzhouAudio(url) {
    try {
        console.log('处理小宇宙链接（RSS解析）...');
        
        // 方法1: 直接从网页抓取音频链接（替代需要认证的API）
        try {
            console.log('从小宇宙网页抓取音频链接...');
            const pageResponse = await axios.get(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                },
                timeout: 15000
            });

            const pageTitle = extractPageTitle(pageResponse.data, ['小宇宙 - 听播客，上小宇宙', '小宇宙']);
            const pageDescription = extractPageDescription(pageResponse.data);
            const pagePublishedAt = extractPagePublishedAt(pageResponse.data);
            
            // 从og:audio meta标签提取音频链接
            const ogAudioMatch = pageResponse.data.match(/<meta\s+property="og:audio"\s+content="([^"]+)"/);
            if (ogAudioMatch) {
                const audioUrl = ogAudioMatch[1];
                console.log('从小宇宙网页og:audio成功获取到音频链接');
                return {
                    audioUrl,
                    title: pageTitle || 'Untitled Episode',
                    description: pageDescription || '',
                    publishedAt: pagePublishedAt || null
                };
            }
            
            // 备用方案：从JSON-LD结构化数据提取
            const jsonLdMatch = pageResponse.data.match(/"contentUrl":"([^"]+\.m4a)"/);
            if (jsonLdMatch) {
                const audioUrl = jsonLdMatch[1];
                console.log('从小宇宙JSON-LD数据获取到音频链接');
                return {
                    audioUrl,
                    title: pageTitle || 'Untitled Episode',
                    description: pageDescription || '',
                    publishedAt: pagePublishedAt || null
                };
            }
            
        } catch (pageError) {
            console.log('小宇宙网页抓取失败，尝试其他方法:', pageError.message);
        }

        // 方法2: 尝试RSS feed
        try {
            const rssUrl = await getXiaoyuzhouRSS(url);
            if (rssUrl) {
                const audioItems = await parseRSSFeed(rssUrl);
                if (audioItems && audioItems.length > 0) {
                    console.log('从小宇宙RSS获取到音频链接');
                    return {
                        audioUrl: audioItems[0].audioUrl,
                        title: audioItems[0].title || 'Untitled Episode',
                        description: audioItems[0].description || '',
                        publishedAt: audioItems[0].pubDate || null
                    };
                }
            }
        } catch (rssError) {
            console.log('小宇宙RSS解析失败:', rssError.message);
        }

        // 方法3: 尝试从页面发现RSS
        try {
            const discoveredRSS = await discoverRSSFromPage(url);
            if (discoveredRSS) {
                const audioItems = await parseRSSFeed(discoveredRSS);
                if (audioItems && audioItems.length > 0) {
                    console.log('从发现的RSS获取到音频链接');
                    return {
                        audioUrl: audioItems[0].audioUrl,
                        title: audioItems[0].title || 'Untitled Episode',
                        description: audioItems[0].description || '',
                        publishedAt: audioItems[0].pubDate || null
                    };
                }
            }
        } catch (discoverError) {
            console.log('RSS发现失败:', discoverError.message);
        }

        // 所有解析方法都失败了
        throw new Error('无法从小宇宙获取音频链接，请检查链接是否有效');

    } catch (error) {
        console.error('小宇宙解析错误:', error);
        throw new Error(`小宇宙音频解析失败: ${error.message}`);
    }
}

/**
 * 处理通用播客链接 - 支持RSS
 */
async function extractGenericPodcastAudio(url) {
    try {
        console.log('处理通用播客链接...');
        
        // 方法1: 检查是否直接是RSS feed
        if (url.includes('.xml') || url.includes('rss') || url.includes('feed')) {
            try {
                console.log('检测到RSS链接，直接解析...');
                const audioItems = await parseRSSFeed(url);
                if (audioItems && audioItems.length > 0) {
                    console.log('从RSS feed获取到音频链接');
                    return {
                        audioUrl: audioItems[0].audioUrl,
                        title: audioItems[0].title || 'Untitled Episode',
                        description: audioItems[0].description || '',
                        publishedAt: audioItems[0].pubDate || null
                    };
                }
            } catch (rssError) {
                console.log('直接RSS解析失败:', rssError.message);
            }
        }

        // 方法2: 尝试从页面获取内容
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
            },
            timeout: 0, // 无超时限制
        });
        const pageTitle = extractPageTitle(response.data);
        const pageDescription = extractPageDescription(response.data);
        const pagePublishedAt = extractPagePublishedAt(response.data);

        // 方法3: 如果响应是XML/RSS
        if (response.data.includes('<rss') || response.data.includes('<?xml')) {
            try {
                console.log('响应内容是RSS，解析...');
                const audioItems = await parseRSSFeed(url);
                if (audioItems && audioItems.length > 0) {
                    return {
                        audioUrl: audioItems[0].audioUrl,
                        title: audioItems[0].title || 'Untitled Episode',
                        description: audioItems[0].description || '',
                        publishedAt: audioItems[0].pubDate || null
                    };
                }
            } catch (xmlError) {
                console.log('XML解析失败:', xmlError.message);
            }
        }

        // 方法4: 查找各种可能的音频链接格式
        const patterns = [
            /(https?:\/\/[^"'\s]+\.(?:mp3|m4a|aac|wav|ogg)(?:\?[^"'\s]*)?)/i,
            /(?:src|href)=["']([^"']+\.(?:mp3|m4a|aac|wav|ogg)(?:\?[^"']*)?)/i,
            /"(https?:\/\/[^"]+(?:podcast|audio|media)[^"]*\.(?:mp3|m4a|aac))"/i,
            /<enclosure[^>]+url=["']([^"']+)["']/i
        ];

        for (const pattern of patterns) {
            const match = response.data.match(pattern);
            if (match) {
                console.log('从页面HTML中找到音频链接');
                return {
                    audioUrl: match[1],
                    title: pageTitle || 'Untitled Episode',
                    description: pageDescription || '',
                    publishedAt: pagePublishedAt || null
                };
            }
        }

        // 方法5: 尝试发现RSS feed
        try {
            const discoveredRSS = await discoverRSSFromPage(url);
            if (discoveredRSS) {
                console.log('发现RSS feed，解析...');
                const audioItems = await parseRSSFeed(discoveredRSS);
                if (audioItems && audioItems.length > 0) {
                    return {
                        audioUrl: audioItems[0].audioUrl,
                        title: audioItems[0].title || 'Untitled Episode',
                        description: audioItems[0].description || '',
                        publishedAt: audioItems[0].pubDate || null
                    };
                }
            }
        } catch (discoverError) {
            console.log('RSS发现失败:', discoverError.message);
        }

        throw new Error('无法找到音频链接 / Cannot find audio URL');

    } catch (error) {
        console.error('通用播客解析错误:', error);
        if (error instanceof PodcastSourceError) {
            throw error;
        }
        throw new Error(`通用播客音频解析失败: ${error.message}`);
    }
}

/**
 * 下载音频文件
 */
async function downloadAudioFile(audioUrl) {
    try {
        console.log(`开始下载音频文件: ${audioUrl}`);

        // 生成临时文件名
        const tempDir = path.join(__dirname, '../temp');
        const fileName = `audio_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const filePath = path.join(tempDir, fileName);

        // 下载文件
        const response = await axios({
            method: 'GET',
            url: audioUrl,
            responseType: 'stream',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
            },
            timeout: 0, // 无超时限制
            maxContentLength: Infinity, // 无大小限制
        });

        // 检查内容类型和长度
        const contentType = response.headers['content-type'];
        const contentLength = response.headers['content-length'];
        console.log(`内容类型: ${contentType}`);
        console.log(`内容长度: ${contentLength ? (parseInt(contentLength) / 1024 / 1024).toFixed(2) + 'MB' : '未知'}`);
        
        // 预检查内容长度
        if (contentLength && parseInt(contentLength) < 1024) {
            throw new Error(`音频文件太小(${contentLength}字节)，可能不是有效的音频文件或链接已过期`);
        }

        // 确定文件扩展名
        let extension = '.mp3'; // 默认
        if (contentType) {
            if (contentType.includes('mp4') || contentType.includes('m4a')) {
                extension = '.m4a';
            } else if (contentType.includes('wav')) {
                extension = '.wav';
            } else if (contentType.includes('aac')) {
                extension = '.aac';
            }
        }

        const finalFilePath = filePath + extension;

        // 写入文件
        const writer = fs.createWriteStream(finalFilePath);
        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on('finish', () => {
                console.log(`音频文件下载完成: ${finalFilePath}`);
                
                // 检查文件大小
                const stats = fs.statSync(finalFilePath);
                const fileSizeMB = stats.size / 1024 / 1024;
                console.log(`文件大小: ${fileSizeMB.toFixed(2)}MB`);
                
                // 验证文件是否有效（至少应该有一些内容）
                if (stats.size < 1024) { // 小于1KB可能不是有效的音频文件
                    fs.unlinkSync(finalFilePath); // 删除无效文件
                    reject(new Error(`下载的文件太小(${stats.size}字节)，可能不是有效的音频文件。可能是链接过期或需要特殊认证。`));
                    return;
                }
                
                resolve(finalFilePath);
            });
            
            writer.on('error', (error) => {
                console.error('文件写入错误:', error);
                reject(error);
            });
            
            // 超时处理
            setTimeout(() => {
                writer.destroy();
                reject(new Error('下载超时 / Download timeout'));
            }, 180000); // 180秒超时（3分钟）
        });

    } catch (error) {
        console.error('下载音频文件错误:', error);
        
        // 不再使用假音频备用方案
        
        throw new Error(`下载失败: ${error.message} / Download failed: ${error.message}`);
    }
}

module.exports = {
    downloadPodcastAudio,
    extractAudioUrl,
    downloadAudioFile
};
