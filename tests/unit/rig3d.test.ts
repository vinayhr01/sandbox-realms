import { describe, expect, it } from 'vitest';
import {
  EYE_HEIGHT,
  overviewHeight,
  rigPose,
  rotateRig,
  panRig,
  walkRig,
  zoomRig,
  type RigState,
} from '../../src/render3d/rig.ts';

const flatGround = () => 0;
const SIDE = 256;
const deg = (r: number) => (r * 180) / Math.PI;

function state(over: Partial<RigState> = {}): RigState {
  return { focus: { x: 128, y: 128 }, height: overviewHeight(SIDE), yaw: 0, ...over };
}

describe('rig pitch', () => {
  it('looks straight down at overview height', () => {
    expect(deg(rigPose(state(), SIDE, flatGround).pitch)).toBeCloseTo(-90, 6);
  });

  it('is about -5 degrees at eye height', () => {
    expect(deg(rigPose(state({ height: EYE_HEIGHT }), SIDE, flatGround).pitch)).toBeCloseTo(-5, 6);
  });

  it('eases monotonically between eye height and overview', () => {
    let last = Infinity;
    for (let h = EYE_HEIGHT; h <= overviewHeight(SIDE); h *= 1.2) {
      const pitch = deg(rigPose(state({ height: h }), SIDE, flatGround).pitch);
      expect(pitch).toBeLessThanOrEqual(last + 1e-9);
      last = pitch;
    }
  });

  it('puts the eye above the ground under the focus', () => {
    const p = rigPose(state({ focus: { x: 3, y: 4 }, height: 2 }), SIDE, () => 1.5);
    expect(p.eye).toEqual([3, 3.5, 4]);
  });
});

describe('zoomRig', () => {
  it('never goes below eye height above the ground', () => {
    expect(zoomRig(state({ height: 5 }), 1e9, SIDE, flatGround).height).toBeCloseTo(EYE_HEIGHT, 9);
  });

  it('never goes above the overview height', () => {
    expect(zoomRig(state({ height: 5 }), 1e-9, SIDE, flatGround).height).toBeCloseTo(overviewHeight(SIDE), 9);
  });

  it('zooms in with a factor above 1', () => {
    expect(zoomRig(state({ height: 40 }), 2, SIDE, flatGround).height).toBeCloseTo(20, 9);
  });
});

describe('rotate and pan', () => {
  it('pans along the rotated axis after a rotation', () => {
    const r = 1;
    const turned = rotateRig(state(), r);
    expect(turned.yaw).toBeCloseTo(r, 9);
    const moved = panRig(turned, 1, 0);
    expect(moved.focus.x - 128).toBeCloseTo(Math.cos(r), 9);
    expect(moved.focus.y - 128).toBeCloseTo(Math.sin(r), 9);
  });

  it('pans forward (dy) along the view direction at yaw 0', () => {
    const moved = panRig(state(), 0, 2);
    expect(moved.focus.x).toBeCloseTo(128, 9);
    expect(moved.focus.y).toBeCloseTo(126, 9);
  });

  it('clamps the focus to the map edges', () => {
    const s = panRig(state({ focus: { x: 1, y: 255 } }), -50, -50, SIDE);
    expect(s.focus.x).toBe(0);
    expect(s.focus.y).toBe(SIDE);
    expect(panRig(state({ focus: { x: 0, y: 0 } }), -10, 10, SIDE).focus.x).toBe(0);
  });

  it('walks at ground level without changing height', () => {
    const s = walkRig(state({ height: EYE_HEIGHT }), 1, 0, 1000, 4, SIDE);
    expect(s.height).toBe(EYE_HEIGHT);
    expect(s.focus.y).toBeCloseTo(124, 9);
  });
});

describe('resize', () => {
  it('keeps focus tile and height (rigPose takes no viewport size)', () => {
    const s = state({ focus: { x: 40.5, y: 90.25 }, height: 3 });
    expect(rigPose({ ...s }, SIDE, flatGround)).toEqual(rigPose(s, SIDE, flatGround));
    expect(s.focus).toEqual({ x: 40.5, y: 90.25 });
    expect(s.height).toBe(3);
  });
});
