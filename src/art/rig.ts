/**
 * SVG rig for the creature art (map-graphics, Task 7). A species' art is one SVG with a `0 0 128 128` viewBox. Each
 * animated part is a `<g id="..." data-pivot="x y">`: the pivot is where the part rotates. `poseRig` writes each part's
 * `transform` from its gait pose and serialises the SVG for the atlas (atlas.ts). Art never carries a filter: the
 * creature layer draws the drop shadow. Pure DOM (DOMParser, XMLSerializer): jsdom in unit tests, the browser otherwise.
 */
import type { GaitDef, PoseMode } from './gaits.ts';

export const ART_SIZE = 128;
const VIEW_BOX = `0 0 ${ART_SIZE} ${ART_SIZE}`;
/** Largest art file the lint accepts (brief: 12 KB). */
export const MAX_ART_BYTES = 12 * 1024;

export interface RigPart {
  el: SVGGElement;
  px: number;
  py: number;
}

export interface Rig {
  root: SVGSVGElement;
  parts: Map<string, RigPart>;
}

/** Parses an art SVG. Throws on a viewBox other than `0 0 128 128`, a malformed document, or a bad pivot. */
export function parseRig(svg: string): Rig {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  // The root is checked to be an <svg> element just below: the DOM types it as HTMLElement.
  const root = doc.documentElement as unknown as SVGSVGElement;
  if (root.localName !== 'svg' || doc.getElementsByTagName('parsererror').length > 0) throw new Error('rig: not an SVG document');
  const viewBox = (root.getAttribute('viewBox') ?? '').trim().split(/\s+/).join(' ');
  if (viewBox !== VIEW_BOX) throw new Error(`rig: viewBox must be "${VIEW_BOX}", got "${viewBox}"`);

  const parts = new Map<string, RigPart>();
  for (const el of Array.from(root.querySelectorAll('[data-pivot]'))) {
    const id = el.getAttribute('id');
    if (!id) throw new Error('rig: a part with data-pivot needs an id');
    if (el.localName !== 'g') throw new Error(`rig: part ${id} must be a <g>`);
    const nums = (el.getAttribute('data-pivot') ?? '').trim().split(/[\s,]+/).map(Number);
    const [px = NaN, py = NaN] = nums;
    if (nums.length !== 2 || !Number.isFinite(px) || !Number.isFinite(py)) throw new Error(`rig: part ${id} needs a numeric data-pivot "x y"`);
    parts.set(id, { el: el as SVGGElement, px, py });
  }
  return { root, parts };
}

/**
 * Sets every part's transform to its pose at `phase` (`rotate(r px py) translate(dx dy)`; dx and dy are fractions of
 * the art size in the gait table, so they are scaled to user units here) and returns the serialised SVG. The root gets
 * explicit width and height so that an <img> decodes it at 128 px.
 */
export function poseRig(rig: Rig, gait: GaitDef, phase: number, mode: PoseMode): string {
  for (const [name, part] of rig.parts) {
    const p = gait.pose(name, phase, mode);
    part.el.setAttribute('transform', `rotate(${p.rot} ${part.px} ${part.py}) translate(${p.dx * ART_SIZE} ${p.dy * ART_SIZE})`);
  }
  rig.root.setAttribute('width', String(ART_SIZE));
  rig.root.setAttribute('height', String(ART_SIZE));
  return new XMLSerializer().serializeToString(rig.root);
}

/**
 * The problems with one art file, empty when it passes: the size limit, a parseable rig, no filter element, and every
 * part the species' gaits animate (`required`) present.
 */
export function artProblems(svg: string, required: readonly string[]): string[] {
  const problems: string[] = [];
  const bytes = new TextEncoder().encode(svg).length;
  if (bytes > MAX_ART_BYTES) problems.push(`over 12 KB (${(bytes / 1024).toFixed(1)} KB)`);
  let rig: Rig;
  try {
    rig = parseRig(svg);
  } catch (err) {
    return [...problems, err instanceof Error ? err.message : String(err)];
  }
  if (rig.root.getElementsByTagName('filter').length > 0) problems.push('contains a filter element (the layer draws the shadow)');
  for (const part of required) if (!rig.parts.has(part)) problems.push(`missing part ${part}`);
  return problems;
}
