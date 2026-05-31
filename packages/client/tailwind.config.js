/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        cyber: {
          bg: "#0a0e17",
          grid: "#1a2744",
          accent: "#00f0ff",
          glow: "#7b61ff",
        },
      },
    },
  },
  plugins: [],
};
