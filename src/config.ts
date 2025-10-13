import 'dotenv/config';

export type JupiterMode = 'FREE' | 'ULTRA';
export type IncludeMode = 'all' | 'any';
export type BotMode = 'both' | 'buy-only' | 'sell-only';

export interface Config {
  JUP_MODE: JupiterMode;
  JUP_API_KEY: string;
  RPC_URL?: string;
  PRIVATE_KEY_B58: string;
  DRY_RUN: boolean;
  USDC_MINT: string;
  BUY_AMOUNT_USDC: number;
  MIN_NET_PROFIT_USDC: number;
  SLIPPAGE_BPS: number;
  INCLUDE_DEXES: string[];
  INCLUDE_MODE: IncludeMode;
  EXCLUDE_DEXES: string[];
  PRIORITY_LAMPORTS: number;
  JITO_APPLY_MODE: string;
  JITO_TIP_LAMPORTS: number;
  SCAN_INTERVAL_MS: number;
  PER_TOKEN_COOLDOWN_MS: number;
  MAX_PARALLEL: number;
  HTTP_TIMEOUT_MS: number;
  FETCH_RETRIES: number;
  RETRY_BACKOFF_MS: number;
  MODE: BotMode;
}

const toList = (value?: string): string[] =>
  (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const toMode = (value: string | undefined): BotMode => {
  const normalized = (value ?? 'both').toLowerCase();
  if (normalized === 'buy-only' || normalized === 'sell-only') {
    return normalized;
  }
  return 'both';
};

const toIncludeMode = (value: string | undefined): IncludeMode => {
  const normalized = (value ?? 'all').toLowerCase();
  return normalized === 'any' ? 'any' : 'all';
};

const toJupMode = (value: string | undefined): JupiterMode => {
  const normalized = (value ?? 'FREE').toUpperCase();
  return normalized === 'ULTRA' ? 'ULTRA' : 'FREE';
};

export const CFG: Config = {
  JUP_MODE: toJupMode(process.env.JUP_MODE),
  JUP_API_KEY: process.env.JUP_API_KEY ?? '',
  RPC_URL: process.env.RPC_URL,
  PRIVATE_KEY_B58: process.env.PRIVATE_KEY_B58 ?? '',
  DRY_RUN: (process.env.DRY_RUN ?? 'true').toLowerCase() === 'true',
  USDC_MINT: process.env.USDC_MINT ?? 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  BUY_AMOUNT_USDC: Number(process.env.BUY_AMOUNT_USDC ?? 50),
  MIN_NET_PROFIT_USDC: Number(process.env.MIN_NET_PROFIT_USDC ?? 0.5),
  SLIPPAGE_BPS: Number(process.env.SLIPPAGE_BPS ?? 50),
  INCLUDE_DEXES: toList(process.env.INCLUDE_DEXES),
  INCLUDE_MODE: toIncludeMode(process.env.INCLUDE_MODE),
  EXCLUDE_DEXES: toList(process.env.EXCLUDE_DEXES),
  PRIORITY_LAMPORTS: Number(process.env.PRIORITY_LAMPORTS ?? 10000),
  JITO_APPLY_MODE: (process.env.JITO_APPLY_MODE ?? 'both').toLowerCase(),
  JITO_TIP_LAMPORTS: Number(process.env.JITO_TIP_LAMPORTS ?? 2000),
  SCAN_INTERVAL_MS: Number(process.env.SCAN_INTERVAL_MS ?? 250),
  PER_TOKEN_COOLDOWN_MS: Number(process.env.PER_TOKEN_COOLDOWN_MS ?? 0),
  MAX_PARALLEL: Number(process.env.MAX_PARALLEL ?? 4),
  HTTP_TIMEOUT_MS: Number(process.env.HTTP_TIMEOUT_MS ?? 15000),
  FETCH_RETRIES: Number(process.env.FETCH_RETRIES ?? 5),
  RETRY_BACKOFF_MS: Number(process.env.RETRY_BACKOFF_MS ?? 500),
  MODE: toMode(process.env.MODE),
};

export const ENDPOINTS = {
  FREE: 'https://lite-api.jup.ag',
  ULTRA: 'https://api.jup.ag/ultra',
} as const;

export const JUP_BASE = CFG.JUP_MODE === 'ULTRA' ? ENDPOINTS.ULTRA : ENDPOINTS.FREE;
