import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  // Default 1mb is too small for a 5mb template workbook uploaded through the import server action.
  experimental: { serverActions: { bodySizeLimit: '6mb' } },
};

export default nextConfig;
