import fs from 'fs';

export function readMemes(file = 'memes.txt'): string[] {
  if (!fs.existsSync(file)) {
    throw new Error(`memes file not found: ${file}`);
  }

  return fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}
