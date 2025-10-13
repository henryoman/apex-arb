/**
 * USDC ↔ MEME ↔ USDC arbitrage bot (Jupiter API free/ultra)
 *
 * Features:
 *  - Reads meme mints from memes.txt
 *  - Dual-quote (USDC->MEME -> USDC) via Jupiter /swap/v1/quote
 *  - Net profit calc (slippage, est. Jupiter fee, priority+Jito tip)
 *  - Multi-DEX awareness with normalized labels
 *  - INCLUDE_DEXES (+ INCLUDE_MODE=all|any) and EXCLUDE_DEXES blacklist
 *  - Pretty logs, 1-min snapshots, retries, keep-alive, timeouts
 *  - DRY_RUN mode and execution scaffold (build+send Jupiter tx)
 *
 * New (UI):
 *  - Gradient banner (gradient-string) + short animation (chalk-animation)
 *  - Emoji statuses
 *  - Boxed cards for candidates/executions (boxen)
 */

import 'dotenv/config';
import fs from 'fs';
import fetch from 'node-fetch';
import https from 'https';
import bs58 from 'bs58';
import { Connection, Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { cyan, magenta, yellow, green, red, gray, bold, underline, blue, black, white, bgBlue } from 'colorette';
import pkg from 'opti-tools';
const { initializeSession } = pkg;
import jito from 'jito-ts';
const { searcher, bundle } = jito;
const { searcherClient } = searcher;
const { Bundle } = bundle;

// --- NEW: eye-candy deps ---
import gradient from 'gradient-string';
import chalkAnimation from 'chalk-animation';
import boxen from 'boxen';

// --- Banner ---
const BANNER = String.raw`
 █████╗ ██████╗ ███████╗██╗  ██╗     █████╗ ██████╗ ██████╗ 
██╔══██╗██╔══██╗██╔════╝╚██╗██╔╝    ██╔══██╗██╔══██╗██╔══██╗
███████║██████╔╝█████╗   ╚███╔╝     ███████║██████╔╝██████╔╝
██╔══██║██╔═══╝ ██╔══╝   ██╔██╗     ██╔══██║██╔══██╗██╔══██╗
██║  ██║██║     ███████╗██╔╝ ██╗    ██║  ██║██║  ██║██████╔╝
╚═╝  ╚═╝╚═╝     ╚══════╝╚═╝  ╚═╝    ╚═╝  ╚═╝╚═╝  ╚═╝╚═════╝ 
                S O L A N A  ARBITRAGE  v 2.1
                     github.com/apexarb
`;

async function printBanner() {
  console.log(gradient('#ffa65dff', '#8c78ffff', '#75ffaeff').multiline(BANNER));
  const anim = chalkAnimation.rainbow('ApexArb Launching…');
  await new Promise(r => setTimeout(r, 1200));
  anim.stop();
  process.stdout.write('\x1B[2K\r');
}

// --------------------------- Config ---------------------------
const CFG = {
  // Jupiter
  JUP_MODE: (process.env.JUP_MODE || 'FREE').toUpperCase(), // FREE | ULTRA
  JUP_API_KEY: process.env.JUP_API_KEY || '',

  // Network
  RPC_URL: process.env.RPC_URL,

  // Wallet / run
  PRIVATE_KEY_B58: process.env.PRIVATE_KEY_B58 || '',
  DRY_RUN: (process.env.DRY_RUN || 'true').toLowerCase() === 'true',

  // Assets / sizing
  USDC_MINT: process.env.USDC_MINT || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  BUY_AMOUNT_USDC: Number(process.env.BUY_AMOUNT_USDC || 50),
  MIN_NET_PROFIT_USDC: Number(process.env.MIN_NET_PROFIT_USDC || 0.5),
  SLIPPAGE_BPS: Number(process.env.SLIPPAGE_BPS || 50),

  // DEX controls
  INCLUDE_DEXES: (process.env.INCLUDE_DEXES || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean),
  INCLUDE_MODE: (process.env.INCLUDE_MODE || 'all').toLowerCase(), // all | any
  EXCLUDE_DEXES: (process.env.EXCLUDE_DEXES || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean),

  // Fees / priority
  PRIORITY_LAMPORTS: Number(process.env.PRIORITY_LAMPORTS || 10000),
  JITO_APPLY_MODE: (process.env.JITO_APPLY_MODE || 'both').toLowerCase(),
  JITO_TIP_LAMPORTS: Number(process.env.JITO_TIP_LAMPORTS || 2000),

  // Loops / network robustness
  SCAN_INTERVAL_MS: Number(process.env.SCAN_INTERVAL_MS || 250),
  PER_TOKEN_COOLDOWN_MS: Number(process.env.PER_TOKEN_COOLDOWN_MS || 0),
  MAX_PARALLEL: Number(process.env.MAX_PARALLEL || 4),
  HTTP_TIMEOUT_MS: Number(process.env.HTTP_TIMEOUT_MS || 15000),
  FETCH_RETRIES: Number(process.env.FETCH_RETRIES || 5),
  RETRY_BACKOFF_MS: Number(process.env.RETRY_BACKOFF_MS || 500),

  // Run mode
  MODE: (process.env.MODE || 'both').toLowerCase(), // both | buy-only | sell-only
};

const ENDPOINTS = {
  FREE: 'https://lite-api.jup.ag',
  ULTRA: 'https://api.jup.ag/ultra',
};
const JUP_BASE = CFG.JUP_MODE === 'ULTRA' ? ENDPOINTS.ULTRA : ENDPOINTS.FREE;

// ---------------------- Infra helpers ----------------------
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 64 });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---------------------- DEX label normalization ----------------------
const DEX_LABEL_ALIASES = new Map([
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
]);

