/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#07090d',
          900: '#0b0e14',
          850: '#0f131b',
          800: '#131822',
          750: '#171d29',
          700: '#1c2431',
          600: '#26303f',
          500: '#38455a',
        },
        accent: {
          DEFAULT: '#7c5cff',
          soft: '#9b83ff',
          deep: '#5b3ce6',
        },
        cyan: {
          DEFAULT: '#22d3ee',
          deep: '#0e9bb3',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Microsoft YaHei', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      boxShadow: {
        panel: '0 8px 30px rgba(0,0,0,.45)',
        pop: '0 16px 60px rgba(0,0,0,.55)',
      },
      keyframes: {
        fadeIn: { '0%': { opacity: '0', transform: 'translateY(4px)' }, '100%': { opacity: '1', transform: 'none' } },
        pulseSoft: { '0%,100%': { opacity: '0.35' }, '50%': { opacity: '0.9' } },
      },
      animation: {
        fadeIn: 'fadeIn .16s ease-out',
        pulseSoft: 'pulseSoft 1.6s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
