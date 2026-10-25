import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // A 股惯例：涨红跌绿
        up: '#D9342B',
        down: '#1E9E62',
        ink: {
          900: '#12161C',
          700: '#333B45',
          500: '#5C6673',
          400: '#8A939F',
          300: '#B6BEC8',
          200: '#DCE1E7',
          100: '#EEF1F5',
          50: '#F7F9FB',
        },
        accent: {
          DEFAULT: '#2F5FE0',
          soft: '#EAF0FE',
          700: '#1F45AC',
        },
        warnSoft: '#FDF3E3',
        warnLine: '#C8871A',
        dangerSoft: '#FCECEA',
      },
      fontFamily: {
        sans: [
          '"PingFang SC"',
          '"Microsoft YaHei"',
          '"Source Han Sans SC"',
          'system-ui',
          'sans-serif',
        ],
        num: ['"SF Mono"', 'Consolas', '"Roboto Mono"', 'monospace'],
      },
      borderRadius: {
        card: '10px',
      },
    },
  },
  plugins: [],
};

export default config;
