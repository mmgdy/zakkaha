/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: '/api/quran/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=604800, stale-while-revalidate=86400' },
          { key: 'Access-Control-Allow-Origin', value: '*' },
        ],
      },
      {
        source: '/api/audio/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=604800' },
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Accept-Ranges', value: 'bytes' },
        ],
      },
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cube.paysky.io:6006 https://pgw.paysky.io",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "font-src 'self' https://fonts.gstatic.com",
              "connect-src 'self' https://api.openai.com https://api.groq.com https://cube.paysky.io:6006 https://pgw.paysky.io",
              "frame-src https://cube.paysky.io:6006 https://pgw.paysky.io",
              "img-src 'self' data: https:",
              "media-src 'self' blob:",
            ].join('; ')
          }
        ]
      }
    ]
  }
}
export default nextConfig
