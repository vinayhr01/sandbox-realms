/**
 * Crash capture skeleton (19 sections 3-8): unclean-exit sentinel, a small local journal,
 * and a fatal dialog. Storage access is wrapped because it can throw in private windows.
 * Nothing leaves the device (no telemetry in v1).
 */
const SENTINEL_KEY = 'sr.session';
const JOURNAL_KEY = 'sr.journal';
const JOURNAL_MAX = 20;

interface JournalEntry {
  at: string;
  code: string;
  detail: string;
}

function readJournal(): JournalEntry[] {
  try {
    const raw = localStorage.getItem(JOURNAL_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as JournalEntry[]) : [];
  } catch {
    return [];
  }
}

export function journal(code: string, detail: string): void {
  const entries = readJournal();
  entries.push({ at: new Date().toISOString(), code, detail: detail.slice(0, 300) });
  try {
    localStorage.setItem(JOURNAL_KEY, JSON.stringify(entries.slice(-JOURNAL_MAX)));
  } catch {
    // Storage unavailable or full: the journal is best-effort.
  }
}

/** Returns true when the previous session did not reach pagehide cleanly. */
export function startSentinel(): boolean {
  let unclean = false;
  try {
    unclean = localStorage.getItem(SENTINEL_KEY) === 'running';
    localStorage.setItem(SENTINEL_KEY, 'running');
  } catch {
    // Without storage we cannot tell; treat as a clean start.
  }
  window.addEventListener('pagehide', () => {
    try {
      localStorage.setItem(SENTINEL_KEY, 'clean');
    } catch {
      // Ignored: nothing else to do while the page is going away.
    }
  });
  if (unclean) journal('UNCLEAN_EXIT', 'previous session did not exit cleanly');
  return unclean;
}

/** Shows the fatal dialog with a reload action. Safe to call more than once. */
export function showFatal(title: string, detail: string): void {
  const dialog = document.getElementById('fatal');
  const titleEl = document.getElementById('fatal-title');
  const detailEl = document.getElementById('fatal-detail');
  if (!dialog || !titleEl || !detailEl) return;
  titleEl.textContent = title;
  detailEl.textContent = detail;
  dialog.hidden = false;
  document.getElementById('fatal-reload')?.addEventListener('click', () => location.reload(), { once: true });
}

export function installGlobalErrorHandlers(): void {
  window.addEventListener('error', (event: ErrorEvent) => {
    journal('UNCAUGHT', event.message);
    showFatal('Something went wrong', event.message);
  });
  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    const reason: unknown = event.reason;
    const message = reason instanceof Error ? reason.message : String(reason);
    journal('UNHANDLED_REJECTION', message);
    showFatal('Something went wrong', message);
  });
}
