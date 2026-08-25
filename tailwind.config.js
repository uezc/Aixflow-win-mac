/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./public/index.html",
    "./manage-my-aixflow-content.html",
    "./src/renderer/**/*.{js,ts,jsx,tsx}",
    "./src/website/**/*.{js,ts,jsx,tsx}",
    "./src/glass-installer/**/*.{js,ts,jsx,tsx}",
    "./glass-installer.html",
  ],
  theme: {
    extend: {
      fontFamily: {
        body: ['"PP Neue Montreal"', 'system-ui', '-apple-system', 'sans-serif'],
        serif: ['"PP Mondwest"', 'Georgia', 'serif'],
      },
      animation: {
        marquee: 'marquee 30s linear infinite',
        'marquee-mobile': 'marquee 10s linear infinite',
      },
      keyframes: {
        marquee: {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' },
        },
      },
      colors: {
        'apple-blue': '#0A84FF',
        'apple-panel': 'rgba(28, 28, 30, 0.7)',
        vo: {
          dark: '#051A24',
          heading: '#0D212C',
          muted: '#273C46',
          light: '#F6FCFF',
          'light-muted': '#E0EBF0',
        },
      },
      boxShadow: {
        'vo-primary':
          '0 1px 2px 0 rgba(5,26,36,0.1), 0 4px 4px 0 rgba(5,26,36,0.09), 0 9px 6px 0 rgba(5,26,36,0.05), 0 17px 7px 0 rgba(5,26,36,0.01), 0 26px 7px 0 rgba(5,26,36,0), inset 0 2px 8px 0 rgba(255,255,255,0.5)',
        'vo-secondary': '0 0 0 0.5px rgba(0,0,0,0.05), 0 4px 30px rgba(0,0,0,0.08)',
      },
      backdropBlur: {
        'md': '12px',
      },
      backdropSaturate: {
        '150': '150%',
      },
    },
  },
  plugins: [],
}
