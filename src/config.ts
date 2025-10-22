import 'dotenv/config';

export type JupiterMode = 'FREE' | 'ULTRA';
export type IncludeMode = 'all' | 'any';
export type BotMode = 'both' | 'buy-only' | 'sell-only';
export type SymbolPosition = 'prefix' | 'suffix';
export type SenderCommitment = 'processed' | 'confirmed' | 'finalized' | 'none';

export interface Config {
  JUP_MODE: JupiterMode;
  JUP_API_KEY: string;
  RPC_URL?: string;
  PRIVATE_KEY_B58: string;
  DRY_RUN: boolean;
  BASE_MINT: string;
  BASE_DECIMALS: number;
  BASE_SYMBOL: string;
  BASE_SYMBOL_POSITION: SymbolPosition;
  BASE_DISPLAY_DECIMALS: number;
  BUY_AMOUNT_BASE: number;
  MIN_NET_PROFIT_BASE: number;
  NEAR_MISS_DELTA: number;
  LAMPORTS_PRICE_IN_BASE: number;
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
  SENDER_ENABLED: boolean;
  SENDER_ENDPOINT: string;
  SENDER_SKIP_PREFLIGHT: boolean;
  SENDER_MAX_RETRIES: number;
  SENDER_CONFIRM_COMMITMENT: SenderCommitment;
  SENDER_API_KEY: string;
}

const toList = (value?: string): string[] =>
  (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const normalizeDecimals = (value: unknown, fallback: number): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return fallback;
  }
  return Math.min(12, Math.max(0, Math.floor(numeric)));
};

const toBoolean = (value: string | undefined, fallback = false): boolean => {
  if (typeof value === 'undefined') return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return fallback;
};

const toSenderCommitment = (value: string | undefined): SenderCommitment => {
  const normalized = (value ?? 'confirmed').toLowerCase();
  if (normalized === 'processed' || normalized === 'finalized' || normalized === 'none') {
    return normalized;
  }
  return 'confirmed';
};

const toSymbolPosition = (value: string | undefined, symbol: string): SymbolPosition => {
  const normalized = (value ?? '').toLowerCase();
  if (normalized === 'prefix' || normalized === 'suffix') {
    return normalized;
  }
  return symbol === '$' ? 'prefix' : 'suffix';
};

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

const DEFAULT_SOL_MINT = 'So11111111111111111111111111111111111111112';

const detectBaseDefaults = (): {
  mint: string;
  decimals: number;
  symbol: string;
  symbolPosition: SymbolPosition;
  nearMissDelta: number;
  lamportsPriceInBase: number;
} => {
  const mint = (process.env.BASE_MINT ?? DEFAULT_SOL_MINT).trim() || DEFAULT_SOL_MINT;

  return {
    mint,
    decimals: 9,
    symbol: 'SOL',
    symbolPosition: 'suffix',
    nearMissDelta: 0.005,
    lamportsPriceInBase: 1,
  };
};

const baseDefaults = detectBaseDefaults();

export const CFG: Config = {
  JUP_MODE: toJupMode(process.env.JUP_MODE),
  JUP_API_KEY: process.env.JUP_API_KEY ?? '',
  RPC_URL: process.env.RPC_URL,
  PRIVATE_KEY_B58: process.env.PRIVATE_KEY_B58 ?? '',
  DRY_RUN: (process.env.DRY_RUN ?? 'true').toLowerCase() === 'true',
  BASE_MINT: baseDefaults.mint,
  BASE_DECIMALS: normalizeDecimals(process.env.BASE_DECIMALS, baseDefaults.decimals),
  BASE_SYMBOL: (process.env.BASE_SYMBOL ?? baseDefaults.symbol).trim() || baseDefaults.symbol,
  BASE_SYMBOL_POSITION: toSymbolPosition(process.env.BASE_SYMBOL_POSITION, process.env.BASE_SYMBOL ?? baseDefaults.symbol),
  BASE_DISPLAY_DECIMALS: normalizeDecimals(process.env.BASE_DISPLAY_DECIMALS, 4),
  BUY_AMOUNT_BASE: Number(process.env.BUY_AMOUNT_BASE ?? 0.25),
  MIN_NET_PROFIT_BASE: Number(process.env.MIN_NET_PROFIT_BASE ?? 0.01),
  NEAR_MISS_DELTA: Number(process.env.NEAR_MISS_DELTA ?? baseDefaults.nearMissDelta),
  LAMPORTS_PRICE_IN_BASE: Number(process.env.LAMPORTS_PRICE_IN_BASE ?? baseDefaults.lamportsPriceInBase),
  SLIPPAGE_BPS: Number(process.env.SLIPPAGE_BPS ?? 50),
  INCLUDE_DEXES: toList(process.env.INCLUDE_DEXES),
  INCLUDE_MODE: toIncludeMode(process.env.INCLUDE_MODE),
  EXCLUDE_DEXES: toList(process.env.EXCLUDE_DEXES ?? 'tessera,solfi'),
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
  SENDER_ENABLED: toBoolean(process.env.SENDER_ENABLED, false),
  SENDER_ENDPOINT: (process.env.SENDER_ENDPOINT ?? '').trim(),
  SENDER_SKIP_PREFLIGHT: toBoolean(process.env.SENDER_SKIP_PREFLIGHT, true),
  SENDER_MAX_RETRIES: Number(process.env.SENDER_MAX_RETRIES ?? 0),
  SENDER_CONFIRM_COMMITMENT: toSenderCommitment(process.env.SENDER_CONFIRM_COMMITMENT),
  SENDER_API_KEY: (process.env.SENDER_API_KEY ?? '').trim(),
};

export const ENDPOINTS = {
  FREE: 'https://lite-api.jup.ag',
  ULTRA: 'https://api.jup.ag/ultra',
} as const;

export const JUP_BASE = CFG.JUP_MODE === 'ULTRA' ? ENDPOINTS.ULTRA : ENDPOINTS.FREE;
