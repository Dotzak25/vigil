import { Store } from '../core/store.js';
import { findItemArrays, suggestFields, extractItems, pathToString } from '../core/extract.js';
import { identify, toTemplate, pickTemplate, templateKey, templateHealth } from '../core/registry.js';
import { describeGeometry, toMinimap } from '../core/seats.js';
import { formatPrice } from '../core/money.js';
import { FORMATS, formatLabel } from '../catalog/vocab.js';

const $ = (id) => document.getElementById(id);

const state = {
  recordingTabId: null,
  pageUrl: null,
  profile: null,
  capture: null,
  payload: null,
  candidates: [],
  spec: { itemsPath: [], fields: {} },
  geometry: { numbering: 'sequential', rowOrder: 'front-first' },
  rules: [],
  templateKey: null,
  templates: [],
  templateHealthMap: {},
};

/**
 * Load whatever's in the shared template feed (cached in the background,
 * refetched on a slow TTL). Almost always empty right now — the feed itself
 * doesn't exist yet — and that's fine; everything below degrades cleanly to
 * today's fully-manual flow when there's nothing to match against.
 */
async function loadTemplates() {
  const res = await chrome.runtime.sendMessage({ type: 'vigil:getTemplates' });
  state.templates = res?.templates || [];
  state.templateHealthMap = res?.health || {};
}

function say(msg, kind = 'good') {
  const b = $('banner');
  b.className = kind;
  b.textContent = msg;
  if (kind === 'good') setTimeout(() => (b.className = ''), 4500);
}

const esc = (s) => String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]);

/* ---------- profile ---------- */

function applyProfile(url) {
  state.pageUrl = url;
  const p = identify(url);
  state.profile = p;

  if (p.seat) state.geometry = { numbering: p.seat.numbering, rowOrder: p.seat.rowOrder };
  if (!state.rules.length && p.rules?.length) state.rules = JSON.parse(JSON.stringify(p.rules));

  const box = $('profile');
  box.hidden = false;
  box.textContent = '';

  const dot = document.createElement('div');
  dot.className = 'flagdot';
  if (!p.known) dot.style.background = 'var(--muted)';

  const mid = document.createElement('div');
  const nm = document.createElement('div');
  nm.className = 'pname';
  nm.textContent = p.known ? p.name : `${p.name} — not in the catalogue yet`;

  const meta = document.createElement('div');
  meta.className = 'pmeta';
  meta.textContent = [
    p.kind,
    p.country || (p.countries?.[0] === '*' ? 'worldwide' : null),
    p.currency,
    p.seat ? `${p.seat.numbering} seat numbering` : null,
    p.rtl ? 'RTL' : null,
  ].filter(Boolean).join(' · ');

  mid.append(nm, meta);
  box.append(dot, mid);

  if (p.notes) {
    const n = document.createElement('div');
    n.className = 'pmeta right';
    n.style.maxWidth = '38ch';
    n.style.textAlign = 'right';
    n.textContent = p.notes;
    box.appendChild(n);
  }

  renderRules();
}

/* ---------- step 1: record ---------- */

async function loadTabs() {
  const tabs = await chrome.tabs.query({});
  const sel = $('tabs');
  sel.textContent = '';
  for (const t of tabs) {
    if (!/^https?:/.test(t.url || '')) continue;
    const o = document.createElement('option');
    o.value = t.id;
    o.dataset.url = t.url;
    o.textContent = (t.title || t.url).slice(0, 72);
    sel.appendChild(o);
  }
  const preset = new URLSearchParams(location.search).get('record');
  if (preset && [...sel.options].some((o) => o.value === preset)) sel.value = preset;
  onTabChange();
}

function onTabChange() {
  const opt = $('tabs').selectedOptions[0];
  if (opt?.dataset.url) applyProfile(opt.dataset.url);
}

$('tabs').addEventListener('change', onTabChange);

