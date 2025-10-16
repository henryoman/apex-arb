import fetch from 'node-fetch';
import {
  Connection,
  Keypair,
  PublicKey,
  VersionedTransaction,
} from '@solana/web3.js';
import jito from 'jito-ts';
import { green, yellow, tag } from './logger.js';

const { searcher, bundle } = jito;
const { searcherClient } = searcher;
const { Bundle } = bundle;

type SearcherClient = ReturnType<typeof searcherClient>;

let jitoClient: SearcherClient | null = null;
let jitoTipAccount: string | null = null;

export function getJitoTipAccount(): string | null {
  return jitoTipAccount;
}

export async function initJito(_connection: Connection): Promise<void> {
  const mode = (process.env.JITO_MODE ?? 'off').toLowerCase();
  if (mode !== 'relayer') return;

  if (process.env.JITO_TIP_ACCOUNT) {
    jitoTipAccount = process.env.JITO_TIP_ACCOUNT.trim();
    console.log(tag.info(`[JITO] Tip account (ENV): ${jitoTipAccount}`));
    return;
  }

  try {
    const endpoint = process.env.JITO_BLOCK_ENGINE ?? 'searcher.mainnet.block-engine.jito.wtf:443';
    jitoClient = searcherClient(endpoint);

    const tipsGrpc = await jitoClient.getTipAccounts?.();
    if (Array.isArray(tipsGrpc) && tipsGrpc.length > 0) {
      jitoTipAccount = tipsGrpc[0];
      console.log(tag.info(`[JITO] Tip account (gRPC): ${jitoTipAccount}`));
      return;
    }
    console.log(tag.warn('[JITO] Loading...'));
  } catch (error) {
    console.log(tag.warn(`[JITO] Loading...: ${(error as Error).message}`));
  }

  try {
    const bases = [
      (process.env.JITO_BLOCK_ENGINE_HTTP ?? 'https://mainnet.block-engine.jito.wtf').replace(/\/$/, ''),
      'https://frankfurt.mainnet.block-engine.jito.wtf',
      'https://dublin.mainnet.block-engine.jito.wtf',
      'https://amsterdam.mainnet.block-engine.jito.wtf',
      'https://newyork.mainnet.block-engine.jito.wtf',
      'https://tokyo.mainnet.block-engine.jito.wtf',
    ];

    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (process.env.JITO_AUTH_UUID) headers['x-jito-auth'] = process.env.JITO_AUTH_UUID;

    const bodies = [
      { jsonrpc: '2.0', id: 1, method: 'getTipAccounts', params: [] as unknown[] },
      { jsonrpc: '2.0', id: 1, method: 'get_tip_accounts', params: [] as unknown[] },
    ];

    let tipsHttp: string[] = [];

    outer: for (const base of bases) {
      const url = `${base}/api/v1/bundles`;
      for (const body of bodies) {
        try {
          const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
          });
          const text = await response.text();
          let parsed: unknown;
          try {
            parsed = JSON.parse(text);
          } catch {
            parsed = null;
          }
          const result = (parsed as { result?: { tipAccounts?: string[] } | string[] })?.result;
          const accounts =
            Array.isArray(result)
              ? result
              : Array.isArray(result?.tipAccounts)
                ? result.tipAccounts
                : null;

          if (accounts && accounts.length > 0) {
            tipsHttp = accounts;
            break outer;
          }
        } catch {
          // continue to next endpoint
        }
      }
    }

    if (tipsHttp.length > 0) {
      const index = Math.floor(Math.random() * tipsHttp.length);
      jitoTipAccount = tipsHttp[index];
      console.log(tag.info(`[JITO] Tip account (HTTP): ${jitoTipAccount}`));
      return;
    }

    console.log(tag.warn('[JITO] Could not fetch tip accounts via HTTP. Restart the bot.'));
  } catch (error) {
    console.log(tag.warn(`[JITO] JSON-RPC getTipAccounts error: ${(error as Error).message}`));
  }
}

interface BundleParams {
  conn: Connection;
  swapB64: string;
  payer: Keypair;
  tipSol: string | number | undefined;
}

export async function sendBundleWithTip({
  conn,
  swapB64,
  payer,
  tipSol,
}: BundleParams): Promise<string | null> {
  if (!jitoClient || !jitoTipAccount) return null;

  const swapBuffer = Buffer.from(swapB64, 'base64');
  const swapTx = VersionedTransaction.deserialize(swapBuffer);
  swapTx.sign([payer]);

  const { blockhash } = await conn.getLatestBlockhash('finalized');
  const tipLamports = Math.floor(Number(tipSol ?? 0) * 1e9);

  const bundleTx = new Bundle([swapTx], 5);
  const addResult = bundleTx.addTipTx(
    payer,
    tipLamports,
    new PublicKey(jitoTipAccount),
    blockhash,
  );
  if (addResult instanceof Error) {
    console.log(tag.warn(`[JITO] addTipTx error: ${addResult.message}`));
    return null;
  }

  try {
    const bundleId = await jitoClient.sendBundle(bundleTx);
    return bundleId;
  } catch (error) {
    console.log(tag.warn(`[JITO] sendBundle error: ${(error as Error).message}`));
    return null;
  }
}
