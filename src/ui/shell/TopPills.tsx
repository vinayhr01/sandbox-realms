/** The two floating pills over the top of the map: realm (opens the Atlas) and speed (pause and speeds). */
import type { UiStore, ShellActions } from './store.ts';
import type { Speed } from '../../shared/protocol.ts';

interface SpeedChoice {
  speed: Speed;
  /** Visible label. */
  label: string;
  /** Accessible name; the e2e tests and screen readers use it. */
  name: string;
}

const SPEEDS: readonly SpeedChoice[] = [
  { speed: 0.5, label: '½', name: 'x0.5' },
  { speed: 1, label: '1', name: 'x1' },
  { speed: 2, label: '2', name: 'x2' },
  { speed: 5, label: '5', name: 'x5' },
  { speed: 10, label: '10', name: 'x10' },
];

export function TopPills({ store, actions }: { store: UiStore; actions: ShellActions }) {
  const realm = store.realm.value;
  const paused = store.paused.value;
  const speed = store.speed.value;
  return (
    <div class="top-pills">
      <button
        type="button"
        class="pill realm-pill"
        aria-haspopup="dialog"
        aria-label={`Realm ${realm.name}, open Atlas`}
        onClick={() => {
          store.atlas.value = { ...store.atlas.value, open: true, tab: 'world' };
        }}
      >
        <span id="realm-name" class="realm-name">
          {realm.name}
        </span>
        <span class="realm-stat">Year {realm.year}</span>
        <span class="realm-stat realm-extra">{realm.creatures} creatures</span>
        <span class="realm-stat realm-extra">{realm.towns} towns</span>
      </button>
      <div class="pill-end">
        <div class="pill speed-pill" role="group" aria-label="Simulation speed">
          <button
            id="pause"
            type="button"
            class="btn icon"
            aria-label={paused ? 'Resume' : 'Pause'}
            aria-pressed={paused ? 'true' : 'false'}
            onClick={() => actions.togglePause()}
          >
            {paused ? '▶' : '❚❚'}
          </button>
          {SPEEDS.map((choice) => {
            const pressed = !paused && speed === choice.speed;
            return (
              <button
                key={choice.name}
                type="button"
                class="btn speed-btn"
                aria-label={choice.name}
                aria-pressed={pressed ? 'true' : 'false'}
                onClick={() => actions.setSpeed(choice.speed)}
              >
                {choice.label}
              </button>
            );
          })}
        </div>
        <button
          id="settings-open"
          type="button"
          class="pill pill-button"
          aria-haspopup="dialog"
          onClick={() => actions.openWindow('win_settings')}
        >
          Settings
        </button>
      </div>
    </div>
  );
}
