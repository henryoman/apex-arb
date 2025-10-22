import { CFG } from './config.js';

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const fromBaseUnits = (value: bigint | number | string): number => {
  const raw =
    typeof value === 'bigint'
      ? value
      : typeof value === 'number'
        ? BigInt(Math.round(value))
        : BigInt(value);
  const divisor = 10 ** CFG.BASE_DECIMALS;
  return Number(raw) / divisor;
};

export const toBaseUnits = (value: number): bigint => {
  const multiplier = 10 ** CFG.BASE_DECIMALS;
  return BigInt(Math.round(value * multiplier));
};

export function estimateJupFeeBps(_mint: string): number {
  return 10;
}
