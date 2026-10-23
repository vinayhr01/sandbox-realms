/**
 * Main <-> sim worker protocol (17 section 2.2). Numeric kinds, plain objects,
 * every command carries `seq`, every reply echoes it.
 */
export const PROTOCOL_VERSION = 1;

export enum Cmd {
  Init = 1,
  NewRealm = 2,
  SetSpeed = 3,
  Stroke = 4,
  Query = 5,
  ReturnBuffer = 6,
}

export enum Ev {
  Ready = 101,
  Frame = 102,
  QueryResult = 103,
  Fault = 104,
  Heartbeat = 105,
}

export type Speed = 0 | 0.5 | 1 | 2 | 5 | 10;

export type BrushOp = 'raise' | 'lower';
export type BrushShape = 'circle' | 'square' | 'diamond';

export type Command =
  | { kind: Cmd.Init; seq: number; protocolVersion: number }
  | { kind: Cmd.NewRealm; seq: number; seed: number; sizeStep: number }
  | { kind: Cmd.SetSpeed; seq: number; speed: Speed }
  /** Dabs along the line (x0,y0)->(x1,y1). includeStart=false skips the first tile, which an earlier segment already painted. */
  | { kind: Cmd.Stroke; seq: number; op: BrushOp; shape: BrushShape; size: number; x0: number; y0: number; x1: number; y1: number; includeStart: boolean }
  | { kind: Cmd.Query; seq: number; tileX: number; tileY: number }
  | { kind: Cmd.ReturnBuffer; seq: number; buffer: ArrayBuffer };

/** Rows of the index texture: RGBA8 per tile = [ground, cover, elevation, flags & 0xff]. */
export interface FrameRows {
  y0: number;
  y1: number;
  /** Packed RGBA rows y0..y1 inclusive, row-major. */
  data: Uint8Array;
}

export interface FrameStats {
  tick: number;
  avgTickMs: number;
  ticksThisPump: number;
  speed: Speed;
  stateHash: number;
}

export type Event =
  | { kind: Ev.Ready; reply: number; protocolVersion: number; side: number; sizeStep: number; seed: number }
  | { kind: Ev.Frame; rows: FrameRows | null; stats: FrameStats }
  | { kind: Ev.QueryResult; reply: number; tileX: number; tileY: number; elevation: number; ground: string; inBounds: boolean }
  | { kind: Ev.Fault; severity: 'warn' | 'error' | 'fatal'; code: string; detail: string }
  | { kind: Ev.Heartbeat; tick: number; avgTickMs: number };
