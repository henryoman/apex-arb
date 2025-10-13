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

export const tag = {
  ok: (message: string) => green(bold(`✅ [OK] ${message}`)),
  bad: (message: string) => red(bold(`❌ [X] ${message}`)),
  info: (message: string) => blue(bold(`🐋  [i] ${message}`)),
  warn: (message: string) => yellow(bold(`💶  [!] ${message}`)),
  dex: (message: string) => magenta(bold(message)),
  usd: (value: number) => `${green('$')}${value.toFixed(4)}`,
  negusd: (value: number) => `${red('-$')}${Math.abs(value).toFixed(4)}`,
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
