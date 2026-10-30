/**
 * On-screen walk stick for touch at ground level (3D part 1, spec "Camera": move at ground level). It sits over the map
 * host, so its pointer events never reach the map's MapInput. It is shown only on a coarse pointer and only when the
 * caller asks, and value() is read each frame by the walk loop.
 */

/** Radius of the stick's travel in CSS px; a full push is 1.0. */
const RADIUS = 48;

export class Joystick {
  private readonly root: HTMLDivElement;
  private readonly knob: HTMLDivElement;
  private pointerId: number | null = null;
  private f = 0;
  private s = 0;

  constructor(host: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'joystick';
    this.root.hidden = true;
    this.knob = document.createElement('div');
    this.knob.className = 'joystick-knob';
    this.root.appendChild(this.knob);
    this.root.addEventListener('pointerdown', this.onDown);
    this.root.addEventListener('pointermove', this.onMove);
    this.root.addEventListener('pointerup', this.onUp);
    this.root.addEventListener('pointercancel', this.onUp);
    host.appendChild(this.root);
  }

  /** Forward (+1 is up on screen) and strafe (+1 is right), each -1..1. Zero when released or hidden. */
  value(): { f: number; s: number } {
    return { f: this.f, s: this.s };
  }

  /** Shows the stick when `on` and the device has a coarse pointer, otherwise hides it and releases any push. */
  setActive(on: boolean): void {
    const show = on && isTouchDevice();
    if (this.root.hidden === show) this.root.hidden = !show;
    if (!show) this.release();
  }

  destroy(): void {
    this.root.remove();
  }

  private readonly onDown = (e: PointerEvent): void => {
    if (this.pointerId !== null) return;
    this.pointerId = e.pointerId;
    this.root.setPointerCapture(e.pointerId);
    this.move(e);
  };

  private readonly onMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    this.move(e);
  };

  private readonly onUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    this.release();
  };

  private move(e: PointerEvent): void {
    const rect = this.root.getBoundingClientRect();
    let dx = e.clientX - (rect.left + rect.width / 2);
    let dy = e.clientY - (rect.top + rect.height / 2);
    const len = Math.hypot(dx, dy);
    if (len > RADIUS) {
      dx = (dx * RADIUS) / len;
      dy = (dy * RADIUS) / len;
    }
    this.s = dx / RADIUS;
    this.f = -dy / RADIUS;
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  private release(): void {
    if (this.pointerId !== null && this.root.hasPointerCapture(this.pointerId)) this.root.releasePointerCapture(this.pointerId);
    this.pointerId = null;
    this.f = 0;
    this.s = 0;
    this.knob.style.transform = '';
  }
}

function isTouchDevice(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
}
