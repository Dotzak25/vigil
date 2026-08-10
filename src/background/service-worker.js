/**
 * service-worker.js — the night shift.
 *
 * MV3 kills this worker after ~30s idle, so it is written as a pure function
 * of storage: wake on an alarm, load state, do one pass, write, die. Nothing
 * is cached in module scope on purpose.
 */

import { Store } from '../core/store.js';
import { extractItems } from '../core/extract.js';
import { diffItems, toSnapshot } from '../core/diff.js';
import { evaluate } from '../core/rules.js';
import { toMinimap } from '../core/seats.js';
import { fetchTemplatePack, TEMPLATE_FEED } from '../core/registry.js';

const TICK = 'vigil:tick';
const MAX_BACKOFF_MIN = 60;
const TEMPLATE_FEED_TTL_MS = 12 * 60 * 60 * 1000; // 12h — this is a slow-moving catalogue, not live data

/* ---------- lifecycle ---------- */

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.alarms.create(TICK, { periodInMinutes: 1, delayInMinutes: 0.1 });
  await refreshBadge();
});

chrome.runtime.onStartup.addListener(async () => {
  await chrome.alarms.create(TICK, { periodInMinutes: 1, delayInMinutes: 0.1 });
  await refreshBadge();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== TICK) return;
  await tick();
});

/* ---------- the pass ---------- */

async function tick() {
  const settings = await Store.settings();
  if (!settings.armed) return;

  const watchers = await Store.watchers();
  const now = Date.now();

  const due = Object.values(watchers).filter(
    (w) => w.enabled !== false && (w.nextRunAt || 0) <= now
  );

  // Never fire two sites in the same millisecond; stagger politely.
  for (const w of due) {
    await runWatcher(w, settings);
    await sleep(400 + Math.random() * 600);
  }

  await refreshBadge();
}

async function runWatcher(watcher, settings) {
  const patch = { lastRunAt: Date.now() };

  try {
    const payload = await replay(watcher.request);
    const items = extractItems(payload, {
      ...watcher.spec,
      countryHint: watcher.profile?.country,
      defaultCurrency: watcher.profile?.currency,
    });

    if (!items.length) throw new Error('Extractor returned 0 items — the page shape probably changed');

    const prev = await Store.snapshot(watcher.id);
    const { changes, firstRun } = diffItems(prev, items);

    // Record prices before evaluating, so the median includes today.
    for (const it of items) {
      if (it.price) await Store.pushHistory(watcher.id, it.id, it.price);
    }
    const history = await Store.history(watcher.id);

    const hits = evaluate({ watcher, items, changes, firstRun, history });

    await Store.saveSnapshot(watcher.id, toSnapshot(items));

    if (hits.length) {
      const stamped = hits.map((h) => ({
        ...h,
        watcherId: watcher.id,
        watcherName: watcher.name,
        at: Date.now(),
        url: h.url || watcher.openUrl || watcher.request.pageUrl,
        // A seat hit carries a picture of the room with it. "Row F, seats 7–9"
        // means nothing until you can see where that is.
        minimap: h.seatIds
          ? toMinimap(items, h.seatIds, {
              numbering: watcher.geometry?.numbering || 'sequential',
              rowOrder: watcher.geometry?.rowOrder || 'front-first',
            })
          : null,
      }));
      await Store.pushEvents(stamped);
      await announce(stamped, settings);
    }

    Object.assign(patch, {
      failures: 0,
      lastError: null,
      itemCount: items.length,
      lastHits: hits.length,
      nextRunAt: schedule(watcher.intervalMin || settings.defaultIntervalMin),
    });
    if (watcher.templateKey) await Store.recordTemplateOutcome(watcher.templateKey, true);
  } catch (err) {
    const failures = (watcher.failures || 0) + 1;
    // Back off hard on repeated failure. A watcher hammering a 403 helps nobody
    // and is the fastest way to get the account flagged.
    const backoff = Math.min(MAX_BACKOFF_MIN, 2 ** failures);
    Object.assign(patch, {
      failures,
      lastError: String(err.message || err),
      nextRunAt: schedule(backoff),
    });
    // A watcher built from a shared template earns/loses that template's
    // health from real usage — this is what keeps a broken template from
    // sending the next person into the same failure with false confidence.
    if (watcher.templateKey) await Store.recordTemplateOutcome(watcher.templateKey, false);
    if (failures === 4) {
      await notify({
        title: `${watcher.name} keeps failing`,
        body: `${String(err.message || err).slice(0, 120)} — re-record the request in Options.`,
        priority: 0,
      });
    }
  }

  await Store.saveWatcher({ ...watcher, ...patch });
}

function schedule(minutes) {
  // ±20% jitter. Perfectly periodic requests are the easiest thing in the
  // world for a WAF to spot.
  const jitter = 0.8 + Math.random() * 0.4;
  return Date.now() + minutes * 60_000 * jitter;
}

/* ---------- replay ---------- */

const FORBIDDEN = new Set([
  'host', 'connection', 'content-length', 'cookie', 'cookie2', 'origin',
  'referer', 'user-agent', 'sec-fetch-mode', 'sec-fetch-site', 'sec-fetch-dest',
  'accept-encoding', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'via',
]);

