/**
 * First-run tutorial (13 section 17) as data plus a small state machine. Each step waits for a named
 * event; the player may skip the whole tutorial at any point.
 */
export interface TutorialStep {
  id: string;
  /** Event name that completes this step. */
  waitFor: string;
}

/** The first-launch coach (UX redesign, spec E): three steps, each done by the first matching action. */
export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  { id: 'shape', waitFor: 'stroke-finished' },
  { id: 'life', waitFor: 'spawned' },
  { id: 'speed', waitFor: 'speed-changed' },
];

export interface TutorialState {
  index: number;
  skipped: boolean;
  done: boolean;
}

export function newTutorial(): TutorialState {
  return { index: 0, skipped: false, done: false };
}

/** Feeds an event; advances when it matches the current step. Ignored once skipped or done. */
export function tutorialEvent(state: TutorialState, event: string, steps: readonly TutorialStep[] = TUTORIAL_STEPS): TutorialState {
  if (state.skipped || state.done) return state;
  const step = steps[state.index];
  if (!step || step.waitFor !== event) return state;
  const index = state.index + 1;
  return { index, skipped: false, done: index >= steps.length };
}

/** Coach heading for each step. */
export const TUTORIAL_TITLE: Readonly<Record<string, string>> = {
  shape: 'Shape the land',
  life: 'Add life',
  speed: 'Change the speed',
};

/** Coach text for each step. */
export const TUTORIAL_TEXT: Readonly<Record<string, string>> = {
  shape: 'Drag across the map with an armed tool to shape the land.',
  life: 'Open the Creatures chip, arm a creature and tap the map.',
  speed: 'Change the simulation speed with the speed buttons at the top.',
};

/** Parses a saved tutorial state; anything unexpected starts the tutorial over. */
export function parseTutorial(raw: unknown): TutorialState {
  const src = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const index = typeof src['index'] === 'number' && Number.isInteger(src['index']) ? Math.min(TUTORIAL_STEPS.length, Math.max(0, src['index'])) : 0;
  const skipped = src['skipped'] === true;
  const done = src['done'] === true || index >= TUTORIAL_STEPS.length;
  return { index, skipped, done };
}

export function skipTutorial(state: TutorialState): TutorialState {
  return { ...state, skipped: true };
}

export function currentStep(state: TutorialState, steps: readonly TutorialStep[] = TUTORIAL_STEPS): TutorialStep | null {
  return state.skipped || state.done ? null : (steps[state.index] ?? null);
}
