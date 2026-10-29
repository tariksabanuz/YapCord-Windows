

const h = YM.dom.h;

const fill = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false));

const PAGES = [
  { id: 'main', label: 'YapCord' },
  { id: 'plugins', label: 'Plugins' },
  { id: 'alwayson', label: 'Always-on' },
  { id: 'themes', label: 'Themes' },
  { id: 'layout', label: 'Layout', hiddenOnPhone: true },
  { id: 'backup', label: 'Backup & Restore', appOnly: true },
  { id: 'updater', label: 'Updater', appOnly: true },
];

const Ui = (YM.settingsUi = { page: null, restartNeeded: false });
let unsub = [];

function clearSubs() {
  unsub.forEach((fn) => {
    try { fn(); } catch (_) {  }
  });
  unsub = [];
}

const btn = (label, onClick, extra = '') => h('button', { class: 'ym-btn ' + extra, type: 'button', onClick }, label);

function toggleRow(title, hint, checked, onChange) {
  return h('label', { class: 'toggle-row' },
    h('div', {}, h('div', { class: 'toggle-label' }, title), hint ? h('div', { class: 'hint' }, hint) : null),
    h('input', { type: 'checkbox', class: 'switch', checked: !!checked, onChange: (e) => onChange(e.target.checked) }));
}

function section(title, ...children) {
  return h('div', { class: 'ym-section' }, h('h3', {}, title), ...children);
}

function callout(tone, ...children) {
  return h('div', { class: 'ym-callout ym-callout-' + tone }, children);
}

function humanize(key) {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
}

function fillRange(input, min, max) {
  const pct = max > min ? ((Number(input.value) - min) / (max - min)) * 100 : 0;
  input.style.setProperty('--ym-pct', Math.max(0, Math.min(100, Math.round(pct * 100) / 100)) + '%');
}

function optionControl(plugin, key, def) {
  const st = plugin.settings;
  const title = def.description || humanize(key);
  const value = st.store[key];
  switch (def.type) {
    case 'boolean':
      return toggleRow(title, def.hint, value, (v) => st.set(key, v));
    case 'select':
      return h('div', { class: 'ym-opt' }, h('div', { class: 'toggle-label' }, title),
        h('select', { class: 'ym-input', onChange: (e) => {
          const opt = def.options[e.target.selectedIndex];
          st.set(key, opt.value);
        } }, def.options.map((o) => h('option', { value: String(o.value), selected: o.value === value }, o.label))));
    case 'number':
    case 'slider': {
      const isRange = def.type === 'slider';
      const input = h('input', { class: isRange ? 'ym-input ym-range' : 'ym-input', type: isRange ? 'range' : 'number', min: def.min, max: def.max, step: def.step, value: String(value ?? ''),
        onInput: isRange ? (e) => fillRange(e.target, Number(def.min), Number(def.max)) : null,
        onChange: (e) => {
          const raw = String(e.target.value).trim();
          if (raw === '') {
            st.set(key, def.default);
            e.target.value = String(def.default ?? '');
            if (isRange) fillRange(e.target, Number(def.min), Number(def.max));
            return;
          }
          let n = Number(raw);
          if (!Number.isFinite(n)) return;
          if (typeof def.min === 'number') n = Math.max(def.min, n);
          if (typeof def.max === 'number') n = Math.min(def.max, n);
          st.set(key, n);
          if (String(n) !== raw) e.target.value = String(n);
          if (isRange) fillRange(e.target, Number(def.min), Number(def.max));
        } });
      if (isRange) fillRange(input, Number(def.min), Number(def.max));
      return h('div', { class: 'ym-opt' }, h('div', { class: 'toggle-label' }, title), input);
    }
    case 'string':
      return h('div', { class: 'ym-opt' }, h('div', { class: 'toggle-label' }, title),
        h('input', { class: 'ym-input', type: 'text', value: String(value ?? ''), spellcheck: 'false',
          onChange: (e) => st.set(key, e.target.value) }));
    case 'custom': {
      const box = h('div', { class: 'ym-opt ym-custom' });
      try { def.render(box, plugin); } catch (err) { box.textContent = 'Could not render this option: ' + err.message; }
      return box;
    }
    default:
      return null;
  }
}

function tagHue(text) {
  let n = 0;
  for (const c of String(text)) n = (n * 31 + c.charCodeAt(0)) % 360;
  return n;
}

function showPluginInfo(plugin) {
  YM.modal.open({
    title: plugin.name,
    subtitle: plugin.tags.length ? plugin.tags.join(' · ') : undefined,
    body: [h('p', {}, plugin.description || 'No description.')],
  });
}

function pluginCard(plugin, expanded, onToggleExpand) {
  const running = YM.plugins.isRunning(plugin.name);
  const err = YM.plugins.errors.get(plugin.name);
  const optionKeys = Object.keys(plugin.options);
  return h('div', { class: 'ym-card' + (running ? ' on' : ''), style: { '--hue': String(tagHue(plugin.tags[0] || plugin.name)) } },
    h('div', { class: 'ym-card-head' },
      h('span', { class: 'ym-glyph', 'aria-hidden': 'true' }, plugin.name.charAt(0).toUpperCase()),
      h('div', { class: 'ym-card-title' },
        h('b', {}, plugin.name),
        plugin.tags.length ? h('span', { class: 'ym-tags' }, plugin.tags.map((t) => h('i', {}, t))) : null),
      h('button', { class: 'ym-info-btn', type: 'button', title: 'About ' + plugin.name, 'aria-label': 'About ' + plugin.name, onClick: () => showPluginInfo(plugin) }, 'ⓘ'),
      h('input', { type: 'checkbox', class: 'switch', 'aria-label': 'Enable ' + plugin.name, checked: YM.plugins.isEnabled(plugin.name),
        onChange: (e) => YM.plugins.requestEnabled(plugin.name, e.target.checked) })),
    h('div', { class: 'ym-card-desc' }, plugin.description || ''),
    err ? h('div', { class: 'ym-error' }, 'Failed to start: ' + (err && err.message ? err.message : String(err))) : null,
    optionKeys.length ? h('div', { class: 'ym-card-foot ym-card-foot-end' },
      btn(expanded ? 'Hide options' : 'Options', onToggleExpand, 'ym-btn-small ym-btn-ghost')) : null,
    expanded ? h('div', { class: 'ym-options' }, optionKeys.map((k) => optionControl(plugin, k, plugin.options[k])),
      btn('Reset to defaults', () => { plugin.settings.resetAll(); onToggleExpand(); onToggleExpand(); }, 'ym-btn-small ym-btn-ghost')) : null);
}

Ui.markRestartNeeded = () => {
  Ui.restartNeeded = true;
  YM.Events.emit('ui:restart-needed');
};

function restartBanner() {
  const el = h('div', { class: 'ym-restart', role: 'alert' },
    h('b', {}, 'Restart required'),
    h('span', {}, "Plugin changes take effect after you reload - nothing has changed yet (you stay logged in)."),
    h('button', { class: 'ym-restart-btn', type: 'button', onClick: () => YM.native.app.reload() }, 'Reload'));
  const sync = () => { el.hidden = !Ui.restartNeeded; };
  sync();
  unsub.push(YM.Events.on('ui:restart-needed', sync));
  return el;
}

