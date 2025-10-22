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
import { fromBaseUnits, estimateJupFeeBps, sleep } from './utils.js';
import { stats } from './stats.js';
import { card, tag, cyan, gray, green } from './logger.js';
import { sendBundleWithTip } from './jito.js';
import { sendViaSender } from './sender.js';

const normalizeDexes = (quote: JupiterQuote) => normalizeDexSet(extractDexLabels(quote));

const LOG_PREVIEW_LINES = 3;
const LAMPORTS_PER_SOL = 1_000_000_000;

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
      CFG.BASE_MINT,
      memeMint,
      CFG.BUY_AMOUNT_BASE,
      CFG.SLIPPAGE_BPS,
    );
    if (!routePassesFilters(quoteBuyResult)) return;

    const outMemes = BigInt(quoteBuyResult.outAmount);

    const quoteSellResult = await quoteSell(
      memeMint,
      CFG.BASE_MINT,
      outMemes.toString(),
      CFG.SLIPPAGE_BPS,
    );
    if (!routePassesFilters(quoteSellResult)) return;

    const baseBack = fromBaseUnits(quoteSellResult.outAmount);
    const gross = baseBack - CFG.BUY_AMOUNT_BASE;

    const jupFeeBuyBps = estimateJupFeeBps(memeMint);
    const jupFeeSellBps = estimateJupFeeBps(memeMint);
    const jupFeesBase =
      (CFG.BUY_AMOUNT_BASE * jupFeeBuyBps) / 10_000 +
      (baseBack * jupFeeSellBps) / 10_000;

    const totalLamports = CFG.PRIORITY_LAMPORTS + CFG.JITO_TIP_LAMPORTS;
    const priorityCostBase = (totalLamports / LAMPORTS_PER_SOL) * CFG.LAMPORTS_PRICE_IN_BASE;
    const net = gross - jupFeesBase - priorityCostBase;

    if (!Number.isFinite(baseBack) || !Number.isFinite(net)) {
      stats.errors += 1;
      console.log(
        logPrefix,
        tag.warn('SKIP invalid net'),
        '| back',
        String(baseBack),
        '| net',
        String(net),
      );
      return;
    }

    const dexBuy = normalizeDexes(quoteBuyResult);
    const dexSell = normalizeDexes(quoteSellResult);
    const dexStr = `${tag.dex('BUY:')} ${dexBuy.join(' > ')}  ${tag.dex('SELL:')} ${dexSell.join(' > ')}`;

    stats.seenSpreads += 1;
    if (net > stats.bestNet) stats.bestNet = net;
    stats.totalNetSum += net;

    if (net <= 0) {
      console.log(
        logPrefix,
        tag.warn('SKIP non-positive net'),
        '| net',
        tag.negAmount(Math.abs(net)),
        '| back',
        tag.amount(baseBack),
      );
      return;
    }

    const netStr = net >= 0 ? tag.amount(net) : tag.negAmount(net);
    const candidate = net >= CFG.MIN_NET_PROFIT_BASE;

    if (candidate) {
      stats.candidates += 1;
      stats.candidateNetSum += net;
      const title = `🎯 CANDIDATE  ${short}   net ${netStr}`;
      const body = [
        `${cyan('back')} ${tag.amount(baseBack)}   ${cyan('size')} ${tag.amount(CFG.BUY_AMOUNT_BASE)}   ${cyan('slip')} ${(CFG.SLIPPAGE_BPS / 100).toFixed(2)}%`,
        `${cyan('priority')} ${CFG.PRIORITY_LAMPORTS}+${CFG.JITO_TIP_LAMPORTS} lamports   ${CFG.DRY_RUN ? gray('DRY_RUN') : green('LIVE')}`,
        `${dexStr}`,
      ].join('\n');
      console.log(card(title, body, 'ok'));
    } else {
      if (CFG.MIN_NET_PROFIT_BASE - net <= CFG.NEAR_MISS_DELTA) stats.nearMiss += 1;
      console.log(
        logPrefix,
        tag.warn('SKIP'),
        'net',
        netStr,
        '| back',
        tag.amount(baseBack),
        '| size',
        tag.amount(CFG.BUY_AMOUNT_BASE),
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

      const describeTransport = (transport: 'sender' | 'rpc') => (transport === 'sender' ? 'Sender' : 'RPC');
      const jitoMode = (process.env.JITO_MODE ?? 'off').toLowerCase();

      const dispatchSwap = async (
        swapB64: string,
        leg: 'BUY' | 'SELL',
      ): Promise<{ signature: string; transport: 'sender' | 'rpc' }> => {
        if (CFG.SENDER_ENABLED && CFG.SENDER_ENDPOINT) {
          try {
            const signature = await sendViaSender(conn, swapB64, payer);
            return { signature, transport: 'sender' };
          } catch (error) {
            console.log(
              logPrefix,
              tag.warn(`[SENDER] ${leg} send failed`),
              stringifyError((error as Error).message ?? error),
            );
          }
        }

        const fallbackSignature = await sendB64Tx(conn, swapB64, payer);
        return { signature: fallbackSignature, transport: 'rpc' };
      };

      const buySwap = await buildSwapTx({
        quote: quoteBuyResult,
        userPublicKey: payer.publicKey.toBase58(),
        wrapAndUnwrapSol: true,
      });
      const buyB64 = buySwap.swapTransaction;
      if (!buyB64) throw new Error('buy swap tx not provided');

      if (jitoMode === 'relayer') {
        const bundleId = await sendBundleWithTip({
          conn,
          swapB64: buyB64,
          payer,
          tipSol: process.env.JITO_TIP_SOL_BUY ?? '0.006',
        });
        if (bundleId) {
          console.log(card('🧩 BUY BUNDLE SENT', cyan(String(bundleId)), 'ok'));
        } else {
          const result = await dispatchSwap(buyB64, 'BUY');
          console.log(
            card(
              `🟢 BUY SENT (fallback ${describeTransport(result.transport)})`,
              cyan(result.signature),
              'ok',
            ),
          );
        }
      } else {
        const result = await dispatchSwap(buyB64, 'BUY');
        console.log(card(`🟢 BUY SENT (${describeTransport(result.transport)})`, cyan(result.signature), 'ok'));
      }

      if (CFG.MODE !== 'buy-only') {
        const sellSwap = await buildSwapTx({
          quote: quoteSellResult,
          userPublicKey: payer.publicKey.toBase58(),
          wrapAndUnwrapSol: true,
        });
        const sellB64 = sellSwap.swapTransaction;
        if (!sellB64) throw new Error('sell swap tx not provided');

        if (jitoMode === 'relayer') {
          const bundleId = await sendBundleWithTip({
            conn,
            swapB64: sellB64,
            payer,
            tipSol: process.env.JITO_TIP_SOL_SELL ?? '0.008',
          });
          if (bundleId) {
            console.log(card('🧩 SELL BUNDLE SENT', cyan(String(bundleId)), 'ok'));
          } else {
            const result = await dispatchSwap(sellB64, 'SELL');
            console.log(
              card(
                `🔵 SELL SENT (fallback ${describeTransport(result.transport)})`,
                cyan(result.signature),
                'ok',
              ),
            );
          }
        } else {
          const result = await dispatchSwap(sellB64, 'SELL');
          console.log(card(`🔵 SELL SENT (${describeTransport(result.transport)})`, cyan(result.signature), 'ok'));
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
