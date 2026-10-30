/**
 * 3D map input (3D part 1, spec "Camera" and "Powers in 3D"). MapInput does the pointer arbitration; this wrapper turns
 * its gestures into camera calls when the camera is at ground level, and into rotation for a right-drag or a twist from
 * above. It emits intents only and never touches the sim, like MapInput. Walking is not a gesture: main.ts walks each
 * frame from the keys and the joystick.
 */
import { MapInput, type MapInputHandlers } from './input.ts';

export interface MapInput3DHandlers extends MapInputHandlers {
  /** Turns the view about the focus, in radians (right-drag or two-finger twist from above). */
  onRotate(radians: number): void;
  /** Looks around at ground level: yaw turns right when positive, pitch tilts up when positive. Radians. */
  onLook(dyaw: number, dpitch: number): void;
}

/** Radians of look per CSS pixel of drag at ground level (about 0.3 degrees a pixel). */
const LOOK_RAD_PER_PX = 0.005;
/** Radians of rotation per CSS pixel of right-drag from above. */
const ROTATE_RAD_PER_PX = 0.008;

export class MapInput3D {
  private readonly inner: MapInput;
  /** A stroke-mode drag at ground level is a look, not a paint. */
  private looking = false;
  private lookX = 0;
  private lookY = 0;
  /** The primary pointer is the right button (right-drag rotates from above). */
  private rightDrag = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly handlers: MapInput3DHandlers,
    private readonly rig: () => { atGround: boolean },
  ) {
    this.inner = new MapInput(canvas, {
      ...handlers,
      onPan: (dx, dy) => this.pan(dx, dy),
      onStrokeStart: (sx, sy) => {
        if (this.ground()) {
          this.looking = true;
          this.lookX = sx;
          this.lookY = sy;
          return;
        }
        handlers.onStrokeStart(sx, sy);
      },
      onStrokeMove: (sx, sy) => {
        if (this.looking) {
          this.look(sx - this.lookX, sy - this.lookY);
          this.lookX = sx;
          this.lookY = sy;
          return;
        }
        handlers.onStrokeMove(sx, sy);
      },
      onStrokeEnd: () => {
        this.looking = false;
        handlers.onStrokeEnd();
      },
      // A still press holds at the crosshair (the screen centre) at ground level; from above it holds where it is.
      onHold: (sx, sy) => {
        if (!this.ground()) {
          handlers.onHold?.(sx, sy);
          return;
        }
        const r = this.canvas.getBoundingClientRect();
        handlers.onHold?.(r.width / 2, r.height / 2);
      },
      onTwist: (radians) => handlers.onRotate(radians),
    });
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onUp);
    canvas.addEventListener('dblclick', this.onDblClick);
    document.addEventListener('mousemove', this.onMouseMove);
    // Capture on window: Esc with the pointer locked releases the lock and stops there. The sheet and the Atlas, which
    // listen lower down, never see that press, so it does not collapse the sheet or disarm the power.
    window.addEventListener('keydown', this.onEscCapture, true);
  }

  dispose(): void {
    this.inner.dispose();
    this.canvas.removeEventListener('pointerdown', this.onDown);
    this.canvas.removeEventListener('pointerup', this.onUp);
    this.canvas.removeEventListener('pointercancel', this.onUp);
    this.canvas.removeEventListener('dblclick', this.onDblClick);
    document.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('keydown', this.onEscCapture, true);
  }

  private ground(): boolean {
    return this.rig().atGround;
  }

  private pan(dx: number, dy: number): void {
    if (this.ground()) {
      this.look(dx, dy);
      return;
    }
    if (this.rightDrag) {
      this.handlers.onRotate(dx * ROTATE_RAD_PER_PX);
      return;
    }
    this.handlers.onPan(dx, dy);
  }

  /** Pixels of pointer travel to radians. Dragging down looks down, as with a mouse. */
  private look(dx: number, dy: number): void {
    this.handlers.onLook(dx * LOOK_RAD_PER_PX, -dy * LOOK_RAD_PER_PX);
  }

  private readonly onDown = (e: PointerEvent): void => {
    this.rightDrag = e.pointerType === 'mouse' && e.button === 2;
  };

  private readonly onUp = (): void => {
    this.rightDrag = false;
  };

  private readonly onDblClick = (): void => {
    if (!this.ground()) return;
    try {
      // requestPointerLock returns a promise in current browsers; a refusal (no user activation) is not an error.
      const result = this.canvas.requestPointerLock() as unknown;
      if (result instanceof Promise) result.catch(() => undefined);
    } catch {
      // Pointer lock is unavailable here: the drag still looks.
    }
  };

  /** With the pointer locked, the mouse's movement looks around (the position itself does not change). */
  private readonly onMouseMove = (e: MouseEvent): void => {
    if (document.pointerLockElement !== this.canvas) return;
    this.look(e.movementX, e.movementY);
  };

  private readonly onEscCapture = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || document.pointerLockElement !== this.canvas) return;
    document.exitPointerLock();
    e.stopImmediatePropagation();
  };
}

/** The centred aim mark, shown at ground level while a power is armed. Pointer events pass through it. */
export class Crosshair {
  private readonly el: HTMLDivElement;

  constructor(host: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'crosshair';
    this.el.hidden = true;
    host.appendChild(this.el);
  }

  setVisible(on: boolean): void {
    if (this.el.hidden === on) this.el.hidden = !on;
  }

  destroy(): void {
    this.el.remove();
  }
}
