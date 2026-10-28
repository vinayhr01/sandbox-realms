/** Small DOM read-outs: status line, toasts, calendar and the optional debug overlay. */

export function setStatus(text: string): void {
  const el = document.getElementById('status');
  if (el) el.textContent = text;
}

export function setCalendar(text: string): void {
  const el = document.getElementById('calendar');
  if (el) el.textContent = text;
}

export function toast(text: string, action?: { label: string; run: () => void }): void {
  const host = document.getElementById('toasts');
  if (!host) return;
  const item = document.createElement('div');
  item.className = 'toast';
  item.textContent = text;
  if (action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn';
    btn.textContent = action.label;
    btn.addEventListener('click', () => {
      item.remove();
      action.run();
    });
    item.append(' ', btn);
  }
  host.appendChild(item);
  window.setTimeout(() => item.remove(), action ? 30_000 : 3000);
}

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
