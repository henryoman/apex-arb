import path from 'node:path';
import os from 'node:os';
import bs58 from 'bs58';
import { Connection, Keypair } from '@solana/web3.js';
import { getCurrentLogFile } from './logManager.js';
import { printBanner } from './banner.js';
import { CFG } from './config.js';
import type { Config } from './config.js';
import { tag, cyan, gray } from './logger.js';
import { readMemes } from './io.js';
import { normalizeDexLabel } from './dex.js';
import { pLimit } from './concurrency.js';
import { processToken } from './processToken.js';
import { snapshotTick } from './stats.js';
import { initJito } from './jito.js';
import { sleep } from './utils.js';

const logFilePath = getCurrentLogFile();
const runtimeStartedAt = new Date();

type ConfigIssue = {
  severity: 'warn' | 'error';
  message: string;
};

function inspectConfig(config: Config): ConfigIssue[] {
  const issues: ConfigIssue[] = [];

  const numericChecks: Array<{
    field: keyof Config;
    value: number;
    min?: number;
    allowZero?: boolean;
  }> = [
    { field: 'BUY_AMOUNT_USDC', value: config.BUY_AMOUNT_USDC, min: 0 },
    { field: 'MIN_NET_PROFIT_USDC', value: config.MIN_NET_PROFIT_USDC, min: 0, allowZero: true },
    { field: 'SLIPPAGE_BPS', value: config.SLIPPAGE_BPS, min: 0, allowZero: true },
    { field: 'PRIORITY_LAMPORTS', value: config.PRIORITY_LAMPORTS, min: 0, allowZero: true },
    { field: 'JITO_TIP_LAMPORTS', value: config.JITO_TIP_LAMPORTS, min: 0, allowZero: true },
    { field: 'SCAN_INTERVAL_MS', value: config.SCAN_INTERVAL_MS, min: 0, allowZero: true },
    { field: 'PER_TOKEN_COOLDOWN_MS', value: config.PER_TOKEN_COOLDOWN_MS, min: 0, allowZero: true },
    { field: 'MAX_PARALLEL', value: config.MAX_PARALLEL, min: 1 },
    { field: 'HTTP_TIMEOUT_MS', value: config.HTTP_TIMEOUT_MS, min: 1 },
    { field: 'FETCH_RETRIES', value: config.FETCH_RETRIES, min: 1 },
    { field: 'RETRY_BACKOFF_MS', value: config.RETRY_BACKOFF_MS, min: 0, allowZero: true },
  ];

  for (const { field, value, min = 0, allowZero } of numericChecks) {
    if (!Number.isFinite(value)) {
      issues.push({ severity: 'error', message: `${String(field)} is not a finite number` });
      continue;
    }
    if (value < min || (!allowZero && value === 0)) {
      const comparator = allowZero ? '>= 0' : `>${min - 1}`;
      issues.push({ severity: 'error', message: `${String(field)} must be ${comparator} (received ${value})` });
    }
    if (field === 'SLIPPAGE_BPS' && value === 0) {
      issues.push({ severity: 'warn', message: 'SLIPPAGE_BPS is 0; swaps will fail unless routes are perfectly priced.' });
    }
  }

  if (!config.RPC_URL) {
    issues.push({ severity: 'error', message: 'RPC_URL is required but missing.' });
  }

  if (config.JUP_MODE === 'ULTRA' && !config.JUP_API_KEY) {
    issues.push({ severity: 'warn', message: 'JUP_MODE is ULTRA but JUP_API_KEY is empty; Jupiter may reject requests.' });
  }

  if (!config.DRY_RUN && !config.PRIVATE_KEY_B58) {
    issues.push({ severity: 'error', message: 'DRY_RUN=false requires PRIVATE_KEY_B58.' });
  }

  return issues;
}

function logStartupContext(memeCount: number): void {
  console.log(
    tag.info(`Started: ${runtimeStartedAt.toISOString()}`),
    '|',
    tag.info(`PID: ${process.pid}`),
    '|',
    tag.info(`Bun: ${process.versions.bun ?? 'unknown'}`),
  );

  console.log(
    tag.info(`Host: ${os.hostname()}`),
    '|',
    tag.info(`Platform: ${process.platform}`),
    '|',
    tag.info(`Cores: ${os.cpus().length}`),
  );

  if (logFilePath) {
    console.log(tag.info(`Log file: ${logFilePath}`));
  } else {
    console.log(tag.warn('Log file path unavailable (logging stream not initialised).'));
  }

  console.log(
    tag.info(`Memes: ${memeCount}`),
    '|',
    tag.info(`Scan interval: ${CFG.SCAN_INTERVAL_MS}ms`),
    '|',
    tag.info(`Cooldown/token: ${CFG.PER_TOKEN_COOLDOWN_MS}ms`),
    '|',
    tag.info(`Concurrency limit: ${CFG.MAX_PARALLEL}`),
  );

  console.log(
    tag.info(`HTTP timeout: ${CFG.HTTP_TIMEOUT_MS}ms`),
    '|',
    tag.info(`Retries: ${CFG.FETCH_RETRIES}`),
    '|',
    tag.info(`Retry backoff base: ${CFG.RETRY_BACKOFF_MS}ms`),
  );

  console.log(
    tag.info(`JITO mode: ${(process.env.JITO_MODE ?? 'off').toLowerCase()}`),
    '|',
    tag.info(`Priority fee: ${CFG.PRIORITY_LAMPORTS} lamports`),
    '|',
    tag.info(`Jito tip (lamports): ${CFG.JITO_TIP_LAMPORTS}`),
  );

  console.log(
    tag.info(`Memes file: ${path.resolve('memes.txt')}`),
    '|',
    tag.info(`USDC mint: ${CFG.USDC_MINT}`),
    '|',
    tag.info(`Include mode: ${CFG.INCLUDE_MODE}`),
  );
}

