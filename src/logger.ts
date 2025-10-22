import boxen from 'boxen';
import {
  cyan,
  magenta,
  yellow,
  green,
  red,
  gray,
  bold,
  blue,
  underline,
} from 'colorette';
import { CFG } from './config.js';

const clampDecimals = (value: number): number => {
  if (!Number.isFinite(value)) return 4;
  return Math.min(8, Math.max(0, Math.floor(value)));
};

const attachSymbol = (value: number): string => {
  const decimals = clampDecimals(CFG.BASE_DISPLAY_DECIMALS);
  const formatted = value.toFixed(decimals);
  if (!CFG.BASE_SYMBOL) {
    return formatted;
  }
  return CFG.BASE_SYMBOL_POSITION === 'prefix'
    ? `${CFG.BASE_SYMBOL}${formatted}`
    : `${formatted} ${CFG.BASE_SYMBOL}`;
};

export const tag = {
  ok: (message: string) => green(bold(`✅ [OK] ${message}`)),
  bad: (message: string) => red(bold(`❌ [X] ${message}`)),
  info: (message: string) => blue(bold(`🐋  [i] ${message}`)),
  warn: (message: string) => yellow(bold(`💶  [!] ${message}`)),
  dex: (message: string) => magenta(bold(message)),
  amount: (value: number) => green(attachSymbol(value)),
  negAmount: (value: number) => red(`-${attachSymbol(Math.abs(value))}`),
  usd: (value: number) => green(attachSymbol(value)),
  negusd: (value: number) => red(`-${attachSymbol(Math.abs(value))}`),
};

type CardVariant = 'info' | 'ok' | 'warn' | 'bad';

export function card(title: string, body: string, variant: CardVariant = 'info'): string {
  const borderColor =
    variant === 'ok'
      ? 'green'
      : variant === 'warn'
        ? 'yellow'
        : variant === 'bad'
          ? 'red'
          : 'cyan';

  return boxen(`${bold(title)}\n${body}`, {
    padding: { top: 0, right: 1, bottom: 0, left: 1 },
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
    borderColor,
    borderStyle: 'round',
  });
}

export { cyan, magenta, yellow, green, red, gray, bold, blue, underline };
