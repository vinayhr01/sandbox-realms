/**
 * Which world view a page starts in (3D part 1, spec "Renderer choice"). Precedence: Safe Mode forces 2D; then `?view=`;
 * then the saved choice in localStorage `sr.view`; then the default (3D when WebGL2 works and device memory is unknown or
 * at least 4 GB, otherwise 2D). A 3D start that fails falls back to the 2D renderer.
 */
import type { WorldRenderer } from '../render/world-renderer.ts';
import type { KeyValueStorage } from '../ui/panels/options.ts';

export type ViewKind = '2d' | '3d';

export const VIEW_KEY = 'sr.view';
export const VIEW_FALLBACK_TOAST = '3D view unavailable, showing 2D.';

export interface ViewInputs {
  /** The `view` query parameter, or null. */
  query: string | null;
  /** The saved `sr.view` value, or null. */
  saved: string | null;
  webgl2: boolean;
  /** `navigator.deviceMemory` in GB, or undefined when the browser does not report it. */
  deviceMemory: number | undefined;
  safeMode: boolean;
}

const isView = (v: string | null): v is ViewKind => v === '2d' || v === '3d';

export function chooseView(o: ViewInputs): ViewKind {
  if (o.safeMode) return '2d';
  if (isView(o.query)) return o.query;
  if (isView(o.saved)) return o.saved;
  return o.webgl2 && (o.deviceMemory === undefined || o.deviceMemory >= 4) ? '3d' : '2d';
}

/** The saved choice, or null. Storage can throw (private windows, blocked site data), so the read is wrapped. */
export function readSavedView(storage: KeyValueStorage | null): string | null {
  try {
    return storage?.getItem(VIEW_KEY) ?? null;
  } catch {
    return null;
  }
}

/** Saves the choice; returns false when storage refused. Never throws. */
export function writeSavedView(storage: KeyValueStorage | null, view: ViewKind): boolean {
  try {
    if (!storage) return false;
    storage.setItem(VIEW_KEY, view);
    return true;
  } catch {
    return false;
  }
}

/** True when this browser can create a WebGL2 context. */
export function webgl2Available(): boolean {
  try {
    return document.createElement('canvas').getContext('webgl2') !== null;
  } catch {
    return false;
  }
}

export interface ViewLoaders {
  load3D(host: HTMLElement): Promise<WorldRenderer>;
  load2D(host: HTMLElement): Promise<WorldRenderer>;
}

export interface StartedView {
  renderer: WorldRenderer;
  /** True when 3D was asked for and failed, so the 2D renderer was started instead. The caller shows the toast. */
  fellBack: boolean;
}

/**
 * Starts the chosen view. A 3D start that throws or rejects (chunk load failure, no WebGL2) falls back to 2D; any canvas
 * the failed start appended to the host is removed first, so 2D never draws over a stale 3D canvas.
 */
export async function startView(view: ViewKind, host: HTMLElement, loaders: ViewLoaders): Promise<StartedView> {
  if (view === '2d') return { renderer: await loaders.load2D(host), fellBack: false };
  const before = new Set<Node>(host.childNodes);
  try {
    return { renderer: await loaders.load3D(host), fellBack: false };
  } catch {
    for (const node of [...host.childNodes]) if (!before.has(node)) node.remove();
    return { renderer: await loaders.load2D(host), fellBack: true };
  }
}
