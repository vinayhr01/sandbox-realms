/**
 * First-run tutorial (13 section 17) as data plus a small state machine. Each step waits for a named
 * event; the player may skip the whole tutorial at any point.
 */
export interface TutorialStep {
  id: string;
  /** Event name that completes this step. */
  waitFor: string;
}

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  { id: 'pick-tool', waitFor: 'tool-armed' },
  { id: 'paint', waitFor: 'stroke-finished' },
  { id: 'inspect', waitFor: 'tile-inspected' },
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

export function skipTutorial(state: TutorialState): TutorialState {
  return { ...state, skipped: true };
}

export function currentStep(state: TutorialState, steps: readonly TutorialStep[] = TUTORIAL_STEPS): TutorialStep | null {
  return state.skipped || state.done ? null : (steps[state.index] ?? null);
}
