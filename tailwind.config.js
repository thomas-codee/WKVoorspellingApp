export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      boxShadow: {
        glass: '0 20px 60px rgba(0, 0, 0, 0.22)',
      },
      backgroundImage: {
        'frosted-radial': 'radial-gradient(circle at top, rgba(110, 211, 255, 0.22), transparent 45%), linear-gradient(180deg, rgba(10, 15, 35, 1), rgba(10, 15, 35, 0.97))',
      },
      colors: {
        electric: '#64d9ff',
        neon: '#7c3aed',
      },
    },
  },
  plugins: [],
};
