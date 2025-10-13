import https from 'https';
import fetch, { RequestInit } from 'node-fetch';
import { CFG } from './config.js';
import { sleep } from './utils.js';
import { gray } from './logger.js';

const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 64 });

const TRANSIENT_ERROR = /ECONNRESET|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH/i;

export async function fetchWithRetry<T>(
  url: string,
  options: RequestInit = {},
  isPost = false,
): Promise<T> {
  let attempt = 0;
  let lastError: unknown;

  while (attempt < CFG.FETCH_RETRIES) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CFG.HTTP_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        agent: httpsAgent,
        signal: controller.signal,
        ...options,
        headers: {
          accept: 'application/json',
          ...(isPost ? { 'content-type': 'application/json' } : {}),
          ...(CFG.JUP_API_KEY ? { 'x-api-key': CFG.JUP_API_KEY } : {}),
          ...(options.headers ?? {}),
        },
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        if (response.status === 429 || (response.status >= 500 && response.status <= 599)) {
          throw new Error(`HTTP ${response.status} – ${text.slice(0, 200)}`);
        }
        try {
          return (await response.json()) as T;
        } catch {
          return { error: text } as unknown as T;
        }
      }

      return (await response.json()) as T;
    } catch (error) {
      lastError = error;
      attempt += 1;
      const message = (error as Error)?.message ?? '';
      const aborted =
        (error as Error)?.name === 'AbortError' || /aborted/i.test(message);
      if (attempt < CFG.FETCH_RETRIES && (aborted || TRANSIENT_ERROR.test(message))) {
        const backoff = CFG.RETRY_BACKOFF_MS * 2 ** (attempt - 1);
        console.log(gray(`[retry ${attempt}/${CFG.FETCH_RETRIES}] ${message} → wait ${backoff}ms`));
        await sleep(backoff);
        continue;
      }
      throw error;
    }
  }

  throw lastError;
}

export async function httpGet<T>(url: string, query: Record<string, string> = {}): Promise<T> {
  const params = new URLSearchParams(query);
  const fullUrl = params.toString() ? `${url}?${params.toString()}` : url;
  return fetchWithRetry<T>(fullUrl, { method: 'GET' }, false);
}

export async function httpPost<T>(url: string, body: unknown = {}): Promise<T> {
  return fetchWithRetry<T>(url, { method: 'POST', body: JSON.stringify(body) }, true);
}