async function main(): Promise<void> {

  await printBanner();

  console.log(tag.info('Runtime context initialising…'), logFilePath ? gray(`→ ${logFilePath}`) : gray('(no file)'));

  console.log(
    '\nUSDC ↔ MEME ↔ USDC Arbitrage — Jupiter',
    cyan(`[${CFG.JUP_MODE}]`),
  );
  console.log(
    tag.info(`RPC: ${CFG.RPC_URL ?? '(unset)'}`),
    '|',
    tag.info(`MODE: ${CFG.MODE}`),
    '|',
    tag.info(`DRY_RUN: ${CFG.DRY_RUN}`),
  );
  console.log(
    tag.info(
      `BUY $: ${CFG.BUY_AMOUNT_USDC} | MIN_NET: $${CFG.MIN_NET_PROFIT_USDC} | SLIPPAGE: ${(CFG.SLIPPAGE_BPS / 100).toFixed(2)}%`,
    ),
  );

  const includeDisplay = CFG.INCLUDE_DEXES.map((dex) => normalizeDexLabel(dex));
  const excludeDisplay = CFG.EXCLUDE_DEXES.map((dex) => normalizeDexLabel(dex));

  const configIssues = inspectConfig(CFG);
  if (configIssues.length) {
    console.log(gray('-'.repeat(100)));
    for (const issue of configIssues) {
      const prefix = issue.severity === 'error' ? tag.bad('CONFIG') : tag.warn('CONFIG');
      console.log(prefix, issue.message);
    }
    console.log(gray('-'.repeat(100)));
    const hasErrors = configIssues.some((issue) => issue.severity === 'error');
    if (hasErrors) {
      console.log(tag.bad('Configuration errors detected; aborting startup.'));
      process.exit(1);
    }
  }

  if (includeDisplay.length) {
    console.log(
      tag.info(`DEX Allow (${CFG.INCLUDE_MODE}): ${includeDisplay.join(', ')}`),
      gray('(aliases enabled)'),
    );
  } else {
    console.log(tag.info('DEX Allow: (any)'));
  }

  if (excludeDisplay.length) {
    console.log(
      tag.info(`DEX Exclude: ${excludeDisplay.join(', ')}`),
      gray('(aliases enabled)'),
    );
  } else {
    console.log(tag.info('DEX Exclude: (none)'));
  }

  console.log(gray('-'.repeat(100)));

  if (!CFG.RPC_URL) {
    console.error(tag.bad('RPC_URL is required.'));
    process.exit(1);
  }

  const memes = readMemes('memes.txt');
  console.log(tag.info(`Loaded ${memes.length} meme tokens from memes.txt`));

  logStartupContext(memes.length);

  const connection = new Connection(CFG.RPC_URL, { commitment: 'confirmed' });
  await initJito(connection);

  let payer: Keypair;
  if (CFG.DRY_RUN) {
    payer = Keypair.generate();
  } else {
    if (!CFG.PRIVATE_KEY_B58) {
      console.log(tag.bad('PRIVATE_KEY_B58 is empty but DRY_RUN=false. Set the key or enable DRY_RUN.'));
      process.exit(1);
    }
    try {
      const secret = bs58.decode(CFG.PRIVATE_KEY_B58);
      payer = Keypair.fromSecretKey(secret);
      console.log(tag.info(`Wallet: ${payer.publicKey.toBase58()}`));
    } catch (error) {
      console.log(tag.bad(`Failed to load PRIVATE_KEY_B58: ${(error as Error).message}`));
      process.exit(1);
    }
  }

  setInterval(snapshotTick, 1000);

  const limit = pLimit(Math.max(1, CFG.MAX_PARALLEL));

  while (true) {
    const started = Date.now();
    const tasks = memes.map((mint) => limit(() => processToken(connection, payer, mint)));
    await Promise.allSettled(tasks);
    const elapsed = Date.now() - started;
    const wait = Math.max(0, CFG.SCAN_INTERVAL_MS - elapsed);
    if (wait > 0) {
      await sleep(wait);
    }
  }
}

main().catch((error) => {
  console.error(tag.bad((error as Error).stack ?? (error as Error).message ?? String(error)));
  process.exit(1);
});