async function replay(request) {
  const headers = {};
  for (const [k, v] of Object.entries(request.headers || {})) {
    if (!FORBIDDEN.has(k.toLowerCase())) headers[k] = v;
  }

  const res = await fetch(request.url, {
    method: request.method || 'GET',
    headers,
    body: request.method && request.method !== 'GET' ? request.requestBody : undefined,
    // Session cookies ride along, so VIGIL sees exactly what you see when
    // logged in — member presales, regional pricing, the lot.
    credentials: 'include',
    cache: 'no-store',
    redirect: 'follow',
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Response was not JSON (bot check or login wall?)');
  }
}

/* ---------- telling you ---------- */

async function announce(hits, settings) {
  if (inQuietHours(settings)) {
    await chrome.action.setBadgeText({ text: String(Math.min(99, hits.length)) });
    return;
  }

  const top = hits.sort((a, b) => (b.priority || 0) - (a.priority || 0))[0];
  const more = hits.length - 1;

  await notify({
    title: `${top.watcherName} · ${top.title}`,
    body: more > 0 ? `${top.body}\n+${more} more` : top.body,
    priority: top.priority ?? 1,
    url: top.url,
  });

  if (settings.sound && (top.priority ?? 1) >= 2) await playChime();
}

async function notify({ title, body, priority = 1, url }) {
  const id = `vigil:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`;
  await chrome.notifications.create(id, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon128.png'),
    title,
    message: body,
    priority: Math.min(2, priority),
    requireInteraction: priority >= 2,
  });
  if (url) {
    const map = (await chrome.storage.session?.get('notifUrls'))?.notifUrls || {};
    map[id] = url;
    await chrome.storage.session?.set({ notifUrls: map });
  }
}

chrome.notifications.onClicked.addListener(async (id) => {
  const map = (await chrome.storage.session?.get('notifUrls'))?.notifUrls || {};
  if (map[id]) await chrome.tabs.create({ url: map[id] });
  chrome.notifications.clear(id);
});

function inQuietHours(settings) {
  const q = settings.quietHours;
  if (!q?.enabled) return false;
  const h = new Date().getHours();
  return q.from <= q.to ? h >= q.from && h < q.to : h >= q.from || h < q.to;
}

async function playChime() {
  try {
    const existing = await chrome.runtime.getContexts?.({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
    if (!existing?.length) {
      await chrome.offscreen.createDocument({
        url: 'src/background/offscreen.html',
        reasons: ['AUDIO_PLAYBACK'],
        justification: 'Alert tone when a watched seat or item opens up.',
      });
    }
    await chrome.runtime.sendMessage({ type: 'vigil:chime' });
  } catch (_) {
    /* audio is a nicety, never a failure path */
  }
}

async function refreshBadge() {
  const { armed } = await Store.settings();
  const watchers = Object.values(await Store.watchers()).filter((w) => w.enabled !== false);
  await chrome.action.setBadgeBackgroundColor({ color: armed ? '#E8A33D' : '#3A4453' });
  await chrome.action.setBadgeText({ text: armed && watchers.length ? String(watchers.length) : '' });
}

/* ---------- template feed ---------- */

/**
 * The shared catalogue this is Phase 3 of: someone else's recorded template,
 * so the next person on that site never has to record or map a field at all.
 * The feed doesn't exist yet in any meaningful way, so this fails constantly
 * right now — and that's fine. It degrades to today's full manual flow
 * rather than blocking anything, which is the only honest way to ship a
 * feature whose value depends entirely on who else has used it.
 */
async function getTemplates(force = false) {
  const cache = await Store.templateCache();
  const stale = force || Date.now() - (cache.fetchedAt || 0) > TEMPLATE_FEED_TTL_MS;
  if (!stale) return cache.templates;

  try {
    const pack = await fetchTemplatePack(TEMPLATE_FEED);
    await Store.saveTemplateCache({ fetchedAt: Date.now(), templates: pack.templates });
    return pack.templates;
  } catch {
    // Feed unreachable (most likely: it simply doesn't exist yet). Keep
    // serving whatever's cached rather than erroring the watch builder.
    return cache.templates;
  }
}

/* ---------- messages ---------- */

const recordingTabs = new Set();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    switch (msg?.type) {
      case 'vigil:isRecording':
        return sendResponse({ recording: recordingTabs.has(sender.tab?.id) });

      case 'vigil:startRecording': {
        recordingTabs.add(msg.tabId);
        await Store.clearCaptures();
        await chrome.tabs.sendMessage(msg.tabId, { type: 'vigil:setRecording', recording: true }).catch(() => {});
        return sendResponse({ ok: true });
      }

      case 'vigil:stopRecording': {
        recordingTabs.delete(msg.tabId);
        await chrome.tabs.sendMessage(msg.tabId, { type: 'vigil:setRecording', recording: false }).catch(() => {});
        return sendResponse({ ok: true, captures: await Store.captures() });
      }

      case 'vigil:capture':
        await Store.pushCapture(msg.capture);
        return sendResponse({ ok: true });

      case 'vigil:runNow': {
        const w = await Store.watcher(msg.id);
        if (!w) return sendResponse({ ok: false, error: 'No such watcher' });
        await runWatcher(w, await Store.settings());
        return sendResponse({ ok: true, watcher: await Store.watcher(msg.id) });
      }

      case 'vigil:testRequest': {
        try {
          const payload = await replay(msg.request);
          return sendResponse({ ok: true, payload });
        } catch (e) {
          return sendResponse({ ok: false, error: String(e.message || e) });
        }
      }

      case 'vigil:refreshBadge':
        await refreshBadge();
        return sendResponse({ ok: true });

      case 'vigil:getTemplates': {
        const templates = await getTemplates(msg.force);
        const health = await Store.templateHealth();
        return sendResponse({ ok: true, templates, health });
      }

      default:
        return sendResponse({ ok: false, error: 'Unknown message' });
    }
  })();
  return true; // keep the channel open for the async work above
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