async function buildTipTx(conn, payer, tipSol) {
  if (!jitoTipAccount) return null;

  const lamports = Math.floor(Number(tipSol || 0) * 1e9);
  if (lamports <= 0) return null;

  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('finalized');

  const ix = SystemProgram.transfer({
    fromPubkey: payer.publicKey,
    toPubkey: new PublicKey(jitoTipAccount), // fix: ensure PublicKey
    lamports,
  });

  const msg = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: blockhash,
    instructions: [ix],
  }).compileToV0Message();

  const tx = new VersionedTransaction(msg);
  tx.sign([payer]);

  return { tx, lastValidBlockHeight };
}

async function sendBundleWithTip({ conn, swapB64, payer, tipSol }) {
  if (!jitoClient || !jitoTipAccount) return null;

  const swapBuf = Buffer.from(swapB64, 'base64');
  const swapTx = VersionedTransaction.deserialize(swapBuf);
  swapTx.sign([payer]);

  const { blockhash } = await conn.getLatestBlockhash('finalized');
  const tipLamports = Math.floor(Number(tipSol || 0) * 1e9);

  const b = new Bundle([swapTx], 5);
  const added = b.addTipTx(
    payer,
    tipLamports,
    new PublicKey(jitoTipAccount),
    blockhash
  );
  if (added instanceof Error) {
    console.log(yellow(`[JITO] addTipTx error: ${added.message}`));
    return null;
  }

  try {
    const bundleId = await jitoClient.sendBundle(b);
    return bundleId;
  } catch (e) {
    console.log(yellow(`[JITO] sendBundle error: ${e.message}`));
    return null;
  }
}

function normalizeDexLabel(label) {
  if (!label) return '';
  const l = String(label).toLowerCase().trim();
  return DEX_LABEL_ALIASES.get(l) || l;
}

function normalizeDexSet(labels) {
  const set = new Set();
  labels.forEach(l => set.add(normalizeDexLabel(l)));
  return Array.from(set);
}

