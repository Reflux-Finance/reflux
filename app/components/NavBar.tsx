'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { WalletButton } from './WalletButton';

const NAV_LINKS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/deposit',   label: 'Deposit'   },
  { href: '/trade',     label: 'Trade'     },
  { href: '/strategy',  label: 'Strategy'  },
  { href: '/risk',      label: 'Risk'      },
];

export function NavBar() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <header
      className="sticky top-0 z-50"
      style={{
        background: 'rgba(8,12,16,0.92)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
        {/* Logo */}
        <Link
          href="/"
          className="flex items-center gap-2.5 flex-shrink-0"
          onClick={() => setOpen(false)}
        >
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
            <polygon
              points="11,1 20,5.5 20,16.5 11,21 2,16.5 2,5.5"
              fill="none"
              stroke="#00D4C8"
              strokeWidth="1.5"
            />
            <polygon
              points="11,5.5 16.5,8.5 16.5,14.5 11,17.5 5.5,14.5 5.5,8.5"
              fill="#00D4C8"
              opacity="0.18"
            />
            <line x1="11" y1="5.5" x2="11" y2="17.5" stroke="#00D4C8" strokeWidth="1" opacity="0.5" />
            <line x1="5.5" y1="8.5" x2="16.5" y2="14.5" stroke="#00D4C8" strokeWidth="1" opacity="0.5" />
            <line x1="16.5" y1="8.5" x2="5.5" y2="14.5" stroke="#00D4C8" strokeWidth="1" opacity="0.5" />
          </svg>
          <span className="text-base font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
            Reflux
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-1">
          {NAV_LINKS.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className={`nav-link px-3 py-1.5 text-sm font-medium transition-colors ${
                pathname === href ? 'text-teal-400' : ''
              }`}
            >
              {label}
            </Link>
          ))}
        </nav>

        {/* Right side */}
        <div className="flex items-center gap-2">
          {/* Network badge */}
          <span
            className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono font-medium"
            style={{
              background: 'rgba(0,212,200,0.08)',
              border: '1px solid rgba(0,212,200,0.2)',
              color: '#33DDD8',
            }}
          >
            <span className="status-dot status-dot-green" />
            testnet
          </span>

          {/* Wallet button — always visible */}
          <WalletButton />

          {/* Hamburger — mobile only */}
          <button
            className="md:hidden flex flex-col justify-center items-center w-8 h-8 gap-1.5 rounded focus:outline-none focus:ring-2 focus:ring-teal-500/40"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
          >
            <span
              className={`block h-0.5 w-5 bg-gray-400 transition-transform duration-200 ${open ? 'translate-y-2 rotate-45' : ''}`}
            />
            <span
              className={`block h-0.5 w-5 bg-gray-400 transition-opacity duration-200 ${open ? 'opacity-0' : ''}`}
            />
            <span
              className={`block h-0.5 w-5 bg-gray-400 transition-transform duration-200 ${open ? '-translate-y-2 -rotate-45' : ''}`}
            />
          </button>
        </div>
      </div>

      {/* Mobile dropdown */}
      {open && (
        <div
          className="md:hidden border-t"
          style={{
            background: 'rgba(8,12,16,0.97)',
            borderColor: 'rgba(255,255,255,0.06)',
          }}
        >
          <nav className="flex flex-col px-4 py-3 gap-1">
            {NAV_LINKS.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                onClick={() => setOpen(false)}
                className={`px-3 py-3 rounded-lg text-sm font-medium transition-colors ${
                  pathname === href
                    ? 'bg-teal-950/40 text-teal-300'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                {label}
              </Link>
            ))}
            {/* Network badge in mobile menu */}
            <div className="mt-2 pt-2 border-t border-white/5 flex items-center gap-1.5 px-3 py-1 text-[11px] font-mono text-teal-400">
              <span className="status-dot status-dot-green" />
              testnet
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
