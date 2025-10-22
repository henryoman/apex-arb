import bs58 from 'bs58';
import {
  Commitment,
  Connection,
  Keypair,
  VersionedTransaction,
} from '@solana/web3.js';
import { CFG, SenderCommitment } from './config.js';

type SenderResponse = {
  result?: unknown;
  error?: {
    code?: number;
    message?: string;
    data?: unknown;
  };
};

const resolveCommitment = (value: SenderCommitment): Commitment | null => {
  if (value === 'none') return null;
  if (value === 'processed' || value === 'confirmed' || value === 'finalized') {
    return value;
  }
  return 'confirmed';
};

const serializeTransaction = (swapTransactionB64: string, signer: Keypair) => {
  const buffer = Buffer.from(swapTransactionB64, 'base64');
  const transaction = VersionedTransaction.deserialize(buffer);
  transaction.sign([signer]);
  const serialized = transaction.serialize();
  const signature = transaction.signatures[0];
  if (!signature) {
    throw new Error('missing transaction signature after signing');
  }
  return {
    serialized,
    signature: bs58.encode(signature),
  };
};

export async function sendViaSender(
  connection: Connection,
  swapTransactionB64: string,
  payer: Keypair,
): Promise<string> {
  if (!CFG.SENDER_ENDPOINT) {
    throw new Error('SENDER_ENDPOINT is empty');
  }

  const { serialized, signature } = serializeTransaction(swapTransactionB64, payer);

  const body = {
    jsonrpc: '2.0',
    id: Date.now(),
    method: 'sendTransaction',
    params: [
      Buffer.from(serialized).toString('base64'),
      {
        encoding: 'base64',
        skipPreflight: CFG.SENDER_SKIP_PREFLIGHT,
        maxRetries: Number.isFinite(CFG.SENDER_MAX_RETRIES)
          ? Math.max(0, Math.floor(CFG.SENDER_MAX_RETRIES))
          : 0,
      },
    ],
  };

  const response = await fetch(CFG.SENDER_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(CFG.SENDER_API_KEY ? { 'x-api-key': CFG.SENDER_API_KEY } : {}),
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Sender HTTP ${response.status} ${response.statusText}`);
  }

  const json = (await response.json()) as SenderResponse;
  if (json.error) {
    const message = json.error.message ?? JSON.stringify(json.error);
    throw new Error(`Sender error: ${message}`);
  }

  const commitment = resolveCommitment(CFG.SENDER_CONFIRM_COMMITMENT);
  if (commitment) {
    try {
      await connection.confirmTransaction(signature, commitment);
    } catch (error) {
      throw new Error(`Sender confirmation error: ${(error as Error).message}`);
    }
  }

  return signature;
}

