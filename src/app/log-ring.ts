/**
 * Warn-and-up log lines for crash records (19 section 3, Logs). Only warnings and errors are kept, so the ring
 * holds the lines a crash needs. Consecutive repeats collapse into one line with a count, so a fault that fires
 * every frame cannot fill the ring. Lines are scrubbed when a record is built (crash-record.ts), not here.
 */

/** Main-thread ring size (19 section 3, 17 section 9: main 2,000). */
export const LOG_RING_MAX = 2_000;
/** A crash record attaches at most this many lines (19 section 5). */
export const CRASH_LOG_LINES = 200;
/** The diagnostics bundle attaches this many lines (17 section 9: last 500 log lines). */
export const DIAGNOSTIC_LOG_LINES = 500;
const LINE_MAX = 300;

export type LogLevel = 'warn' | 'error' | 'fatal';

interface LogLine {
  level: LogLevel;
  text: string;
  count: number;
}

const lines: LogLine[] = [];

/** Adds one warn-and-up line. A line equal to the newest one (same level and text) adds to its count instead. */
export function logLine(level: LogLevel, text: string): void {
  const clipped = text.slice(0, LINE_MAX);
  const last = lines[lines.length - 1];
  if (last && last.level === level && last.text === clipped) {
    last.count++;
    return;
  }
  lines.push({ level, text: clipped, count: 1 });
  if (lines.length > LOG_RING_MAX) lines.splice(0, lines.length - LOG_RING_MAX);
}

/** The newest `limit` lines, oldest first, as text: `[level] text` with ` (xN)` when a line repeated. */
export function recentLogLines(limit: number = CRASH_LOG_LINES): string[] {
  return lines.slice(-Math.max(0, limit)).map((l) => `[${l.level}] ${l.text}${l.count > 1 ? ` (x${l.count})` : ''}`);
}
