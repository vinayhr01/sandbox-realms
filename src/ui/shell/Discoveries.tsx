/**
 * The Discoveries list in the Atlas (UX redesign, spec E): every entry, with its line once it is met and a locked
 * placeholder until then. The achievements sections stay below it, in the Atlas.
 */
import { DISCOVERIES } from '../../content/discoveries.ts';
import type { UiStore } from './store.ts';

export function DiscoveryList({ store }: { store: UiStore }) {
  const found = new Set(store.found.value);
  return (
    <section class="discovery-list" aria-label="Discoveries">
      <ul class="discovery-items">
        {DISCOVERIES.map((entry) =>
          found.has(entry.id) ? (
            <li key={entry.id} class="discovery-item" data-state="found">
              <strong>{entry.title}</strong>
              <span class="discovery-text">{entry.text}</span>
            </li>
          ) : (
            <li key={entry.id} class="discovery-item" data-state="locked">
              <strong>???</strong>
              <span class="discovery-text">Not discovered yet.</span>
            </li>
          ),
        )}
      </ul>
    </section>
  );
}
