import { Store } from '../core/store.js';
import { findItemArrays, suggestFields, extractItems, pathToString, parseFieldPath, getPath, suggestAnchor } from '../core/extract.js';
import { identify, toTemplate, pickTemplate, templateKey, templateHealth } from '../core/registry.js';
import { describeGeometry, toMinimap } from '../core/seats.js';
import { formatPrice } from '../core/money.js';
import { FORMATS, formatLabel } from '../catalog/vocab.js';
import { isPlausibleWebhookUrl } from '../core/webhook.js';

const $ = (id) => document.getElementById(id);

function defaultState() {
  return {
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
    allUnreadable: false,
    // Set while editing an existing saved watcher, so Save updates it in
    // place (same id -> same snap:/hist: keys, so price history and the
    // diff baseline survive) instead of creating a new one.
    editingId: null,
    editingCreatedAt: null,
  };
}

const state = { ...defaultState(), templates: [], templateHealthMap: {} };

/**
 * Clears everything about the CURRENT builder session, without touching the
 * template feed cache. This didn't exist before: after saving one watch, the
 * builder held onto its capture/spec/rules/geometry indefinitely. Recording
 * a second, different site in the same tab session could then either (a)
 * silently save a duplicate of the FIRST watch if the second site's capture
 * list came back empty — state.capture/spec never got replaced — or (b)
 * save the second watch with the first's leftover rules, most dangerously
 * state.rules, which is only ever replaced by applyProfile() when it's
 * currently EMPTY. A cinema's seat_block rule surviving into a sneaker
 * watch means that watch is saved, looks healthy, and can never fire.
 */
function resetBuilderState() {
  Object.assign(state, defaultState());

  $('name').value = '';
  $('interval').value = '5';
  $('openUrl').value = '';
  $('profile').hidden = true;
  $('caps').innerHTML = '<div class="empty">Nothing captured yet.</div>';
  $('mapping').innerHTML = '<div class="empty">Pick a request first.</div>';
  renderRules();
}

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

// A generation token so an earlier "good" message's auto-clear timer can't
// wipe out a LATER message. Without this: Save succeeds (good banner, timer
// armed for 4.5s) -> user changes something and Saves again within that
// window but hits a validation error -> at 4.5s the FIRST timer fires and
// clears the banner (which has `display:none` in its base CSS rule) a
// fraction of a second after the error appeared, so the error is
// effectively invisible.
let bannerGen = 0;

function say(msg, kind = 'good') {
  const gen = ++bannerGen;
  const b = $('banner');
  b.className = kind;
  b.textContent = msg;
  if (kind === 'good') {
    setTimeout(() => {
      if (bannerGen === gen) b.className = '';
    }, 4500);
  }
}

const esc = (s) => String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]);

const hostnameOf = (url) => { try { return new URL(url).hostname; } catch { return null; } };

/* ---------- profile ---------- */