function banner() {
  return h('div', { class: 'ym-banner' },
    h('div', { class: 'ym-banner-text' },
      h('b', {}, 'YapCord'),
      h('span', {}, 'An unofficial mod for Yapper - plugins, themes and Custom CSS, inspired by Vencord.')));
}

function quickActions() {
  const items = [
    { label: 'Edit Custom CSS', onClick: () => activate('quickcss') },
    { label: 'Reload YapCord', onClick: () => YM.native.app.reload() },
    { label: 'Open Settings Folder', onClick: () => YM.native.openPath('data') },
    { label: 'Open Themes Folder', onClick: () => YM.native.openPath('themes') },
  ];
  return h('div', { class: 'ym-qa-grid' }, items.map((it) => h('button', { class: 'ym-qaction-btn', type: 'button', onClick: it.onClick }, it.label)));
}

function pageMain(root) {
  const w = (k, d) => YM.settings.get('window.' + k, d);
  const set = (k) => (v) => YM.settings.set('window.' + k, v);

  const settingsRows = [
    toggleRow('Enable Custom CSS', 'Applies your Custom CSS (see "Edit Custom CSS" above) on top of everything else.', YM.settings.get('useQuickCss', true), (v) => YM.settings.set('useQuickCss', v)),
  ];

  if (YM.inApp && YM.official) {
    settingsRows.push(
      h('p', { class: 'hint' }, 'YapCord is running inside the official Yapper app, so there is just one app and you stay logged in.'),
      h('p', { class: 'hint' }, 'Window, tray icon, "Start with Windows", updates and the screen picker are handled by Yapper itself. Your YapCord settings and themes are stored in the YapCord folder and shared with the stand-alone YapCord app.'),
      h('p', { class: 'hint' }, 'After a Yapper update YapCord can be gone from the app. Run the installer\'s "Reinstall / Repair" again to put it back.'));
  } else if (YM.inApp) {
    settingsRows.push(
      toggleRow('Close to tray', 'The close button hides the window; quit from the tray icon.', w('closeToTray', false), set('closeToTray')),
      toggleRow('Start with Windows', 'Launches YapCord when you sign in.', w('autoStart', false), set('autoStart')),
      toggleRow('Start minimized', 'Only applies together with "Start with Windows".', w('startMinimized', false), set('startMinimized')),
      toggleRow('Spell checking', 'Underline misspelled words in the message box.', w('spellcheck', true), set('spellcheck')),
      toggleRow('Hardware acceleration', 'Turn off if you see graphical glitches. Needs a restart.', w('hardwareAcceleration', true), set('hardwareAcceleration')),
      toggleRow('Allow developer tools', 'Ctrl+Shift+I opens DevTools.', w('devTools', true), set('devTools')),
      toggleRow("Use YapCord's file dialog", "Makes the + button next to the message box (and other upload buttons) open Windows' own file dialog. Turn off to use the browser's file chooser.", w('ownFilePicker', true), set('ownFilePicker')),
      h('div', { class: 'ym-toolbar', style: { marginTop: '6px' } },
        btn('DevTools', () => YM.native.app.devtools(), 'ym-btn-ghost ym-btn-small'),
        btn('Quit', () => YM.native.app.quit(), 'ym-btn-danger ym-btn-small')));
  } else {
    settingsRows.push(h('p', { class: 'hint' }, 'Window, tray, startup and file-dialog settings only apply to the YapCord desktop app.'));
  }

  root.append(
    h('div', { class: 'ym-page-head' }, h('h2', {}, 'YapCord')),
    restartBanner(),
    banner(),
    h('h3', {}, 'Quick Actions'),
    quickActions(),
    h('h3', {}, 'Settings'),
    ...settingsRows);

}

function pagePlugins(root) {
  const expanded = new Set();
  let query = '';
  let filter = 'all';
  let tag = '';
  const list = h('div', { class: 'ym-list ym-grid' });
  const summary = h('span', { class: 'ym-summary' });
  const chips = h('div', { class: 'ym-chips', role: 'group', 'aria-label': 'Categories' });
  const seg = h('div', { class: 'ym-seg', role: 'group', 'aria-label': 'Show' });
  const segBtns = [['all', 'All'], ['on', 'On'], ['off', 'Off']].map(([v, label]) => h('button', { type: 'button', class: 'ym-seg-btn', 'data-v': v, onClick: () => { filter = v; draw(); } }, label));
  seg.append(...segBtns);
  const drawChips = () => {
    const counts = new Map();
    for (const p of YM.plugins.list()) if (!p.alwaysOn) for (const t of p.tags) counts.set(t, (counts.get(t) || 0) + 1);
    chips.replaceChildren(...[...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t, n]) =>
      h('button', { type: 'button', class: 'ym-chip-btn' + (tag === t ? ' on' : ''), style: { '--hue': String(tagHue(t)) }, 'aria-pressed': tag === t ? 'true' : 'false', onClick: () => { tag = tag === t ? '' : t; draw(); } }, t, h('em', {}, String(n)))));
  };
  const draw = () => {
    list.replaceChildren();
    const q = query.trim().toLowerCase();
    const all = YM.plugins.list().filter((p) => !p.alwaysOn);
    const items = all.filter((p) => {
      if (filter === 'on' && !YM.plugins.isEnabled(p.name)) return false;
      if (filter === 'off' && YM.plugins.isEnabled(p.name)) return false;
      if (tag && !p.tags.includes(tag)) return false;
      return !q || (p.name + ' ' + p.description + ' ' + p.tags.join(' ')).toLowerCase().includes(q);
    }).sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
    const on = all.filter((p) => YM.plugins.isEnabled(p.name)).length;
    summary.textContent = on + ' of ' + all.length + ' switched on';
    segBtns.forEach((b) => b.classList.toggle('on', b.getAttribute('data-v') === filter));
    drawChips();
    if (!items.length) list.append(h('div', { class: 'ym-empty' }, 'Nothing matches. Clear the search or pick another category.'));
    for (const p of items) {
      list.append(pluginCard(p, expanded.has(p.name), () => { expanded.has(p.name) ? expanded.delete(p.name) : expanded.add(p.name); draw(); }));
    }
  };
  root.append(
    h('div', { class: 'ym-page-head' }, h('h2', {}, 'Plugins'), summary),
    restartBanner(),
    callout('info', h('b', {}, 'Plugin Management'),
      h('p', {}, 'Click the ⓘ on a plugin to see what it does.'),
      h('p', {}, 'Plugins with a gear-free "Options" button have settings you can change.'),
      h('p', {}, 'Looking for something that used to be here and isn\'t any more? It may now be always-on - check the "Always-on" page.')),
    h('h3', {}, 'Filters'),
    h('div', { class: 'ym-toolbar' },
      h('input', { class: 'ym-input', type: 'search', placeholder: 'Search plugins', 'aria-label': 'Search plugins', onInput: (e) => { query = e.target.value; draw(); } }),
      seg),
    chips,
    h('h3', {}, 'Plugins'),
    list);
  draw();
  unsub.push(YM.Events.on('plugin:state', () => { if (list.isConnected && !list.querySelector(':focus')) draw(); }));
  unsub.push(YM.Events.on('plugin:error', () => { if (list.isConnected) draw(); }));

  unsub.push(YM.Events.on('plugin:pending', () => { if (list.isConnected && !list.querySelector(':focus')) draw(); }));
}

