/**
 * List windows (13 section 8): a pure sort, filter and search, and a virtualised renderer that only
 * builds the rows visible in the scroll viewport.
 */
export interface SortFilterOptions<T> {
  /** Field to sort by; compared with < and >. */
  sortKey: keyof T;
  desc: boolean;
  /** Keep items for which this returns true (applied before search). */
  filter?: (item: T) => boolean;
  /** Case-insensitive substring matched against `label` of each item. */
  query: string;
  label: (item: T) => string;
}

export function sortFilterSearch<T>(items: readonly T[], opts: SortFilterOptions<T>): T[] {
  const needle = opts.query.trim().toLowerCase();
  const kept = items.filter(
    (item) => (opts.filter ? opts.filter(item) : true) && (needle === '' || opts.label(item).toLowerCase().includes(needle)),
  );
  const sign = opts.desc ? -1 : 1;
  return kept
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const av = a.item[opts.sortKey];
      const bv = b.item[opts.sortKey];
      if (av < bv) return -sign;
      if (av > bv) return sign;
      return a.index - b.index;
    })
    .map((x) => x.item);
}

/** Rows to build for a viewport: start index and exclusive end, with overscan on both sides. */
export function visibleRange(count: number, rowHeight: number, viewportHeight: number, scrollTop: number, overscan = 3): { start: number; end: number } {
  if (count <= 0 || rowHeight <= 0) return { start: 0, end: 0 };
  const first = Math.floor(Math.max(0, scrollTop) / rowHeight);
  const visible = Math.ceil(Math.max(0, viewportHeight) / rowHeight);
  const start = Math.max(0, first - overscan);
  const end = Math.min(count, first + visible + overscan);
  return { start, end };
}

/**
 * Virtual list: a spacer gives the full height, and only the rows in range are in the DOM.
 * Call update(scrollTop, viewportHeight) on scroll. Browser-only (uses document).
 */
export class VirtualList<T> {
  private readonly spacer: HTMLElement;
  private rows: HTMLElement[] = [];
  private items: T[] = [];
  private range = { start: 0, end: 0 };

  constructor(
    private readonly host: HTMLElement,
    private readonly rowHeight: number,
    private readonly render: (item: T, index: number) => HTMLElement,
  ) {
    this.spacer = document.createElement('div');
    this.spacer.className = 'vlist-spacer';
    host.appendChild(this.spacer);
  }

  setItems(items: readonly T[], viewportHeight: number, scrollTop: number): void {
    this.items = [...items];
    this.spacer.style.height = `${this.items.length * this.rowHeight}px`;
    this.update(scrollTop, viewportHeight);
  }

  update(scrollTop: number, viewportHeight: number): void {
    const range = visibleRange(this.items.length, this.rowHeight, viewportHeight, scrollTop);
    for (const row of this.rows) row.remove();
    this.rows = [];
    for (let i = range.start; i < range.end; i++) {
      const item = this.items[i];
      if (item === undefined) continue;
      const row = this.render(item, i);
      row.style.position = 'absolute';
      row.style.top = `${i * this.rowHeight}px`;
      row.style.height = `${this.rowHeight}px`;
      this.host.appendChild(row);
      this.rows.push(row);
    }
    this.range = range;
  }

  get rendered(): { start: number; end: number } {
    return { ...this.range };
  }
}