function applyProfile(url) {
  // A genuinely different site being recorded now must not inherit rules or
  // geometry left over from whatever was recorded before in this same
  // builder session. This used to only reset when state.rules happened to
  // already be empty (the `!state.rules.length` guard below) — recording
  // cinema A (seat_block), then switching the tab dropdown to retail site B
  // without saving A first, left seat_block in place because it was never
  // empty. Site B could then be saved with a rule that can never fire
  // against a payload with no row/col data, silently.
  const prevHost = state.pageUrl ? hostnameOf(state.pageUrl) : null;
  const newHost = hostnameOf(url);
  if (prevHost && newHost && prevHost !== newHost) {
    state.rules = [];
    state.geometry = { numbering: 'sequential', rowOrder: 'front-first' };
  }

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

/**
 * Host permission is optional and per-site now (manifest.json), so nothing
 * can inject into or fetch from a domain until the user has explicitly said
 * yes to THIS one. request() only works from a user-gesture handler, which
 * every call site below already is — a button click.
 */
function originPatternOf(url) {
  const u = new URL(url);
  return `${u.protocol}//${u.hostname}/*`;
}

/** @returns {Promise<{granted: boolean, wasAlreadyGranted: boolean}>} */
async function ensurePermissionDetailed(url) {
  const origin = originPatternOf(url);
  if (await chrome.permissions.contains({ origins: [origin] })) return { granted: true, wasAlreadyGranted: true };
  const granted = await chrome.permissions.request({ origins: [origin] });
  return { granted, wasAlreadyGranted: false };
}

async function ensurePermission(url) {
  return (await ensurePermissionDetailed(url)).granted;
}

$('rec').addEventListener('click', async () => {
  const tabId = Number($('tabs').value);
  if (!tabId) return say('Pick a tab first.', 'err');

  const pageUrl = $('tabs').selectedOptions[0]?.dataset.url;
  // Disabled BEFORE any await, not after — otherwise a fast double-click
  // sends two vigil:startRecording messages before either await resolves,
  // each of which wipes the shared capture buffer via Store.clearCaptures().
  $('rec').disabled = true;
  try {
    let justGranted = false;
    if (pageUrl) {
      const { granted, wasAlreadyGranted } = await ensurePermissionDetailed(pageUrl);
      if (!granted) return say('Permission denied for this site — VIGIL can\'t watch it without access to it.', 'err');
      justGranted = !wasAlreadyGranted;
    }

    state.recordingTabId = tabId;
    await chrome.runtime.sendMessage({ type: 'vigil:startRecording', tabId });
    $('stop').disabled = false;

    if (justGranted) {
      // Permission was JUST granted, meaning the content script was only
      // just registered for this origin — the already-loaded page never
      // had it injected, so its own fetch/XHR calls (already fired before
      // now, or about to fire without ever being observed) would go
      // unrecorded. A first-time recording could silently capture nothing
      // at all, with no error, unless the user happened to also manually
      // reload. Force it explicitly instead of just activating the tab.
      say('Permission granted — reloading that tab so recording actually attaches, then watch for the data to load.');
      await chrome.tabs.reload(tabId);
      await chrome.tabs.update(tabId, { active: true });
    } else {
      say('Recording. Switch to that tab, reload the seats or the product, then come back and stop.');
      await chrome.tabs.update(tabId, { active: true });
    }
  } catch (e) {
    $('stop').disabled = true;
    say(`Couldn't start recording: ${e?.message || e}`, 'err');
  } finally {
    $('rec').disabled = false;
  }
});

$('stop').addEventListener('click', async () => {
  $('stop').disabled = true;
  try {
    const res = await chrome.runtime.sendMessage({ type: 'vigil:stopRecording', tabId: state.recordingTabId });
    renderCaptures(res?.captures || []);
  } catch (e) {
    say(`Couldn't stop recording cleanly: ${e?.message || e} — try again, or reload this page.`, 'err');
  } finally {
    $('rec').disabled = false;
  }
});

/* ---------- step 2: rank and pick ---------- */

function renderCaptures(caps) {
  const box = $('caps');
  box.textContent = '';

  // Clear whatever the PREVIOUS pick left in state, unconditionally, before
  // deciding what this new capture list means. Without this: recording a
  // server-rendered site (which captures 0 JSON responses) after already
  // having picked a capture for an earlier site in the same tab session left
  // state.capture pointing at the EARLIER site's request — the empty-state
  // message below was shown, but Save's only guard is `if (!state.capture)`,
  // which was still satisfied by the stale value. The result was a watch
  // that silently polls the wrong site under the name the user gave the one
  // they thought they were setting up.
  state.capture = null;
  state.payload = null;
  state.candidates = [];
  state.spec = { itemsPath: [], fields: {} };
  state.templateKey = null;
  $('mapping').innerHTML = '<div class="empty">Pick a request first.</div>';

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
    // Plain clickable divs with no tabindex/role/keydown handler were
    // completely unreachable by keyboard — a keyboard-only user could not
    // complete step 2 of the wizard at all (Apply template's real <button>
    // was the only reachable control, and only when a template matched).
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    const top = s.cands[0];
    el.innerHTML = `<div class="u">${esc(s.cap.method)} ${esc(s.cap.url.slice(0, 130))}</div>
      <div class="m">${top ? `${top.length} items at ${esc(pathToString(top.path))} · ${esc(top.tags.join(', ')) || 'no strong signals'}` : 'no list-shaped data'}</div>`;
    const pick = () => {
      [...box.children].forEach((c) => c.classList.remove('sel'));
      el.classList.add('sel');
      chooseCapture(s);
    };
    el.addEventListener('click', pick);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); }
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

  // A numeric segment in itemsPath (findItemArrays picks up array indices,
  // e.g. "today's 6th screening") silently drifts to a different item once
  // the underlying list reorders — always computed fresh against THIS
  // capture's own payload, never trusted from a shared template (which may
  // have been recorded against a differently-ordered list).
  state.spec.itemsAnchor = suggestAnchor(state.payload, state.spec.itemsPath);

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
  // Without this, picking candidate #3 correctly updated the field grid and
  // preview for #3, but the dropdown itself snapped back to displaying #0
  // on the very next render (a plain <select> with no explicit .value
  // defaults to its first option) — every reasonable reading of that is
  // "my selection didn't take".
  const currentIndex = state.candidates.findIndex((c) => pathToString(c.path) === pathToString(state.spec.itemsPath));
  sel.value = currentIndex >= 0 ? String(currentIndex) : '0';
  sel.addEventListener('change', () => {
    const c = state.candidates[Number(sel.value)];
    state.spec.itemsPath = c.path;
    state.spec.fields = suggestFields(c.sample);
    state.spec.itemsAnchor = suggestAnchor(state.payload, c.path);
    renderMapping();
  });
  pathLabel.appendChild(sel);
  box.appendChild(pathLabel);

  // Manual fallback: findItemArrays only walks the first 4 elements of any
  // array and stops at depth 8, and never looks inside a 2D grid's outer
  // array at all — real payload shapes exist where none of the auto-found
  // candidates is the right one, and until now there was no way to tell
  // VIGIL "no, it's actually here" short of it being auto-discovered.
  const manualLabel = document.createElement('label');
  manualLabel.style.cssText = 'display:block;margin-top:10px';
  manualLabel.innerHTML = '<span class="lab">Or type the path manually, if the list above missed it</span>';
  const manualInput = document.createElement('input');
  manualInput.placeholder = 'e.g. data.attributes.layout.rows.0.seats';
  manualInput.value = currentIndex === -1 && state.spec.itemsPath?.length ? pathToString(state.spec.itemsPath) : '';
  manualInput.addEventListener('change', () => {
    const path = parseFieldPath(manualInput.value) || [];
    const resolved = getPath(state.payload, path);
    if (!Array.isArray(resolved) || !resolved.length) {
      say('That path doesn\'t resolve to a non-empty list in the captured response.', 'err');
      return;
    }
    const sample = resolved.find((x) => x && typeof x === 'object') || {};
    state.spec.itemsPath = path;
    state.spec.fields = suggestFields(sample);
    state.spec.itemsAnchor = suggestAnchor(state.payload, path);
    renderMapping();
  });
  manualLabel.appendChild(manualInput);
  box.appendChild(manualLabel);

  const cand = state.candidates.find((c) => pathToString(c.path) === pathToString(state.spec.itemsPath));
  const keys = cand?.keys || (Array.isArray(getPath(state.payload, state.spec.itemsPath))
    ? Object.keys(getPath(state.payload, state.spec.itemsPath).find((x) => x && typeof x === 'object') || {})
    : []);

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

  // Tracked on state (not just shown here) so the Save handler can refuse
  // to save a watch that's already provably incapable of ever firing —
  // previously this was a warning only, and a watch whose availability
  // field maps to nothing saved cleanly, reported a healthy itemCount
  // forever, and never once spoke.
  state.allUnreadable = items.length > 0 && unknown === items.length;

  if (state.allUnreadable) {
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
    id: state.editingId || crypto.randomUUID(),
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
    createdAt: state.editingId ? (state.editingCreatedAt || Date.now()) : Date.now(),
  };
}

