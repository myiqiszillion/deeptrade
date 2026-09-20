/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          bg: '#0c0e12',
          surface: '#14171f',
          surfaceHover: '#1c212d',
          border: '#232936',
          text: '#e1e7f0',
          muted: '#808ea0',
          bid: '#00c087',
          bidDim: 'rgba(0, 192, 135, 0.15)',
          ask: '#f6465d',
          askDim: 'rgba(246, 70, 93, 0.15)',
          poc: '#f0b90b',
          val: '#3b82f6',
          imbalance: '#f59e0b',
          deltaPos: '#10b981',
          deltaNeg: '#ef4444',
          whale: '#8b5cf6'
        }
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', 'Consolas', 'Menlo', 'monospace'],
        sans: ['Inter', 'system-ui', 'sans-serif']
      }
    },
  },
  plugins: [],
}
