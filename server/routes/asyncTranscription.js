/**
 * 异步转录处理路由
 * 解决长时间转录导致的HTTP超时问题
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const { processAudioWithOpenAI } = require('../services/openaiService');
const { saveTranscriptionResults } = require('../utils/fileSaver');

const router = express.Router();

// 存储任务状态
const tasks = new Map();

/**
 * 启动异步转录任务
 * POST /api/transcription/start
 */
router.post('/start', async (req, res) => {
    try {
        const { filename, operation = 'transcribe_only', outputLanguage = 'zh' } = req.body;
        
        if (!filename) {
            return res.status(400).json({
                success: false,
                error: '缺少文件名参数'
            });
        }
        
        const tempDir = path.join(__dirname, '..', 'temp');
        const filePath = path.join(tempDir, filename);
        
        // 安全检查
        if (!filePath.startsWith(tempDir) || !fs.existsSync(filePath)) {
            return res.status(400).json({
                success: false,
                error: '文件不存在或路径无效'
            });
        }
        
        // 生成任务ID
        const taskId = `task_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        
        // 初始化任务状态
        tasks.set(taskId, {
            id: taskId,
            status: 'queued', // queued, processing, completed, failed
            progress: 0,
            filename,
            operation,
            outputLanguage,
            startTime: new Date(),
            result: null,
            error: null,
            savedFiles: []
        });
        
        // 立即返回任务ID，不等待处理完成
        res.json({
            success: true,
            taskId,
            message: '转录任务已启动，请使用任务ID查询进度'
        });
        
        // 异步处理转录
        processTranscriptionAsync(taskId, filePath, operation === 'transcribe_summarize', outputLanguage);
        
    } catch (error) {
        console.error('启动转录任务失败:', error);
        res.status(500).json({
            success: false,
            error: error.message || '启动任务失败'
        });
    }
});

/**
 * 查询任务状态
 * GET /api/transcription/status/:taskId
 */
router.get('/status/:taskId', (req, res) => {
    const { taskId } = req.params;
    const task = tasks.get(taskId);
    
    if (!task) {
        return res.status(404).json({
            success: false,
            error: '任务未找到'
        });
    }
    
    // 返回任务状态，但不包含完整结果（避免响应过大）
    const response = {
        success: true,
        task: {
            id: task.id,
            status: task.status,
            progress: task.progress,
            filename: task.filename,
            operation: task.operation,
            startTime: task.startTime,
            savedFiles: task.savedFiles
        }
    };
    
    // 如果任务完成，包含部分结果信息
    if (task.status === 'completed' && task.result) {
        response.task.hasTranscript = !!task.result.transcript;
        response.task.hasSummary = !!task.result.summary;
        response.task.transcriptLength = task.result.transcript ? task.result.transcript.length : 0;
    }
    
    // 如果任务失败，包含错误信息
    if (task.status === 'failed') {
        response.task.error = task.error;
    }
    
    res.json(response);
});

/**
 * 获取任务结果
 * GET /api/transcription/result/:taskId
 */
router.get('/result/:taskId', (req, res) => {
    const { taskId } = req.params;
    const task = tasks.get(taskId);
    
    if (!task) {
        return res.status(404).json({
            success: false,
            error: '任务未找到'
        });
    }
    
    if (task.status !== 'completed') {
        return res.status(400).json({
            success: false,
            error: `任务未完成，当前状态: ${task.status}`
        });
    }
    
    // 返回完整结果
    res.json({
        success: true,
        data: {
            ...task.result,
            savedFiles: task.savedFiles
        }
    });
});

/**
 * 删除任务
 * DELETE /api/transcription/:taskId
 */
router.delete('/:taskId', (req, res) => {
    const { taskId } = req.params;
    const deleted = tasks.delete(taskId);
    
    res.json({
        success: deleted,
        message: deleted ? '任务已删除' : '任务未找到'
    });
});

/**
 * 异步处理转录任务
 */
async function processTranscriptionAsync(taskId, filePath, shouldSummarize, outputLanguage) {
    const task = tasks.get(taskId);
    if (!task) return;
    
    try {
        console.log(`🚀 开始异步转录任务: ${taskId}`);
        
        // 更新任务状态
        task.status = 'processing';
        task.progress = 5;
        
        // 执行转录
        console.log(`🎤 处理文件: ${task.filename}`);
        const result = await processAudioWithOpenAI([filePath], shouldSummarize, outputLanguage, null, 'auto');
        
        task.progress = 80;
        
        // 保存文件
        console.log(`💾 保存转录结果...`);
        const tempDir = path.dirname(filePath);
        const savedFiles = saveTranscriptionResults(result, tempDir, shouldSummarize);
        
        // 任务完成
        task.status = 'completed';
        task.progress = 100;
        task.result = result;
        task.savedFiles = savedFiles;
        task.completedTime = new Date();
        
        console.log(`✅ 异步转录任务完成: ${taskId}`);
        
    } catch (error) {
        console.error(`❌ 异步转录任务失败: ${taskId}`, error);
        
        task.status = 'failed';
        task.error = error.message;
        task.failedTime = new Date();
    }
}

/**
 * 清理过期任务（可选的定期清理）
 */
function cleanupExpiredTasks() {
    const now = new Date();
    const maxAge = 24 * 60 * 60 * 1000; // 24小时
    
    let cleanedCount = 0;
    for (const [taskId, task] of tasks.entries()) {
        const taskAge = now - task.startTime;
        if (taskAge > maxAge) {
            tasks.delete(taskId);
            cleanedCount++;
        }
    }
    
    if (cleanedCount > 0) {
        console.log(`🧹 清理了 ${cleanedCount} 个过期任务`);
    }
}

// 每小时清理一次过期任务
setInterval(cleanupExpiredTasks, 60 * 60 * 1000);

module.exports = router;
