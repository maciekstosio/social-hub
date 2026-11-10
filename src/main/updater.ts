import { app } from 'electron';
import { autoUpdater } from 'electron-updater';

const CHECK_EVERY_MS = 60 * 60 * 1000;
let ready = false;

/**
 * Checks GitHub Releases for a newer build (packaged app only), downloads it in
 * the background and installs it on quit, or right away via restartToUpdate().
 */
export function startUpdates(onReady: () => void) {
  if (!app.isPackaged) return;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-downloaded', () => {
    ready = true;
    onReady();
  });
  autoUpdater.on('error', (err) => console.error('Update failed:', err));
  const check = () => void autoUpdater.checkForUpdates().catch(() => {});
  check();
  setInterval(check, CHECK_EVERY_MS);
}

export const updateReady = () => ready;

export function restartToUpdate() {
  autoUpdater.quitAndInstall();
}
