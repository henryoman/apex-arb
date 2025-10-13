export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const lamportsToUSD = (value: bigint | number | string): number => {
  const numeric = typeof value === 'bigint' ? Number(value) : Number(value);
  return numeric / 1_000_000;
};

export function estimateJupFeeBps(_mint: string): number {
  return 10;
}
