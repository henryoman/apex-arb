import {
  Connection,
  Keypair,
  VersionedTransaction,
} from '@solana/web3.js';
import { CFG, JUP_BASE } from './config.js';
import { httpGet, httpPost } from './http.js';

export interface JupiterRoutePlanStep {
  label?: string;
  ammLabel?: string;
  swapInfo?: {
    label?: string;
    ammLabel?: string;
  };
}

export interface JupiterMarketInfo {
  label?: string;
  ammLabel?: string;
}

export interface JupiterRoute {
  marketInfos?: JupiterMarketInfo[];
}

export interface JupiterQuote {
  outAmount: string;
  inputMint: string;
  outputMint: string;
  routePlan?: JupiterRoutePlanStep[];
  marketInfos?: JupiterMarketInfo[];
  routes?: JupiterRoute[];
  outputMintDecimals?: number;
  outDecimals?: number;
}

export interface SwapTransactionResponse {
  swapTransaction?: string;
}

interface QuoteResponseWrapper {
  data?: JupiterQuote[];
  quote?: JupiterQuote;
}

export async function quoteBuy(
  usdcMint: string,
  memeMint: string,
  amountUsdc: number,
  slippageBps: number,
): Promise<JupiterQuote> {
  const query = {
    inputMint: usdcMint,
    outputMint: memeMint,
    amount: Math.floor(amountUsdc * 1_000_000).toString(),
    slippageBps: slippageBps.toString(),
  };
  const url = `${JUP_BASE}/swap/v1/quote`;
  const data = await httpGet<QuoteResponseWrapper | JupiterQuote>(url, query);
  const quote =
    (data as QuoteResponseWrapper)?.data?.[0] ??
    (data as QuoteResponseWrapper)?.quote ??
    (data as JupiterQuote);
  if (!quote?.outAmount) {
    throw new Error('invalid buy quote');
  }
  return quote;
}

export async function quoteSell(
  memeMint: string,
  usdcMint: string,
  memeAmountLamports: string,
  slippageBps: number,
): Promise<JupiterQuote> {
  const query = {
    inputMint: memeMint,
    outputMint: usdcMint,
    amount: memeAmountLamports,
    slippageBps: slippageBps.toString(),
  };
  const url = `${JUP_BASE}/swap/v1/quote`;
  const data = await httpGet<QuoteResponseWrapper | JupiterQuote>(url, query);
  const quote =
    (data as QuoteResponseWrapper)?.data?.[0] ??
    (data as QuoteResponseWrapper)?.quote ??
    (data as JupiterQuote);
  if (!quote?.outAmount) {
    throw new Error('invalid sell quote');
  }
  return quote;
}

interface BuildSwapTxPayload {
  quote: JupiterQuote;
  userPublicKey: string;
  wrapAndUnwrapSol?: boolean;
}

export async function buildSwapTx(payload: BuildSwapTxPayload): Promise<SwapTransactionResponse> {
  const url = `${JUP_BASE}/swap/v1/transactions`;
  return httpPost<SwapTransactionResponse>(url, {
    quoteResponse: payload.quote,
    userPublicKey: payload.userPublicKey,
    wrapAndUnwrapSol: payload.wrapAndUnwrapSol ?? true,
    asLegacyTransaction: false,
    dynamicSlippage: false,
    prioritizationFeeLamports: Number(CFG.PRIORITY_LAMPORTS + CFG.JITO_TIP_LAMPORTS),
  });
}

export async function sendB64Tx(
  connection: Connection,
  swapTransactionB64: string,
  payer: Keypair,
): Promise<string> {
  const buffer = Buffer.from(swapTransactionB64, 'base64');
  const transaction = VersionedTransaction.deserialize(buffer);
  transaction.sign([payer]);
  const serialized = transaction.serialize();
  return connection.sendRawTransaction(serialized, {
    skipPreflight: false,
    maxRetries: 3,
    preflightCommitment: 'confirmed',
  });
}

export function extractDexLabels(quote: JupiterQuote): string[] {
  try {
    const labels = new Set<string>();
    const routePlan = quote.routePlan ?? quote.marketInfos ?? [];
    for (const hop of routePlan) {
      if (hop?.swapInfo?.label) labels.add(hop.swapInfo.label);
      if (hop?.swapInfo?.ammLabel) labels.add(hop.swapInfo.ammLabel);
      if (hop?.label) labels.add(hop.label);
      if (hop?.ammLabel) labels.add(hop.ammLabel);
    }
    if (Array.isArray(quote.routes)) {
      for (const route of quote.routes) {
        route.marketInfos?.forEach((info) => {
          if (info.label) labels.add(info.label);
          if (info.ammLabel) labels.add(info.ammLabel);
        });
      }
    }
    return Array.from(labels);
  } catch {
    return [];
  }
}
