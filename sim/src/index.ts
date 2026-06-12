/**
 * Reflux simulation harness entrypoint.
 *
 * Pipeline:
 *   1. fetch-history  → load ≥200 historical expiries
 *   2. engine replay  → compute allocation targets + simulate PnL per roll
 *   3. stress scenarios → 6 synthetic scenarios
 *   4. report         → write SIMULATION.md
 *
 * Usage:
 *   pnpm sim [--indexer <url>] [--out <path>]
 *   node dist/index.js
 */

import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readEnv } from '@reflux/lib';
import { loadHistory } from './fetch-history.js';
import { replayExpiries } from './engine.js';
import { buildAllScenarios } from './scenarios.js';
import { buildScenarioResult, buildReport, renderMarkdown } from './report.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const env = readEnv(process.env as Record<string, string>);
  const indexerUrl = env.NEXT_PUBLIC_PREDICT_SERVER;
  const outPath = process.argv.find((a) => a.startsWith('--out='))?.slice(6)
    ?? join(__dirname, '../../SIMULATION.md');

  console.log('Reflux Simulation Harness');
  console.log('Indexer:', indexerUrl);

  // Step 1: Load history (≥200 expiries)
  console.log('Fetching history...');
  const history = await loadHistory(indexerUrl, 200);
  console.log(`Loaded ${history.length} expiries.`);

  // Step 2: Replay real history
  const replaySteps = replayExpiries(history);
  console.log(`Replayed ${replaySteps.length} rolls.`);

  // Step 3: Run stress scenarios (6 scenarios × 50 rolls each = 300 rolls)
  const scenarios = buildAllScenarios(50);
  const results = scenarios.map(({ label, expiries }) =>
    buildScenarioResult(label, expiries),
  );

  // Step 4: Build and write report
  const totalExpiries = history.length + scenarios.reduce((a, s) => a + s.expiries.length, 0);
  const report = buildReport(results, totalExpiries);
  const markdown = renderMarkdown(report);

  writeFileSync(outPath, markdown, 'utf8');
  console.log(`\nSIMULATION.md written to ${outPath}`);
  console.log(`Total expiries replayed: ${report.nExpiriesReplayed}`);
  console.log('\nScenario summary:');
  for (const r of report.scenarios) {
    const pnlPct = (Number(r.totalPnlDusdc) / 1e8).toFixed(2);
    console.log(`  ${r.scenarioName}: ${r.nRolls} rolls, PnL ${pnlPct}% of initial NAV, maxDD=${r.maxDrawdownBps}bps`);
  }
}

main().catch((err) => {
  console.error('Simulation failed:', err);
  process.exit(1);
});
