/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#08080a',
          900: '#0e0e11',
          850: '#131317',
          800: '#181820',
          750: '#1d1d25',
          700: '#26262f',
          600: '#32323d',
          500: '#43434f',
        },
        accent: {
          DEFAULT: '#0aa7ff',
          soft: '#5cc8ff',
          deep: '#0680c8',
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