$('save').addEventListener('click', async () => {
  if (!state.capture) return say('Record and pick a request first.', 'err');
  if (!state.rules.length) return say('Add at least one rule.', 'err');
  if (!$('name').value.trim()) return say('Give the watch a name.', 'err');
  if (state.allUnreadable) {
    return say('Availability is unreadable for every item, so this watch could never fire. Fix the availability field mapping first.', 'err');
  }

  // Disabled before any await — a rapid double-click otherwise enters this
  // handler twice; buildWatcher() mints a fresh UUID each time (unless
  // editing), Store.saveWatcher's read-modify-write on the shared watchers
  // map means the two writes can race, and either way the user sees two
  // "Saved" banners for what looks like one click.
  $('save').disabled = true;
  try {
    // The replay target can be a different host than the page itself (the
    // seat map's API often lives on api.* while the page is on www.*) — the
    // scheduler needs its own permission to fetch that host in the background.
    if (!(await ensurePermission(state.capture.url))) {
      return say('Permission denied for the request VIGIL needs to replay — this watch can\'t run without it.', 'err');
    }

    const w = buildWatcher();
    await Store.saveWatcher(w);
    const wasEditing = !!state.editingId;
    say(wasEditing ? `Updated “${w.name}”.` : `Saved “${w.name}”. Arm VIGIL from the toolbar to start checking.`);
    resetBuilderState();
    renderWatchers();
  } catch (e) {
    say(`Couldn't save: ${e?.message || e}`, 'err');
  } finally {
    $('save').disabled = false;
  }
});

