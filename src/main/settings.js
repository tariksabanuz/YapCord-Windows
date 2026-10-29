'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  version: 1,

  plugins: {},

  updater: { auto: false, notify: true, repo: '' },

  layout: { order: ['rail', 'sidebar', 'main'], railIcon: 48, sidebarWidth: 260, zoom: 100, chatText: 100, messageGap: 100 },
  useQuickCss: true,
  enabledThemes: [],
  themeLinks: [],
  window: {
    closeToTray: false,
    startMinimized: false,
    autoStart: false,
    hardwareAcceleration: true,
    spellcheck: true,
    devTools: true,
    ownFilePicker: true,
    bounds: null,

    skipProxyDetection: true,
  },
};

function isObj(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

function deepMerge(target, patch) {
  if (!isObj(target) || !isObj(patch)) return patch;
  const out = { ...target };
  for (const k of Object.keys(patch)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    out[k] = isObj(patch[k]) && isObj(target[k]) ? deepMerge(target[k], patch[k]) : patch[k];
  }
  return out;
}

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

class SettingsStore {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'settings.json');
    this.quickCssFile = path.join(dir, 'quickCss.css');
    this.data = clone(DEFAULTS);
    this._timer = null;
    this._listeners = new Set();
  }

  load() {
    fs.mkdirSync(this.dir, { recursive: true });
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      if (!isObj(parsed)) throw new Error('settings.json is not an object');
      this.data = deepMerge(clone(DEFAULTS), parsed);
    } catch (err) {
      if (err && err.code !== 'ENOENT') {

        try {
          fs.copyFileSync(this.file, this.file + '.broken-' + Date.now());
        } catch (_) {

        }
      }
      this.data = clone(DEFAULTS);
    }
    if (!fs.existsSync(this.quickCssFile)) {
      try {
        fs.writeFileSync(this.quickCssFile, '/* YapCord Custom CSS: write your own CSS here. */\n', 'utf8');
      } catch (_) {

      }
    }
    return this.data;
  }

  get() {
    return this.data;
  }

  replace(next) {
    this.data = deepMerge(clone(DEFAULTS), isObj(next) ? next : {});
    this._schedule();
    this._emit();
  }

  patch(partial) {
    if (!isObj(partial)) return;
    this.data = deepMerge(this.data, partial);
    this._schedule();
    this._emit();
  }

  setPath(dotted, value) {
    const keys = String(dotted).split('.').filter(Boolean);
    if (!keys.length || keys.some((k) => k === '__proto__' || k === 'constructor' || k === 'prototype')) return;
    let cur = this.data;
    for (let i = 0; i < keys.length - 1; i++) {
      if (!isObj(cur[keys[i]])) cur[keys[i]] = {};
      cur = cur[keys[i]];
    }
    cur[keys[keys.length - 1]] = value;
    this._schedule();
    this._emit();
  }

  onChange(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _emit() {
    for (const fn of this._listeners) {
      try {
        fn(this.data);
      } catch (_) {

      }
    }
  }

  _schedule() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.flush(), 250);
  }

  flush() {
    clearTimeout(this._timer);
    this._timer = null;
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.error('[YapCord] could not save settings:', err);
    }
  }

  readQuickCss() {
    try {
      return fs.readFileSync(this.quickCssFile, 'utf8');
    } catch (_) {
      return '';
    }
  }

  writeQuickCss(css) {
    try {
      fs.writeFileSync(this.quickCssFile, String(css ?? ''), 'utf8');
    } catch (err) {
      console.error('[YapCord] could not save quickCss:', err);
    }
  }
}

module.exports = { SettingsStore, DEFAULTS, deepMerge, isObj, clone };
