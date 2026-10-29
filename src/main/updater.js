'use strict';

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const { extractZip } = require('./unzip');

const GITHUB_HOSTS = ['api.github.com', 'github.com', 'codeload.github.com', 'objects.githubusercontent.com', 'raw.githubusercontent.com'];
const RUNTIME_ITEMS = ['src', 'themes', 'build', 'package.json', 'LICENSE', 'LICENSES'];
const REQUIRED_FILES = ['package.json', path.join('src', 'main', 'inject.js'), path.join('src', 'preload', 'index.js'), path.join('src', 'renderer', '000-boot.js')];
const MAX_ZIP = 30 * 1024 * 1024;
const FIRST_CHECK_MS = 30 * 1000;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const MIN_GAP_MS = 60 * 60 * 1000;

function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(v == null ? '' : v).trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
  return 0;
}

const validRepo = (r) => typeof r === 'string' && /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(r.trim());

const PLATFORM_REPOS = { win32: 'tariksabanuz/YapCord-Windows', linux: 'tariksabanuz/YapCord-Linux', darwin: 'tariksabanuz/YapCord-MacOS' };

function defaultRepoForPlatform(ownPkg, platform) {
  return PLATFORM_REPOS[platform] || (ownPkg && ownPkg.yapcord && ownPkg.yapcord.updateRepo) || '';
}

