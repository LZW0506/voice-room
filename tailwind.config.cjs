/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'selector',
  content: ['./src/**/*.{html,tsx}'],
  theme: {
    colors: {
      base: 'var(--base)',
      primary: 'var(--primary)',
      black: 'var(--text-base)',
      border: '#dee2e6',
      icon: '#6c757d'
    },
    extend: {
      height: {
        'header-full': 'var(--header-height)',
        'content-full': 'calc(100% - var(--header-height))'
      }
    }
  },
  plugins: []
}
