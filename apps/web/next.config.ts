import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  // Default 1mb is too small for a 5mb template workbook uploaded through the import server action.
  experimental: { serverActions: { bodySizeLimit: '6mb' } },
  async headers() {
    const scriptSrc = process.env.NODE_ENV === 'production'
      ? "script-src 'self' 'unsafe-inline'"
      : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              scriptSrc,
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: http://localhost:* http://127.0.0.1:* https:",
              "media-src 'self' data: blob: http://localhost:* http://127.0.0.1:* https:",
              "font-src 'self' data:",
              "connect-src 'self' http://localhost:* ws://localhost:* http://127.0.0.1:* ws://127.0.0.1:* https:",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join('; '),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
