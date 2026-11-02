import { BrowserWindow, shell, type WebContents } from 'electron';
import { logBlocked } from './config';
import { unwrapLinkShim, type Platform } from './platforms';

type Phase = 'navigate' | 'redirect' | 'in-page' | 'window-open';

/** Reloads the platform home, but gives up if home itself keeps bouncing to a blocked page. */
function homeLoader(wc: WebContents, platform: Platform) {
  let recent: number[] = [];
  return () => {
    const now = Date.now();
    recent = recent.filter((t) => now - t < 10_000);
    if (recent.length >= 3) {
      logBlocked(platform.id, 'home-loop', wc.getURL());
      return;
    }
    recent.push(now);
    setImmediate(() => !wc.isDestroyed() && wc.loadURL(platform.home));
  };
}

function openExternal(url: string) {
  if (/^https?:\/\//.test(url)) void shell.openExternal(url);
}

/**
 * Keeps a platform's main view on allowlisted pages. Shared items go to the
 * locked viewer, outbound links to the system browser, everything else is blocked.
 */
export function guardPlatformView(
  wc: WebContents,
  platform: Platform,
  openViewer: (url: string) => void,
) {
  const loadHome = homeLoader(wc, platform);

  /** Returns true when the navigation may proceed. */
  const check = (rawUrl: string, phase: Phase): boolean => {
    const url = unwrapLinkShim(rawUrl);
    const verdict = platform.classify(url);
    switch (verdict.kind) {
      case 'allow':
        if (url === rawUrl) return true;
        void wc.loadURL(url);
        break;
      case 'call':
        return phase === 'window-open';
      case 'viewer':
        openViewer(verdict.url);
        break;
      case 'external':
        openExternal(url);
        break;
      case 'block':
        logBlocked(platform.id, phase, url);
        break;
    }
    return false;
  };

  /** In-page (pushState) navigations can't be cancelled, only undone. */
  const undo = () => {
    if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
    else loadHome();
  };

  wc.on('will-navigate', (event) => {
    if (event.isMainFrame && !check(event.url, 'navigate')) event.preventDefault();
  });

  wc.on('will-redirect', (event) => {
    if (event.isMainFrame && !check(event.url, 'redirect')) {
      event.preventDefault();
      loadHome();
    }
  });

  wc.on('did-navigate-in-page', (_event, url, isMainFrame) => {
    if (isMainFrame && !check(url, 'in-page')) undo();
  });

  wc.setWindowOpenHandler(({ url }) => {
    if (url === 'about:blank' || check(url, 'window-open')) {
      return { action: 'allow', overrideBrowserWindowOptions: { width: 960, height: 720 } };
    }
    return { action: 'deny' };
  });

  // Call windows (and about:blank popups that become them) stay on call/allowed pages.
  wc.on('did-create-window', (win) => guardCallWindow(win, platform));
}

function guardCallWindow(win: BrowserWindow, platform: Platform) {
  const wc = win.webContents;
  const ok = (url: string) => {
    const kind = platform.classify(url).kind;
    return kind === 'call' || kind === 'allow';
  };
  const onNav = (event: Electron.Event & { url: string; isMainFrame: boolean }) => {
    if (event.isMainFrame && !ok(event.url)) {
      logBlocked(platform.id, 'call-window', event.url);
      event.preventDefault();
      win.close();
    }
  };
  wc.on('will-navigate', onNav);
  wc.on('will-redirect', onNav);
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
}

/**
 * Opens a single shared item. Before the first load finishes, redirects to
 * another item URL are followed (share links resolve this way); after that the
 * window is locked to that item and any move away from it closes the window.
 */
export function openLockedViewer(parent: BrowserWindow, platform: Platform, url: string) {
  const win = new BrowserWindow({
    parent,
    width: 520,
    height: 860,
    title: `${platform.label} — shared item`,
    autoHideMenuBar: true,
    webPreferences: {
      partition: platform.partition,
      sandbox: true,
      contextIsolation: true,
    },
  });
  const wc = win.webContents;
  let lockedKey: string | null = null;

  const permitted = (target: string): boolean => {
    const key = platform.itemKey(target);
    if (lockedKey !== null) return key === lockedKey;
    return key !== null || platform.classify(target).kind === 'allow';
  };

  const close = (target: string) => {
    logBlocked(platform.id, 'viewer', target);
    if (!win.isDestroyed()) win.close();
  };

  const onNav = (event: Electron.Event & { url: string; isMainFrame: boolean }) => {
    if (!event.isMainFrame || permitted(event.url)) return;
    event.preventDefault();
    if (platform.classify(event.url).kind === 'external') openExternal(event.url);
    close(event.url);
  };
  wc.on('will-navigate', onNav);
  wc.on('will-redirect', onNav);
  wc.on('did-navigate-in-page', (_event, target, isMainFrame) => {
    if (isMainFrame && !permitted(target)) close(target);
  });
  wc.once('did-finish-load', () => {
    lockedKey = platform.itemKey(wc.getURL());
    if (lockedKey === null) close(wc.getURL());
  });
  wc.setWindowOpenHandler(({ url: target }) => {
    const resolved = unwrapLinkShim(target);
    if (platform.classify(resolved).kind === 'external') openExternal(resolved);
    return { action: 'deny' };
  });
  // "Back" always means: return to the chat.
  wc.on('before-input-event', (event, input) => {
    const back = input.key === 'Escape' || (input.meta && input.key === '[');
    if (input.type === 'keyDown' && back) {
      event.preventDefault();
      win.close();
    }
  });

  void win.loadURL(url);
}
