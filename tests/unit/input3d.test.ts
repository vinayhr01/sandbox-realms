// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MapInput3D, type MapInput3DHandlers } from '../../src/ui/input3d.ts';

/** A pointer event with the fields MapInput reads (jsdom has no PointerEvent constructor here). */
function pointer(type: string, x: number, y: number, pointerId = 1, pointerType = 'touch', button = 0): Event {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(e, { pointerId, pointerType, button, clientX: x, clientY: y });
  return e;
}

type Spies = { [K in keyof MapInput3DHandlers]-?: ReturnType<typeof vi.fn> };

describe('MapInput3D', () => {
  let canvas: HTMLCanvasElement;
  let input: MapInput3D | null;
  let handlers: Spies;
  let ground: boolean;

  beforeEach(() => {
    vi.useFakeTimers();
    ground = false;
    canvas = document.createElement('canvas');
    document.body.appendChild(canvas);
    canvas.setPointerCapture = vi.fn();
    canvas.releasePointerCapture = vi.fn();
    canvas.hasPointerCapture = () => false;
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, right: 400, bottom: 400, width: 400, height: 400, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    handlers = {
      brushArmed: vi.fn(() => true),
      toolArmed: vi.fn(() => true),
      onPan: vi.fn(),
      onZoom: vi.fn(),
      onHover: vi.fn(),
      onStrokeStart: vi.fn(),
      onStrokeMove: vi.fn(),
      onStrokeEnd: vi.fn(),
      onTap: vi.fn(),
      onHold: vi.fn(),
      onStrokeUndo: vi.fn(),
      onRotate: vi.fn(),
      onLook: vi.fn(),
    } as Spies;
    input = new MapInput3D(canvas, handlers as unknown as MapInput3DHandlers, () => ({ atGround: ground }));
  });

  afterEach(() => {
    input?.dispose();
    input = null;
    canvas.remove();
    vi.useRealTimers();
    Reflect.deleteProperty(document, 'pointerLockElement');
  });

  it('an armed drag from above paints, and does not pan', () => {
    canvas.dispatchEvent(pointer('pointerdown', 40, 50));
    canvas.dispatchEvent(pointer('pointermove', 80, 50));
    canvas.dispatchEvent(pointer('pointermove', 120, 50));
    expect(handlers.onStrokeMove).toHaveBeenCalled();
    expect(handlers.onPan).not.toHaveBeenCalled();
    expect(handlers.onLook).not.toHaveBeenCalled();
  });

  it('a drag at ground level looks around, and does not paint', () => {
    ground = true;
    canvas.dispatchEvent(pointer('pointerdown', 40, 50));
    canvas.dispatchEvent(pointer('pointermove', 80, 50));
    canvas.dispatchEvent(pointer('pointermove', 120, 50));
    canvas.dispatchEvent(pointer('pointerup', 120, 50));
    expect(handlers.onLook).toHaveBeenCalled();
    // Dragging right turns the view right (a positive yaw), and nothing paints.
    const [dyaw] = handlers.onLook.mock.calls[0] as [number, number];
    expect(dyaw).toBeGreaterThan(0);
    expect(handlers.onStrokeStart).not.toHaveBeenCalled();
    expect(handlers.onStrokeMove).not.toHaveBeenCalled();
    expect(handlers.onPan).not.toHaveBeenCalled();
  });

  it('a second finger calls onStrokeUndo before onZoom', () => {
    canvas.dispatchEvent(pointer('pointerdown', 40, 50, 1));
    canvas.dispatchEvent(pointer('pointermove', 60, 50, 1));
    canvas.dispatchEvent(pointer('pointerdown', 80, 50, 2));
    canvas.dispatchEvent(pointer('pointermove', 100, 50, 2));
    canvas.dispatchEvent(pointer('pointermove', 140, 50, 2));
    expect(handlers.onStrokeUndo).toHaveBeenCalledTimes(1);
    expect(handlers.onZoom).toHaveBeenCalled();
    expect(handlers.onStrokeUndo.mock.invocationCallOrder[0]!).toBeLessThan(handlers.onZoom.mock.invocationCallOrder[0]!);
  });

  it('a two-finger twist calls onRotate with the turned angle', () => {
    canvas.dispatchEvent(pointer('pointerdown', 100, 100, 1));
    canvas.dispatchEvent(pointer('pointerdown', 200, 100, 2));
    canvas.dispatchEvent(pointer('pointermove', 100, 200, 2));
    expect(handlers.onRotate).toHaveBeenCalled();
    const total = handlers.onRotate.mock.calls.reduce((sum, c) => sum + (c[0] as number), 0);
    expect(total).toBeCloseTo(Math.PI / 2, 6);
  });

  it('a right-drag from above rotates the view', () => {
    canvas.dispatchEvent(pointer('pointerdown', 100, 100, 1, 'mouse', 2));
    canvas.dispatchEvent(pointer('pointermove', 140, 100, 1, 'mouse', 2));
    expect(handlers.onRotate).toHaveBeenCalled();
    expect(handlers.onRotate.mock.calls[0]![0]).toBeGreaterThan(0);
    expect(handlers.onPan).not.toHaveBeenCalled();
  });

  it('a still press at ground level holds at the screen centre', () => {
    ground = true;
    canvas.dispatchEvent(pointer('pointerdown', 40, 50));
    vi.advanceTimersByTime(160);
    expect(handlers.onHold).toHaveBeenCalledWith(200, 200);
  });

  it('a double-click at ground level asks for pointer lock', () => {
    ground = true;
    const lock = vi.fn(() => Promise.resolve());
    canvas.requestPointerLock = lock;
    canvas.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(lock).toHaveBeenCalledTimes(1);
  });

  it('a double-click from above does not ask for pointer lock', () => {
    const lock = vi.fn(() => Promise.resolve());
    canvas.requestPointerLock = lock;
    canvas.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(lock).not.toHaveBeenCalled();
  });

  it('with pointer lock, Esc releases the lock and does not reach the rest of the page', () => {
    const exit = vi.fn();
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => canvas });
    document.exitPointerLock = exit;
    const later = vi.fn();
    window.addEventListener('keydown', later);
    try {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(exit).toHaveBeenCalledTimes(1);
      expect(later).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', later);
    }
  });

  it('without pointer lock, Esc passes through to the page', () => {
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => null });
    const exit = vi.fn();
    document.exitPointerLock = exit;
    const later = vi.fn();
    window.addEventListener('keydown', later);
    try {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(exit).not.toHaveBeenCalled();
      expect(later).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('keydown', later);
    }
  });
});