function alwaysOnCard(plugin, expanded, onToggleExpand) {
  const optionKeys = Object.keys(plugin.options);
  return h('div', { class: 'ym-card on', style: { '--hue': String(tagHue(plugin.tags[0] || plugin.name)) } },
    h('div', { class: 'ym-card-head' },
      h('span', { class: 'ym-glyph', 'aria-hidden': 'true' }, plugin.name.charAt(0).toUpperCase()),
      h('div', { class: 'ym-card-title' },
        h('b', {}, plugin.name),
        plugin.tags.length ? h('span', { class: 'ym-tags' }, plugin.tags.map((t) => h('i', {}, t))) : null),
      h('button', { class: 'ym-info-btn', type: 'button', title: 'About ' + plugin.name, 'aria-label': 'About ' + plugin.name, onClick: () => showPluginInfo(plugin) }, 'ⓘ')),
    h('div', { class: 'ym-card-desc' }, plugin.description || ''),
    h('div', { class: 'ym-card-foot ym-card-foot-end' },
      btn(expanded ? 'Hide options' : 'Options', onToggleExpand, 'ym-btn-small ym-btn-ghost')),
    expanded ? h('div', { class: 'ym-options' }, optionKeys.map((k) => optionControl(plugin, k, plugin.options[k])),
      btn('Reset to defaults', () => { plugin.settings.resetAll(); onToggleExpand(); onToggleExpand(); }, 'ym-btn-small ym-btn-ghost')) : null);
}

