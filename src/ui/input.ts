/**
 * One pointer path for mouse, touch and pen (13 section 9, PLATFORM-REQUIREMENTS section 2).
 * Arbitrates each gesture into one of: stroke (brush drag), pan, pinch/zoom, tap, double-tap,
 * long-press, hold-to-raise, or hover. Emits intents only; it never touches the sim or the camera
 * directly.
 */

export interface MapInputHandlers {
  /** A brush is armed, so a drag paints rather than pans. */
  brushArmed(): boolean;
  /**
   * Any power or tool is armed (brush or not). Optional: when absent, only brushArmed() counts.
   * With a tool armed, a press that stays still is a plain tap (13 section 4), so no hold or
   * long-press starts.
   */
  toolArmed?(): boolean;
  onPan(dx: number, dy: number): void;
  onZoom(factor: number, sx: number, sy: number): void;
  onHover(sx: number, sy: number): void;
  onStrokeStart(sx: number, sy: number): void;
  onStrokeMove(sx: number, sy: number): void;
  onStrokeEnd(): void;
  onTap(sx: number, sy: number): void;
  /**
   * Hold-to-raise (04 section 1.1, 13 section 9): with a brush armed, a press that stays still
   * repeats this every HOLD_INTERVAL_MS after HOLD_DELAY_MS. The first call replaces the tap, so
   * the release of a held press does not tap again.
   */
  onHold?(sx: number, sy: number): void;
  /** Long-press (500 ms, under 10 px travel) with no tool armed: inspect detail (13 section 9). */
  onLongPress?(sx: number, sy: number): void;
  /**
   * A second finger lands on a stroke (13 section 9): the stroke ends and is undone. Optional: when
   * absent the stroke ends as before, without undo.
   */
  onStrokeUndo?(): void;
  /**
   * Settings: sticky hold (13 section 15). When on, releasing a stroke keeps it running; the pointer
   * then paints by hovering, and the next press ends it. Optional, so off when not given.
   */
  stickyHold?(): boolean;
}

type Mode = 'idle' | 'pending' | 'stroke' | 'pan' | 'pinch';

interface Pointer {
  id: number;
  type: string;
  button: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  moved: boolean;
}