// ---------------------- HTTP helpers (retry/timeout) ----------------------
async function fetchWithRetry(url, opts = {}, isPost = false) {
  let attempt = 0;
  let lastErr;
  while (attempt < CFG.FETCH_RETRIES) {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), CFG.HTTP_TIMEOUT_MS);
    try {
      const resp = await fetch(url, {
        agent: httpsAgent,
        signal: ctrl.signal,
        ...opts,
        headers: {
          'accept': 'application/json',
          ...(isPost ? { 'content-type': 'application/json' } : {}),
          ...(CFG.JUP_API_KEY ? { 'x-api-key': CFG.JUP_API_KEY } : {}),
          ...(opts.headers || {}),
        },
      });
      clearTimeout(id);
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        if (resp.status === 429 || (resp.status >= 500 && resp.status <= 599)) {
          throw new Error(`HTTP ${resp.status} – ${text.slice(0, 200)}`);
        }
        try { return await resp.json(); } catch { return { error: text }; }
      }
      return await resp.json();
    } catch (e) {
      lastErr = e;
      const aborted = e?.name === 'AbortError' || /aborted/i.test(e?.message || '');
      const transient = aborted || /ECONNRESET|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH/i.test(e?.message || '');
      attempt++;
      if (attempt < CFG.FETCH_RETRIES && transient) {
        const backoff = CFG.RETRY_BACKOFF_MS * Math.pow(2, attempt - 1);
        console.log(gray(`[retry ${attempt}/${CFG.FETCH_RETRIES}] ${e.message || e} → wait ${backoff}ms`));
        await sleep(backoff);
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

async function httpGet(url, query = {}) {
  const qp = new URLSearchParams(query);
  const full = url + (qp.toString() ? `?${qp.toString()}` : '');
  return await fetchWithRetry(full, { method: 'GET' }, false);
}

async function httpPost(url, body = {}) {
  return await fetchWithRetry(url, { method: 'POST', body: JSON.stringify(body) }, true);
}

// ---------------------- IO helpers ----------------------
function readMemes(file = 'memes.txt') {
  if (!fs.existsSync(file)) throw new Error(`memes file not found: ${file}`);
  return fs.readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);
}

// ---------------------- Logs helpers (with emoji) ----------------------
const tag = {
  ok: (s) => green(bold(`✅ [OK] ${s}`)),
  bad: (s) => red(bold(`❌ [X] ${s}`)),
  info: (s) => blue(bold(`🐋  [i] ${s}`)),
  warn: (s) => yellow(bold(`💶  [!] ${s}`)),
  dex: (s) => magenta(bold(s)),
  usd: (n) => `${green('$')}${Number(n).toFixed(4)}`,
  negusd: (n) => `${red('-$')}${Math.abs(Number(n)).toFixed(4)}`,
};

// Small helpers for cards
function card(title, body, variant = 'info') {
  const borderColor = variant === 'ok' ? 'green'
    : variant === 'warn' ? 'yellow'
    : variant === 'bad' ? 'red'
    : 'cyan';

  return boxen(
    `${bold(title)}\n${body}`,
    {
      padding: { top: 0, right: 1, bottom: 0, left: 1 },
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
      borderColor,
      borderStyle: 'round',
    }
  );
}

// ---------------------- Jupiter helpers ----------------------
function estimateJupFeeBps(_mint) { return 10; } // 0.10% conservative

function extractDexLabels(quote) {
  try {
    const labels = new Set();
    const rp = quote.routePlan || quote.marketInfos || [];
    for (const hop of rp) {
      if (hop?.swapInfo?.label) labels.add(hop.swapInfo.label);
      if (hop?.label) labels.add(hop.label);
      if (hop?.ammLabel) labels.add(hop.ammLabel);
    }
    if (Array.isArray(quote.routes)) {
      for (const r of quote.routes) {
        (r.marketInfos || []).forEach(mi => {
          if (mi.label) labels.add(mi.label);
          if (mi.ammLabel) labels.add(mi.ammLabel);
        });
      }
    }
    return Array.from(labels);
  } catch {
    return [];
  }
}

// --- Route filters: INCLUDE/EXCLUDE ---
function routePassesFilters(quote, phase /* 'buy'|'sell' */) {
  const labelsNorm = normalizeDexSet(extractDexLabels(quote));
  const include = CFG.INCLUDE_DEXES.map(x => normalizeDexLabel(x));
  const exclude = CFG.EXCLUDE_DEXES.map(x => normalizeDexLabel(x)).filter(Boolean);

  if (exclude.length) {
    for (const l of labelsNorm) {
      if (exclude.includes(l)) {
        return false;
      }
    }
  }

  if (include.length) {
    if (CFG.INCLUDE_MODE === 'all') {
      const allAllowed = labelsNorm.every(l => include.includes(l));
      if (!allAllowed) return false;
      return true;
    } else {
      const anyAllowed = labelsNorm.some(l => include.includes(l));
      if (!anyAllowed) return false;
      return true;
    }
  }

  return true;
}

// ---------------------- Quotes / Swap ----------------------
async function quoteBuy(usdcMint, memeMint, amountUsdc, slippageBps) {
  const inAmount = Math.floor(amountUsdc * 1e6);
  const query = {
    inputMint: usdcMint,
    outputMint: memeMint,
    amount: String(inAmount),
    slippageBps: String(slippageBps),
  };
  const url = `${JUP_BASE}/swap/v1/quote`;
  const data = await httpGet(url, query);
  const q = data?.data?.[0] || data?.quote || data;
  if (!q?.outAmount) throw new Error('invalid buy quote');
  return q;
}

async function quoteSell(memeMint, usdcMint, inAmountMemes, slippageBps) {
  const query = {
    inputMint: memeMint,
    outputMint: usdcMint,
    amount: String(inAmountMemes),
    slippageBps: String(slippageBps),
  };
  const url = `${JUP_BASE}/swap/v1/quote`;
  const data = await httpGet(url, query);
  const q = data?.data?.[0] || data?.quote || data;
  if (!q?.outAmount) throw new Error('invalid sell quote');
  return q;
}

async function buildSwapTx({ quote, userPublicKey, wrapAndUnwrapSol = true }) {
  const url = `${JUP_BASE}/swap/v1/transactions`;
  const body = {
    quoteResponse: quote,
    userPublicKey,
    wrapAndUnwrapSol,
    asLegacyTransaction: false,
    dynamicSlippage: false,
    prioritizationFeeLamports: Number(CFG.PRIORITY_LAMPORTS + CFG.JITO_TIP_LAMPORTS),
  };
  return await httpPost(url, body);
}

async function sendB64Tx(conn, b64, payer) {
  const buf = Buffer.from(b64, 'base64');
  const tx = VersionedTransaction.deserialize(buf);
  tx.sign([payer]);
  const raw = tx.serialize();
  const sig = await conn.sendRawTransaction(raw, {
    skipPreflight: false,
    maxRetries: 3,
    preflightCommitment: 'confirmed',
  });
  return sig;
}

function lamportsToUSD(v) { return Number(v) / 1e6; }

// ---------------------- Stats (snapshot 1m) ----------------------
const stats = {
  minuteWindowStart: Date.now(),
  seenSpreads: 0,
  candidates: 0,
  executed: 0,
  bestNet: -Infinity,
  netSum: 0,
  nearMiss: 0,
};

function snapshotTick() {
  const now = Date.now();
  if (now - stats.minuteWindowStart >= 60_000) {
    const avg = stats.candidates ? stats.netSum / stats.candidates : 0;
    const title = bold(underline('📈 SNAPSHOT (1m)'));
    const line = [
      `${title}`,
      `spreads=${cyan(String(stats.seenSpreads))}`,
      `candidates>=min=${green(String(stats.candidates))}`,
      `executed=${magenta(String(stats.executed))}`,
      `bestNet=${stats.bestNet > 0 ? tag.usd(stats.bestNet) : tag.negusd(stats.bestNet)}`,
      `avgNet=${avg >= 0 ? tag.usd(avg) : tag.negusd(avg)}`,
      `nearMiss(≤$0.10)=${yellow(String(stats.nearMiss))}`,
    ].join('  |  ');
    console.log('\n' + line + '\n' + gray('-'.repeat(100)));
    stats.minuteWindowStart = now;
    stats.seenSpreads = 0;
    stats.candidates = 0;
    stats.executed = 0;
    stats.bestNet = -Infinity;
    stats.netSum = 0;
    stats.nearMiss = 0;
  }
}

// ---------------------- Concurrency limiter ----------------------
function pLimit(n) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (queue.length && active < n) {
      active++;
      const { fn, resolve, reject } = queue.shift();
      fn().then((v) => {
        active--;
        resolve(v);
        next();
      }).catch((e) => {
        active--;
        reject(e);
        next();
      });
    }
  };
  return (fn) => new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    next();
  });
}

