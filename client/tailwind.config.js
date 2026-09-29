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
        terminal: {
          bg: '#080B0F',
          bgSecondary: '#0B0F14',
          bgTertiary: '#10151C',
          panel: '#0D1218',
          panelHeader: '#111720',
          border: '#1C2630',
          borderActive: '#25303A',
          borderFocus: '#3A4756',
          textPrimary: '#E7EDF3',
          textSecondary: '#7F8B97',
          textMuted: '#4E5965',
          buy: '#19C37D',
          sell: '#F05252',
          delta: '#22D3EE',
          cvd: '#A78BFA',
          vwap: '#F5B942',
          warning: '#F5B942',
          whale: '#38BDF8',
        },
        brand: {
          bg: '#080B0F',
          surface: '#0D1218',
          surfaceHover: '#111720',
          border: '#1C2630',
          text: '#E7EDF3',
          muted: '#7F8B97',
          bid: '#19C37D',
          bidDim: 'rgba(25, 195, 125, 0.12)',
          ask: '#F05252',
          askDim: 'rgba(240, 82, 82, 0.12)',
          poc: '#F5B942',
          val: '#3B82F6',
          imbalance: '#F5B942',
          deltaPos: '#19C37D',
          deltaNeg: '#F05252',
          whale: '#38BDF8'
        }
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', '"IBM Plex Mono"', 'Consolas', 'Menlo', 'monospace'],
        sans: ['Inter', '"IBM Plex Sans"', 'system-ui', '-apple-system', 'sans-serif']
      }
    },
  },
  plugins: [],
}

