/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './ui/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  darkMode: 'class',
  theme: {
    extend: {
      // A single warm accent to break the neutral palette; the app leads with
      // near-black primary actions and reserves this teal for status, links
      // and selected states.
      colors: {
        accent: {
          50: '#effcf6',
          100: '#c6f7e2',
          200: '#8eedc7',
          300: '#65d6ad',
          400: '#3ebd93',
          500: '#27ab83',
          600: '#199473',
          700: '#147d64',
          800: '#0c6b58',
          900: '#014d40',
        },
      },
      // Softer defaults: buttons and cards read as slightly floating on
      // a warm off-white / true-dark background rather than iOS glass.
      boxShadow: {
        soft: '0 1px 2px rgba(15, 23, 42, 0.04), 0 1px 3px rgba(15, 23, 42, 0.06)',
        raised: '0 4px 12px rgba(15, 23, 42, 0.06), 0 2px 4px rgba(15, 23, 42, 0.04)',
      },
    },
  },
}
