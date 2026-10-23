// Budget constants shared with scripts/check-budgets.mjs (17 section 10, PERFORMANCE-PLAN section 2).
export const BUDGETS = {
  mainGzipBytes: 350 * 1024,
  workerGzipBytes: 250 * 1024,
  /** Sim budget per 16.6 ms frame on phones (17 section 3.1). */
  simFrameMsPhone: 6,
  simFrameMsDesktop: 8,
} as const;
