import { bold, underline, cyan, magenta, green, yellow, gray } from './logger.js';
import { tag } from './logger.js';

export interface StatsState {
  minuteWindowStart: number;
  seenSpreads: number;
  candidates: number;
  executed: number;
  bestNet: number;
  netSum: number;
  nearMiss: number;
}

export const stats: StatsState = {
  minuteWindowStart: Date.now(),
  seenSpreads: 0,
  candidates: 0,
  executed: 0,
  bestNet: -Infinity,
  netSum: 0,
  nearMiss: 0,
};

export function snapshotTick(): void {
  const now = Date.now();
  if (now - stats.minuteWindowStart < 60_000) return;

  const avg = stats.candidates ? stats.netSum / stats.candidates : 0;
  const title = bold(underline('📈 SNAPSHOT (1m)'));
  const line = [
    `${title}`,
    `spreads=${cyan(String(stats.seenSpreads))}`,
    `candidates>=min=${green(String(stats.candidates))}`,
    `executed=${magenta(String(stats.executed))}`,
    `bestNet=${stats.bestNet > 0 ? tag.usd(stats.bestNet) : tag.negusd(stats.bestNet)}`,
    `avgNet=${avg >= 0 ? tag.usd(avg) : tag.negusd(avg)}`,
    `nearMiss(≤$0.10)=${yellow(String(stats.nearMiss))}`,
  ].join('  |  ');
  console.log('\n' + line + '\n' + gray('-'.repeat(100)));

  stats.minuteWindowStart = now;
  stats.seenSpreads = 0;
  stats.candidates = 0;
  stats.executed = 0;
  stats.bestNet = -Infinity;
  stats.netSum = 0;
  stats.nearMiss = 0;
}
