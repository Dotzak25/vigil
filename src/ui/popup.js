import { Store } from '../core/store.js';

const $ = (id) => document.getElementById(id);

/**
 * Every sendMessage call below used to have no catch at all. render() is the
 * only thing that ever un-disables a button or updates state, so a rejected
 * message (service worker unreachable, port closed mid-call — both real,
 * ordinary occurrences) left a button permanently stuck disabled with
 * whatever text was set right before the await, no error shown anywhere,
 * since this popup previously had no error surface at all.
 */
function showError(msg) {
  const el = $('popupErr');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 5000);
}

function ago(t) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

function minimapEl(mm) {
  const wrap = document.createElement('div');
  wrap.className = 'minimap';

  const screen = document.createElement('div');
  screen.className = 'screen';
  wrap.appendChild(screen);

  const CLASS = { '!': 'hit', o: 'open', x: '', '.': 'gap' };
  for (const line of mm.rows) {
    const row = document.createElement('div');
    row.className = 'mrow';
    for (const ch of line) {
      const cell = document.createElement('div');
      cell.className = `cell ${CLASS[ch] || ''}`.trim();
      row.appendChild(cell);
    }
    wrap.appendChild(row);
  }
  return wrap;
}

async function render() {
  const settings = await Store.settings();
  const watchers = Object.values(await Store.watchers());
  const events = await Store.events();

  // Arm control. "Arm" was never explained anywhere in the product — a
  // bare button label with a static HTML tooltip as the only hint — so the
  // title is set dynamically here to say what it actually does right now,
  // not just what it's called.
  $('arm').textContent = settings.armed ? 'Disarm' : 'Arm';
  $('arm').title = settings.armed
    ? `Checking every ${settings.defaultIntervalMin}m by default. Click to stop.`
    : 'Start checking your saved watches every few minutes. VIGIL only interrupts you when something actually changes.';
  $('arm').classList.toggle('primary', !settings.armed);
  $('arm').classList.toggle('ghost', settings.armed);
  $('pulse').classList.toggle('off', !settings.armed);

  // Watcher list
  const list = $('watchers');
  list.textContent = '';

  if (!watchers.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.innerHTML =
      'Nothing on watch yet.<br><span class="muted">Whatever you\'d refresh by hand — a seat map, a size, a price — VIGIL can watch instead.</span>';
    list.appendChild(empty);
  }

  for (const w of watchers) {
    const el = document.createElement('div');
    el.className = 'watch';

    const dot = document.createElement('div');
    dot.className = `dot ${w.enabled === false ? 'off' : w.lastError ? 'err' : ''}`.trim();

    const mid = document.createElement('div');
    const nm = document.createElement('div');
    nm.className = 'nm';
    nm.textContent = w.name;
    const st = document.createElement('div');
    st.className = 'st';
    st.textContent = w.lastError
      ? w.lastError.slice(0, 46)
      : `${w.itemCount ?? '—'} items · every ${w.intervalMin || settings.defaultIntervalMin}m · ${
          w.lastRunAt ? ago(w.lastRunAt) : 'not run'
        }`;
    mid.append(nm, st);

    const run = document.createElement('button');
    run.className = 'ghost right';
    run.textContent = 'Check';
    run.addEventListener('click', async () => {
      run.disabled = true;
      run.textContent = '…';
      try {
        await chrome.runtime.sendMessage({ type: 'vigil:runNow', id: w.id });
      } catch (e) {
        showError(`Couldn't check "${w.name}": ${e?.message || e}`);
      } finally {
        // render() rebuilds this exact button from scratch, so it always
        // ends up back in a normal, clickable state regardless of whether
        // the message above succeeded.
        render();
      }
    });

    el.append(dot, mid, run);
    list.appendChild(el);
  }

  const last = watchers.map((w) => w.lastRunAt || 0).sort((a, b) => b - a)[0];
  $('sweep').textContent = !settings.armed
    ? 'Disarmed — nothing is being checked.'
    : last
      ? `Last sweep ${ago(last)}`
      : 'Armed. First sweep within a minute.';

  // Hits
  const hits = $('hits');
  hits.textContent = '';

  if (!events.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No hits yet. VIGIL only reports changes, so silence is normal.';
    hits.appendChild(empty);
  }

  for (const e of events.slice(0, 12)) {
    const el = document.createElement('div');
    el.className = 'hit';

    const head = document.createElement('div');
    head.className = 'row';
    const t = document.createElement('span');
    t.className = 't';
    t.textContent = e.title;
    const when = document.createElement('span');
    when.className = 'when right';
    when.textContent = ago(e.at);
    head.append(t, when);

    const b = document.createElement('div');
    b.className = 'b';
    b.textContent = e.body;

    if (e.watcherName) {
      const w = document.createElement('div');
      w.className = 'when';
      w.textContent = e.watcherName;
      el.appendChild(head);
      el.appendChild(w);
      el.appendChild(b);
      if (e.minimap) el.appendChild(minimapEl(e.minimap));
      if (e.url) {
        el.style.cursor = 'pointer';
        el.addEventListener('click', () => chrome.tabs.create({ url: e.url }));
      }
      hits.appendChild(el);
      continue;
    }

    el.append(head, b);
    if (e.minimap) el.appendChild(minimapEl(e.minimap));

    if (e.url) {
      el.style.cursor = 'pointer';
      el.addEventListener('click', () => chrome.tabs.create({ url: e.url }));
    }
    hits.appendChild(el);
  }
}

$('arm').addEventListener('click', async () => {
  const s = await Store.settings();
  await Store.saveSettings({ armed: !s.armed });
  try {
    await chrome.runtime.sendMessage({ type: 'vigil:refreshBadge' });
  } catch (e) {
    // The setting itself is already saved and correct at this point — only
    // the toolbar badge failed to refresh, so this must not block render()
    // below. It used to: an await before render() meant a failure here left
    // the button reading "Arm" while the extension was actually armed
    // (or vice versa), and clicking again would then silently flip it back.
    showError(`Armed, but the toolbar badge may be stale: ${e?.message || e}`);
  }
  render();
});

$('new').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await chrome.tabs.create({ url: chrome.runtime.getURL(`src/ui/options.html?record=${tab?.id ?? ''}`) });
  window.close();
});

$('opts').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

$('clear').addEventListener('click', async () => {
  // Wiped up to 200 events with no confirmation and no undo.
  if (!confirm('Clear all recent hits? This can\'t be undone.')) return;
  await Store.clearEvents();
  render();
});

render();
