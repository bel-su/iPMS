import type { Metadata } from 'next';
import './styles.css';

export const metadata: Metadata = {
  title: 'iPMS | Project delivery',
  description: 'Integrated project management and quality operations.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