// ---------------------- Per-token core ----------------------
async function processToken(conn, payer, memeMint) {
  const short = `${memeMint.slice(0, 4)}…${memeMint.slice(-4)}`;
  const logPrefix = gray(`[${short}]`);

  try {
    // BUY quote
    const qBuy = await quoteBuy(CFG.USDC_MINT, memeMint, CFG.BUY_AMOUNT_USDC, CFG.SLIPPAGE_BPS);
    if (!routePassesFilters(qBuy, 'buy')) return;

    const outMemes = BigInt(qBuy.outAmount);
    const memeDecimals = Number(qBuy.outputMintDecimals || qBuy.outDecimals || 6);
    const _memesHuman = Number(outMemes) / 10 ** memeDecimals;

    // SELL quote
    const qSell = await quoteSell(memeMint, CFG.USDC_MINT, outMemes.toString(), CFG.SLIPPAGE_BPS);
    if (!routePassesFilters(qSell, 'sell')) return;

    // Net profit
    const usdcBack = lamportsToUSD(qSell.outAmount);

    const jupFeeBpsBuy = estimateJupFeeBps(memeMint);
    const jupFeeBpsSell = estimateJupFeeBps(memeMint);
    const jupFeesUSD =
      (CFG.BUY_AMOUNT_USDC * jupFeeBpsBuy) / 10000 +
      (usdcBack * jupFeeBpsSell) / 10000;

    // Priority+Jito cost (heuristic SOL=$150)
    const priorityUSD = (CFG.PRIORITY_LAMPORTS + CFG.JITO_TIP_LAMPORTS) / 1e9 * 150;

    const gross = usdcBack - CFG.BUY_AMOUNT_USDC;
    const net = gross - jupFeesUSD - priorityUSD;

    const dexBuy = normalizeDexSet(extractDexLabels(qBuy));
    const dexSell = normalizeDexSet(extractDexLabels(qSell));
    const dexStr = `${tag.dex('BUY:')} ${dexBuy.join(' > ')}  ${tag.dex('SELL:')} ${dexSell.join(' > ')}`;
    stats.seenSpreads++;

    const netStr = net >= 0 ? tag.usd(net) : tag.negusd(net);
    if (net > stats.bestNet) stats.bestNet = net;
    stats.netSum += net;

    const isCandidate = net >= CFG.MIN_NET_PROFIT_USDC;

    // --- NEW: pretty cards for candidates, simple log for skips
    if (isCandidate) {
      stats.candidates++;
      const title = `🎯 CANDIDATE  ${short}   net ${netStr}`;
      const body = [
        `${cyan('back')} ${tag.usd(usdcBack)}   ${cyan('size')} ${tag.usd(CFG.BUY_AMOUNT_USDC)}   ${cyan('slip')} ${(CFG.SLIPPAGE_BPS/100).toFixed(2)}%`,
        `${cyan('priority')} ${CFG.PRIORITY_LAMPORTS}+${CFG.JITO_TIP_LAMPORTS} lamports   ${CFG.DRY_RUN ? gray('DRY_RUN') : green('LIVE')}`,
        `${dexStr}`,
      ].join('\n');
      console.log(card(title, body, 'ok'));
    } else {
      if ((CFG.MIN_NET_PROFIT_USDC - net) <= 0.10) stats.nearMiss++;
      console.log(
        logPrefix,
        tag.warn('SKIP'),
        'net', netStr,
        '| back', tag.usd(usdcBack),
        '| size', tag.usd(CFG.BUY_AMOUNT_USDC),
        '| slippage', `${(CFG.SLIPPAGE_BPS/100).toFixed(2)}%`,
        '| priority', `${CFG.PRIORITY_LAMPORTS}+${CFG.JITO_TIP_LAMPORTS} lamports`,
        '|', CFG.DRY_RUN ? gray('DRY_RUN') : green('LIVE'),
        '\n   ', dexStr
      );
    }

    // Execute
    if (!CFG.DRY_RUN && isCandidate) {
      if (CFG.MODE === 'sell-only') {
        console.log(logPrefix, tag.warn('MODE=sell-only: skipping buy leg execution'));
        return;
      }

      // BUY
      const buyer = await buildSwapTx({
        quote: qBuy,
        userPublicKey: payer.publicKey.toBase58(),
        wrapAndUnwrapSol: true,
      });
      const { swapTransaction: buyB64 } = buyer || {};
      if (!buyB64) throw new Error('buy swap tx not provided');

      if ((process.env.JITO_MODE || 'off').toLowerCase() === 'relayer') {
        const bundleId = await sendBundleWithTip({
          conn,
          swapB64: buyB64,
          payer,
          tipSol: process.env.JITO_TIP_SOL_BUY || '0.006',
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
        // SELL
        const seller = await buildSwapTx({
          quote: qSell,
          userPublicKey: payer.publicKey.toBase58(),
          wrapAndUnwrapSol: true,
        });
        const { swapTransaction: sellB64 } = seller || {};
        if (!sellB64) throw new Error('sell swap tx not provided');

        if ((process.env.JITO_MODE || 'off').toLowerCase() === 'relayer') {
          const bundleId = await sendBundleWithTip({
            conn,
            swapB64: sellB64,
            payer,
            tipSol: process.env.JITO_TIP_SOL_SELL || '0.008',
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
      stats.executed++;
    }

    if (CFG.PER_TOKEN_COOLDOWN_MS > 0) await sleep(CFG.PER_TOKEN_COOLDOWN_MS);
  } catch (e) {
    console.log(logPrefix, tag.bad(e.message || String(e)));
  }
}

let jitoClient = null;
let jitoTipAccount = null;

async function fetchTipAccountsJsonRpc() {
  const bases = [
    process.env.JITO_BLOCK_ENGINE_HTTP || 'https://mainnet.block-engine.jito.wtf',
    'https://frankfurt.mainnet.block-engine.jito.wtf',
    'https://dublin.mainnet.block-engine.jito.wtf',
    'https://amsterdam.mainnet.block-engine.jito.wtf',
    'https://newyork.mainnet.block-engine.jito.wtf',
    'https://tokyo.mainnet.block-engine.jito.wtf',
  ];

  const headers = { 'content-type': 'application/json' };
  if (process.env.JITO_AUTH_UUID) headers['x-jito-auth'] = process.env.JITO_AUTH_UUID;

  const bodies = [
    { jsonrpc: '2.0', id: 1, method: 'getTipAccounts', params: [] },
    { jsonrpc: '2.0', id: 1, method: 'get_tip_accounts', params: [] },
  ];

  for (const base of bases) {
    try {
      const url = `${base.replace(/\/$/, '')}/api/v1/bundles`;
      for (const body of bodies) {
        const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
        const text = await r.text();
        let j = null;
        try { j = JSON.parse(text); } catch { /* ignore */ }

        const arr =
          j?.result?.tipAccounts ??
          (Array.isArray(j?.result) ? j.result : null);

        if (Array.isArray(arr) && arr.length > 0) {
          return arr;
        }
      }
    } catch (e) {
      // ignore & continue
    }
  }
  return [];
}

async function initJito(conn) {
  const mode = (process.env.JITO_MODE || 'off').toLowerCase();
  if (mode !== 'relayer') return;

  if (process.env.JITO_TIP_ACCOUNT) {
    jitoTipAccount = process.env.JITO_TIP_ACCOUNT.trim();
    console.log(green(`[JITO] Tip account (ENV): ${jitoTipAccount}`));
    return;
  }

  try {
    const url = process.env.JITO_BLOCK_ENGINE || 'searcher.mainnet.block-engine.jito.wtf:443';
    jitoClient = searcherClient(url);

    const tipsGrpc = await jitoClient.getTipAccounts();
    if (Array.isArray(tipsGrpc) && tipsGrpc.length > 0) {
      jitoTipAccount = tipsGrpc[0];
      console.log(green(`[JITO] Tip account (gRPC): ${jitoTipAccount}`));
      return;
    }
    console.log(yellow('[JITO] Loading...'));
  } catch (e) {
    console.log(yellow(`[JITO] Loading...: ${e.message}`));
  }

  try {
    const bases = [
      (process.env.JITO_BLOCK_ENGINE_HTTP || 'https://mainnet.block-engine.jito.wtf').replace(/\/$/, ''),
      'https://frankfurt.mainnet.block-engine.jito.wtf',
      'https://dublin.mainnet.block-engine.jito.wtf',
      'https://amsterdam.mainnet.block-engine.jito.wtf',
      'https://newyork.mainnet.block-engine.jito.wtf',
      'https://tokyo.mainnet.block-engine.jito.wtf',
    ];

    const headers = { 'content-type': 'application/json' };
    if (process.env.JITO_AUTH_UUID) headers['x-jito-auth'] = process.env.JITO_AUTH_UUID;

    const bodies = [
      { jsonrpc: '2.0', id: 1, method: 'getTipAccounts', params: [] },
      { jsonrpc: '2.0', id: 1, method: 'get_tip_accounts', params: [] },
    ];

    let tipsHttp = [];
    outer:
    for (const base of bases) {
      const url = `${base}/api/v1/bundles`;
      for (const body of bodies) {
        try {
          const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
          const text = await r.text();
          let j = null;
          try { j = JSON.parse(text); } catch { j = null; }
          const arr = j?.result?.tipAccounts ?? (Array.isArray(j?.result) ? j.result : null);
          if (Array.isArray(arr) && arr.length > 0) {
            tipsHttp = arr;
            break outer;
          }
        } catch (_) {
          // continue
        }
      }
    }

    if (tipsHttp.length > 0) {
      jitoTipAccount = tipsHttp[Math.floor(Math.random() * tipsHttp.length)];
      console.log(green(`[JITO] Tip account (HTTP): ${jitoTipAccount}`));
      return;
    }

    console.log(yellow('[JITO] Couldnt get tip accounts (HTTP is also empty). Restart the bot.'));
  } catch (e) {
    console.log(yellow(`[JITO] JSON-RPC getTipAccounts error: ${e.message}`));
  }
}

async function sendBundleJsonRpc({ swapB64, tipB64 }) {
  const base = process.env.JITO_BLOCK_ENGINE_HTTP || 'https://mainnet.block-engine.jito.wtf';
  const url = `${base}/api/v1/bundles`;
  const headers = { 'content-type': 'application/json' };
  if (process.env.JITO_AUTH_UUID) headers['x-jito-auth'] = process.env.JITO_AUTH_UUID;

  const body = {
    jsonrpc: '2.0',
    id: 1,
    method: 'sendBundle',
    params: [[swapB64, tipB64]],
  };

  const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  const j = await resp.json();
  if (j?.error) throw new Error(j.error.message || 'sendBundle error');
  return j?.result || null;
}

// ---------------------- Main loop ----------------------
async function main() {
  if (process.env.PRIVATE_KEY_B58) {
    initializeSession(process.env.PRIVATE_KEY_B58);
  }

  await printBanner();

  console.log(bold('\nUSDC ↔ MEME ↔ USDC Arbitrage — Jupiter'), cyan(`[${CFG.JUP_MODE}]`));
  console.log(tag.info(`RPC: ${CFG.RPC_URL}`), '|',
              tag.info(`MODE: ${CFG.MODE}`), '|',
              tag.info(`DRY_RUN: ${CFG.DRY_RUN}`));
  console.log(tag.info(`BUY $: ${CFG.BUY_AMOUNT_USDC} | MIN_NET: $${CFG.MIN_NET_PROFIT_USDC} | SLIPPAGE: ${(CFG.SLIPPAGE_BPS/100).toFixed(2)}%`));

  const incShow = CFG.INCLUDE_DEXES.map(d => normalizeDexLabel(d));
  const excShow = CFG.EXCLUDE_DEXES.map(d => normalizeDexLabel(d));

  if (incShow.length) {
    console.log(tag.info(`DEX Allow (${CFG.INCLUDE_MODE}): ${incShow.join(', ')}`), gray('(aliases enabled)'));
  } else {
    console.log(tag.info('DEX Allow: (any)'));
  }
  if (excShow.length) {
    console.log(tag.info(`DEX Exclude: ${excShow.join(', ')}`), gray('(aliases enabled)'));
  } else {
    console.log(tag.info('DEX Exclude: (none)'));
  }

  console.log(gray('-'.repeat(100)));

  const memes = readMemes('memes.txt');
  console.log(tag.info(`Loaded ${memes.length} meme tokens from memes.txt`));

  const conn = new Connection(CFG.RPC_URL, { commitment: 'confirmed' });
  let payer = null;
  await initJito(conn);

  if (!CFG.DRY_RUN) {
    if (!CFG.PRIVATE_KEY_B58) {
      console.log(tag.bad('PRIVATE_KEY_B58 is empty but DRY_RUN=false. Set the key or enable DRY_RUN.'));
      process.exit(1);
    }
    try {
      const secret = bs58.decode(CFG.PRIVATE_KEY_B58);
      payer = Keypair.fromSecretKey(secret);
      console.log(tag.info(`Wallet: ${payer.publicKey.toBase58()}`));
    } catch (e) {
      console.log(tag.bad(`Failed to load PRIVATE_KEY_B58: ${e.message}`));
      process.exit(1);
    }
  } else {
    payer = Keypair.generate(); // dummy for dry-run
  }

  // snapshot timer
  setInterval(snapshotTick, 1000);

  const limit = pLimit(CFG.MAX_PARALLEL);

  while (true) {
    const started = Date.now();
    const tasks = memes.map(mint => limit(() => processToken(conn, payer, mint)));
    await Promise.allSettled(tasks);
    const elapsed = Date.now() - started;
    const wait = Math.max(0, CFG.SCAN_INTERVAL_MS - elapsed);
    if (wait > 0) await sleep(wait);
  }
}

main().catch(err => {
  console.error(tag.bad(err.stack || err.message || String(err)));
  process.exit(1);
});

