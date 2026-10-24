/**
 * DOM for list windows (13 section 8): a search box, sort buttons that reverse on a second tap,
 * filter chips, a count, and a virtualised list. Sorting and search come from listWindow.ts.
 */
import { VirtualList, sortFilterSearch } from './panels/listWindow.ts';

export interface SortChoice<T> {
  key: keyof T & string;
  label: string;
}

export interface FilterChoice<T> {
  id: string;
  label: string;
  test: (item: T) => boolean;
}

export interface ListSpec<T> {
  /** Accessible name of the search box and the list. */
  name: string;
  items: readonly T[];
  rowHeight: number;
  label: (item: T) => string;
  render: (item: T) => HTMLElement;
  sorts: readonly SortChoice<T>[];
  filters?: readonly FilterChoice<T>[];
  empty: string;
}

export interface ListHandle {
  /** Rebuilds the visible rows, for example after a row's value changed. */
  refresh(): void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

export function buildList<T>(root: HTMLElement, spec: ListSpec<T>): ListHandle {
  let query = '';
  let sortKey = spec.sorts[0]?.key ?? '';
  let desc = false;
  let filterId = spec.filters?.[0]?.id ?? '';

  const toolbar = el('div', 'list-toolbar');
  const search = el('input', 'list-search');
  search.type = 'search';
  search.placeholder = 'Search';
  search.setAttribute('aria-label', `Search ${spec.name}`);
  const sortGroup = el('div', 'list-sorts');
  sortGroup.setAttribute('role', 'group');
  sortGroup.setAttribute('aria-label', `Sort ${spec.name}`);
  const chips = el('div', 'list-chips');
  chips.setAttribute('role', 'group');
  chips.setAttribute('aria-label', `Filter ${spec.name}`);
  const count = el('output', 'list-count');
  count.setAttribute('aria-live', 'polite');
  const scroll = el('div', 'list-scroll');
  scroll.setAttribute('role', 'list');
  scroll.setAttribute('aria-label', spec.name);
  const emptyNote = el('p', 'option-note', spec.empty);
  emptyNote.hidden = true;

  toolbar.append(search, sortGroup, chips, count);
  root.append(toolbar, scroll, emptyNote);

  const vlist = new VirtualList<T>(scroll, spec.rowHeight, (item) => {
    const row = spec.render(item);
    row.setAttribute('role', 'listitem');
    row.classList.add('list-row');
    return row;
  });
  const viewport = (): number => scroll.clientHeight || 360;

  const current = (): readonly T[] => {
    const filter = spec.filters?.find((f) => f.id === filterId);
    return sortFilterSearch(spec.items, {
      sortKey: sortKey as keyof T,
      desc,
      query,
      label: spec.label,
      ...(filter ? { filter: filter.test } : {}),
    });
  };

  const draw = (): void => {
    const shown = current();
    count.textContent = `${shown.length} of ${spec.items.length}`;
    emptyNote.hidden = shown.length > 0;
    vlist.setItems(shown, viewport(), scroll.scrollTop);
  };

  const drawSorts = (): void => {
    sortGroup.replaceChildren(
      ...spec.sorts.map((s) => {
        const btn = el('button', 'btn list-chip', `${s.label}${s.key === sortKey ? (desc ? ' ↓' : ' ↑') : ''}`);
        btn.type = 'button';
        btn.setAttribute('aria-pressed', String(s.key === sortKey));
        btn.addEventListener('click', () => {
          desc = s.key === sortKey ? !desc : false;
          sortKey = s.key;
          drawSorts();
          draw();
        });
        return btn;
      }),
    );
  };

  const drawChips = (): void => {
    const filters = spec.filters ?? [];
    chips.hidden = filters.length === 0;
    chips.replaceChildren(
      ...filters.map((f) => {
        const btn = el('button', 'btn list-chip', f.label);
        btn.type = 'button';
        btn.setAttribute('aria-pressed', String(f.id === filterId));
        btn.addEventListener('click', () => {
          filterId = f.id;
          drawChips();
          draw();
        });
        return btn;
      }),
    );
  };

  search.addEventListener('input', () => {
    query = search.value;
    draw();
  });
  scroll.addEventListener('scroll', () => vlist.update(scroll.scrollTop, viewport()));

  drawSorts();
  drawChips();
  draw();
  return { refresh: draw };
}
