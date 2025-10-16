import fs from 'node:fs';
import path from 'node:path';

let currentLogFile: string | null = null;

if (!process.env.APEX_ARB_LOGGER_INITIALIZED) {
  process.env.APEX_ARB_LOGGER_INITIALIZED = 'true';

  const logsDir = path.join(process.cwd(), 'logs');
  fs.mkdirSync(logsDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logFile = path.join(logsDir, `session-${timestamp}.log`);
  currentLogFile = logFile;
  const logStream = fs.createWriteStream(logFile, { flags: 'a' });

  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);

  const header = `# session ${new Date().toISOString()} pid=${process.pid} bun=${process.versions.bun ?? 'unknown'}\n`;
  logStream.write(header);

  logStream.on('error', (error) => {
    const message = `\n[logManager] write error: ${(error as Error).message}\n`;
    originalStderrWrite(message);
  });

  const intercept = (
    original: typeof process.stdout.write,
    target: NodeJS.WriteStream,
  ) =>
    function interceptWrite(
      chunk: unknown,
      encoding?: BufferEncoding | ((error?: Error | null) => void),
      callback?: (error?: Error | null) => void,
    ): boolean {
      const buffer = Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(String(chunk ?? ''), typeof encoding === 'string' ? encoding : 'utf8');

      logStream.write(buffer);

      if (typeof encoding === 'function') {
        return original.call(target, chunk as any, encoding as any);
      }

      if (typeof callback === 'function') {
        return original.call(target, chunk as any, encoding as any, callback as any);
      }

      if (encoding !== undefined) {
        return original.call(target, chunk as any, encoding as any);
      }

      return original.call(target, chunk as any);
    };

  process.stdout.write = intercept(originalStdoutWrite, process.stdout);
  process.stderr.write = intercept(originalStderrWrite, process.stderr);

  const finalize = () => {
    if (!logStream.closed) {
      logStream.end(`\n# session end ${new Date().toISOString()}\n`);
    }
    currentLogFile = null;
  };

  process.once('exit', finalize);
  process.once('SIGINT', () => {
    finalize();
    process.exit(0);
  });
  process.once('SIGTERM', () => {
    finalize();
    process.exit(0);
  });
}

export function getCurrentLogFile(): string | null {
  return currentLogFile;
}