$('rec').addEventListener('click', async () => {
  const tabId = Number($('tabs').value);
  if (!tabId) return say('Pick a tab first.', 'err');
  state.recordingTabId = tabId;
  await chrome.runtime.sendMessage({ type: 'vigil:startRecording', tabId });
  $('rec').disabled = true;
  $('stop').disabled = false;
  say('Recording. Switch to that tab, load the seats or the product, then come back and stop.');
  chrome.tabs.update(tabId, { active: true });
});

$('stop').addEventListener('click', async () => {
  const res = await chrome.runtime.sendMessage({ type: 'vigil:stopRecording', tabId: state.recordingTabId });
  $('rec').disabled = false;
  $('stop').disabled = true;
  renderCaptures(res?.captures || []);
});

/* ---------- step 2: rank and pick ---------- */

function renderCaptures(caps) {
  const box = $('caps');
  box.textContent = '';

  const scored = caps
    .map((c) => {
      try {
        const payload = JSON.parse(c.body);
        const cands = findItemArrays(payload);
        const match = pickTemplate(state.templates, c);
        return { cap: c, payload, cands, score: cands[0]?.score || 0, match };
      } catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) {
    box.innerHTML =
      '<div class="empty">No JSON responses captured. Some sites render seats on the server — reload the page while recording and make sure the map actually redrew.</div>';
    return;
  }

  // A confident, non-broken template match is the whole point of the feed:
  // the thousandth person on a site presses one button instead of mapping
  // ten fields by hand. It's surfaced above the ranked list, never in place
  // of it — recording still happens (this device's cookies and the concrete
  // URL are only available by watching the page), only the setup work after
  // it is skipped.
  const templated = scored.find((s) => s.match && s.match.confidence >= 0.75);
  if (templated) {
    const key = templateKey(templated.match.template);
    const health = templateHealth(state.templateHealthMap[key]);
    if (health.state !== 'broken') {
      const card = document.createElement('div');
      card.className = 'cap tmpl';
      card.style.borderColor = 'var(--signal)';
      card.innerHTML = `<div class="u">Shared template found — ${esc(templated.match.template.chainName || 'this site')}</div>
        <div class="m">Field mapping, seat numbering and default rules come pre-filled. Health: ${esc(health.label)}. You can still adjust anything below.</div>`;
      const btn = document.createElement('button');
      btn.className = 'primary';
      btn.style.marginTop = '6px';
      btn.textContent = 'Apply template';
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        chooseCapture(templated, templated.match.template);
      });
      card.appendChild(btn);
      box.appendChild(card);
    }
  }

  for (const s of scored) {
    const el = document.createElement('div');
    el.className = 'cap';
    const top = s.cands[0];
    el.innerHTML = `<div class="u">${esc(s.cap.method)} ${esc(s.cap.url.slice(0, 130))}</div>
      <div class="m">${top ? `${top.length} items at ${esc(pathToString(top.path))} · ${esc(top.tags.join(', ')) || 'no strong signals'}` : 'no list-shaped data'}</div>`;
    el.addEventListener('click', () => {
      [...box.children].forEach((c) => c.classList.remove('sel'));
      el.classList.add('sel');
      chooseCapture(s);
    });
    box.appendChild(el);
  }
  box.querySelector('.cap:not(.tmpl)')?.click();
}

function chooseCapture(s, template = null) {
  state.capture = s.cap;
  state.payload = s.payload;
  state.candidates = s.cands;
  if (s.cap.pageUrl) applyProfile(s.cap.pageUrl);

  if (template) {
    state.templateKey = templateKey(template);
    state.spec = {
      ...template.spec,
      countryHint: state.profile?.country,
      defaultCurrency: state.profile?.currency,
    };
    if (template.seat) state.geometry = { ...template.seat };
    if (template.rules?.length) state.rules = JSON.parse(JSON.stringify(template.rules));
    say(`Applied the shared template for ${template.chainName || 'this site'}.`);
  } else {
    state.templateKey = null;
    const top = s.cands[0];
    state.spec = {
      itemsPath: top?.path || [],
      fields: suggestFields(top?.sample || {}),
      invertAvailable: false,
      countryHint: state.profile?.country,
      defaultCurrency: state.profile?.currency,
    };
  }

  if (!$('name').value) $('name').value = (s.cap.title || state.profile?.name || 'Watch').slice(0, 60);
  if (!$('openUrl').value) $('openUrl').value = s.cap.pageUrl || '';
  renderMapping();
  renderRules();
}

