import type { Metadata } from 'next';
import { Toaster } from 'sonner';
import './globals.css';

export const metadata: Metadata = {
  title: 'Store Admin',
  description: 'Business management dashboard.',
};

// Applies a saved theme preference before first paint, matching the
// storefront's convention (see js/cart.js) of avoiding a flash of the
// wrong theme. Must run before any CSS renders.
const THEME_INIT_SCRIPT = `
(function () {
  try {
    var saved = localStorage.getItem('theaamghar_admin_theme');
    if (saved === 'light' || saved === 'dark') {
      document.documentElement.setAttribute('data-theme', saved);
    }
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className="h-full antialiased"
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col">
        {children}
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
