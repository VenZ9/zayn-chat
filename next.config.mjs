/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // /api/chat returns a plain-text stream that has to reach the browser token by
  // token. Next only compresses content types it considers compressible, but
  // keep it off explicitly instead of relying on that list.
  compress: false,
};

export default nextConfig;
