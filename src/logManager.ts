import fs from 'node:fs';
import path from 'node:path';

if (!process.env.APEX_ARB_LOGGER_INITIALIZED) {
  process.env.APEX_ARB_LOGGER_INITIALIZED = 'true';

  const logsDir = path.join(process.cwd(), 'logs');
  fs.mkdirSync(logsDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logFile = path.join(logsDir, `session-${timestamp}.log`);
  const logStream = fs.createWriteStream(logFile, { flags: 'a' });

  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);

  const intercept = (
    original: typeof process.stdout.write,
    target: NodeJS.WriteStream,
  ) =>
    function interceptWrite(
      chunk: unknown,
      encoding?: BufferEncoding | ((error?: Error | null) => void),
      callback?: (error?: Error | null) => void,
    ): boolean {
      let actualEncoding: BufferEncoding | undefined;
      let actualCallback: ((error?: Error | null) => void) | undefined;

      if (typeof encoding === 'function') {
        actualCallback = encoding;
        actualEncoding = undefined;
      } else {
        actualEncoding = encoding;
        actualCallback = callback;
      }

      const buffer = Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(String(chunk ?? ''), actualEncoding ?? 'utf8');

      logStream.write(buffer);

      return original.call(target, chunk as any, encoding as any, actualCallback as any);
    };

  process.stdout.write = intercept(originalStdoutWrite, process.stdout);
  process.stderr.write = intercept(originalStderrWrite, process.stderr);

  const finalize = () => {
    if (!logStream.closed) {
      logStream.end();
    }
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

