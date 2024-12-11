/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'selector',
  content: ['./src/**/*.{html,tsx}'],
  theme: {
    colors: {
      base: 'var(--base)',
      primary: 'var(--primary)',
      black: 'var(--text-base)'
    },
    extend: {
      height: {
        'content-full': 'calc(100vh - 2.25rem)'
      }
    }
  },
  plugins: []
}
