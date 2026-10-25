import { Cmd, Ev, PROTOCOL_VERSION, type BrushOp, type BrushShape, type Command, type Event, type Speed } from '../shared/protocol.ts';

/** Command shape without the `seq` the client assigns. Distributes over the union. */
type Draft<T> = T extends unknown ? Omit<T, 'seq'> : never;
export type CommandDraft = Draft<Command>;

export type QueryResult = Extract<Event, { kind: typeof Ev.QueryResult }>;

const SENT_LOG_MAX = 64;

/** Worker deaths allowed inside the window before the client gives up and reports a fatal fault. */
export const RESPAWN_MAX = 3;
export const RESPAWN_WINDOW_MS = 5 * 60_000;

/**
 * True when a respawn may happen. `deaths` are the times (ms) of the worker deaths, the newest last;
 * deaths outside the window do not count. More than RESPAWN_MAX inside it means the worker keeps
 * dying, so the client stops respawning and the crash dialogs take over (19 section 7).
 */
export function respawnAllowed(deaths: readonly number[], now: number): boolean {
  const recent = deaths.filter((t) => now - t < RESPAWN_WINDOW_MS && t <= now);
  return recent.length <= RESPAWN_MAX;
}

/**
 * The reply a request gets when its worker died before answering. Each kind gets the shape its
 * caller reads: no save bytes, a failed load, a zero realm, or an empty query.
 */
export function fallbackReply(kind: number, reply: number): Event {
  switch (kind) {
    case Cmd.SaveRealm:
      return { kind: Ev.Saved, reply, bytes: new Uint8Array(0) };
    case Cmd.LoadRealm:
      return { kind: Ev.Loaded, reply, ok: false, detail: 'The simulation was restarted before the save loaded.' };
    case Cmd.Query:
      return { kind: Ev.QueryResult, reply, tileX: 0, tileY: 0, elevation: 0, ground: '', inBounds: false };
    default:
      // Empty contentHash: no worker answered, so the page does not treat it as a build mismatch.
      return { kind: Ev.Ready, reply, protocolVersion: PROTOCOL_VERSION, side: 0, sizeStep: 0, seed: 0, contentHash: '' };
  }
}

interface Pending {
  readonly kind: number;
  readonly resolve: (event: Event) => void;
}

interface RealmArgs {
  readonly seed: number;
  readonly sizeStep: number;
  readonly template: string;
}

/**
 * Main-thread side of the sim worker protocol (17 section 2.2). Assigns sequence numbers,
 * routes replies to their requests, and forwards unsolicited events to one listener.
 *
 * If the worker dies, the client starts a new one (up to RESPAWN_MAX times in RESPAWN_WINDOW_MS),
 * re-initialises it, starts the last realm again and tells the listener with a warning fault. The
 * realm's state is lost with the old worker: the app then restores the newest autosave (onRespawn).
 */
export class SimClient {
  private worker: Worker;
  private seq = 1;
  private readonly replies = new Map<number, Pending>();
  private listener: ((event: Event) => void) | null = null;
  private resumedListener: ((event: Event) => void) | null = null;
  private respawnListener: (() => void) | null = null;
  private readonly sent: number[] = [];
  private realm: RealmArgs | null = null;
  private deaths: number[] = [];
  private respawned = 0;
  /** performance.now() of the last Heartbeat; null until the first one for the current worker. */
  private heartbeatAt: number | null = null;
  /** Realm-replacing requests (NewRealm, LoadRealm) still waiting: worldgen and decode may block the worker. */
  private heavyPending = 0;

  constructor() {
    this.worker = this.spawn();
  }

  onEvent(listener: (event: Event) => void): void {
    this.listener = listener;
  }

  /**
   * Listener for a Ready with reply 0: a generation job resumed after a reload finished (03 section 10). No request
   * is waiting on it, so it is kept away from onEvent, whose Ready means a realm the page asked for.
   */
  onResumed(listener: (event: Event) => void): void {
    this.resumedListener = listener;
  }

  /** Called after a respawn, once the new worker is initialised and the last realm is started again. */
  onRespawn(listener: () => void): void {
    this.respawnListener = listener;
  }

  /** How many times the worker has been started again. */
  get respawnCount(): number {
    return this.respawned;
  }

  /** performance.now() of the last heartbeat, or null before the worker has posted one. */
  get lastHeartbeat(): number | null {
    return this.heartbeatAt;
  }

  /**
   * True when the watchdog may judge the worker: a heartbeat has been seen and no realm is being
   * generated or decoded (a long but healthy realm build must not read as a stall).
   */
  get watchdogArmed(): boolean {
    return this.heartbeatAt !== null && this.heavyPending === 0;
  }

  /** Restarts the watchdog clock from now, for example after the user chose to wait. */
  resetHeartbeat(): void {
    if (this.heartbeatAt !== null) this.heartbeatAt = performance.now();
  }

  /** Ends the current worker and starts another, as after a crash; the newest autosave resumes (onRespawn). */
  restartWorker(reason: string): void {
    this.workerDied(reason);
  }

