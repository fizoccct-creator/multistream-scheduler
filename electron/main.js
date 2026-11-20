// Desktop app wrapper: runs the scheduler in the background, with a window and a menu bar / tray icon.
import { app, BrowserWindow, Tray, Menu, Notification, shell, dialog, powerSaveBlocker, nativeImage, nativeTheme } from 'electron';
import path from 'node:path';
import { createRequire } from 'node:module';
import { stopAll } from '../lib/streamer.js'; // has no setup side effects, safe to load early

const PORT = 3030; // fixed, because the YouTube redirect URI uses it
const BASE = `http://localhost:${PORT}`;
const isMac = process.platform === 'darwin';
const ASSETS = path.join(import.meta.dirname, 'assets');

let win = null;
let tray = null;
let quitting = false;
let hintShown = false;
let store = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  setup();
}

function setup() {
  app.setAppUserModelId('com.multistream.scheduler');

  // Keep settings, schedule and videos in the user's app-data folder.
  const userData = app.getPath('userData');
  process.env.MS_DATA_DIR = path.join(userData, 'data');
  process.env.MS_VIDEOS_DIR = path.join(userData, 'videos');

  // Use the FFmpeg that ships inside the app. Packaged apps keep it outside the read-only archive.
  const require = createRequire(import.meta.url);
  const ffmpegPath = require('ffmpeg-static');
  if (ffmpegPath) process.env.FFMPEG_PATH = ffmpegPath.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);

  const startHidden = process.argv.includes('--hidden') || app.getLoginItemSettings().wasOpenedAtLogin;

  app.on('second-instance', () => showWindow());
  app.on('activate', () => showWindow());
  app.on('window-all-closed', () => {}); // keep running in the background
  app.on('before-quit', (e) => {
    if (!quitting) {
      e.preventDefault();
      confirmQuit();
    }
  });
  app.on('will-quit', () => stopAll()); // never leave FFmpeg streaming after the app closes

  app.whenReady().then(async () => {
    const notifyModule = await import('../lib/notify.js');
    notifyModule.setNotifier((title, body) => {
      const n = new Notification({ title, body });
      n.on('click', () => showWindow());
      n.show();
    });
    notifyModule.setOpener((url) => {
      const hash = url.includes('#') ? url.slice(url.indexOf('#')) : '';
      showWindow(hash);
    });

    try {
      const { startServer } = await import('../server.js');
      await startServer();
      store = await import('../lib/store.js');
    } catch (err) {
      dialog.showErrorBox(
        'Multistream Scheduler could not start',
        err.code === 'EADDRINUSE'
          ? `Port ${PORT} is already being used by another program. Close it (or another copy of this app) and try again.`
          : String(err.message || err),
      );
      app.exit(1);
      return;
    }

    // Stop the computer from sleeping while the app runs, so scheduled streams can start.
    powerSaveBlocker.start('prevent-app-suspension');
    createTray();
    if (!startHidden) createWindow();
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 420,
    minHeight: 500,
    title: 'Multistream Scheduler',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#121211' : '#f6f6f4',
    autoHideMenuBar: true,
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  win.once('ready-to-show', () => win.show());
  win.loadURL(BASE);

  // Links to other sites (YouTube, Google sign-in) open in the normal browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url.startsWith('/') ? BASE + url : url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(`${BASE}/`) || new URL(url).pathname.startsWith('/auth/')) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });

  // Closing the window keeps the app running so scheduled streams still start.
  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    win.hide();
    if (isMac) app.dock?.hide();
    if (!hintShown) {
      hintShown = true;
      new Notification({
        title: 'Multistream Scheduler is still running',
        body: `Scheduled streams will still start. Use the ${isMac ? 'menu bar' : 'system tray'} icon to open or quit.`,
      }).show();
    }
  });
  win.on('closed', () => { win = null; });
}

function showWindow(hash = '') {
  if (isMac) app.dock?.show();
  if (!win) createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  if (hash) win.webContents.executeJavaScript(`location.hash = ${JSON.stringify(hash)}`).catch(() => {});
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(ASSETS, isMac ? 'trayTemplate.png' : 'tray.png'));
  if (isMac) icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip('Multistream Scheduler');
  const buildMenu = () => Menu.buildFromTemplate([
    { label: 'Open Multistream Scheduler', click: () => showWindow() },
    { label: 'Open videos folder', click: () => shell.openPath(process.env.MS_VIDEOS_DIR) },
    { type: 'separator' },
    {
      label: 'Start when I log in',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked, openAsHidden: true, args: ['--hidden'] }),
    },
    { type: 'separator' },
    { label: 'Quit', click: () => confirmQuit() },
  ]);
  tray.setContextMenu(buildMenu());
  tray.on('click', () => { if (!isMac) showWindow(); });
}

async function confirmQuit() {
  const jobs = store ? store.listJobs() : [];
  const live = jobs.some((j) => ['live', 'starting'].includes(j.status));
  const upcoming = jobs.some((j) => j.status === 'scheduled');
  if (live || upcoming) {
    const { response } = await dialog.showMessageBox({
      type: 'warning',
      buttons: ['Keep running', live ? 'Stop stream and quit' : 'Quit anyway'],
      defaultId: 0,
      cancelId: 0,
      message: live ? 'A stream is live right now' : 'You have scheduled streams',
      detail: live
        ? 'Quitting stops it on every platform.'
        : "Scheduled streams won't start while the app is closed.",
    });
    if (response !== 1) return;
  }
  quitting = true;
  app.quit();
}
