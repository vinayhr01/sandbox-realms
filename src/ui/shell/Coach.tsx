/**
 * The first-launch coach (UX redesign, spec E): three steps, shown in the top-centre column above the toasts. The steps
 * advance in main.ts on the first matching action; the Skip button ends it for good.
 */
import { TUTORIAL_TEXT, TUTORIAL_TITLE } from '../panels/tutorial.ts';
import type { ShellActions, UiStore } from './store.ts';

export function Coach({ store, actions }: { store: UiStore; actions: ShellActions }) {
  const step = store.coach.value;
  if (step === null) return null;
  return (
    <div class="coach" role="region" aria-label="First steps">
      <div class="coach-body">
        <p class="coach-title">{TUTORIAL_TITLE[step] ?? ''}</p>
        <p class="coach-text">{TUTORIAL_TEXT[step] ?? ''}</p>
      </div>
      <button type="button" class="btn coach-skip" onClick={() => actions.skipCoach()}>
        Skip tutorial
      </button>
    </div>
  );
}
