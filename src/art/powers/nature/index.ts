/** Illustrated power icons for this group (one SVG per power id, or per chip id in `chips`). See src/art/load.ts. */
const files = import.meta.glob<string>('./*.svg', { query: '?raw', import: 'default', eager: true });

/** The SVG source keyed by file name without `.svg`. An empty group yields an empty record. */
export const ART: Record<string, string> = Object.fromEntries(
  Object.entries(files).map(([path, svg]) => [path.slice(2, -'.svg'.length), svg]),
);
