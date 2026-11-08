/** @type {import('next').NextConfig} */
const nextConfig = {
  // The floating dev badge sat on top of the sidebar credit.
  devIndicators: false,
  // Lets a second dev server (e.g. the demo) run alongside without sharing build output.
  distDir: process.env.NEXT_DIST_DIR || ".next",
};
export default nextConfig;
