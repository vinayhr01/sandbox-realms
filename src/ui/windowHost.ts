/**
 * Window host (13 section 7, UX redesign spec C). `open` is the one entry point for a window kind: a confirmation
 * (routeOf: modal) shows in the modal dialog, with Esc, the close button and focus return; every other kind routes into
 * the Atlas through `toAtlas`. The dialog also keeps `#fatal`-style confirmations. Live windows refresh from each
 * snapshot through `feed`.
 */
import type { WindowBuild, WindowParams } from './windowContent.ts';
import { isModalKind } from './shell/atlasRoutes.ts';

export interface WindowHostDeps {
  /** The window for a kind, or null when the UI does not build it. */
  build(kind: string, params: WindowParams): WindowBuild | null;
  /** Shows a non-modal kind in the Atlas. */
  toAtlas(kind: string, params: WindowParams): void;
}

export class WindowHost {
  private readonly dialog: HTMLDialogElement;
  private readonly title: HTMLElement;
  private readonly body: HTMLElement;
  private readonly deps: WindowHostDeps;
  private openId: string | null = null;
  /** Re-renders the open window from the latest snapshot; null for windows that do not read the sim. */
  private live: (() => void) | null = null;

  constructor(dialog: HTMLDialogElement, title: HTMLElement, body: HTMLElement, deps: WindowHostDeps, onClosed?: () => void) {
    this.dialog = dialog;
    this.title = title;
    this.body = body;
    this.deps = deps;
    dialog.addEventListener('close', () => {
      // A close event can arrive after another window has already opened in its place.
      if (dialog.open) return;
      this.openId = null;
      this.live = null;
      this.body.replaceChildren();
      onClosed?.();
    });
  }

  /** Called when a new snapshot arrives: the open modal window, if it is live, refreshes its numbers. */
  feed(): void {
    if (this.openId !== null) this.live?.();
  }

  /** The kind of the open modal confirmation, or null. Atlas pages are reported by the Atlas. */
  get current(): string | null {
    return this.openId;
  }

  /** Opens a window kind: a modal confirmation here, anything else in the Atlas. Returns its build, or null if none. */
  open(kind: string, params: WindowParams = {}): WindowBuild | null {
    const build = this.deps.build(kind, params);
    if (build === null) return null;
    if (!isModalKind(kind)) {
      // An Atlas page opening over a confirmation (Chronicle after a save) closes the confirmation first.
      this.dismiss();
      this.deps.toAtlas(kind, params);
      return build;
    }
    this.body.replaceChildren();
    this.title.textContent = build.title;
    this.openId = kind;
    this.live = build.live ?? null;
    build.build(this.body);
    if (!this.dialog.open) this.dialog.showModal();
    return build;
  }

  close(): void {
    if (this.dialog.open) this.dialog.close();
  }

  /** Forgets the open confirmation at once (its close event arrives later) and closes the dialog. */
  private dismiss(): void {
    if (this.openId === null) return;
    this.openId = null;
    this.live = null;
    this.close();
  }
}
