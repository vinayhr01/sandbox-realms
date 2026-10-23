import { Cmd, Ev, type BrushOp, type BrushShape, type Command, type Event, type Speed } from '../shared/protocol.ts';

/** Command shape without the `seq` the client assigns. Distributes over the union. */
type Draft<T> = T extends unknown ? Omit<T, 'seq'> : never;
export type CommandDraft = Draft<Command>;

export type QueryResult = Extract<Event, { kind: typeof Ev.QueryResult }>;

/**
 * Main-thread side of the sim worker protocol (17 section 2.2). Assigns sequence numbers,
 * routes replies to their requests, and forwards unsolicited events to one listener.
 */
export class SimClient {
  private readonly worker: Worker;
  private seq = 1;
  private readonly replies = new Map<number, (event: Event) => void>();
  private listener: ((event: Event) => void) | null = null;

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
    this.worker.postMessage({ ...command, seq } as Command, transfer);
    return seq;
  }

  init(): Promise<Event> {
    return this.request({ kind: Cmd.Init, protocolVersion: 1 });
  }

  newRealm(seed: number, sizeStep: number): Promise<Event> {
    return this.request({ kind: Cmd.NewRealm, seed, sizeStep });
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
