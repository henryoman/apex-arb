const RAW_DEX_ALIASES: Array<[string, string]> = [
  ['whirlpool', 'orca'],
  ['raydium clmm', 'raydium'],
  ['raydium cpmm', 'raydium'],
  ['meteora dlmm', 'meteora'],
  ['openbook v2', 'openbook'],
  ['openbookv2', 'openbook'],
  ['pancakeswap', 'pancakeswap'],
  ['lifinity v2', 'lifinity'],
  ['lifinityv2', 'lifinity'],
  ['aquifer', 'aquifer'],
  ['humidifi', 'humidifi'],
  ['tessera', 'tessera'],
  ['tessera v', 'tessera'],
  ['tesserav', 'tessera'],
  ['solfi', 'solfi'],
  ['solfi v', 'solfi'],
  ['solfi v1', 'solfi'],
  ['solfi v2', 'solfi'],
  ['solfi v3', 'solfi'],
  ['pump', 'pump'],
  ['raydium', 'raydium'],
  ['orca', 'orca'],
  ['meteora', 'meteora'],
  ['openbook', 'openbook'],
];

export const DEX_LABEL_ALIASES = new Map<string, string>(RAW_DEX_ALIASES);

export function normalizeDexLabel(label: string | undefined | null): string {
  if (!label) return '';
  const normalized = String(label).toLowerCase().trim();
  return DEX_LABEL_ALIASES.get(normalized) ?? normalized;
}

export function normalizeDexSet(labels: Iterable<string>): string[] {
  const dedupe = new Set<string>();
  for (const label of labels) {
    const normalized = normalizeDexLabel(label);
    if (normalized) dedupe.add(normalized);
  }
  return Array.from(dedupe);
}