  send(command: CommandDraft, transfer: Transferable[] = []): number {
    const seq = this.seq++;
    const full = { ...command, seq } as Command;
    this.worker.postMessage(full, transfer);
    this.sent.push(full.kind);
    if (this.sent.length > SENT_LOG_MAX) this.sent.shift();
    return seq;
  }

  /** Kinds of the most recent commands sent, oldest first. Read by the e2e hooks; not used by the game. */
  get sentKinds(): readonly number[] {
    return this.sent;
  }

  init(): Promise<Event> {
    return this.request({ kind: Cmd.Init, protocolVersion: PROTOCOL_VERSION });
  }

  newRealm(seed: number, sizeStep: number, template = 'continent'): Promise<Event> {
    this.realm = { seed, sizeStep, template };
    return this.request({ kind: Cmd.NewRealm, seed, sizeStep, template });
  }

  setSpeed(speed: Speed): void {
    this.send({ kind: Cmd.SetSpeed, speed });
  }

  stroke(
    op: BrushOp,
    shape: BrushShape,
    size: number,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    includeStart: boolean,
  ): void {
    this.send({ kind: Cmd.Stroke, op, shape, size, x0, y0, x1, y1, includeStart });
  }

  /** Applies one power from content/powers.ts at a tile. */
  power(powerId: string, x: number, y: number): void {
    this.send({ kind: Cmd.Power, powerId, x, y });
  }

  /** Sets one Realm Rule by id (src/sim/rules.ts). */
  setRule(rule: string, on: boolean): void {
    this.send({ kind: Cmd.SetRule, rule, on });
  }

  /** Asks the worker for a snapshot now; it arrives as an Ev.Snapshot event. */
  requestSnapshot(): void {
    this.send({ kind: Cmd.Snapshot });
  }

  query(tileX: number, tileY: number): Promise<QueryResult> {
    return this.request({ kind: Cmd.Query, tileX, tileY }) as Promise<QueryResult>;
  }

  returnBuffer(buffer: ArrayBuffer): void {
    this.send({ kind: Cmd.ReturnBuffer, buffer }, [buffer]);
  }

  /** Encodes the live realm; null when there is no realm to save. */
  async capture(): Promise<Uint8Array | null> {
    const event = await this.request({ kind: Cmd.SaveRealm });
    return event.kind === Ev.Saved && event.bytes.length > 0 ? event.bytes : null;
  }

  /** Replaces the live realm with a save; false when the save cannot be decoded. */
  async restore(bytes: Uint8Array): Promise<boolean> {
    const event = await this.request({ kind: Cmd.LoadRealm, bytes });
    return event.kind === Ev.Ready;
  }

  private spawn(): Worker {
    const worker = new Worker(new URL('../sim/worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (message: MessageEvent<Event>) => {
      if (worker === this.worker) this.dispatch(message.data);
    };
    worker.onerror = (event: ErrorEvent) => {
      if (worker === this.worker) this.workerDied(event.message);
    };
    return worker;
  }

  /** The worker stopped: start another, answer the requests it never answered, and resume the realm. */
  private workerDied(detail: string): void {
    const dead = this.worker;
    dead.terminate();
    const now = Date.now();
    this.deaths = [...this.deaths.filter((t) => now - t < RESPAWN_WINDOW_MS), now];
    if (!respawnAllowed(this.deaths, now)) {
      this.listener?.({ kind: Ev.Fault, severity: 'fatal', code: 'WORKER_ERROR', detail });
      return;
    }
    this.worker = this.spawn();
    this.respawned++;
    this.heartbeatAt = null;
    this.settlePending();
    this.listener?.({
      kind: Ev.Fault,
      severity: 'warn',
      code: 'WORKER_RESPAWN',
      detail: 'The simulation stopped and was started again.',
    });
    this.send({ kind: Cmd.Init, protocolVersion: PROTOCOL_VERSION });
    if (this.realm) this.send({ kind: Cmd.NewRealm, ...this.realm });
    this.respawnListener?.();
  }

  private settlePending(): void {
    const pending = [...this.replies.entries()];
    this.replies.clear();
    for (const [seq, p] of pending) p.resolve(fallbackReply(p.kind, seq));
  }

  private request(command: CommandDraft): Promise<Event> {
    return new Promise<Event>((resolve) => {
      const seq = this.send(command);
      const heavy = command.kind === Cmd.NewRealm || command.kind === Cmd.LoadRealm;
      if (heavy) this.heavyPending++;
      this.replies.set(seq, {
        kind: command.kind,
        resolve: (event: Event) => {
          if (heavy) this.heavyPending--;
          resolve(event);
        },
      });
    });
  }

  private dispatch(event: Event): void {
    if (event.kind === Ev.Heartbeat) {
      this.heartbeatAt = performance.now();
      return;
    }
    if (event.kind === Ev.Ready && event.reply === 0) {
      this.resumedListener?.(event);
      return;
    }
    if (event.kind === Ev.Ready || event.kind === Ev.QueryResult || event.kind === Ev.Saved || event.kind === Ev.Loaded) {
      const pending = this.replies.get(event.reply);
      if (pending) {
        this.replies.delete(event.reply);
        pending.resolve(event);
        if (event.kind === Ev.Ready) this.listener?.(event);
        return;
      }
    }
    this.listener?.(event);
  }
}