$('test').addEventListener('click', async () => {
  if (!state.capture) return say('Record and pick a request first.', 'err');
  $('test').disabled = true;
  try {
    if (!(await ensurePermission(state.capture.url))) {
      return say('Permission denied for this request.', 'err');
    }
    const res = await chrome.runtime.sendMessage({
      type: 'vigil:testRequest',
      request: { url: state.capture.url, method: state.capture.method,
        headers: state.capture.headers, requestBody: state.capture.requestBody },
    });
    if (!res?.ok) return say(`Replay failed: ${res?.error}`, 'err');
    const items = extractItems(res.payload, state.spec);
    say(`Replay worked — ${items.length} items, ${items.filter((i) => i.available === true).length} available right now.`);
  } catch (e) {
    say(`Couldn't test: ${e?.message || e}`, 'err');
  } finally {
    $('test').disabled = false;
  }
});

$('exportT').addEventListener('click', async () => {
  if (!state.capture) return say('Record and pick a request first.', 'err');
  const t = toTemplate(buildWatcher(), state.profile);
  const json = JSON.stringify(t, null, 2);

  // Clipboard access can fail for reasons that have nothing to do with the
  // export itself (document not focused, no clipboardWrite permission
  // declared) — that used to abort the whole handler before the download
  // below ever ran, silently. The file is the part that matters; clipboard
  // is a nicety on top of it.
  try {
    await navigator.clipboard.writeText(json);
  } catch { /* the download below is what actually matters */ }

  const filename = `${t.chainId || t.host.replace(/[^a-z0-9.-]/gi, '_')}.json`;
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);

  say(`Downloaded ${filename} — no cookies, tokens or account ids in it. Drop it into this project's templates/ folder and open a pull request to add it to the shared feed.`);
});

/**
 * Load a saved watcher back into the builder for adjustment. This is the
 * fix for there being no edit path at all: previously the ONLY way to
 * change a broken watch's field mapping or rules was Delete + fully
 * re-record — and Store.deleteWatcher also removes hist:<id>, so the
 * "keeps failing, re-record it" notification's own advice destroyed
 * exactly the rolling price history price_drop rules depend on. Keeping
 * the same id here means snap:<id>/hist:<id> are untouched and the diff
 * baseline survives.
 */
