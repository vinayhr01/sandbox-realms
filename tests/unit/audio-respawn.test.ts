import { describe, expect, it } from 'vitest';
import { Cmd, Ev, PROTOCOL_VERSION } from '../../src/shared/protocol.ts';
import { RESPAWN_MAX, RESPAWN_WINDOW_MS, fallbackReply, respawnAllowed } from '../../src/app/sim-client.ts';

describe('worker respawn policy (sim-client)', () => {
  it('allows up to RESPAWN_MAX deaths inside the window', () => {
    const deaths = Array.from({ length: RESPAWN_MAX }, (_, i) => i * 1000);
    expect(respawnAllowed(deaths, 5000)).toBe(true);
    expect(respawnAllowed([...deaths, 6000], 6000)).toBe(false);
  });

  it('deaths outside the window do not count', () => {
    const now = RESPAWN_WINDOW_MS + 400_000;
    expect(respawnAllowed([0, 1, 2, 3, now], now)).toBe(true);
  });
});

describe('replies to requests the dead worker never answered', () => {
  it('a save reply carries no bytes, so the caller sees no save', () => {
    expect(fallbackReply(Cmd.SaveRealm, 7)).toEqual({ kind: Ev.Saved, reply: 7, bytes: new Uint8Array(0) });
  });

  it('a load reply fails', () => {
    const e = fallbackReply(Cmd.LoadRealm, 8);
    expect(e.kind === Ev.Loaded && e.ok).toBe(false);
  });

  it('a query reply is an empty result', () => {
    const e = fallbackReply(Cmd.Query, 9);
    expect(e.kind === Ev.QueryResult && e.inBounds).toBe(false);
  });

  it('a realm or init reply is a zero Ready', () => {
    expect(fallbackReply(Cmd.NewRealm, 10)).toEqual({ kind: Ev.Ready, reply: 10, protocolVersion: PROTOCOL_VERSION, side: 0, sizeStep: 0, seed: 0 });
  });
});
