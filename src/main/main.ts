import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, screen, session, shell, WebContentsView } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { blockedLogPath, configPath, loadConfig, logBlocked, type PlatformId } from './config';
import { guardPlatformView, openLockedViewer } from './guard';
import { createPlatforms, routeLink, type Platform } from './platforms';
import { restartToUpdate, startUpdates, updateReady } from './updater';

// Platform pages fill the window. Two transparent views float on top of them: a pill behind
// the traffic lights (also the drag handle) and the dock, which is a thin hover strip at the
// left edge until the pointer reaches it. Keep in sync with .lights / .dock in sidebar.css.
const TITLEBAR = { width: 112, height: 64 };
const TRAFFIC_LIGHTS = { x: 23, y: 21 };
const DOCK_WIDTH = 84;
const DOCK_EDGE = 6;
const DOCK_CLOSE_DELAY_MS = 300;
const ALLOWED_PERMISSIONS = new Set(['media', 'fullscreen', 'clipboard-sanitized-write', 'speaker-selection']);

const config = loadConfig();
const platforms = createPlatforms(config);
const views = new Map<PlatformId, WebContentsView>();
let mainWindow: BrowserWindow | null = null;
let active: PlatformId = platforms[0].id;
let dockView: WebContentsView | null = null;
let titlebarView: WebContentsView | null = null;
let dockOpen = false;
let dockPoll: ReturnType<typeof setInterval> | undefined;

// Look like plain Chrome: drop the "Electron/…" and app-name tokens, which some
// sites treat as an unsupported browser. Applies to headers and navigator.userAgent.
app.userAgentFallback = app.userAgentFallback.replace(/ (?!(?:AppleWebKit|Chrome|Safari)\/)[\w-]+\/\S+/g, '');

function setupSession(platform: Platform) {
  const ses = session.fromPartition(platform.partition);
  // Camera/mic for calls; no notifications (not in the MVP), nothing else.
  ses.setPermissionRequestHandler((_wc, permission, callback) => callback(ALLOWED_PERMISSIONS.has(permission)));
  ses.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission));
}

function layout() {
  if (!mainWindow) return;
  const { width, height } = mainWindow.getContentBounds();
  for (const view of views.values()) view.setBounds({ x: 0, y: 0, width, height });
  // No traffic lights in fullscreen, so no pill and the dock can use the full height.
  const fullscreen = mainWindow.isFullScreen();
  titlebarView?.setVisible(!fullscreen);
  titlebarView?.setBounds({ x: 0, y: 0, ...TITLEBAR });
  // Same inset at the bottom so the centered bubble lines up with the window's middle.
  const inset = fullscreen ? 8 : TITLEBAR.height;
  dockView?.setBounds({ x: 0, y: inset, width: dockOpen ? DOCK_WIDTH : DOCK_EDGE, height: height - 2 * inset });
}

/**
 * The dock view only sees the pointer while it's over the dock, so main watches the cursor
 * and asks the dock to slide out once it has been away for a moment. The dock shrinks
 * itself back to the edge strip (setDockOpen(false)) when its animation ends.
 */
function setDockOpen(open: boolean) {
  dockOpen = open;
  clearInterval(dockPoll);
  dockPoll = undefined;
  layout();
  if (!open) return;
  let awaySince = 0;
  dockPoll = setInterval(() => {
    if (!mainWindow || !dockView) return setDockOpen(false);
    const content = mainWindow.getContentBounds();
    const dock = dockView.getBounds();
    const { x, y } = screen.getCursorScreenPoint();
    const inside =
      x >= content.x + dock.x && x < content.x + dock.x + dock.width && y >= content.y + dock.y && y < content.y + dock.y + dock.height;
    if (inside) awaySince = 0;
    else if (!awaySince) awaySince = Date.now();
    else if (Date.now() - awaySince >= DOCK_CLOSE_DELAY_MS) {
      clearInterval(dockPoll);
      dockPoll = undefined;
      dockView.webContents.send('hub:dock-close');
    }
  }, 50);
}

function createOverlay(win: BrowserWindow, file: string, preload?: string) {
  const view = new WebContentsView({
    webPreferences: { preload, sandbox: true, contextIsolation: true },
  });
  view.setBackgroundColor('#00000000');
  win.contentView.addChildView(view);
  void view.webContents.loadFile(path.join(__dirname, '../renderer', file));
  return view;
}

function select(id: PlatformId, url?: string) {
  const platform = platforms.find((p) => p.id === id);
  const view = views.get(id);
  if (!platform || !view) return;
  // Clicking the active icon again goes back to the platform home.
  if (url) void view.webContents.loadURL(url);
  else if (id === active) void view.webContents.loadURL(platform.home);
  active = id;
  for (const [vid, v] of views) v.setVisible(vid === id);
  view.webContents.focus();
  dockView?.webContents.send('hub:active', id);
}