async function editWatcher(w) {
  say(`Loading current data for “${w.name}”…`);
  let res;
  try {
    res = await chrome.runtime.sendMessage({ type: 'vigil:testRequest', request: w.request });
  } catch (e) {
    return say(`Couldn't reach the background to refresh this watch's data: ${e?.message || e}`, 'err');
  }
  if (!res?.ok) {
    return say(`Couldn't refresh this watch's data (${res?.error || 'unreachable'}) — you may need to fully re-record it instead.`, 'err');
  }

  resetBuilderState();
  state.editingId = w.id;
  state.editingCreatedAt = w.createdAt;
  state.capture = {
    url: w.request.url, method: w.request.method, headers: w.request.headers,
    requestBody: w.request.requestBody, pageUrl: w.request.pageUrl, title: w.name,
  };
  state.payload = res.payload;
  state.candidates = findItemArrays(res.payload);
  state.rules = JSON.parse(JSON.stringify(w.rules || []));
  state.templateKey = w.templateKey || null;
  if (w.request.pageUrl) applyProfile(w.request.pageUrl); // won't touch state.rules — already non-empty above
  state.geometry = { ...w.geometry }; // the watcher's OWN saved geometry wins over the profile's default guess
  state.spec = JSON.parse(JSON.stringify(w.spec));

  $('name').value = w.name;
  $('interval').value = w.intervalMin;
  $('openUrl').value = w.openUrl || '';

  renderMapping();
  renderRules();
  say(`Editing “${w.name}”. Adjust anything below, then Save to update it in place.`);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

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
    // w.rules is expected to always exist, but a defensive `?? []` here
    // costs nothing and means one malformed record can't blank the entire
    // saved-watch list — the crash previously wasn't even caught anywhere
    // near here, it just surfaced in the console with nothing rendered.
    const ruleCount = w.rules?.length ?? 0;
    mid.innerHTML = `<div><strong>${esc(w.name)}</strong> <span class="muted" style="font-size:11px">${esc(w.profile?.name || '')}</span></div>
      <div class="muted num" style="font-size:11px">every ${w.intervalMin}m · ${ruleCount} rule(s) · ${w.itemCount ?? '—'} items${
        w.lastError ? ` · <span style="color:var(--bad)">${esc(w.lastError).slice(0, 60)}</span>` : ''}</div>`;

    const edit = document.createElement('button');
    edit.className = 'ghost';
    edit.textContent = 'Edit';
    edit.addEventListener('click', () => editWatcher(w));

    const toggle = document.createElement('button');
    toggle.className = 'ghost';
    toggle.textContent = w.enabled === false ? 'Enable' : 'Pause';
    toggle.addEventListener('click', async () => {
      // patchWatcher merges onto a FRESH read rather than this closed-over
      // `w` (which is only as current as the last renderWatchers() call) —
      // saveWatcher({...w, enabled}) used to silently roll back
      // failures/lastError/itemCount/nextRunAt to whatever they were at
      // last render if a background sweep had updated them since.
      await Store.patchWatcher(w.id, { enabled: w.enabled === false });
      renderWatchers();
    });

    const del = document.createElement('button');
    del.className = 'ghost danger';
    del.textContent = 'Delete';
    del.addEventListener('click', async () => {
      // No confirmation existed anywhere in either UI file. Delete sits
      // directly next to Pause with only a 10px gap, is irreversible (also
      // drops hist:<id>'s price history), and there's no undo.
      if (!confirm(`Delete “${w.name}”? This can't be undone, and its price history goes with it.`)) return;
      await Store.deleteWatcher(w.id);
      renderWatchers();
    });

    el.append(mid, edit, toggle, del);
    box.appendChild(el);
  }
}

/* ---------- backup / restore ---------- */

/**
 * Everything lives in chrome.storage.local and nowhere else — a profile
 * reset, a reinstall, or one misclick on Delete (now confirmed, but still)
 * was previously unrecoverable. exportT() exports one watcher as a
 * feed-contribution template with cookies/tokens deliberately stripped;
 * this is the opposite thing — a full, private backup of everything,
 * including price history, meant to be restored on THIS OR ANOTHER
 * install, never shared or contributed anywhere.
 */
