import { bold, underline, cyan, magenta, green, yellow, gray } from './logger.js';
import { tag } from './logger.js';
import { CFG } from './config.js';

export interface StatsState {
  minuteWindowStart: number;
  seenSpreads: number;
  candidates: number;
  executed: number;
  bestNet: number;
  totalNetSum: number;
  candidateNetSum: number;
  nearMiss: number;
  errors: number;
}

export const stats: StatsState = {
  minuteWindowStart: Date.now(),
  seenSpreads: 0,
  candidates: 0,
  executed: 0,
  bestNet: -Infinity,
  totalNetSum: 0,
  candidateNetSum: 0,
  nearMiss: 0,
  errors: 0,
};

export function snapshotTick(): void {
  const now = Date.now();
  if (now - stats.minuteWindowStart < 60_000) return;

  const avgSeen = stats.seenSpreads ? stats.totalNetSum / stats.seenSpreads : 0;
  const avgCandidates = stats.candidates ? stats.candidateNetSum / stats.candidates : 0;
  const formatBase = (value: number) => (value >= 0 ? tag.amount(value) : tag.negAmount(value));
  const bestNetDisplay = Number.isFinite(stats.bestNet)
    ? formatBase(stats.bestNet)
    : gray('n/a');
  const title = bold(underline('📈 SNAPSHOT (1m)'));
  const line = [
    `${title}`,
    `spreads=${cyan(String(stats.seenSpreads))}`,
    `candidates>=min=${green(String(stats.candidates))}`,
    `executed=${magenta(String(stats.executed))}`,
    `bestNet=${bestNetDisplay}`,
    `avgNetSeen=${formatBase(avgSeen)}`,
    `avgNetCandidates=${stats.candidates ? formatBase(avgCandidates) : gray('n/a')}`,
    `nearMiss(≤${tag.amount(CFG.NEAR_MISS_DELTA)})=${yellow(String(stats.nearMiss))}`,
    `errors=${yellow(String(stats.errors))}`,
  ].join('  |  ');
  console.log('\n' + line + '\n' + gray('-'.repeat(100)));

  stats.minuteWindowStart = now;
  stats.seenSpreads = 0;
  stats.candidates = 0;
  stats.executed = 0;
  stats.bestNet = -Infinity;
  stats.totalNetSum = 0;
  stats.candidateNetSum = 0;
  stats.nearMiss = 0;
  stats.errors = 0;
}
