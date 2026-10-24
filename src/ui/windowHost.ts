/**
 * Window host (13 section 7): one modal dialog that shows the open window. Esc and the close button
 * dismiss it (the dialog's native cancel). Opening another window replaces the current one; a
 * window stack is not built yet.
 */
export class WindowHost {
  private readonly dialog: HTMLDialogElement;
  private readonly title: HTMLElement;
  private readonly body: HTMLElement;
  private openId: string | null = null;
  /** Re-renders the open window from the latest snapshot; null for windows that do not read the sim. */
  private live: (() => void) | null = null;

  constructor(dialog: HTMLDialogElement, title: HTMLElement, body: HTMLElement, onClosed?: () => void) {
    this.dialog = dialog;
    this.title = title;
    this.body = body;
    dialog.addEventListener('close', () => {
      // A close event can arrive after another window has already opened in its place.
      if (dialog.open) return;
      this.openId = null;
      this.live = null;
      this.body.replaceChildren();
      onClosed?.();
    });
  }

  /** Called when a new snapshot arrives: the open window, if it is live, refreshes its numbers. */
  feed(): void {
    if (this.openId !== null) this.live?.();
  }

  get current(): string | null {
    return this.openId;
  }

  /** Shows window `id` with `heading` as its title and fills the body with `build`. */
  open(id: string, heading: string, build: (body: HTMLElement) => void, live?: () => void): void {
    this.body.replaceChildren();
    this.title.textContent = heading;
    this.openId = id;
    this.live = live ?? null;
    build(this.body);
    if (!this.dialog.open) this.dialog.showModal();
  }

  close(): void {
    if (this.dialog.open) this.dialog.close();
  }
}
