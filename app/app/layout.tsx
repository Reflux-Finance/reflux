import type { Metadata } from 'next';
import { Space_Grotesk, IBM_Plex_Mono } from 'next/font/google';
import { Providers } from '../components/Providers';
import { NavBar } from '../components/NavBar';
import './globals.css';

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-space-grotesk',
  weight: ['400', '500', '600', '700'],
  display: 'swap',
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  variable: '--font-ibm-plex-mono',
  weight: ['400', '500'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Reflux — Structured Yield OS for Sui',
  description:
    'A dUSDC-native capital system that converts any Sui asset into structured volatility and staking yield across DeepBook Predict, Margin, and Iron Bank.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${spaceGrotesk.variable} ${ibmPlexMono.variable}`}>
      <body
        style={{ fontFamily: "var(--font-space-grotesk, 'Inter', sans-serif)" }}
        className="antialiased min-h-screen flex flex-col"
      >
        <Providers>
          {/* ── Top navigation ─────────────────────────────────────── */}
          <NavBar />

          {/* ── Page content ───────────────────────────────────────── */}
          <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-8">
            {children}
          </main>

          {/* ── Footer ─────────────────────────────────────────────── */}
          <footer
            className="mt-auto py-6 px-6"
            style={{ borderTop: '1px solid var(--border-subtle)' }}
          >
            <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                © 2026 Reflux · Sui Overflow · DeepBook Predict Track
              </span>
              <div className="flex items-center gap-4 text-xs" style={{ color: 'var(--text-muted)' }}>
                <a
                  href="https://predict-server.testnet.mystenlabs.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-teal-400 transition-colors"
                >
                  Indexer
                </a>
                <a href="/risk" className="hover:text-teal-400 transition-colors">
                  Risk Dashboard
                </a>
                <a
                  href="https://suiexplorer.com/?network=testnet"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-teal-400 transition-colors"
                >
                  Explorer
                </a>
              </div>
            </div>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
