/**
 * Nameplate sizing, as pure data. No renderer import, so the 3D view (src/render3d/marks3d.ts) sizes its names the same way as
 * the 2D marks (marks.ts) without pulling the renderer into its chunk. marks.ts re-exports nameFontPx.
 */

const LABEL_BASE_PX = 16;
const NAME_SCALE_MIN = 30;
const NAME_SCALE_MAX = 160;

/** Nameplate font size (CSS px) for a `ui.scaleNames` percentage, clamped to its range. */
export function nameFontPx(percent: number): number {
  const p = Math.min(NAME_SCALE_MAX, Math.max(NAME_SCALE_MIN, percent));
  return (LABEL_BASE_PX * p) / 100;
}
