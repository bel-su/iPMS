import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'iPMS | Project delivery',
    short_name: 'iPMS',
    description: 'Integrated project management and quality operations.',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#0b63b8',
    icons: [
      { src: '/brand/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/brand/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/brand/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
