import Link from 'next/link';
import { ProtocolStats } from '../components/ProtocolStats';

const LAYERS = [
  {
    tag: 'INPUT',
    color: '#8B98A8',
    border: 'rgba(139,152,168,0.2)',
    title: 'Any Sui asset',
    items: ['Native SUI', 'vSUI · afSUI · haSUI', 'USDC (from anywhere)', 'xBTC · sBTC'],
  },
  {
    tag: 'ENGINE',
    color: '#00D4C8',
    border: 'rgba(0,212,200,0.3)',
    title: 'dUSDC-native allocation engine',
    items: [
      'DeepBook Predict — PLP supply + range strips',
      'deepbook_margin — leverage against SUI/LSD collateral',
      'DeepBook Spot — asset conversion at deposit/exit',
      'Iron Bank — idle capital parking + instant-exit buffer',
    ],
    highlight: true,
  },
  {
    tag: 'OUTPUT',
    color: '#F5A623',
    border: 'rgba(245,166,35,0.25)',
    title: 'rfUSD',
    items: [
      'Single transferable share token',
      'dUSDC-denominated NAV',
      'Composable · auditable',
      'Instant exits under buffer cap',
    ],
  },
];

const FEATURES = [
  {
    icon: '⚡',
    title: 'Instant exits',
    body: 'Withdrawals under the buffer cap settle immediately — no waiting for Predict positions to expire.',
  },
  {
    icon: '🔍',
    title: 'Transparent decisions',
    body: 'Every allocation change emits an on-chain AllocationDecision event with the exact IV trigger, regime, and weight delta.',
  },
  {
    icon: '🛡',
    title: 'Trustless safety',
    body: 'Emergency deleverage is callable by anyone when LTV is breached. Hard caps cannot be exceeded even by admin.',
  },
  {
    icon: '📊',
    title: 'Vol-regime aware',
    body: 'The allocator reads the live DeepBook SVI surface and shifts capital toward range premia when IV is rich.',
  },
];

export default function Home() {
  return (
    <div className="space-y-20">
      {/* ── Hero ─────────────────────────────────────────────────── */}
      <section className="pt-10 pb-4 text-center space-y-6">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium mb-2"
          style={{ background: 'var(--teal-dim)', border: '1px solid var(--teal-border)', color: 'var(--teal-light)' }}>
          <span className="status-dot status-dot-green" />
          Live on Sui testnet · DeepBook Predict track
        </div>

        <h1 className="text-5xl sm:text-6xl font-bold tracking-tight leading-[1.08]">
          <span className="gradient-text">Structured Yield OS</span>
          <br />
          <span style={{ color: 'var(--text-primary)' }}>for Sui</span>
        </h1>

        <p className="max-w-2xl mx-auto text-lg leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          A dUSDC-native capital system that converts any Sui asset into structured
          volatility and staking yield across DeepBook Predict, Margin, and Iron Bank.
        </p>

        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link href="/deposit" className="btn-teal px-6 py-3 text-sm">
            Start earning
          </Link>
          <Link href="/risk" className="btn-ghost px-6 py-3 text-sm">
            Risk dashboard →
          </Link>
        </div>
      </section>

      {/* ── Protocol stats (TVL live from chain) ─────────────────── */}
      <ProtocolStats />

      {/* ── Three-layer architecture ─────────────────────────────── */}
      <section className="space-y-4">
        <div className="text-center mb-8">
          <h2 className="text-2xl font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
            One deposit. Three layers.
          </h2>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Deposit any asset — receive rfUSD. The engine handles the rest.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-stretch">
          {LAYERS.map((layer, i) => (
            <div key={layer.tag} className="relative flex flex-col">
              {/* Connector arrow */}
              {i < 2 && (
                <div
                  className="hidden md:flex absolute -right-3 top-1/2 -translate-y-1/2 z-10 items-center justify-center w-6 h-6 rounded-full text-xs"
                  style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', color: 'var(--text-muted)' }}
                >
                  →
                </div>
              )}

              <div
                className="flex-1 rounded-xl p-5 space-y-4"
                style={{
                  background: layer.highlight ? 'linear-gradient(135deg, #0D1117 0%, rgba(0,212,200,0.04) 100%)' : 'var(--bg-panel)',
                  border: `1px solid ${layer.border}`,
                }}
              >
                <div className="flex items-center justify-between">
                  <span
                    className="text-[10px] font-mono font-semibold tracking-widest px-2 py-1 rounded"
                    style={{ background: `${layer.color}15`, color: layer.color, border: `1px solid ${layer.border}` }}
                  >
                    {layer.tag}
                  </span>
                </div>
                <div>
                  <div className="font-semibold mb-3" style={{ color: layer.highlight ? 'var(--teal-light)' : 'var(--text-primary)' }}>
                    {layer.title}
                  </div>
                  <ul className="space-y-1.5">
                    {layer.items.map((item) => (
                      <li key={item} className="flex items-start gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                        <span style={{ color: layer.color, marginTop: '2px', flexShrink: 0 }}>·</span>
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────────────── */}
      <section className="space-y-6">
        <h2 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
          Why Reflux
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {FEATURES.map(({ icon, title, body }) => (
            <div
              key={title}
              className="card-elevated flex gap-4 card-interactive rounded-xl p-5"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}
            >
              <span className="text-2xl flex-shrink-0">{icon}</span>
              <div>
                <div className="font-semibold text-sm mb-1.5" style={{ color: 'var(--text-primary)' }}>{title}</div>
                <div className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{body}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── CTA row ──────────────────────────────────────────────── */}
      <section
        className="rounded-2xl p-8 text-center space-y-4"
        style={{ background: 'linear-gradient(135deg, var(--bg-panel) 0%, rgba(0,212,200,0.04) 100%)', border: '1px solid var(--teal-border)' }}
      >
        <h2 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
          Ready to earn structured yield?
        </h2>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          Deposit from a CEX withdrawal, Wormhole bridge, or any wallet — plain USDC works.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
          <Link href="/deposit" className="btn-teal px-8 py-3">
            Deposit USDC
          </Link>
          <Link href="/risk" className="btn-ghost px-6 py-3">
            View live risk data
          </Link>
        </div>
      </section>
    </div>
  );
}