/** Opens a link from outside the hub (clipboard, drag & drop) through the allowlist. */
async function openLink(source: string | Promise<string>) {
  const text = await source;
  const win = mainWindow;
  if (!win) return;
  const route = routeLink(platforms, text);
  switch (route.kind) {
    case 'allow':
      return select(route.platform.id, route.url);
    case 'viewer':
      return openLockedViewer(win, route.platform, route.url);
    case 'external':
      return void shell.openExternal(route.url);
    case 'none':
      return void dialog.showMessageBox(win, {
        type: 'info',
        message: 'No link to open',
        detail: 'Copy a link first, then use Open Link (⌘L).',
      });
    case 'block':
      logBlocked(route.platform?.id ?? 'link', 'pasted', route.url);
      return void dialog.showMessageBox(win, {
        type: 'warning',
        message: `${route.platform?.label ?? 'This page'} isn't allowed in Social Hub`,
        detail: `${route.url}\n\nOnly messages, shared posts/reels/stories and your X list open here.`,
      });
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 720,
    minHeight: 480,
    title: 'Social Hub',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: TRAFFIC_LIGHTS,
    backgroundColor: '#111114',
    webPreferences: { sandbox: true, contextIsolation: true },
  });
  mainWindow = win;

  for (const platform of platforms) {
    setupSession(platform);
    const view = new WebContentsView({
      webPreferences: {
        partition: platform.partition,
        sandbox: true,
        contextIsolation: true,
        // Views stay loaded while hidden. With throttling on, Chromium treats them as
        // background tabs and caps in-flight image/fetch loads, so a few long-polling
        // requests starve everything else for a minute or more.
        backgroundThrottling: false,
        preload: platform.id === 'x' ? path.join(__dirname, '../preload/x-filter.js') : undefined,
      },
    });
    guardPlatformView(view.webContents, platform, (url) => openLockedViewer(win, platform, url));
    if (platform.css) {
      const css = platform.css;
      view.webContents.on('dom-ready', () => void view.webContents.insertCSS(css));
    }
    view.setVisible(platform.id === active);
    win.contentView.addChildView(view);
    views.set(platform.id, view);
    void view.webContents.loadURL(platform.home);
  }

  // Added after the platform views so they stack on top of them.
  titlebarView = createOverlay(win, 'titlebar.html');
  dockView = createOverlay(win, 'sidebar.html', path.join(__dirname, '../preload/sidebar.js'));

  win.on('resize', layout);
  win.on('enter-full-screen', layout);
  win.on('leave-full-screen', layout);
  layout();
  win.on('closed', () => {
    mainWindow = null;
    setDockOpen(false);
    dockView?.webContents.close();
    titlebarView?.webContents.close();
    dockView = titlebarView = null;
    // WebContentsViews outlive their window; without this, every reopen from the
    // Dock leaves the previous set of pages running hidden in the background.
    for (const view of views.values()) view.webContents.close();
    views.clear();
  });
}

function openConfig() {
  void shell.openPath(configPath());
}

function openLog() {
  fs.appendFileSync(blockedLogPath(), '');
  void shell.openPath(blockedLogPath());
}

function relaunch() {
  if (updateReady()) return restartToUpdate();
  app.relaunch();
  app.exit(0);
}

/** Rebuilt when an update finishes downloading, so Restart turns into Restart to Install Update. */
function buildMenu() {
  const activeContents = () => views.get(active)?.webContents;
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: app.name,
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: openConfig },
          { label: 'Blocked Pages Log', click: openLog },
          { label: updateReady() ? 'Restart to Install Update' : 'Restart', accelerator: 'CmdOrCtrl+Shift+R', click: relaunch },
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      { role: 'editMenu' },
      {
        label: 'View',
        submenu: [
          ...platforms.map((p, i) => ({
            label: p.label,
            accelerator: `CmdOrCtrl+${i + 1}`,
            click: () => select(p.id),
          })),
          { type: 'separator' },
          { label: 'Open Link from Clipboard', accelerator: 'CmdOrCtrl+L', click: () => void openLink(clipboard.readText()) },
          { type: 'separator' },
          { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => activeContents()?.reload() },
          { label: 'Developer Tools', accelerator: 'Alt+CmdOrCtrl+I', click: () => activeContents()?.toggleDevTools() },
          { type: 'separator' },
          { role: 'togglefullscreen' },
        ],
      },
      { role: 'windowMenu' },
    ]),
  );
}

ipcMain.handle('hub:platforms', () => ({
  platforms: platforms.map(({ id, label }) => ({ id, label })),
  active,
}));
ipcMain.on('hub:select', (_e, id: PlatformId) => select(id));
ipcMain.on('hub:dock', (event, open: unknown) => {
  if (event.sender === dockView?.webContents) setDockOpen(open === true);
});
ipcMain.on('hub:open-link', (_e, text: unknown) => void openLink(typeof text === 'string' ? text : clipboard.readText()));
ipcMain.on('x-filter:config', (event) => {
  event.returnValue = { friends: config.x.friends, home: platforms.find((p) => p.id === 'x')?.home };
});
ipcMain.on('x-filter:self', (event, handle: unknown) => {
  if (typeof handle !== 'string' || event.sender !== views.get('x')?.webContents) return;
  platforms.find((p) => p.id === 'x')?.setSelf?.(handle);
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow?.isMinimized()) mainWindow.restore();
    mainWindow?.focus();
  });
  void app.whenReady().then(() => {
    // Packaged builds get the icon from the bundle; dev runs use the stock Electron one.
    if (!app.isPackaged) app.dock?.setIcon(path.join(__dirname, '../../build/icon.png'));
    buildMenu();
    createWindow();
    startUpdates(buildMenu);
    app.on('activate', () => {
      if (!mainWindow) createWindow();
    });
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