async function exportBackup() {
  const watchers = await Store.watchers();
  const settings = await Store.settings();
  const history = {};
  for (const id of Object.keys(watchers)) {
    history[id] = await Store.history(id);
  }
  const backup = { v: 1, kind: 'vigil-backup', exportedAt: Date.now(), settings, watchers, history };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `vigil-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  say(`Downloaded a backup of ${Object.keys(watchers).length} watch(es) and settings.`);
}

async function importBackup(file) {
  let backup;
  try {
    backup = JSON.parse(await file.text());
  } catch {
    return say('That file isn\'t valid JSON.', 'err');
  }
  if (backup?.kind !== 'vigil-backup' || typeof backup.watchers !== 'object') {
    return say('That doesn\'t look like a VIGIL backup file.', 'err');
  }

  for (const w of Object.values(backup.watchers || {})) {
    await Store.saveWatcher(w);
  }
  // Restore history directly via pushHistory (not syncHistory — that prunes
  // anything not in a CURRENT items list, which would just erase everything
  // being restored here since there's no live poll to compare against).
  for (const [id, hist] of Object.entries(backup.history || {})) {
    for (const [itemId, series] of Object.entries(hist)) {
      for (const point of series) {
        await Store.pushHistory(id, itemId, { amount: point.p, currency: point.c }, 240);
      }
    }
  }
  if (backup.settings) await Store.saveSettings(backup.settings);

  say(`Restored ${Object.keys(backup.watchers).length} watch(es).`);
  renderWatchers();
  renderSettings();
}

/* ---------- settings ---------- */

// Values are re-rendered every time settings might have changed elsewhere
// (e.g. after an import); listeners are wired exactly ONCE at init
// (wireSettings, below). Splitting these apart matters: renderSettings()
// used to do both, so calling it a second time — which importBackup() now
// legitimately needs to do, to reflect restored settings — would have
// re-attached every listener a second time, turning one click of Export or
// one change of Default interval into two (or more) actual writes.
async function renderSettings() {
  const s = await Store.settings();
  $('sInterval').value = s.defaultIntervalMin;
  // #interval (step 5's "check every" field for a NEW watch) never actually
  // read this setting despite the field existing purely to configure it —
  // options.html hardcoded value="5" and nothing ever repopulated it.
  if (!state.editingId) $('interval').value = s.defaultIntervalMin;
  $('sQuiet').checked = s.quietHours.enabled;
  $('sFrom').value = s.quietHours.from;
  $('sTo').value = s.quietHours.to;
  $('sSound').checked = s.sound;
  $('sWebhook').value = s.webhookUrl || '';
}

function wireSettings() {
  const save = async () => {
    // Clamp to a real hour — the number inputs' min/max attributes aren't
    // enforced on a programmatic read, so typing e.g. 25 silently stored an
    // hour that inQuietHours() (h >= 25 || h < to) can never match, and
    // clearing both fields (0/0) produced an empty-but-"enabled" window.
    const clampHour = (n) => Math.min(23, Math.max(0, Number(n) || 0));
    const webhookUrl = $('sWebhook').value.trim();
    if (webhookUrl && !isPlausibleWebhookUrl(webhookUrl)) {
      say('That doesn\'t look like a webhook URL (needs to start with https://).', 'err');
      return;
    }
    await Store.saveSettings({
      defaultIntervalMin: Math.max(1, Number($('sInterval').value) || 5),
      sound: $('sSound').checked,
      quietHours: { enabled: $('sQuiet').checked, from: clampHour($('sFrom').value), to: clampHour($('sTo').value) },
      webhookUrl,
    });
  };
  ['sInterval', 'sQuiet', 'sFrom', 'sTo', 'sSound', 'sWebhook'].forEach((id) => $(id).addEventListener('change', save));

  $('exportBackup')?.addEventListener('click', exportBackup);
  $('importBackupBtn')?.addEventListener('click', () => $('importBackup')?.click());
  $('importBackup')?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) importBackup(file);
    e.target.value = '';
  });
}

loadTemplates();
loadTabs();
renderRules();
renderWatchers();
renderSettings();
wireSettings();
