import './globals.css';
export const metadata = {
  title: 'TruthLens AI — Check the claims',
  description: 'Check claims, books, and websites. See the evidence behind each verdict.',
  icons: { icon: '/truthlens-logo.png', apple: '/truthlens-logo.png' },
  manifest: '/manifest.webmanifest',
  openGraph: {
    title: 'TruthLens AI — Check the claims',
    description: 'Check claims, books, and websites. See the evidence behind each verdict.',
    type: 'website',
    images: ['/truthlens-logo.png'],
  },
  twitter: { card: 'summary', title: 'TruthLens AI — Check the claims', description: 'Check claims, books, and websites. See the evidence behind each verdict.' },
  robots: 'index, follow',
};
export const viewport = { themeColor: '#090D16', width: 'device-width', initialScale: 1 };
const THEME_BOOT_SCRIPT = `(function(){try{var s=localStorage.getItem('truthlens-theme');var t=s==='light'||s==='dark'?s:(matchMedia('(prefers-color-scheme: light)').matches?'light':'dark');document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=t;var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute('content',t==='light'?'#eef1f6':'#090D16');}catch(e){document.documentElement.dataset.theme='dark';}})();`;
export default function RootLayout({ children }) {
  return (<html lang="en" data-theme="dark" suppressHydrationWarning><head>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@600;700;800&display=swap" />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200" />
</head><body>
<script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
{children}<footer className="provenance"><span>© 2026 TruthLens AI</span></footer></body></html>);
}
