import './globals.css'
import { Analytics } from '@vercel/analytics/next'

export const metadata = {
  title: 'زكّاها — Zakkaha',
  description: 'القرآن الكريم · الأذكار اليومية · ختمة القرآن · المرشد الروحاني',
  manifest: '/manifest.json',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'زكّاها' },
  formatDetection: { telephone: false },
  other: {
    'mobile-web-app-capable': 'yes',
    'apple-mobile-web-app-capable': 'yes',
    'apple-mobile-web-app-status-bar-style': 'black-translucent',
  }
}

export const viewport = {
  themeColor: '#060e09',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
}

export default function RootLayout({ children }) {
  return (
    <html lang="ar">
      <head>
        {/* Amiri — Quran-grade Arabic font */}
        <link rel="preconnect" href="https://fonts.googleapis.com"/>
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous"/>
        <link href="https://fonts.googleapis.com/css2?family=Amiri:ital,wght@0,400;0,700;1,400&display=swap" rel="stylesheet"/>
        {/* PWA */}
        <link rel="manifest" href="/manifest.json"/>
        <link rel="apple-touch-icon" href="/icons/icon-192.png"/>
        <meta name="theme-color" content="#060e09"/>
        <meta name="apple-mobile-web-app-capable" content="yes"/>
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"/>
        <meta name="apple-mobile-web-app-title" content="زكّاها"/>
      </head>
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  )
}
