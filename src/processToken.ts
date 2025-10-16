import { Connection, Keypair, VersionedTransaction } from '@solana/web3.js';
import { CFG } from './config.js';
import {
  quoteBuy,
  quoteSell,
  buildSwapTx,
  sendB64Tx,
  extractDexLabels,
  JupiterQuote,
} from './jupiter.js';
import { normalizeDexSet, normalizeDexLabel } from './dex.js';
import { lamportsToUSD, estimateJupFeeBps, sleep } from './utils.js';
import { stats } from './stats.js';
import { card, tag, cyan, gray, green } from './logger.js';
import { sendBundleWithTip } from './jito.js';

const normalizeDexes = (quote: JupiterQuote) => normalizeDexSet(extractDexLabels(quote));

const LOG_PREVIEW_LINES = 3;

function summarizeLogs(logs?: string[] | null): string {
  if (!logs?.length) return gray('logs=0');
  const slice = logs.slice(-LOG_PREVIEW_LINES).map((line) => line.replace(/\u0000/g, ''));
  return gray(`logs[-${slice.length}]: ${slice.join(' | ')}`);
}

function stringifyError(err: unknown): string {
  if (typeof err === 'string') return err;
  if (!err) return 'unknown';
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

async function simulateSwapLeg(
  conn: Connection,
  payer: Keypair,
  swapB64: string,
  logPrefix: string,
  leg: 'BUY' | 'SELL',
): Promise<void> {
  const buffer = Buffer.from(swapB64, 'base64');
  const transaction = VersionedTransaction.deserialize(buffer);
  transaction.sign([payer]);

  try {
    const result = await conn.simulateTransaction(transaction, {
      commitment: 'processed',
      sigVerify: true,
    });
    const { err, unitsConsumed, logs } = result.value;
    if (err) {
      console.log(
        logPrefix,
        tag.warn(`SIM ${leg}`),
        'error',
        stringifyError(err),
        '| units',
        typeof unitsConsumed === 'number' ? unitsConsumed : 'n/a',
      );
      if (logs?.length) {
        console.log(logPrefix, summarizeLogs(logs));
      }
    } else {
      console.log(
        logPrefix,
        tag.info(`SIM ${leg}`),
        '| units',
        typeof unitsConsumed === 'number' ? unitsConsumed : 'n/a',
        '| logs',
        logs?.length ?? 0,
      );
      if (logs?.length) {
        console.log(logPrefix, summarizeLogs(logs));
      }
    }
  } catch (error) {
    console.log(
      logPrefix,
      tag.warn(`SIM ${leg} exception`),
      stringifyError((error as Error).message ?? error),
    );
  }
}

async function runDrySimulations(
  conn: Connection,
  payer: Keypair,
  logPrefix: string,
  short: string,
  quoteBuyResult: JupiterQuote,
  quoteSellResult: JupiterQuote,
): Promise<void> {
  if (CFG.MODE !== 'sell-only') {
    try {
      const buySwap = await buildSwapTx({
        quote: quoteBuyResult,
        userPublicKey: payer.publicKey.toBase58(),
        wrapAndUnwrapSol: true,
      });
      const buyB64 = buySwap.swapTransaction;
      if (!buyB64) {
        console.log(logPrefix, tag.warn('SIM BUY missing swap transaction payload'));
      } else {
        await simulateSwapLeg(conn, payer, buyB64, logPrefix, 'BUY');
      }
    } catch (error) {
      console.log(
        logPrefix,
        tag.warn('SIM BUY build error'),
        stringifyError((error as Error).message ?? error),
      );
    }
  }

  if (CFG.MODE !== 'buy-only') {
    try {
      const sellSwap = await buildSwapTx({
        quote: quoteSellResult,
        userPublicKey: payer.publicKey.toBase58(),
        wrapAndUnwrapSol: true,
      });
      const sellB64 = sellSwap.swapTransaction;
      if (!sellB64) {
        console.log(logPrefix, tag.warn('SIM SELL missing swap transaction payload'));
      } else {
        await simulateSwapLeg(conn, payer, sellB64, logPrefix, 'SELL');
      }
    } catch (error) {
      console.log(
        logPrefix,
        tag.warn('SIM SELL build error'),
        stringifyError((error as Error).message ?? error),
      );
    }
  }
}

const routePassesFilters = (quote: JupiterQuote): boolean => {
  const labels = normalizeDexes(quote);
  const include = CFG.INCLUDE_DEXES.map((dex) => normalizeDexLabel(dex)).filter(Boolean);
  const exclude = CFG.EXCLUDE_DEXES.map((dex) => normalizeDexLabel(dex)).filter(Boolean);

  if (exclude.length) {
    for (const label of labels) {
      if (exclude.includes(label)) {
        return false;
      }
    }
  }

  if (include.length) {
    if (CFG.INCLUDE_MODE === 'all') {
      const allAllowed = labels.every((label) => include.includes(label));
      if (!allAllowed) return false;
    } else {
      const anyAllowed = labels.some((label) => include.includes(label));
      if (!anyAllowed) return false;
    }
  }

  return true;
};

export async function processToken(
  conn: Connection,
  payer: Keypair,
  memeMint: string,
): Promise<void> {
  const short = `${memeMint.slice(0, 4)}…${memeMint.slice(-4)}`;
  const logPrefix = gray(`[${short}]`);

  try {
    const quoteBuyResult = await quoteBuy(
      CFG.USDC_MINT,
      memeMint,
      CFG.BUY_AMOUNT_USDC,
      CFG.SLIPPAGE_BPS,
    );
    if (!routePassesFilters(quoteBuyResult)) return;

    const outMemes = BigInt(quoteBuyResult.outAmount);

    const quoteSellResult = await quoteSell(
      memeMint,
      CFG.USDC_MINT,
      outMemes.toString(),
      CFG.SLIPPAGE_BPS,
    );
    if (!routePassesFilters(quoteSellResult)) return;

    const usdcBack = lamportsToUSD(quoteSellResult.outAmount);
    const gross = usdcBack - CFG.BUY_AMOUNT_USDC;

    const jupFeeBuyBps = estimateJupFeeBps(memeMint);
    const jupFeeSellBps = estimateJupFeeBps(memeMint);
    const jupFeesUsd =
      (CFG.BUY_AMOUNT_USDC * jupFeeBuyBps) / 10_000 +
      (usdcBack * jupFeeSellBps) / 10_000;

    const priorityUsd = (CFG.PRIORITY_LAMPORTS + CFG.JITO_TIP_LAMPORTS) / 1e9 * 150;
    const net = gross - jupFeesUsd - priorityUsd;

    const dexBuy = normalizeDexes(quoteBuyResult);
    const dexSell = normalizeDexes(quoteSellResult);
    const dexStr = `${tag.dex('BUY:')} ${dexBuy.join(' > ')}  ${tag.dex('SELL:')} ${dexSell.join(' > ')}`;

    stats.seenSpreads += 1;
    if (net > stats.bestNet) stats.bestNet = net;
    stats.totalNetSum += net;

    const netStr = net >= 0 ? tag.usd(net) : tag.negusd(net);
    const candidate = net >= CFG.MIN_NET_PROFIT_USDC;

    if (candidate) {
      stats.candidates += 1;
      stats.candidateNetSum += net;
      const title = `🎯 CANDIDATE  ${short}   net ${netStr}`;
      const body = [
        `${cyan('back')} ${tag.usd(usdcBack)}   ${cyan('size')} ${tag.usd(CFG.BUY_AMOUNT_USDC)}   ${cyan('slip')} ${(CFG.SLIPPAGE_BPS / 100).toFixed(2)}%`,
        `${cyan('priority')} ${CFG.PRIORITY_LAMPORTS}+${CFG.JITO_TIP_LAMPORTS} lamports   ${CFG.DRY_RUN ? gray('DRY_RUN') : green('LIVE')}`,
        `${dexStr}`,
      ].join('\n');
      console.log(card(title, body, 'ok'));
    } else {
      if (CFG.MIN_NET_PROFIT_USDC - net <= 0.1) stats.nearMiss += 1;
      console.log(
        logPrefix,
        tag.warn('SKIP'),
        'net',
        netStr,
        '| back',
        tag.usd(usdcBack),
        '| size',
        tag.usd(CFG.BUY_AMOUNT_USDC),
        '| slippage',
        `${(CFG.SLIPPAGE_BPS / 100).toFixed(2)}%`,
        '| priority',
        `${CFG.PRIORITY_LAMPORTS}+${CFG.JITO_TIP_LAMPORTS} lamports`,
        '|',
        CFG.DRY_RUN ? gray('DRY_RUN') : green('LIVE'),
        '\n   ',
        dexStr,
      );
    }

    if (!CFG.DRY_RUN && candidate) {
      if (CFG.MODE === 'sell-only') {
        console.log(logPrefix, tag.warn('MODE=sell-only: skipping buy leg execution'));
        return;
      }

      const buySwap = await buildSwapTx({
        quote: quoteBuyResult,
        userPublicKey: payer.publicKey.toBase58(),
        wrapAndUnwrapSol: true,
      });
      const buyB64 = buySwap.swapTransaction;
      if (!buyB64) throw new Error('buy swap tx not provided');

      if ((process.env.JITO_MODE ?? 'off').toLowerCase() === 'relayer') {
        const bundleId = await sendBundleWithTip({
          conn,
          swapB64: buyB64,
          payer,
          tipSol: process.env.JITO_TIP_SOL_BUY ?? '0.006',
        });
        if (bundleId) {
          console.log(card('🧩 BUY BUNDLE SENT', cyan(String(bundleId)), 'ok'));
        } else {
          const sigBuy = await sendB64Tx(conn, buyB64, payer);
          console.log(card('🟢 BUY SENT (fallback)', cyan(sigBuy), 'ok'));
        }
      } else {
        const sigBuy = await sendB64Tx(conn, buyB64, payer);
        console.log(card('🟢 BUY SENT', cyan(sigBuy), 'ok'));
      }

      if (CFG.MODE !== 'buy-only') {
        const sellSwap = await buildSwapTx({
          quote: quoteSellResult,
          userPublicKey: payer.publicKey.toBase58(),
          wrapAndUnwrapSol: true,
        });
        const sellB64 = sellSwap.swapTransaction;
        if (!sellB64) throw new Error('sell swap tx not provided');

        if ((process.env.JITO_MODE ?? 'off').toLowerCase() === 'relayer') {
          const bundleId = await sendBundleWithTip({
            conn,
            swapB64: sellB64,
            payer,
            tipSol: process.env.JITO_TIP_SOL_SELL ?? '0.008',
          });
          if (bundleId) {
            console.log(card('🧩 SELL BUNDLE SENT', cyan(String(bundleId)), 'ok'));
          } else {
            const sigSell = await sendB64Tx(conn, sellB64, payer);
            console.log(card('🔵 SELL SENT (fallback)', cyan(sigSell), 'ok'));
          }
        } else {
          const sigSell = await sendB64Tx(conn, sellB64, payer);
          console.log(card('🔵 SELL SENT', cyan(sigSell), 'ok'));
        }
      }

      stats.executed += 1;
    }

    if (CFG.PER_TOKEN_COOLDOWN_MS > 0) {
      await sleep(CFG.PER_TOKEN_COOLDOWN_MS);
    }
    if (CFG.DRY_RUN) {
      await runDrySimulations(conn, payer, logPrefix, short, quoteBuyResult, quoteSellResult);
    }
  } catch (error) {
    stats.errors += 1;
    console.log(logPrefix, tag.bad((error as Error).message ?? String(error)));
  }
}
