'use strict';
const path = require('path');
const { app, BrowserWindow, Menu, Tray, nativeImage, session, shell } = require('electron');

const C = require('./constants');
const log = require('./log');
const { SettingsStore } = require('./settings');
const { ThemeManager } = require('./themes');
const { NetFilter } = require('./netfilter');
const { registerIpc } = require('./ipc');
const { installDisplayMediaHandler } = require('./capture');
const { attachContextMenu } = require('./contextmenu');
const { resolveDataDir } = require('./datadir');
const { AppIcon } = require('./appicon');
const { Updater, defaultRepoForPlatform } = require('./updater');

app.setName('YapCord');
if (process.platform === 'win32') app.setAppUserModelId('dev.yapcord.app');

const dataLocation = resolveDataDir(app.getPath('appData'));
const dataDir = dataLocation.dir;
app.setPath('userData', dataDir);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  main();
}

function main() {
  const settings = new SettingsStore(path.join(dataDir, 'settings'));
  settings.load();

  if (settings.get().window.skipProxyDetection !== false) app.commandLine.appendSwitch('no-proxy-server');
  const themes = new ThemeManager(path.join(dataDir, 'themes'));
  const netfilter = new NetFilter();

  const appIcon = new AppIcon({
    dir: path.join(dataDir, 'icons'),
    nativeImage,
    isEnabled: () => !!((settings.get().plugins || {}).CustomIcons || {}).enabled,
    originalWindow: () => nativeImage.createFromPath(C.ICON),
    log,
  });

  const ownPkg = require('../../package.json');
  const updater = new Updater({
    currentVersion: ownPkg.version,
    mode: 'standalone',
    runtimeDir: null,
    getRepo: () => (settings.get().updater || {}).repo || defaultRepoForPlatform(ownPkg, process.platform),
    fetch: (url, init) => require('electron').net.fetch(url, init),
    log,
  });

  if (settings.get().window.hardwareAcceleration === false) app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

  let win = null;

  let tray = null;
  let quitting = false;
  const startHidden = process.argv.includes('--hidden');

  const getWindow = () => win;

  function applyWindowSettings() {
    const s = settings.get();
    const w = s.window || {};
    netfilter.enabled = !(s.plugins && s.plugins.NoTrack && s.plugins.NoTrack.enabled === false);
    appIcon.refresh();
    try {
      if (process.platform === 'win32' || process.platform === 'darwin') {
        app.setLoginItemSettings({ openAtLogin: !!w.autoStart, args: w.startMinimized ? ['--hidden'] : [] });
      }
    } catch (err) {
      log.warn('could not update login item:', err);
    }
    if (win && !win.isDestroyed()) {
      try {
        win.webContents.session.setSpellCheckerEnabled(w.spellcheck !== false);
      } catch (_) {

      }
    }
  }

  const send = (channel, ...args) => {
    if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
  };

  const isSiteUrl = (url) => {
    try {
      const u = new URL(url);
      return u.protocol === 'https:' && C.SITE_HOSTS.includes(u.hostname);
    } catch (_) {
      return false;
    }
  };
  const isTrustedOrigin = (url) => {
    try {
      const h = new URL(url).hostname;
      return C.TRUSTED_HOSTS.includes(h) || h.endsWith('.yapper.website');
    } catch (_) {
      return false;
    }
  };
  const openExternalSafe = (url) => {
    if (/^(https?:|mailto:)/i.test(url)) shell.openExternal(url).catch(() => undefined);
  };

  const ALLOWED_PERMISSIONS = new Set([
    'media', 'audioCapture', 'videoCapture', 'display-capture', 'notifications', 'fullscreen', 'pointerLock',
    'clipboard-sanitized-write', 'clipboard-read', 'speaker-selection', 'window-management', 'idle-detection',
  ]);

  function setupSession(ses) {
    ses.setPermissionRequestHandler((wc, permission, callback, details) => {
      const origin = (details && details.requestingUrl) || wc.getURL();
      callback(isTrustedOrigin(origin) && ALLOWED_PERMISSIONS.has(permission));
    });
    ses.setPermissionCheckHandler((wc, permission, requestingOrigin) =>
      isTrustedOrigin(requestingOrigin || (wc && wc.getURL()) || '') && ALLOWED_PERMISSIONS.has(permission),
    );
    netfilter.install(ses);
    installDisplayMediaHandler(ses, getWindow);
  }

  function createWindow() {
    const w = settings.get().window || {};
    const b = w.bounds || {};
    win = new BrowserWindow({
      width: b.width || 1280,
      height: b.height || 820,
      x: Number.isFinite(b.x) ? b.x : undefined,
      y: Number.isFinite(b.y) ? b.y : undefined,
      minWidth: 720,
      minHeight: 480,
      show: false,
      backgroundColor: '#141519',
      title: 'Yapper',
      icon: C.ICON,
      autoHideMenuBar: true,
      webPreferences: {
        preload: C.PRELOAD,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        spellcheck: w.spellcheck !== false,
        backgroundThrottling: false,
      },
    });
    appIcon.attachWindow(win);
    if (b.maximized) win.maximize();

    const wc = win.webContents;
    wc.setUserAgent(wc.getUserAgent().replace(/ (YapCord|YapperMod)\/\S+/g, '') + ' YapCord/' + app.getVersion());

    wc.setWindowOpenHandler(({ url }) => {
      openExternalSafe(url);
      return { action: 'deny' };
    });

    const guardNavigation = (event, url) => {
      if (isSiteUrl(url)) return;
      event.preventDefault();
      openExternalSafe(url);
    };
    wc.on('will-navigate', guardNavigation);
    wc.on('will-redirect', guardNavigation);
    wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
      if (!isMainFrame || code === -3 ) return;
      log.warn('load failed', code, desc, url);
      win.loadFile(path.join(__dirname, 'offline.html'), { query: { u: C.SITE_URL } }).catch(() => undefined);
    });
    wc.on('render-process-gone', (_e, details) => {
      log.error('renderer gone:', details);
      if (details.reason !== 'clean-exit') setTimeout(() => wc.reload(), 1000);
    });

    wc.on('console-message', (event, legacyLevel, legacyMessage) => {
      const message = String(event && event.message !== undefined ? event.message : legacyMessage || '');
      const level = event && event.level !== undefined ? event.level : legacyLevel;
      const isError = level === 'error' || level === 3;
      if (isError && /YapCord|YapperMod/.test(message)) log.error('[page]', message);
    });
    attachContextMenu(wc, { getWindow, settings, openExternal: openExternalSafe });

    win.once('ready-to-show', () => {
      const hidden = startHidden || (settings.get().window || {}).startMinimized;
      if (!hidden) win.show();
    });

    let saveTimer = null;
    const saveBounds = () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        if (!win || win.isDestroyed()) return;
        const maximized = win.isMaximized();
        const bounds = maximized ? (settings.get().window.bounds || {}) : win.getBounds();
        settings.setPath('window.bounds', { ...bounds, maximized });
      }, 600);
    };
    win.on('resize', saveBounds);
    win.on('move', saveBounds);
    win.on('maximize', saveBounds);
    win.on('unmaximize', saveBounds);

    win.on('close', (event) => {
      if (!quitting && (settings.get().window || {}).closeToTray && tray) {
        event.preventDefault();
        win.hide();
      }
    });
    win.on('closed', () => {
      win = null;
    });

    win.loadURL(C.SITE_URL).catch((err) => log.warn('initial load failed:', err && err.message));
  }

  function showWindow() {
    if (!win) return createWindow();
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }

  function createTray() {
    try {
      const img = nativeImage.createFromPath(C.ICON);
      if (img.isEmpty()) return;
      const original = img.resize({ width: 16, height: 16 });
      tray = new Tray(appIcon.trayImage() || original);
      appIcon.attachTray(tray, original);
      tray.setToolTip('Yapper');
      tray.setContextMenu(
        Menu.buildFromTemplate([
          { label: 'Open Yapper', click: showWindow },
          { label: 'YapCord settings', click: () => { showWindow(); openModSettings(); } },
          { type: 'separator' },
          { label: 'Quit', click: () => app.quit() },
        ]),
      );
      tray.on('click', showWindow);
    } catch (err) {
      log.warn('tray unavailable:', err && err.message);
      tray = null;
    }
  }

  function openModSettings() {
    if (!win) return;
    win.webContents
      .executeJavaScript('window.YapperMod && window.YapperMod.openSettings && window.YapperMod.openSettings()')
      .catch(() => undefined);
  }

  function buildMenu() {
    const devTools = (settings.get().window || {}).devTools !== false;
    const view = [{ role: 'reload' }, { role: 'forceReload' }];
    if (devTools) view.push({ role: 'toggleDevTools' });
    view.push(
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomIn', accelerator: 'CmdOrCtrl+=', visible: false },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
    );
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: 'File',
          submenu: [
            { label: 'YapCord settings', accelerator: 'CmdOrCtrl+,', click: openModSettings },
            { label: 'Open data folder', click: () => shell.openPath(dataDir) },
            { label: 'Open themes folder', click: () => shell.openPath(themes.dir) },
            { type: 'separator' },
            { label: 'Quit', accelerator: 'CmdOrCtrl+Q', click: () => app.quit() },
          ],
        },
        { label: 'Edit', role: 'editMenu' },
        { label: 'View', submenu: view },
        { label: 'Window', role: 'windowMenu' },
      ]),
    );
  }

  app.on('second-instance', showWindow);
  app.on('before-quit', () => {
    quitting = true;
    settings.flush();
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  app.on('activate', () => {
    if (!win) createWindow();
  });
  process.on('uncaughtException', (err) => log.error('uncaughtException:', err));
  process.on('unhandledRejection', (err) => log.error('unhandledRejection:', err));

  app.whenReady().then(() => {
    log.init(path.join(dataDir, 'logs'));
    log.info('YapCord ' + app.getVersion() + ' starting (electron ' + process.versions.electron + ')');
    if (dataLocation.migrated) log.info('moved the data folder from YapperMod to YapCord');
    if (dataLocation.legacy) log.warn('could not move the old YapperMod data folder (is the old app still running?), using it as it is:', dataLocation.error && dataLocation.error.message);

    themes.ensureDir(C.BUNDLED_THEMES_DIR);
    setupSession(session.defaultSession);
    registerIpc({ getWindow, settings, themes, netfilter, dataDir, applyWindowSettings, appIcon, updater });
    applyWindowSettings();
    buildMenu();
    createWindow();
    createTray();

    updater.on('state', (st) => send('ym:updater-state', st));
    updater.start(() => settings.get().updater);

    themes.watch(() => send('ym:themes-changed', themes.list()));
    try {
      const fs = require('fs');
      let t = null;
      fs.watch(settings.dir, { persistent: false }, (_ev, fileName) => {
        if (fileName && fileName !== 'quickCss.css') return;
        clearTimeout(t);
        t = setTimeout(() => send('ym:quickcss-changed', settings.readQuickCss()), 200);
      });
    } catch (_) {

    }
  });
}