/* ---------- step 3: mapping + geometry ---------- */

const FIELDS = [
  ['id', 'Unique id'], ['label', 'Label'], ['available', 'Availability'], ['price', 'Price'],
  ['row', 'Row'], ['col', 'Seat / column'], ['x', 'Physical x (if present)'],
  ['section', 'Section'], ['size', 'Size / variant'], ['url', 'Link'],
];

function renderMapping() {
  const box = $('mapping');
  box.textContent = '';
  if (!state.payload) return;

  const pathLabel = document.createElement('label');
  pathLabel.innerHTML = '<span class="lab">Item list</span>';
  const sel = document.createElement('select');
  state.candidates.forEach((c, i) => {
    const o = document.createElement('option');
    o.value = i;
    o.textContent = `${pathToString(c.path)} — ${c.length} items (${c.keys.slice(0, 5).join(', ')})`;
    sel.appendChild(o);
  });
  sel.addEventListener('change', () => {
    const c = state.candidates[Number(sel.value)];
    state.spec.itemsPath = c.path;
    state.spec.fields = suggestFields(c.sample);
    renderMapping();
  });
  pathLabel.appendChild(sel);
  box.appendChild(pathLabel);

  const cand = state.candidates.find((c) => pathToString(c.path) === pathToString(state.spec.itemsPath));
  const keys = cand?.keys || [];

  const grid = document.createElement('div');
  grid.className = 'grid3';
  grid.style.marginTop = '10px';
  for (const [key, label] of FIELDS) {
    const l = document.createElement('label');
    l.innerHTML = `<span class="lab">${label}</span>`;
    const input = document.createElement('input');
    input.setAttribute('list', 'keylist');
    input.value = state.spec.fields[key] || '';
    input.placeholder = '—';
    input.addEventListener('input', () => {
      state.spec.fields[key] = input.value.trim();
      renderPreview();
    });
    l.appendChild(input);
    grid.appendChild(l);
  }
  box.appendChild(grid);

  const dl = document.createElement('datalist');
  dl.id = 'keylist';
  for (const k of keys) {
    const o = document.createElement('option');
    o.value = k;
    dl.appendChild(o);
  }
  box.appendChild(dl);

  const inv = document.createElement('label');
  inv.className = 'row';
  inv.style.cssText = 'gap:6px;margin-top:10px';
  inv.innerHTML = '<input type="checkbox" style="width:auto" /> <span class="muted">That field means <em>taken</em>, not available — flip it</span>';
  inv.querySelector('input').checked = !!state.spec.invertAvailable;
  inv.querySelector('input').addEventListener('change', (e) => {
    state.spec.invertAvailable = e.target.checked;
    renderPreview();
  });
  box.appendChild(inv);

  // Seat numbering. This cannot be auto-detected from labels — {1..20} is
  // identical under both conventions — so the minimap below is the check.
  const geo = document.createElement('div');
  geo.className = 'grid2';
  geo.style.marginTop = '10px';
  geo.innerHTML = `
    <label><span class="lab">Seat numbering</span>
      <select id="numbering">
        <option value="sequential">Sequential — 1,2,3 across the row</option>
        <option value="centerout">Centre-out — …5,3,1 | 2,4,6…</option>
      </select></label>
    <label><span class="lab">Row A is</span>
      <select id="rowOrder">
        <option value="front-first">Closest to the screen</option>
        <option value="back-first">Furthest from the screen</option>
      </select></label>`;
  box.appendChild(geo);
  $('numbering').value = state.geometry.numbering === 'auto' ? 'sequential' : state.geometry.numbering;
  $('rowOrder').value = state.geometry.rowOrder === 'auto' ? 'front-first' : state.geometry.rowOrder;
  $('numbering').addEventListener('change', (e) => { state.geometry.numbering = e.target.value; renderPreview(); });
  $('rowOrder').addEventListener('change', (e) => { state.geometry.rowOrder = e.target.value; renderPreview(); });

  const note = document.createElement('p');
  note.id = 'geoNote';
  box.appendChild(note);

  const preview = document.createElement('div');
  preview.id = 'preview';
  preview.style.marginTop = '12px';
  box.appendChild(preview);

  renderPreview();
}

