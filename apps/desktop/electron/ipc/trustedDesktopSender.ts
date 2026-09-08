import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';

/** The authoritative window and top-level frame are supplied by main, never by the caller. */
export function assertTrustedMainDesktopSender(
  event: IpcMainInvokeEvent,
  getMainWindow: () => BrowserWindow | null,
): void {
  const window = getMainWindow();
  if (!window || window.isDestroyed() || event.sender.isDestroyed() || event.sender !== window.webContents ||
      !event.senderFrame || event.senderFrame !== window.webContents.mainFrame) {
    throw new Error('This operation is restricted to the trusted main desktop frame.');
  }
  const url = new URL(event.senderFrame.url);
  const developmentOrigin = process.env.ELECTRON_RENDERER_URL;
  const trustedDevelopment = developmentOrigin && url.origin === new URL(developmentOrigin).origin;
  // The exact window/frame check excludes settings windows, popout guests and webviews.
  // Production's document is local; development accepts only its configured origin.
  if (url.protocol !== 'file:' && !trustedDevelopment) throw new Error('Untrusted desktop document origin.');
}