function pageAlwaysOn(root) {
  const expanded = new Set();
  let query = '';
  const list = h('div', { class: 'ym-list ym-grid' });
  const summary = h('span', { class: 'ym-summary' });
  const draw = () => {
    list.replaceChildren();
    const q = query.trim().toLowerCase();
    const all = YM.plugins.list().filter((p) => p.alwaysOn && Object.keys(p.options).length);
    const items = all.filter((p) => !q || (p.name + ' ' + p.description + ' ' + p.tags.join(' ')).toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
    summary.textContent = all.length + ' with options';
    if (!items.length) list.append(h('div', { class: 'ym-empty' }, q ? 'Nothing matches. Clear the search.' : 'None of the always-on features have options to set.'));
    for (const p of items) {
      list.append(alwaysOnCard(p, expanded.has(p.name), () => { expanded.has(p.name) ? expanded.delete(p.name) : expanded.add(p.name); draw(); }));
    }
  };
  root.append(
    h('div', { class: 'ym-page-head' }, h('h2', {}, 'Always-on'), summary),
    callout('info', h('b', {}, 'Always-on features'),
      h('p', {}, "These run for everyone, all the time - there's no switch, so they don't appear on the Plugins page. The ones below still have their own options to set.")),
    h('div', { class: 'ym-toolbar' },
      h('input', { class: 'ym-input', type: 'search', placeholder: 'Search', 'aria-label': 'Search always-on features', onInput: (e) => { query = e.target.value; draw(); } })),
    list);
  draw();
}

function pageThemes(root) {
  let sub = 'local';
  const tabs = h('div', { class: 'ym-subtabs', role: 'tablist' });
  const body = h('div', {});
  let localList = null;

  function syncTabs() {
    [...tabs.children].forEach((b) => b.classList.toggle('on', b.dataset.sub === sub));
  }

  function localThemesTab() {
    const list = (localList = h('div', { class: 'ym-list' }));
    const drawList = () => {
      list.replaceChildren();
      const themes = YM.themes.available;
      if (!themes.length) list.append(h('div', { class: 'ym-empty' }, 'No themes yet. Add a .css or .theme.css file.'));
      for (const t of themes) {
        list.append(h('div', { class: 'ym-card' },
          h('div', { class: 'ym-card-head' },
            h('div', { class: 'ym-card-title' }, h('b', {}, t.name), t.version ? h('span', { class: 'ym-tags' }, 'v' + t.version) : null),
            h('input', { type: 'checkbox', class: 'switch', 'aria-label': 'Enable ' + t.name, checked: YM.themes.isEnabled(t.fileName),
              onChange: (e) => { if (YM.themes.previewing === t.fileName) YM.themes.stopPreview(); YM.themes.setEnabled(t.fileName, e.target.checked); drawList(); } })),
          t.description ? h('div', { class: 'ym-card-desc' }, t.description) : null,
          h('div', { class: 'ym-card-foot' }, h('span', { class: 'ym-hint' }, 'by ' + (t.author || 'Unknown') + ' · ' + t.fileName),
            h('div', { class: 'ym-toolbar' },
              btn(YM.themes.previewing === t.fileName ? 'Stop preview' : 'Preview', async () => {
                if (YM.themes.previewing === t.fileName) YM.themes.stopPreview();
                else await YM.themes.previewTheme(t.fileName);
                drawList();
              }, 'ym-btn-small ym-btn-ghost'),
              btn('Share...', async () => {
                const ok = await YM.themes.share(t.fileName);
                if (ok) YM.toast('Saved ' + t.fileName + '.');
              }, 'ym-btn-small ym-btn-ghost'),
              btn('Remove', async () => { if (confirm('Delete ' + t.fileName + '?')) { await YM.themes.remove(t.fileName); } }, 'ym-btn-small ym-btn-danger')))));
      }
    };
    drawList();
    unsub.push(YM.Events.on('themes:list', () => { if (list.isConnected) drawList(); }));
    return [
      callout('warn', h('b', {}, 'Theme Performance'), h('p', {}, "Themes and Custom CSS can affect performance. If you notice lag, try turning your themes and Custom CSS off to see if they're the cause.")),
      callout('info', h('b', {}, 'Find Themes'), h('p', {}, 'Themes are plain CSS files (Vencord .theme.css format). Search GitHub for "vencord theme" or "discord theme css", download the .css file, then use "Add theme file" below.')),
      h('h3', {}, 'Local Themes'),
      h('div', { class: 'ym-toolbar' },
        btn('Add theme file', async () => { try { await YM.themes.importFile(); drawList(); } catch (e) { YM.toast('Could not add theme: ' + e.message, { type: 'error' }); } }),
        btn('Open themes folder', () => YM.native.openPath('themes'), 'ym-btn-ghost'),
        btn('Reload list', async () => { await YM.themes.refresh(); drawList(); }, 'ym-btn-ghost'),
        btn('Edit Custom CSS', () => activate('quickcss'), 'ym-btn-ghost')),
      list,
    ];
  }

  function onlineThemesTab() {
    const input = h('textarea', { class: 'ym-input ym-code', spellcheck: 'false', rows: 14, placeholder: 'https://example.com/theme.css' });
    input.value = (YM.settings.get('themeLinks', []) || []).join('\n');
    const status = h('span', { class: 'ym-hint' }, '');
    const normUrl = (u) => {
      try {
        const x = new URL(String(u).trim());
        return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : null;
      } catch (_) {
        return null;
      }
    };
    const save = YM.util.debounce(() => {
      const rawLines = input.value.split('\n').map((s) => s.trim()).filter(Boolean);
      const desired = new Set();
      let invalid = 0;
      for (const line of rawLines) {
        const n = normUrl(line);
        if (!n) { invalid++; continue; }
        desired.add(n);
        if (!(YM.settings.get('themeLinks', []) || []).includes(n)) YM.themes.addLink(n);
      }
      for (const url of YM.settings.get('themeLinks', []) || []) {
        if (!desired.has(url)) YM.themes.removeLink(url);
      }
      status.textContent = invalid ? invalid + ' line' + (invalid === 1 ? '' : 's') + ' ignored (not a valid http(s) link)' : 'Saved';
    }, 500);
    input.addEventListener('input', () => { status.textContent = 'Saving...'; save(); });
    return [
      callout('warn', h('b', {}, 'Theme Performance'), h('p', {}, "Themes and Custom CSS can affect performance. If you notice lag, try turning your themes and Custom CSS off to see if they're the cause.")),
      callout('warn', h('p', {}, 'This section is for advanced users. If you are having difficulties using it, use the Local Themes tab instead.')),
      callout('info', h('b', {}, 'Paste links to css files here'), h('p', {}, 'One link per line. Use a direct link to the raw CSS file (e.g. a GitHub raw link).')),
      h('h3', {}, 'Online Themes'),
      h('div', { class: 'ym-toolbar' }, status),
      input,
    ];
  }

  function draw() {
    fill(body, sub === 'local' ? localThemesTab() : onlineThemesTab());
  }
  tabs.append(
    h('button', { type: 'button', class: 'ym-subtab', dataset: { sub: 'local' }, onClick: () => { sub = 'local'; syncTabs(); draw(); } }, 'Local Themes'),
    h('button', { type: 'button', class: 'ym-subtab', dataset: { sub: 'online' }, onClick: () => { sub = 'online'; syncTabs(); draw(); } }, 'Online Themes'));
  syncTabs();
  root.append(h('h2', {}, 'Themes'), tabs, body);
  draw();
  unsub.push(() => YM.themes.stopPreview());
}

async function pageQuickCss(root) {
  const ta = h('textarea', { class: 'ym-input ym-code', spellcheck: 'false', rows: 18, placeholder: '/* Your CSS runs on top of every theme. */' });
  const status = h('span', { class: 'ym-hint' }, '');
  ta.value = await YM.themes.getQuickCss();
  const save = YM.util.debounce(async () => { await YM.themes.setQuickCss(ta.value); status.textContent = 'Saved'; }, 400);
  ta.addEventListener('input', () => { status.textContent = 'Saving...'; save(); });
  root.append(
    h('h2', {}, 'Custom CSS'),
    toggleRow('Enable Custom CSS', 'Applied last, so it wins over themes.', YM.settings.get('useQuickCss', true), (v) => YM.settings.set('useQuickCss', v)),
    h('div', { class: 'ym-toolbar' }, status, btn('Open file', () => YM.native.openPath('data'), 'ym-btn-ghost ym-btn-small')),
    ta);
  unsub.push(YM.native.quickCss.onChange((css) => { if (document.activeElement !== ta && css !== ta.value) ta.value = css; }));
}

function pageLayout(root) {
  const L = YM.layout;
  const body = h('div', { class: 'ym-layout' });
  const PRESETS = [
    { label: 'Original', order: ['rail', 'sidebar', 'main'] },
    { label: 'Servers on the right', order: ['sidebar', 'main', 'rail'] },
    { label: 'Mirrored', order: ['main', 'sidebar', 'rail'] },
    { label: 'Channels on the right', order: ['rail', 'main', 'sidebar'] },
  ];
  const SLIDERS = [
    { key: 'railIcon', title: 'Server icon size', suffix: ' px' },
    { key: 'sidebarWidth', title: 'Channel / DM list width', suffix: ' px' },
    { key: 'avatarSize', title: 'Message avatar size', suffix: ' px' },
    { key: 'chatText', title: 'Chat text size', suffix: ' %' },
    { key: 'messageGap', title: 'Space between messages', suffix: ' %' },
    { key: 'zoom', title: 'Whole app size (zoom)', suffix: ' %', appOnly: true },
  ];
  let dragFrom = null;
  const draw = () => {
    const c = L.get();
    const tiles = c.order.map((part, i) => h('div', {
      class: 'ym-lay-tile ym-lay-' + part,
      draggable: true,
      onDragStart: (e) => { dragFrom = part; try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', part); } catch (_) {} e.currentTarget.classList.add('ym-lay-dragging'); },
      onDragEnd: (e) => { e.currentTarget.classList.remove('ym-lay-dragging'); dragFrom = null; body.querySelectorAll('.ym-lay-over').forEach((n) => n.classList.remove('ym-lay-over')); },
      onDragOver: (e) => { if (!dragFrom || dragFrom === part) return; e.preventDefault(); e.currentTarget.classList.add('ym-lay-over'); },
      onDragLeave: (e) => e.currentTarget.classList.remove('ym-lay-over'),
      onDrop: (e) => {
        e.preventDefault();
        e.currentTarget.classList.remove('ym-lay-over');
        if (!dragFrom || dragFrom === part) return;
        const order = [...c.order];
        order.splice(order.indexOf(dragFrom), 1);
        order.splice(order.indexOf(part), 0, dragFrom);
        dragFrom = null;
        L.set('order', order);
        draw();
      },
    },
      h('span', { class: 'ym-lay-handle', 'aria-hidden': 'true', title: 'Drag to reorder' }, '⠿'),
      h('b', {}, L.PART_NAMES[part]),
      h('div', { class: 'ym-lay-arrows' },
        h('button', { class: 'ym-btn ym-btn-small ym-btn-ghost', type: 'button', title: 'Move left', 'aria-label': 'Move ' + L.PART_NAMES[part] + ' left', disabled: i === 0, onClick: () => { L.move(part, -1); draw(); } }, '◀'),
        h('button', { class: 'ym-btn ym-btn-small ym-btn-ghost', type: 'button', title: 'Move right', 'aria-label': 'Move ' + L.PART_NAMES[part] + ' right', disabled: i === c.order.length - 1, onClick: () => { L.move(part, 1); draw(); } }, '▶'))));
    fill(body,
      h('p', { class: 'hint' }, "Put the parts of Yapper where you want them and change their size. Changes show right away. Nothing of Yapper itself is changed - this is all CSS layered on top - so Reset brings back YapCord's own default layout (a wider channel/DM list, not Yapper's bare, un-modded one). On a narrow window Yapper keeps its own one-column layout."),
      h('h3', {}, 'Order (left to right)'),
      h('p', { class: 'hint' }, 'Drag a tile by its ⠿ handle to reorder, or use the arrows.'),
      h('div', { class: 'ym-lay-row' }, tiles),
      h('div', { class: 'ym-toolbar' }, PRESETS.map((p) => btn(p.label, () => { L.set('order', p.order); draw(); }, 'ym-btn-small ym-btn-ghost'))),
      h('h3', {}, 'Sizes'),
      SLIDERS.filter((d) => !d.appOnly || (YM.native && YM.native.ui)).map((d) => {
        const [min, max] = L.LIMITS[d.key];
        const out = h('span', { class: 'ym-lay-val' }, c[d.key] + d.suffix);
        const input = h('input', { class: 'ym-range', type: 'range', min, max, step: 1, value: String(c[d.key]), 'aria-label': d.title,
          onInput: (e) => { out.textContent = e.target.value + d.suffix; L.set(d.key, Number(e.target.value)); fillRange(e.target, min, max); } });
        fillRange(input, min, max);
        return h('div', { class: 'ym-opt' }, h('div', { class: 'ym-lay-head' }, h('div', { class: 'toggle-label' }, d.title), out), input);
      }),
      h('div', { class: 'ym-toolbar' }, btn('Reset layout', () => { L.reset(); draw(); }, 'ym-btn-danger')));
  };
  draw();
  root.append(h('h2', {}, 'Layout'), body);
  unsub.push(YM.Events.on('layout:change', () => { if (!body.contains(document.activeElement)) draw(); }));
}

function updaterStatusText(s) {
  if (!s) return 'Checking...';
  switch (s.phase) {
    case 'unconfigured': return 'No update repository is set yet.';
    case 'checking': return 'Checking for updates...';
    case 'downloading': return 'Downloading ' + s.latest + '...';
    case 'available': return 'YapCord ' + s.latest + ' is available (you have ' + s.current + ').';
    case 'ready': return 'YapCord ' + s.latest + ' is ready - it starts the next time you open Yapper.';
    case 'uptodate': return 'You are on the latest version (' + s.current + ').';
    case 'error': return 'Could not check for updates: ' + s.error;
    default: return 'Not checked yet (you have ' + s.current + ').';
  }
}

function pageUpdater(root) {
  const U = YM.native.updater;
  root.append(h('div', { class: 'ym-page-head' }, h('h2', {}, 'Updater')));
  if (!U) { root.append(callout('warn', h('p', {}, 'The updater only runs inside the YapCord desktop app - there is nothing to check or install here.'))); return; }

  const status = h('div', { class: 'ym-updater-status' }, 'Loading...');
  const notes = h('div', { class: 'hint ym-updater-notes', hidden: true });
  const actions = h('div', { class: 'ym-toolbar' });
  const repoInput = h('input', { class: 'ym-input', type: 'text', placeholder: 'owner/repo (e.g. tariksabanuz/YapCord-Windows)', spellcheck: 'false', value: YM.settings.get('updater.repo', ''),
    onChange: (e) => { YM.settings.set('updater.repo', e.target.value.trim()); YM.toast('Update repository saved.', { type: 'success' }); } });

  function render(s) {
    status.textContent = updaterStatusText(s);
    notes.hidden = !(s && s.notes);
    if (s && s.notes) notes.textContent = s.notes;
    const items = [];
    items.push(h('button', { class: 'ym-btn ym-btn-small', type: 'button', disabled: !!(s && (s.phase === 'checking' || s.phase === 'downloading')), onClick: () => U.check() }, 'Check for updates'));
    if (s && s.phase === 'ready') {
      items.push(btn('Restart now', () => YM.native.app.relaunch(), 'ym-btn-small'));
    } else if (s && s.phase === 'available') {
      if (s.canInstall) items.push(btn('Update now', () => U.install(), 'ym-btn-small'));
      else if (s.url) items.push(btn('Open release page', () => YM.native.openExternal(s.url), 'ym-btn-small'));
    }
    fill(actions, items);
  }

  U.state().then(render).catch(() => render(null));
  unsub.push(U.onState(render));

  root.append(
    status,
    notes,
    actions,
    h('h3', {}, 'Settings'),
    h('div', { class: 'ym-opt' },
      h('div', { class: 'toggle-label' }, 'Update repository'),
      h('div', { class: 'hint' }, 'A public GitHub repository, as owner/repo. YapCord looks at its latest release (or, without one, package.json on the default branch) for a newer version. Left blank, it defaults to the right repo for this platform on its own (YapCord-Windows, YapCord-Linux or YapCord-MacOS).'),
      repoInput),
    toggleRow('Automatically check for updates', 'Checks in the background every few hours and, if something newer is out, lets you know - it never downloads or installs anything by itself. Off by default; use "Check for updates" above any time instead, then "Update now" to actually install a found update.', YM.settings.get('updater.auto', false), (v) => YM.settings.set('updater.auto', v)),
    toggleRow('Notify me when an update is ready', 'Shows a toast once a downloaded update is ready to use.', YM.settings.get('updater.notify', true), (v) => YM.settings.set('updater.notify', v)));
}

Ui.announceUpdates = (U) => {
  let toldAvailable = null;
  let toldReady = null;
  return U.onState((s) => {
    if (!s || !s.latest) return;
    if (YM.settings.get('updater.notify', true) === false) return;
    if (s.phase === 'ready' && toldReady !== s.latest) {
      toldReady = s.latest;
      const t = YM.toast('YapCord ' + s.latest + ' is ready. It starts the next time you open Yapper.', { type: 'success', duration: 15000 });
      if (s.canInstall) t.append(h('button', { class: 'ym-toast-btn', type: 'button', onClick: () => YM.native.app.relaunch() }, 'Restart now'));
    } else if (s.phase === 'available' && toldAvailable !== s.latest) {
      // Notify-only: a background check that finds something newer tells you about it here and stops -
      // it never downloads or runs anything until you click one of these buttons yourself.
      toldAvailable = s.latest;
      const t = YM.toast('YapCord ' + s.latest + ' is available (you have ' + s.current + ').', { type: 'info', duration: 15000 });
      if (s.canInstall) t.append(h('button', { class: 'ym-toast-btn', type: 'button', onClick: () => U.install() }, 'Update now'));
      else if (s.url) t.append(h('button', { class: 'ym-toast-btn', type: 'button', onClick: () => YM.native.openExternal(s.url) }, 'Open release page'));
    }
  });
};
YM.Events.on('boot:ready', () => { if (YM.native && YM.native.updater) Ui.announceUpdates(YM.native.updater); });

function pageBackup(root) {
  root.append(
    h('h2', {}, 'Backup & Restore'),
    callout('warn', h('b', {}, 'Warning'), h('p', {}, 'Importing a settings file will overwrite your current settings.')),
    h('p', {}, 'You can import and export your YapCord settings as a JSON file. This lets you move your settings to another device, or recover them after reinstalling YapCord or Yapper.'),
    h('p', {}, h('b', {}, 'Settings export contains:')),
    h('ul', { class: 'ym-ul' },
      h('li', {}, 'Plugin settings (on/off and options)'),
      h('li', {}, 'Layout and window settings'),
      h('li', {}, 'Custom CSS'),
      h('li', {}, 'Theme links and your local theme files')),
    h('div', { class: 'ym-toolbar' },
      btn('Import Settings', async () => {
        const r = await YM.native.backup.import();
        if (r && r.ok) { YM.toast('Settings imported. Reloading...', { type: 'success' }); setTimeout(() => YM.native.app.reload(), 700); }
        else if (r && r.reason) YM.toast(r.reason, { type: 'error' });
      }),
      btn('Export Settings', async () => { const r = await YM.native.backup.export(); if (r) YM.toast('Settings exported.', { type: 'success' }); })),
    h('div', { class: 'ym-toolbar' }, btn('Open data folder', () => YM.native.openPath('data'), 'ym-btn-ghost ym-btn-small')));
}

const PROBES = ['nav.rail', '.sidebar', '.app', '.msg[data-message-id]', '.msg-body', '.msg-text', '.msg-actions', '.composer textarea', '.user-bar', '.settings-nav', '.settings-main', '.rail-folder', '.rail-folder-open'];

async function collectDiagnostics() {
  let appInfo = null;
  try { appInfo = await YM.native.app.info(); } catch (_) {  }
  const st = YM.Store.isReady ? YM.Store.getState() : null;
  return {
    generatedAt: new Date().toISOString(),
    yapcord: YM.version,
    inApp: YM.inApp,
    userAgent: navigator.userAgent,
    app: appInfo,
    hooks: {
      turbopack: YM.finder.stats(),
      storeReady: YM.Store.isReady,
      storeKeys: st ? Object.keys(st) : null,
      liveModuleFound: !!(YM.Store.isReady && YM.finder.findLoaded(['markRead', 'sendMessage'])),
      websockets: { opened: YM.net.wsOpened, framesIn: YM.net.wsIn, framesOut: YM.net.wsOut, open: [...YM.net.sockets].map((s) => s.url) },
      fetchCalls: YM.net.fetchCalls,
      media: { notificationsSeen: YM.media.notificationsSeen, notificationsBlocked: YM.media.notificationsBlocked, soundsSeen: YM.media.soundsSeen, soundsBlocked: YM.media.soundsBlocked },
      folders: YM.folders.list().length,
    },
    dom: Object.fromEntries(PROBES.map((s) => [s, document.querySelectorAll(s).length])),
    plugins: YM.plugins.list().map((p) => ({ name: p.name, enabled: YM.plugins.isEnabled(p.name), running: YM.plugins.isRunning(p.name), error: YM.plugins.errors.get(p.name) ? String(YM.plugins.errors.get(p.name).message || YM.plugins.errors.get(p.name)) : null, options: p.settings.store && Object.fromEntries(Object.keys(p.options).map((k) => [k, p.settings.store[k]])) })),
    patches: YM.patches.report(),
    themes: { available: YM.themes.available.map((t) => t.fileName), enabled: YM.settings.get('enabledThemes', []), links: YM.settings.get('themeLinks', []).length },
    log: YM.log.recent(),
  };
}
YM.diagnostics = collectDiagnostics;

const RENDER = { main: pageMain, plugins: pagePlugins, alwayson: pageAlwaysOn, themes: pageThemes, quickcss: pageQuickCss, layout: pageLayout, backup: pageBackup, updater: pageUpdater };
YM.uiPages = RENDER;

function currentSettingsEl() {
  return document.querySelector('.settings');
}

function deactivate() {
  const s = currentSettingsEl();
  clearSubs();
  Ui.page = null;
  if (!s) return;
  s.classList.remove('ym-active');
  s.querySelectorAll('.ym-panel').forEach((p) => p.remove());
  s.querySelectorAll('.ym-nav-btn.active').forEach((b) => b.classList.remove('active'));
}

async function activate(page) {
  const s = currentSettingsEl();
  const main = s && s.querySelector('.settings-main');
  if (!s || !main || !RENDER[page]) return;
  clearSubs();
  s.querySelectorAll('.ym-panel').forEach((p) => p.remove());
  s.classList.add('ym-active');
  s.querySelectorAll('.ym-nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.ymPage === page));
  const panel = h('div', { class: 'ym-panel' });
  main.append(panel);
  Ui.page = page;
  try {
    await RENDER[page](panel);
  } catch (err) {
    YM.log.error('settings page failed', page, err);
    panel.append(h('div', { class: 'ym-error' }, 'This page failed to load: ' + err.message));
  }
}

function injectNav(nav) {
  if (nav.querySelector('.ym-nav-label')) return;
  nav.append(h('div', { class: 'settings-nav-label ym-nav-label', style: { marginTop: '14px' } }, 'YapCord Settings'));
  for (const p of PAGES) {
    if (p.appOnly && !YM.inApp) continue;
    if (p.hiddenOnPhone && YM.mode === 'bookmarklet') continue;
    nav.append(h('button', { class: 'ym-nav-btn', type: 'button', dataset: { ymPage: p.id }, onClick: () => activate(p.id) }, p.label));
  }

  nav.addEventListener('click', (e) => {
    const b = e.target instanceof Element ? e.target.closest('button') : null;
    if (b && !b.classList.contains('ym-nav-btn')) deactivate();
  }, true);
  if (Ui.pending) {
    const page = Ui.pending;
    Ui.pending = null;
    activate(page);
  }
}

YM.dom.watch('.settings-nav', injectNav);

Ui.open = async function open(page) {
  Ui.pending = RENDER[page] ? page : 'main';
  if (document.querySelector('.settings-nav')) {
    const p = Ui.pending;
    Ui.pending = null;
    return activate(p);
  }
  try {
    await YM.Store.ready;
    YM.Store.openSettings();
  } catch (err) {
    YM.log.error('could not open settings', err);
  }
};

const PUZZLE = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19.4 11H18V8a2 2 0 0 0-2-2h-3V4.6a2.6 2.6 0 0 0-5.2 0V6H4a2 2 0 0 0-2 2v3h1.4a2.6 2.6 0 0 1 0 5.2H2V19a2 2 0 0 0 2 2h3v-1.4a2.6 2.6 0 0 1 5.2 0V21h3a2 2 0 0 0 2-2v-3h1.4a2.6 2.6 0 0 0 0-5.2z"/></svg>';
YM.dom.watch('.user-bar', (bar) => {
  if (bar.querySelector('.ym-userbar-btn')) return;
  const gear = bar.querySelector('button[aria-label="Settings"]');
  const b = h('button', { class: 'icon-btn ym-userbar-btn', type: 'button', title: 'YapCord', 'aria-label': 'YapCord', html: PUZZLE, onClick: () => Ui.open('main') });
  if (gear) gear.before(b);
  else bar.append(b);
});
YM.dom.onMutate(() => {
  document.querySelectorAll('.user-bar').forEach((bar) => {
    if (!bar.querySelector('.ym-userbar-btn')) {
      const gear = bar.querySelector('button[aria-label="Settings"]');
      if (gear) gear.before(h('button', { class: 'icon-btn ym-userbar-btn', type: 'button', title: 'YapCord', 'aria-label': 'YapCord', html: PUZZLE, onClick: () => Ui.open('main') }));
    }
  });
});

YM.dom.css.set('settings-ui', `
/* Two earlier, narrower attempts at even spacing in the user-bar both missed the actual cause: Yapper gives
   each of its own bar children its own individually-tuned margin (not a plain flex gap, confirmed by
   IdleVoiceControls' own comment on why it had to hand-add a 14px margin to its mic pair just to get a gap
   next to the avatar at all) - and the previous version of this rule only reset margins on direct <button>
   children, never touching that mic pair's <span> wrapper, so the new gap it added just stacked on top of
   that existing 14px instead of replacing it, pushing mic/headphone further out than before. The only way to
   get one true, even gap between every icon - avatar, mic pair, deafen pair, puzzle, gear, logout alike, no
   matter what element type each one is - is to zero out every one of their margins, whoever set them, and
   let a single flex gap on the bar be the only thing spacing them. The selector below (the class doubled,
   not !important stacking) outranks any single-class selector elsewhere, so it wins regardless of which
   stylesheet loaded last. */
.user-bar.user-bar{display:flex!important;align-items:center!important;gap:8px!important}
.user-bar.user-bar>*{margin:0!important}
.settings.ym-active .settings-main>:not(.ym-panel){display:none!important}
.settings.ym-active .settings-nav button.active:not(.ym-nav-btn){background:transparent;color:var(--text-muted)}
.ym-panel h2{margin:0 0 12px;font-size:20px}
.ym-panel h3{margin:18px 0 8px;font-size:14px;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted)}
.ym-panel p{margin:0 0 10px}
.ym-hint{color:var(--text-muted);font-size:12px}
.ym-toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:10px 0}
.ym-toolbar .ym-input{flex:1;min-width:160px}
.ym-input{background:var(--bg-input);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:8px 10px;font:inherit;min-width:0}
.ym-input:focus{outline:2px solid var(--accent-soft);border-color:var(--accent)}
.ym-narrow{flex:0 0 auto!important;min-width:110px!important}
.ym-code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12.5px;width:100%;box-sizing:border-box;resize:vertical}
.ym-pre{white-space:pre-wrap;overflow:auto;max-height:46vh;padding:10px;background:var(--bg-input);border-radius:8px;border:1px solid var(--border)}
.ym-btn{background:var(--accent);color:var(--on-accent);border-radius:8px;padding:8px 14px;font-weight:600;font-size:13px;cursor:pointer}
.ym-btn:hover{background:var(--accent-hover)}
.ym-btn-ghost{background:var(--bg-elev);color:var(--text)}.ym-btn-ghost:hover{background:var(--bg-hover)}
.ym-btn-danger{background:color-mix(in srgb,var(--danger) 85%,#000)}.ym-btn-danger:hover{background:var(--danger)}
.ym-btn-small{padding:5px 10px;font-size:12px}
.ym-list{display:flex;flex-direction:column;gap:10px;margin:10px 0}
.ym-card{background:var(--bg-elev);border:1px solid var(--border);border-radius:10px;padding:12px 14px}
.ym-card.on{border-color:color-mix(in srgb,var(--success) 45%,var(--border))}
.ym-card-row{display:flex;justify-content:space-between;align-items:center;gap:10px}
.ym-card-row code{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ym-card-head{display:flex;justify-content:space-between;align-items:center;gap:10px}
.ym-card-title{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}
.ym-tags{font-size:11px;color:var(--text-faint)}
.ym-card-desc{margin:6px 0 8px;color:var(--text-muted);font-size:13px;line-height:1.4}
.ym-card-foot{display:flex;justify-content:space-between;align-items:center;gap:8px}
.ym-card-foot-end{justify-content:flex-end}
.ym-options{margin-top:10px;border-top:1px solid var(--border);padding-top:6px;display:flex;flex-direction:column;gap:2px}
.ym-opt{display:flex;flex-direction:column;gap:6px;padding:8px 0;border-bottom:1px solid var(--border)}
.ym-custom{flex-direction:row;align-items:center;gap:10px;flex-wrap:wrap}
.ym-empty{padding:18px;text-align:center;color:var(--text-muted)}
.ym-error{margin:6px 0;padding:8px 10px;border-radius:8px;background:color-mix(in srgb,var(--danger) 18%,transparent);color:var(--danger);font-size:12.5px}
.ym-nav-btn{white-space:nowrap}
.ym-restart{display:flex;flex-direction:column;gap:6px;margin:0 0 14px;padding:14px 16px;border-radius:10px;border:1px solid #f0a020;background:#352c20;color:#f2f3f5}
.ym-restart[hidden]{display:none}
.ym-restart b{font-size:15px}
.ym-restart span{font-size:13px;margin-bottom:6px}
.ym-restart-btn{border-radius:8px;padding:10px 14px;background:#ffc96b;color:#fff;font-weight:700;font-size:14px;cursor:pointer;text-align:center}
.ym-restart-btn:hover{background:#ffd689}
.ym-lay-row{display:flex;gap:8px;margin:8px 0}
.ym-lay-tile{flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;gap:8px;padding:12px 8px;border-radius:10px;background:var(--bg-elev);border:1px solid var(--border);text-align:center;cursor:grab;transition:transform 120ms ease-out,box-shadow 120ms ease-out,border-color 120ms ease-out}
.ym-lay-tile:active{cursor:grabbing}
.ym-lay-tile.ym-lay-dragging{opacity:.4}
.ym-lay-tile.ym-lay-over{border-color:var(--accent);box-shadow:0 0 0 2px color-mix(in srgb,var(--accent) 45%,transparent);transform:scale(1.02)}
.ym-lay-handle{color:var(--text-faint,#8b8d99);font-size:16px;line-height:1;letter-spacing:-2px;user-select:none}
.ym-lay-rail{flex:.6}.ym-lay-sidebar{flex:.9}.ym-lay-main{flex:2}
.ym-lay-arrows{display:flex;gap:6px}.ym-lay-arrows .ym-btn[disabled]{opacity:.35;cursor:default}
.ym-lay-head{display:flex;justify-content:space-between;align-items:center;gap:10px}.ym-lay-val{color:var(--text-muted);font-size:12px;font-variant-numeric:tabular-nums}
.ym-range{--ym-pct:0%;width:100%;height:6px;margin:4px 0;-webkit-appearance:none;appearance:none;background:transparent;cursor:pointer;outline:none}
.ym-range::-webkit-slider-runnable-track{height:6px;border-radius:999px;background:linear-gradient(to right,var(--accent,#5865f2) var(--ym-pct),var(--bg-elev,rgba(255,255,255,.12)) var(--ym-pct))}
.ym-range::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:15px;height:15px;margin-top:-4.5px;border-radius:50%;background:var(--accent,#5865f2);border:2px solid var(--bg-main,#1e1f24);box-shadow:0 1px 3px rgba(0,0,0,.4)}
.ym-range::-moz-range-track{height:6px;border-radius:999px;background:var(--bg-elev,rgba(255,255,255,.12))}
.ym-range::-moz-range-progress{height:6px;border-radius:999px 0 0 999px;background:var(--accent,#5865f2)}
.ym-range::-moz-range-thumb{width:15px;height:15px;border-radius:50%;background:var(--accent,#5865f2);border:2px solid var(--bg-main,#1e1f24);box-shadow:0 1px 3px rgba(0,0,0,.4)}
.ym-range:focus-visible::-webkit-slider-thumb{box-shadow:0 0 0 3px color-mix(in srgb,var(--accent,#5865f2) 40%,transparent)}
.ym-range:focus-visible::-moz-range-thumb{box-shadow:0 0 0 3px color-mix(in srgb,var(--accent,#5865f2) 40%,transparent)}
.ym-updater-status{font-size:15px;font-weight:600;margin:4px 0 8px}
.ym-icon-row{display:flex;flex-direction:column;gap:6px;width:100%}
.ym-toast-btn{margin-left:10px;padding:4px 10px;border-radius:7px;background:var(--accent,#5865f2);color:var(--on-accent,#fff);font-weight:700;font-size:12px;cursor:pointer}

.ym-panel{--r:12px}
.ym-page-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:10px}
.ym-page-head h2{margin:0;font-size:22px;letter-spacing:-.01em}
.ym-summary{color:var(--text-muted);font-size:13px}
.ym-seg{display:inline-flex;padding:3px;border-radius:10px;background:var(--bg-input);border:1px solid var(--border);flex:none}
.ym-seg-btn{padding:5px 14px;border-radius:7px;font-size:13px;font-weight:600;color:var(--text-muted);cursor:pointer;background:transparent;transition:background .15s,color .15s}
.ym-seg-btn:hover{color:var(--text)}
.ym-seg-btn.on{background:var(--accent);color:var(--on-accent)}
.ym-chips{display:flex;flex-wrap:wrap;gap:6px;margin:2px 0 12px}
.ym-chip-btn{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;font-size:12px;font-weight:600;cursor:pointer;color:var(--text);background:color-mix(in srgb,hsl(var(--hue) 70% 55%) 12%,var(--bg-elev));border:1px solid color-mix(in srgb,hsl(var(--hue) 70% 55%) 30%,transparent);transition:transform .12s,background .15s}
.ym-chip-btn em{font-style:normal;color:var(--text-muted);font-weight:500}
.ym-chip-btn:hover{transform:translateY(-1px)}
.ym-chip-btn.on{background:hsl(var(--hue) 65% 48%);color:#fff;border-color:transparent}.ym-chip-btn.on em{color:#ffffffc0}
.ym-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px;align-items:start}
.ym-grid .ym-empty{grid-column:1/-1}
.ym-card{--hue:220;position:relative;border-radius:var(--r);padding:14px 14px 12px 16px;overflow:hidden;transition:border-color .2s,box-shadow .2s}
.ym-card::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:hsl(var(--hue) 65% 55%);opacity:.35;transition:opacity .2s}
.ym-card.on::before{opacity:1}
.ym-card.on{border-color:var(--border);box-shadow:0 0 0 1px color-mix(in srgb,hsl(var(--hue) 65% 55%) 35%,transparent)}
.ym-card-head{align-items:flex-start}
.ym-glyph{flex:none;width:34px;height:34px;border-radius:10px;display:grid;place-items:center;font-weight:800;font-size:15px;color:hsl(var(--hue) 80% 82%);background:linear-gradient(145deg,hsl(var(--hue) 55% 32%),hsl(var(--hue) 60% 22%))}
.ym-card-title{flex:1;gap:4px;padding-top:1px}
.ym-card-title b{font-size:14.5px;overflow:hidden;text-overflow:ellipsis}
.ym-tags{display:flex;flex-wrap:wrap;gap:4px}
.ym-tags i{font-style:normal;font-size:11px;padding:1px 7px;border-radius:999px;background:var(--bg-input);color:var(--text-muted)}
.ym-card-desc{margin:10px 0 8px;line-height:1.45}
.ym-options{border-top:1px dashed var(--border)}
.ym-opt{border-bottom:0;padding:9px 0}
.ym-btn{border-radius:9px;transition:background .15s,transform .08s}
.ym-btn:active{transform:translateY(1px)}
.ym-btn:focus-visible,.ym-seg-btn:focus-visible,.ym-chip-btn:focus-visible,.ym-info-btn:focus-visible,.ym-subtab:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.ym-input{border-radius:10px}
.ym-restart{border-radius:var(--r)}

.ym-info-btn{flex:none;width:24px;height:24px;border-radius:50%;background:var(--bg-input);color:var(--text-muted);font-size:14px;line-height:1;display:grid;place-items:center;cursor:pointer;transition:background .15s,color .15s}
.ym-info-btn:hover{background:var(--bg-hover);color:var(--text)}

.ym-callout{display:flex;flex-direction:column;gap:4px;padding:12px 14px;border-radius:10px;margin:0 0 10px;font-size:13px;line-height:1.45}
.ym-callout p{margin:0}
.ym-callout-info{background:color-mix(in srgb,var(--accent) 10%,var(--bg-elev));border:1px solid color-mix(in srgb,var(--accent) 25%,var(--border))}
.ym-callout-warn{background:color-mix(in srgb,#f0a020 16%,var(--bg-elev));border:1px solid color-mix(in srgb,#f0a020 40%,var(--border));color:#f2f3f5}

.ym-banner{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:18px 20px;border-radius:14px;margin:0 0 16px;background:linear-gradient(135deg,color-mix(in srgb,var(--accent) 28%,var(--bg-elev)),var(--bg-elev) 65%);border:1px solid color-mix(in srgb,var(--accent) 30%,var(--border))}
.ym-banner-text{display:flex;flex-direction:column;gap:4px;min-width:0}
.ym-banner-text b{font-size:17px}
.ym-banner-text span{font-size:12.5px;color:var(--text-muted);max-width:46ch}
.ym-banner-btn{flex:none;white-space:nowrap}

.ym-qa-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin:0 0 6px}
.ym-qaction-btn{background:var(--bg-elev);border:1px solid var(--border);color:var(--text);border-radius:10px;padding:12px;font-weight:600;font-size:13px;text-align:left;cursor:pointer;transition:background .15s,border-color .15s}
.ym-qaction-btn:hover{background:var(--bg-hover);border-color:color-mix(in srgb,var(--accent) 40%,var(--border))}

.ym-subtabs{display:flex;gap:4px;margin:2px 0 14px;border-bottom:1px solid var(--border)}
.ym-subtab{padding:8px 4px;margin-right:16px;background:transparent;color:var(--text-muted);font-weight:600;font-size:13.5px;cursor:pointer;border-bottom:2px solid transparent;transition:color .15s,border-color .15s}
.ym-subtab:hover{color:var(--text)}
.ym-subtab.on{color:var(--text);border-bottom-color:var(--accent)}

.ym-ul{margin:0 0 10px;padding-left:20px}
.ym-ul li{margin:2px 0}

@media (prefers-reduced-motion:reduce){.ym-card,.ym-card::before,.ym-btn,.ym-chip-btn,.ym-seg-btn,.ym-info-btn,.ym-subtab{transition:none}}
`);
