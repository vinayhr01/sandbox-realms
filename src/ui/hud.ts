/** The optional debug overlay (the status line, calendar and toasts live in src/ui/shell). */

export interface DebugStats {
  fps: number;
  tick: number;
  avgTickMs: number;
  tps: number;
  speed: number;
  hash: number;
  side: number;
  zoom: number;
}

export function setDebug(stats: DebugStats): void {
  const el = document.getElementById('debug');
  if (!el || el.hidden) return;
  el.textContent =
    `fps ${stats.fps.toFixed(0)} · tick ${stats.tick} · ${stats.tps.toFixed(1)} tps · ` +
    `sim ${stats.avgTickMs.toFixed(2)} ms · x${stats.speed} · ${stats.side}² · zoom ${stats.zoom.toFixed(1)} · ` +
    `hash ${(stats.hash >>> 0).toString(16).padStart(8, '0')} · mode T`;
}
