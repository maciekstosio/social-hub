import { app, BrowserWindow, ipcMain, Menu, session, shell, WebContentsView } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { blockedLogPath, configPath, loadConfig, type PlatformId } from './config';
import { guardPlatformView, openLockedViewer } from './guard';
import { createPlatforms, type Platform } from './platforms';

const SIDEBAR_WIDTH = 76;
const ALLOWED_PERMISSIONS = new Set(['media', 'fullscreen', 'clipboard-sanitized-write', 'speaker-selection']);

const config = loadConfig();
const platforms = createPlatforms(config);
const views = new Map<PlatformId, WebContentsView>();
let mainWindow: BrowserWindow | null = null;
let active: PlatformId = platforms[0].id;

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
  for (const view of views.values()) {
    view.setBounds({ x: SIDEBAR_WIDTH, y: 0, width: width - SIDEBAR_WIDTH, height });
  }
}

function select(id: PlatformId) {
  const platform = platforms.find((p) => p.id === id);
  const view = views.get(id);
  if (!platform || !view) return;
  // Clicking the active icon again goes back to the platform home.
  if (id === active) void view.webContents.loadURL(platform.home);
  active = id;
  for (const [vid, v] of views) v.setVisible(vid === id);
  view.webContents.focus();
  mainWindow?.webContents.send('hub:active', id);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 720,
    minHeight: 480,
    title: 'Social Hub',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 28, y: 14 },
    backgroundColor: '#111114',
    webPreferences: {
      preload: path.join(__dirname, '../preload/sidebar.js'),
      sandbox: true,
      contextIsolation: true,
    },
  });
  mainWindow = win;

  for (const platform of platforms) {
    setupSession(platform);
    const view = new WebContentsView({
      webPreferences: {
        partition: platform.partition,
        sandbox: true,
        contextIsolation: true,
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

  win.on('resize', layout);
  layout();
  void win.loadFile(path.join(__dirname, '../renderer/sidebar.html'));
  win.on('closed', () => {
    mainWindow = null;
    views.clear();
  });
}

function buildMenu() {
  const activeContents = () => views.get(active)?.webContents;
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: 'appMenu' },
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
ipcMain.on('hub:open-config', () => void shell.openPath(configPath()));
ipcMain.on('hub:open-log', () => {
  fs.appendFileSync(blockedLogPath(), '');
  void shell.openPath(blockedLogPath());
});
ipcMain.on('hub:relaunch', () => {
  app.relaunch();
  app.exit(0);
});
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
    buildMenu();
    createWindow();
    app.on('activate', () => {
      if (!mainWindow) createWindow();
    });
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