function normaliseRepo(input) {
  let s = String(input == null ? '' : input).trim();
  const m = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]+)\/([^/\s#?]+)/i.exec(s);
  if (m) s = m[1] + '/' + m[2].replace(/\.git$/i, '');
  return validRepo(s) ? s : '';
}

class Updater extends EventEmitter {

  constructor(o) {
    super();
    this.current = o.currentVersion;
    this.getRepo = o.getRepo;
    this.mode = o.mode;
    this.runtimeDir = o.runtimeDir || null;
    this.fetch = o.fetch;
    this.log = o.log || { info() {}, warn() {}, error() {} };
    this.apiBase = (o.apiBase || 'https://api.github.com').replace(/\/$/, '');
    this.hosts = o.hosts || GITHUB_HOSTS;
    this.allowHttp = !!o.hosts;
    this.now = o.now || Date.now;
    this.busy = false;
    this.info = null;
    this.timers = [];
    this.state = { phase: 'idle', current: this.current, latest: null, repo: '', url: '', notes: '', error: '', lastCheck: 0, canInstall: this.mode === 'official' && !!this.runtimeDir };
    this._detectStaged();
  }

  get nextDir() {
    return this.runtimeDir ? this.runtimeDir + '-next' : null;
  }

  _set(patch) {
    this.state = { ...this.state, ...patch };
    this.emit('state', this.state);
  }

  getState() {
    return this.state;
  }

  _detectStaged() {
    try {
      if (!this.nextDir) return;
      const v = JSON.parse(fs.readFileSync(path.join(this.nextDir, 'package.json'), 'utf8')).version;
      if (compareVersions(v, this.current) > 0) this.state = { ...this.state, phase: 'ready', latest: v };
    } catch (_) {  }
  }

  _checkUrl(raw) {
    let u;
    try { u = new URL(raw); } catch (_) { throw new Error('Bad update address.'); }
    if (u.protocol !== 'https:' && !(this.allowHttp && u.protocol === 'http:')) throw new Error('Updates are only fetched over https.');
    const host = u.hostname.toLowerCase();
    if (!this.hosts.includes(host) && !(!this.allowHttp && host.endsWith('.githubusercontent.com'))) throw new Error('Refusing to download from ' + host + '.');
    return u;
  }

  async _get(url, { accept, timeout = 20000 } = {}) {
    this._checkUrl(url);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeout);
    try {
      const res = await this.fetch(url, { headers: { Accept: accept || 'application/vnd.github+json', 'User-Agent': 'YapCord-Updater' }, redirect: 'follow', signal: ctl.signal });
      if (res.url) this._checkUrl(res.url);
      return res;
    } catch (err) {
      if (err && err.name === 'AbortError') throw new Error('GitHub did not answer in time.');
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  static _httpError(res, what) {
    if (res.status === 403 || res.status === 429) return new Error('GitHub says "too many requests" right now. Try again in a while.');
    if (res.status === 404) return new Error(what + ' was not found. Is the repository name right, and is the repository public?');
    return new Error('GitHub answered ' + res.status + ' for ' + what + '.');
  }

  async _latest(repo) {
    const api = this.apiBase + '/repos/' + repo;
    const rel = await this._get(api + '/releases/latest');
    if (rel.ok) {
      const j = await rel.json();
      const version = String(j.tag_name || '').replace(/^v/i, '');
      const asset = Array.isArray(j.assets) ? j.assets.find((a) => a && /^yapcord.*\.zip$/i.test(a.name || '') && a.browser_download_url) : null;
      // A release asset's browser_download_url is a direct CDN link and wants Accept: application/octet-stream
      // to get the raw bytes back. GitHub's own /zipball/<ref> endpoint (used as a fallback below, and here when
      // a release exists but has no matching named asset) is a normal api.github.com endpoint, not a CDN link -
      // it only negotiates the usual application/vnd.github+json and answers 415 Unsupported Media Type to an
      // octet-stream Accept header, so it must NOT get that header.
      return { version, url: j.html_url || 'https://github.com/' + repo + '/releases', notes: String(j.body || '').slice(0, 1500), zipUrl: asset ? asset.browser_download_url : j.zipball_url, isAsset: !!asset };
    }
    if (rel.status !== 404) throw Updater._httpError(rel, 'the latest release');
    const meta = await this._get(api);
    if (!meta.ok) throw Updater._httpError(meta, 'the repository ' + repo);
    const branch = String((await meta.json()).default_branch || 'main');
    const pkg = await this._get(api + '/contents/package.json?ref=' + encodeURIComponent(branch), { accept: 'application/vnd.github.raw+json' });
    if (!pkg.ok) throw Updater._httpError(pkg, 'package.json in ' + repo);
    const version = String(JSON.parse(await pkg.text()).version || '');
    return { version, url: 'https://github.com/' + repo, notes: '', zipUrl: api + '/zipball/' + encodeURIComponent(branch), isAsset: false };
  }

  async check() {
    if (this.busy) return this.state;
    this.busy = true;
    try {
      const repo = normaliseRepo(this.getRepo());
      if (!repo) {
        this._set({ phase: 'unconfigured', repo: '', error: 'No update repository is set yet.' });
        return this.state;
      }
      this._set({ phase: this.state.phase === 'ready' ? 'ready' : 'checking', repo, error: '' });
      const info = await this._latest(repo);
      if (!parseVersion(info.version)) throw new Error('The repository does not show a version number I understand.');
      this.info = info;
      const stagedOk = this.state.phase === 'ready' && compareVersions(this.state.latest, info.version) >= 0;
      if (compareVersions(info.version, this.current) > 0 && !stagedOk) {
        this._set({ phase: 'available', latest: info.version, url: info.url, notes: info.notes, lastCheck: this.now(), error: '' });
      } else if (stagedOk) {
        this._set({ phase: 'ready', url: info.url, notes: info.notes, lastCheck: this.now(), error: '' });
      } else {
        this._set({ phase: 'uptodate', latest: info.version, url: info.url, notes: '', lastCheck: this.now(), error: '' });
      }
    } catch (err) {
      this.log.warn('update check failed:', err && err.message);
      this._set({ phase: 'error', error: (err && err.message) || String(err), lastCheck: this.now() });
    } finally {
      this.busy = false;
    }
    return this.state;
  }

  async install() {
    if (!this.state.canInstall) throw new Error('Updating inside the app is only possible in the official Yapper app. Download the new version from the release page instead.');
    if (this.busy || this.state.phase === 'ready') return this.state;
    if (this.state.phase !== 'available' || !this.info) await this.check();
    if (this.state.phase !== 'available' || !this.info) return this.state;
    this.busy = true;
    const tmp = this.nextDir + '.tmp';
    try {
      this._set({ phase: 'downloading', error: '' });
      // Only a real release-asset CDN link wants an explicit octet-stream Accept; the api.github.com
      // /zipball/<ref> fallback (this.info.isAsset === false) answers 415 to that header - see the comment
      // in _latest() above.
      const res = await this._get(this.info.zipUrl, { accept: this.info.isAsset ? 'application/octet-stream' : undefined, timeout: 120000 });
      if (!res.ok) throw Updater._httpError(res, 'the download');
      const len = Number(res.headers && res.headers.get && res.headers.get('content-length'));
      if (len > MAX_ZIP) throw new Error('The download is larger than expected.');
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > MAX_ZIP) throw new Error('The download is larger than expected.');
      fs.rmSync(tmp, { recursive: true, force: true });
      extractZip(buf, tmp, { stripRoot: true, allow: RUNTIME_ITEMS });
      const version = this._validate(tmp);
      fs.rmSync(this.nextDir, { recursive: true, force: true });
      fs.renameSync(tmp, this.nextDir);
      this.log.info('update ' + version + ' downloaded; it starts the next time Yapper is opened');
      this._set({ phase: 'ready', latest: version, error: '' });
    } catch (err) {
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {  }
      this.log.warn('update failed:', err && err.message);
      this._set({ phase: 'error', error: (err && err.message) || String(err) });
    } finally {
      this.busy = false;
    }
    return this.state;
  }

  _validate(dir) {
    let pkg;
    try { pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')); } catch (_) { throw new Error('The download is not a YapCord package.'); }
    if (pkg.name !== 'yapcord') throw new Error('The download is not a YapCord package.');
    if (compareVersions(pkg.version, this.current) <= 0) throw new Error('The download is not newer than the version you have.');
    for (const f of REQUIRED_FILES) if (!fs.existsSync(path.join(dir, f))) throw new Error('The download is incomplete (' + f + ' is missing).');
    return pkg.version;
  }

  start(getConfig) {
    // Background runs only ever check and report; they never call install() on their own. Downloading and
    // running new code is only ever triggered by an explicit user click (the "Update now" button), so a
    // compromised update repo can at most get a user a false "update available" notice, never silently
    // execute anything.
    const run = async () => {
      try {
        if (this.state.lastCheck && this.now() - this.state.lastCheck < MIN_GAP_MS) return;
        const cfg = getConfig() || {};
        if (cfg.auto === false) return;
        await this.check();
      } catch (err) {
        this.log.warn('background update failed:', err && err.message);
      }
    };
    const first = setTimeout(run, FIRST_CHECK_MS);
    const every = setInterval(run, CHECK_EVERY_MS);
    for (const t of [first, every]) if (t.unref) t.unref();
    this.timers.push(first, every);
    return run;
  }

  stop() {
    for (const t of this.timers) { clearTimeout(t); clearInterval(t); }
    this.timers = [];
  }
}

module.exports = { Updater, compareVersions, parseVersion, normaliseRepo, validRepo, defaultRepoForPlatform, GITHUB_HOSTS, RUNTIME_ITEMS };