/** Pixels of travel before a press becomes a drag (13 section 9: 10 px touch, 4 px mouse). */
const TOUCH_SLOP = 10;
const MOUSE_SLOP = 4;
/** Wheel zoom per notch (13 section 9: 20% per notch). */
const WHEEL_ZOOM_PER_PX = 0.0015;
/** Hold-to-raise: first repeat after this long still, then every two ticks (04 section 1.1). */
export const HOLD_DELAY_MS = 150;
export const HOLD_INTERVAL_MS = 100;
/** Long-press time (13 section 9). */
export const LONG_PRESS_MS = 500;
export class MapInput {
  private readonly pointers = new Map<number, Pointer>();
  private mode: Mode = 'idle';
  private spaceDown = false;
  private pinchDist = 0;
  private pinchMidX = 0;
  private pinchMidY = 0;
  /** A stroke kept running after release (sticky hold). */
  private latched = false;
  /** Timer for hold-to-raise or long-press on the first pointer; null when none runs. */
  private holdDelay: number | null = null;
  private holdRepeat: number | null = null;
  /** The hold or long-press already fired for this press, so its release is not a tap. */
  private holdFired = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly handlers: MapInputHandlers,
  ) {
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onCancel);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKey);
  }

  /** Whether Space is held (Space + drag pans with a mouse, 13 section 9). */
  get panModifier(): boolean {
    return this.spaceDown;
  }

  dispose(): void {
    this.canvas.removeEventListener('pointerdown', this.onDown);
    this.canvas.removeEventListener('pointermove', this.onMove);
    this.canvas.removeEventListener('pointerup', this.onUp);
    this.canvas.removeEventListener('pointercancel', this.onCancel);
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKey);
    this.holdStop();
  }

  private local(e: PointerEvent | WheelEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private toolArmed(): boolean {
    return this.handlers.toolArmed ? this.handlers.toolArmed() : this.handlers.brushArmed();
  }

  /** Starts the hold timer for a still press: hold-to-raise with a brush, long-press with no tool. */
  private holdStart(p: Pointer): void {
    this.holdStop();
    this.holdFired = false;
    if (this.handlers.brushArmed()) {
      this.holdDelay = window.setTimeout(() => {
        this.holdDelay = null;
        this.holdFired = true;
        this.handlers.onHold?.(p.startX, p.startY);
        this.holdRepeat = window.setInterval(() => this.handlers.onHold?.(p.startX, p.startY), HOLD_INTERVAL_MS);
      }, HOLD_DELAY_MS);
      return;
    }
    if (!this.toolArmed() && this.handlers.onLongPress) {
      this.holdDelay = window.setTimeout(() => {
        this.holdDelay = null;
        this.holdFired = true;
        this.handlers.onLongPress?.(p.startX, p.startY);
      }, LONG_PRESS_MS);
    }
  }

  private holdStop(): void {
    if (this.holdDelay !== null) window.clearTimeout(this.holdDelay);
    if (this.holdRepeat !== null) window.clearInterval(this.holdRepeat);
    this.holdDelay = null;
    this.holdRepeat = null;
  }

  private readonly onDown = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1 && e.button !== 2) return;
    if (this.latched) {
      // The press that ends a latched stroke does nothing else.
      this.latched = false;
      this.mode = 'idle';
      this.handlers.onStrokeEnd();
      return;
    }
    this.canvas.setPointerCapture(e.pointerId);
    const { x, y } = this.local(e);
    this.pointers.set(e.pointerId, {
      id: e.pointerId,
      type: e.pointerType,
      button: e.button,
      startX: x,
      startY: y,
      x,
      y,
      moved: false,
    });

    if (this.pointers.size === 1) {
      this.mode = 'pending';
      const first = this.pointers.get(e.pointerId);
      // Hold and long-press are for the primary button, touch and pen only.
      if (first && (first.type !== 'mouse' || first.button === 0)) this.holdStart(first);
    } else if (this.pointers.size === 2) {
      // A second finger ends the press's hold, and ends any stroke with an undo (13 section 9).
      this.holdStop();
      if (this.mode === 'stroke') {
        if (this.handlers.onStrokeUndo) this.handlers.onStrokeUndo();
        else this.handlers.onStrokeEnd();
      }
      this.mode = 'pinch';
      this.startPinch();
    }
  };

  private readonly onMove = (e: PointerEvent): void => {
    const { x, y } = this.local(e);
    const p = this.pointers.get(e.pointerId);
    if (!p) {
      if (this.pointers.size === 0) {
        if (this.latched) this.handlers.onStrokeMove(x, y);
        this.handlers.onHover(x, y);
      }
      return;
    }
    const prevX = p.x;
    const prevY = p.y;
    p.x = x;
    p.y = y;

    if (this.mode === 'pinch' && this.pointers.size >= 2) {
      this.updatePinch();
      return;
    }

    const slop = p.type === 'mouse' ? MOUSE_SLOP : TOUCH_SLOP;
    if (!p.moved && Math.hypot(x - p.startX, y - p.startY) > slop) {
      p.moved = true;
      // Travel past the slop cancels a hold or long-press (13 section 9: under 10 px to count).
      this.holdStop();
    }

    if (this.mode === 'pending' && p.moved) {
      const paints = this.handlers.brushArmed() && (p.type !== 'mouse' || (p.button === 0 && !this.spaceDown));
      if (paints) {
        this.mode = 'stroke';
        this.handlers.onStrokeStart(p.startX, p.startY);
        this.handlers.onStrokeMove(x, y);
      } else {
        this.mode = 'pan';
        this.handlers.onPan(x - p.startX, y - p.startY);
      }
      return;
    }
    if (this.mode === 'stroke') {
      this.handlers.onStrokeMove(x, y);
      return;
    }
    if (this.mode === 'pan') {
      this.handlers.onPan(x - prevX, y - prevY);
    }
  };

  private readonly onUp = (e: PointerEvent): void => {
    this.finishPointer(e.pointerId, e, false);
  };

  private readonly onCancel = (e: PointerEvent): void => {
    this.finishPointer(e.pointerId, e, true);
  };

  private finishPointer(id: number, e: PointerEvent, cancelled: boolean): void {
    const p = this.pointers.get(id);
    if (!p) return;
    const { x, y } = this.local(e);
    this.pointers.delete(id);
    if (this.canvas.hasPointerCapture(id)) this.canvas.releasePointerCapture(id);
    this.holdStop();

    // A tap fires at once: there is no double-tap zoom, so nothing waits for a second tap.
    if (this.mode === 'pending' && !p.moved && !cancelled && !this.holdFired) this.handlers.onTap(x, y);
    if (this.mode === 'stroke' && (this.pointers.size === 0 || cancelled)) {
      if (!cancelled && this.pointers.size === 0 && this.handlers.stickyHold?.()) this.latched = true;
      else this.handlers.onStrokeEnd();
    }
    if (this.pointers.size === 0) {
      this.mode = 'idle';
      this.holdFired = false;
      return;
    }
    if (this.mode === 'pinch' && this.pointers.size === 1) {
      // Continue as a pan from the remaining finger, without a jump.
      const rest = this.pointers.values().next().value as Pointer;
      rest.startX = rest.x;
      rest.startY = rest.y;
      rest.moved = true;
      this.mode = 'pan';
    }
  }

  private startPinch(): void {
    const [a, b] = this.twoPointers();
    if (!a || !b) return;
    this.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
    this.pinchMidX = (a.x + b.x) / 2;
    this.pinchMidY = (a.y + b.y) / 2;
  }

  private updatePinch(): void {
    const [a, b] = this.twoPointers();
    if (!a || !b) return;
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    // Pinches closer than 12 px are noise (13 section 9).
    if (dist >= 12 && this.pinchDist >= 12) {
      this.handlers.onZoom(dist / this.pinchDist, midX, midY);
    }
    this.handlers.onPan(midX - this.pinchMidX, midY - this.pinchMidY);
    this.pinchDist = dist;
    this.pinchMidX = midX;
    this.pinchMidY = midY;
  }

  private twoPointers(): [Pointer | undefined, Pointer | undefined] {
    const it = this.pointers.values();
    return [it.next().value as Pointer | undefined, it.next().value as Pointer | undefined];
  }

  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const { x, y } = this.local(e);
    const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    this.handlers.onZoom(Math.exp(-px * WHEEL_ZOOM_PER_PX), x, y);
  };

  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.code === 'Space') this.spaceDown = e.type === 'keydown';
  };
}
