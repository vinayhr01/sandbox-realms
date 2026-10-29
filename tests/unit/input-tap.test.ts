// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MapInput, type MapInputHandlers } from '../../src/ui/input.ts';

/** A pointer event with the fields MapInput reads (jsdom has no PointerEvent constructor here). */
function pointer(type: string, x: number, y: number, pointerId = 1): Event {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(e, { pointerId, pointerType: 'touch', button: 0, clientX: x, clientY: y });
  return e;
}

describe('MapInput taps', () => {
  let canvas: HTMLCanvasElement;
  let input: MapInput | null;
  let handlers: { [K in keyof MapInputHandlers]-?: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.useFakeTimers();
    canvas = document.createElement('canvas');
    document.body.appendChild(canvas);
    canvas.setPointerCapture = vi.fn();
    canvas.releasePointerCapture = vi.fn();
    canvas.hasPointerCapture = () => false;
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, right: 400, bottom: 400, width: 400, height: 400, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    handlers = {
      brushArmed: vi.fn(() => false),
      toolArmed: vi.fn(() => false),
      onPan: vi.fn(),
      onZoom: vi.fn(),
      onHover: vi.fn(),
      onStrokeStart: vi.fn(),
      onStrokeMove: vi.fn(),
      onStrokeEnd: vi.fn(),
      onTap: vi.fn(),
    } as typeof handlers;
    input = new MapInput(canvas, handlers as unknown as MapInputHandlers);
  });

  afterEach(() => {
    input?.dispose();
    input = null;
    canvas.remove();
    vi.useRealTimers();
  });

  it('a single tap inspects at once, without waiting for a second tap', () => {
    canvas.dispatchEvent(pointer('pointerdown', 40, 50));
    canvas.dispatchEvent(pointer('pointerup', 40, 50));
    expect(handlers.onTap).toHaveBeenCalledTimes(1);
    expect(handlers.onTap).toHaveBeenCalledWith(40, 50);
  });

  it('two quick taps are two inspect taps, with no double-tap zoom', () => {
    canvas.dispatchEvent(pointer('pointerdown', 40, 50));
    canvas.dispatchEvent(pointer('pointerup', 40, 50));
    canvas.dispatchEvent(pointer('pointerdown', 42, 50));
    canvas.dispatchEvent(pointer('pointerup', 42, 50));
    vi.advanceTimersByTime(1000);
    expect(handlers.onTap).toHaveBeenCalledTimes(2);
    expect(handlers.onZoom).not.toHaveBeenCalled();
  });

  it('a press that travels past the slop is a pan, not a tap', () => {
    canvas.dispatchEvent(pointer('pointerdown', 40, 50));
    canvas.dispatchEvent(pointer('pointermove', 90, 50));
    canvas.dispatchEvent(pointer('pointerup', 90, 50));
    expect(handlers.onPan).toHaveBeenCalled();
    expect(handlers.onTap).not.toHaveBeenCalled();
  });
});
