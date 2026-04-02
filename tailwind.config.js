/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'sans-serif'],
        display: ['"IBM Plex Sans"', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'monospace']
      },
      boxShadow: {
        workspace: '0 18px 48px rgba(29, 28, 29, 0.08)'
      }
    }
  },
  daisyui: {
    themes: [
      {
        studio: {
          primary: '#611f69',
          'primary-content': '#faf7fb',
          secondary: '#611f69',
          'secondary-content': '#faf7fb',
          accent: '#1264a3',
          'accent-content': '#f6fbff',
          neutral: '#3f0f40',
          'neutral-content': '#f8f7fb',
          'base-100': '#ffffff',
          'base-200': '#f8f8f8',
          'base-300': '#dddcdc',
          'base-content': '#1d1c1d',
          info: '#1d9bd1',
          success: '#611f69',
          warning: '#b05f00',
          error: '#c03432'
        }
      },
      {
        'studio-dark': {
          primary: '#7a2e86',
          'primary-content': '#fbf7fc',
          secondary: '#7f4b85',
          'secondary-content': '#f9f5fa',
          accent: '#36c5f0',
          'accent-content': '#061117',
          neutral: '#221126',
          'neutral-content': '#f6f3f9',
          'base-100': '#1a1d21',
          'base-200': '#22262b',
          'base-300': '#3a4047',
          'base-content': '#f3f4f6',
          info: '#36c5f0',
          success: '#7a2e86',
          warning: '#ecb22e',
          error: '#e01e5a'
        }
      }
    ]
  },
  plugins: [require('daisyui')]
};
