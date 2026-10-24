/**
 * The UI's copy of the latest sim snapshot (13 section 1). The main thread stores each Ev.Snapshot
 * here; windows read `current` and subscribe to be told when a new one arrives. Holds no sim state.
 */
import type { Snapshot } from '../shared/protocol.ts';

export class SimView {
  private snap: Snapshot | null = null;
  private readonly listeners = new Set<(snap: Snapshot) => void>();

  /** The newest snapshot, or null before the first one arrives. */
  get current(): Snapshot | null {
    return this.snap;
  }

  /** Stores a snapshot and tells the listeners. Messages arrive in order; a new realm resets the tick. */
  apply(snap: Snapshot): void {
    this.snap = snap;
    for (const listener of this.listeners) listener(snap);
  }

  /** Adds a listener; returns the function that removes it. */
  subscribe(listener: (snap: Snapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
