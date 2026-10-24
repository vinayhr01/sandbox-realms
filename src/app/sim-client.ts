import { Cmd, Ev, PROTOCOL_VERSION, type BrushOp, type BrushShape, type Command, type Event, type Speed } from '../shared/protocol.ts';

/** Command shape without the `seq` the client assigns. Distributes over the union. */
type Draft<T> = T extends unknown ? Omit<T, 'seq'> : never;
export type CommandDraft = Draft<Command>;

export type QueryResult = Extract<Event, { kind: typeof Ev.QueryResult }>;

const SENT_LOG_MAX = 64;

/**
 * Main-thread side of the sim worker protocol (17 section 2.2). Assigns sequence numbers,
 * routes replies to their requests, and forwards unsolicited events to one listener.
 */
export class SimClient {
  private readonly worker: Worker;
  private seq = 1;
  private readonly replies = new Map<number, (event: Event) => void>();
  private listener: ((event: Event) => void) | null = null;
  private readonly sent: number[] = [];

  constructor() {
    this.worker = new Worker(new URL('../sim/worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (message: MessageEvent<Event>) => this.dispatch(message.data);
    this.worker.onerror = (event: ErrorEvent) => {
      this.listener?.({ kind: Ev.Fault, severity: 'fatal', code: 'WORKER_ERROR', detail: event.message });
    };
  }

  onEvent(listener: (event: Event) => void): void {
    this.listener = listener;
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

  private request(command: CommandDraft): Promise<Event> {
    return new Promise<Event>((resolve) => {
      const seq = this.send(command);
      this.replies.set(seq, resolve);
    });
  }

  private dispatch(event: Event): void {
    if (event.kind === Ev.Ready || event.kind === Ev.QueryResult) {
      const resolve = this.replies.get(event.reply);
      if (resolve) {
        this.replies.delete(event.reply);
        resolve(event);
        if (event.kind === Ev.Ready) this.listener?.(event);
        return;
      }
    }
    this.listener?.(event);
  }
}