function renderPreview() {
  const box = $('preview');
  if (!box) return;
  const items = extractItems(state.payload, state.spec);

  const open = items.filter((i) => i.available === true).length;
  const unknown = items.filter((i) => i.available === null).length;

  const desc = describeGeometry(items, state.geometry);
  const note = $('geoNote');
  if (note) note.textContent = desc.message;

  box.textContent = '';

  const head = document.createElement('p');
  head.className = 'muted';
  head.style.margin = '0 0 8px';
  head.textContent = `${items.length} items · ${open} available · ${unknown} unreadable`;
  box.appendChild(head);

  // The picture is the verification. If the shape doesn't look like the room,
  // the numbering setting is wrong — and that's visible in one glance.
  const mm = toMinimap(items, [], state.geometry);
  if (mm) {
    const wrap = document.createElement('div');
    wrap.className = 'minimap';
    wrap.style.alignItems = 'flex-start';
    const screen = document.createElement('div');
    screen.className = 'screen';
    screen.style.width = '100%';
    wrap.appendChild(screen);
    const CLS = { '!': 'hit', o: 'open', x: '', '.': 'gap' };
    for (const line of mm.rows.slice(0, 30)) {
      const row = document.createElement('div');
      row.className = 'mrow';
      for (const ch of line) {
        const cell = document.createElement('div');
        cell.className = `cell ${CLS[ch] || ''}`.trim();
        row.appendChild(cell);
      }
      wrap.appendChild(row);
    }
    box.appendChild(wrap);
  }

  const table = document.createElement('table');
  table.innerHTML = '<thead><tr><th>id</th><th>label</th><th>avail</th><th>price</th><th>row</th><th>seat</th></tr></thead>';
  const tb = document.createElement('tbody');
  for (const it of items.slice(0, 6)) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${esc(it.id)}</td><td>${esc(it.label).slice(0, 30)}</td>
      <td class="${it.available === true ? 'ok' : 'no'}">${it.status ?? '?'}</td>
      <td>${it.price ? esc(formatPrice(it.price)) : '—'}</td>
      <td>${esc(it.meta.row ?? '—')}</td><td>${esc(it.meta.col ?? '—')}</td>`;
    tb.appendChild(tr);
  }
  table.appendChild(tb);
  box.appendChild(table);

  if (items.length && unknown === items.length) {
    const warn = document.createElement('p');
    warn.style.color = 'var(--bad)';
    warn.textContent =
      'Availability is unreadable for every item, so nothing can fire. Point the availability field at another key, or tick the flip box.';
    box.appendChild(warn);
  }
}

/* ---------- step 4: rules ---------- */

const RULE_UI = {
  seat_block: [
    ['partySize', 'Seats together', 'number', 2],
    ['minScore', 'Minimum score (0–100)', 'number', 70],
    ['profile', 'Auditorium', 'select', 'standard', ['standard', 'imax', 'premium']],
  ],
  restock: [['match', 'Only if label matches (regex, optional)', 'text', '']],
  new_item: [['match', 'Only if label matches (regex, optional)', 'text', '']],
  format_added: [],
  price_below: [['value', 'Alert under', 'number', 100]],
  price_drop: [
    ['pct', 'Drop of at least (%)', 'number', 20],
    ['windowDays', 'vs median over (days)', 'number', 30],
  ],
};

const RULE_NAME = {
  seat_block: 'Adjacent seats open up', restock: 'Back in stock',
  new_item: 'New listing or showtime', format_added: 'A specific format is added',
  price_below: 'Price below a number', price_drop: 'Price drop vs median',
};

$('addRule').addEventListener('click', () => {
  const type = $('ruleType').value;
  const rule = { type };
  for (const [k, , , def] of RULE_UI[type]) rule[k] = def;
  if (type === 'format_added') rule.formats = ['imax70'];
  state.rules.push(rule);
  renderRules();
});

function renderRules() {
  const box = $('rules');
  box.textContent = '';

  if (!state.rules.length) {
    box.innerHTML = '<div class="empty">No rules yet — add at least one, or the watch will never speak.</div>';
    return;
  }

  state.rules.forEach((rule, i) => {
    const el = document.createElement('div');
    el.className = 'rulebox';

    const head = document.createElement('div');
    head.className = 'row';
    head.style.marginBottom = '8px';
    const t = document.createElement('strong');
    t.textContent = RULE_NAME[rule.type] || rule.type;
    const rm = document.createElement('button');
    rm.className = 'ghost danger right';
    rm.textContent = 'Remove';
    rm.addEventListener('click', () => { state.rules.splice(i, 1); renderRules(); });
    head.append(t, rm);
    el.appendChild(head);

    if (rule.type === 'format_added') {
      const grid = document.createElement('div');
      grid.className = 'fmtgrid';
      const offered = state.profile?.formats?.length
        ? FORMATS.filter((f) => state.profile.formats.includes(f.id))
        : FORMATS.filter((f) => f.premium);
      rule.formats = rule.formats || [];
      for (const f of offered) {
        const l = document.createElement('label');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = rule.formats.includes(f.id);
        cb.addEventListener('change', () => {
          rule.formats = cb.checked
            ? [...rule.formats, f.id]
            : rule.formats.filter((x) => x !== f.id);
        });
        l.append(cb, document.createTextNode(formatLabel(f.id)));
        grid.appendChild(l);
      }
      el.appendChild(grid);
      if (state.profile?.formats?.length) {
        const hint = document.createElement('p');
        hint.className = 'muted';
        hint.style.cssText = 'font-size:11px;margin:8px 0 0';
        hint.textContent = `Formats ${state.profile.name} is known to run.`;
        el.appendChild(hint);
      }
      box.appendChild(el);
      return;
    }

    const grid = document.createElement('div');
    grid.className = 'grid3';
    for (const [key, label, kind, , opts] of RULE_UI[rule.type] || []) {
      const l = document.createElement('label');
      l.innerHTML = `<span class="lab">${label}</span>`;
      let input;
      if (kind === 'select') {
        input = document.createElement('select');
        for (const o of opts) {
          const opt = document.createElement('option');
          opt.value = o; opt.textContent = o;
          input.appendChild(opt);
        }
      } else {
        input = document.createElement('input');
        input.type = kind;
      }
      input.value = rule[key] ?? '';
      input.addEventListener('input', () => {
        rule[key] = kind === 'number' ? Number(input.value) : input.value;
      });
      l.appendChild(input);
      grid.appendChild(l);
    }
    el.appendChild(grid);

    if (rule.type === 'price_below' || rule.type === 'price_drop') {
      const c = document.createElement('p');
      c.className = 'muted';
      c.style.cssText = 'font-size:11px;margin:8px 0 0';
      c.textContent = state.profile?.currency
        ? `Compared in ${state.profile.currency}. Prices in another currency are never compared against this.`
        : 'Prices are only ever compared within the same currency.';
      el.appendChild(c);
    }
    box.appendChild(el);
  });
}

/* ---------- step 5: save ---------- */

function buildWatcher() {
  return {
    id: crypto.randomUUID(),
    name: $('name').value.trim(),
    enabled: true,
    intervalMin: Math.max(1, Number($('interval').value) || 5),
    openUrl: $('openUrl').value.trim() || state.capture.pageUrl,
    profile: state.profile
      ? { id: state.profile.id, name: state.profile.name, kind: state.profile.kind,
          country: state.profile.country, currency: state.profile.currency }
      : null,
    geometry: { ...state.geometry },
    request: {
      url: state.capture.url, method: state.capture.method,
      headers: state.capture.headers, requestBody: state.capture.requestBody,
      pageUrl: state.capture.pageUrl,
    },
    spec: state.spec,
    rules: state.rules,
    templateKey: state.templateKey || null,
    nextRunAt: Date.now(),
    createdAt: Date.now(),
  };
}

$('save').addEventListener('click', async () => {
  if (!state.capture) return say('Record and pick a request first.', 'err');
  if (!state.rules.length) return say('Add at least one rule.', 'err');
  if (!$('name').value.trim()) return say('Give the watch a name.', 'err');

  const w = buildWatcher();
  await Store.saveWatcher(w);
  say(`Saved “${w.name}”. Arm VIGIL from the toolbar to start checking.`);
  renderWatchers();
});

$('test').addEventListener('click', async () => {
  if (!state.capture) return say('Record and pick a request first.', 'err');
  const res = await chrome.runtime.sendMessage({
    type: 'vigil:testRequest',
    request: { url: state.capture.url, method: state.capture.method,
      headers: state.capture.headers, requestBody: state.capture.requestBody },
  });
  if (!res?.ok) return say(`Replay failed: ${res?.error}`, 'err');
  const items = extractItems(res.payload, state.spec);
  say(`Replay worked — ${items.length} items, ${items.filter((i) => i.available === true).length} available right now.`);
});

$('exportT').addEventListener('click', async () => {
  if (!state.capture) return say('Record and pick a request first.', 'err');
  const t = toTemplate(buildWatcher(), state.profile);
  await navigator.clipboard.writeText(JSON.stringify(t, null, 2));
  say('Template copied to clipboard — no cookies, tokens or account ids in it.');
});

/* ---------- saved watches ---------- */

async function renderWatchers() {
  const box = $('wlist');
  box.textContent = '';
  const all = Object.values(await Store.watchers());
  if (!all.length) { box.innerHTML = '<div class="empty">No saved watches.</div>'; return; }

  for (const w of all) {
    const el = document.createElement('div');
    el.className = 'watch';
    const mid = document.createElement('div');
    mid.style.flex = '1';
    mid.innerHTML = `<div><strong>${esc(w.name)}</strong> <span class="muted" style="font-size:11px">${esc(w.profile?.name || '')}</span></div>
      <div class="muted num" style="font-size:11px">every ${w.intervalMin}m · ${w.rules.length} rule(s) · ${w.itemCount ?? '—'} items${
        w.lastError ? ` · <span style="color:var(--bad)">${esc(w.lastError).slice(0, 60)}</span>` : ''}</div>`;

    const toggle = document.createElement('button');
    toggle.className = 'ghost';
    toggle.textContent = w.enabled === false ? 'Enable' : 'Pause';
    toggle.addEventListener('click', async () => {
      await Store.saveWatcher({ ...w, enabled: w.enabled === false });
      renderWatchers();
    });

    const del = document.createElement('button');
    del.className = 'ghost danger';
    del.textContent = 'Delete';
    del.addEventListener('click', async () => { await Store.deleteWatcher(w.id); renderWatchers(); });

    el.append(mid, toggle, del);
    box.appendChild(el);
  }
}

/* ---------- settings ---------- */

async function renderSettings() {
  const s = await Store.settings();
  $('sInterval').value = s.defaultIntervalMin;
  $('sQuiet').checked = s.quietHours.enabled;
  $('sFrom').value = s.quietHours.from;
  $('sTo').value = s.quietHours.to;
  $('sSound').checked = s.sound;

  const save = async () => {
    await Store.saveSettings({
      defaultIntervalMin: Math.max(1, Number($('sInterval').value) || 5),
      sound: $('sSound').checked,
      quietHours: { enabled: $('sQuiet').checked, from: Number($('sFrom').value) || 0, to: Number($('sTo').value) || 0 },
    });
  };
  ['sInterval', 'sQuiet', 'sFrom', 'sTo', 'sSound'].forEach((id) => $(id).addEventListener('change', save));
}

loadTemplates();
loadTabs();
renderRules();
renderWatchers();
renderSettings();
