/**
 * Minimal structured logger. Writes JSON lines to stdout.
 * In production, pipe to a log aggregator.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  level: LogLevel;
  ts: string;
  msg: string;
  [key: string]: unknown;
}

export const log = {
  debug(msg: string, ctx: Record<string, unknown> = {}) {
    write('debug', msg, ctx);
  },
  info(msg: string, ctx: Record<string, unknown> = {}) {
    write('info', msg, ctx);
  },
  warn(msg: string, ctx: Record<string, unknown> = {}) {
    write('warn', msg, ctx);
  },
  error(msg: string, ctx: Record<string, unknown> = {}) {
    write('error', msg, ctx);
  },
};

function write(level: LogLevel, msg: string, ctx: Record<string, unknown>) {
  const entry: LogEntry = { level, ts: new Date().toISOString(), msg, ...ctx };
  if (level === 'error' || level === 'warn') {
    process.stderr.write(JSON.stringify(entry) + '\n');
  } else {
    process.stdout.write(JSON.stringify(entry) + '\n');
  }
}
