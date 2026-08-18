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
import { formatWebhookPayload } from '../core/webhook.js';

const TICK = 'vigil:tick';
const MAX_BACKOFF_MIN = 60;
const TEMPLATE_FEED_TTL_MS = 12 * 60 * 60 * 1000; // 12h — this is a slow-moving catalogue, not live data

/* ---------- lifecycle ---------- */

chrome.runtime.onInstalled.addListener(async (details) => {
  await chrome.alarms.create(TICK, { periodInMinutes: 1, delayInMinutes: 0.1 });
  await refreshBadge();
  await syncContentScripts();

  // A fresh install drops straight into "pick a tab, start recording" with
  // zero context on WHY — the README explains the actual problem (manual
  // refreshing is a losing game against random-timed changes) at length,
  // but nobody who installs from the Chrome Web Store ever reads the
  // README. This is the one moment guaranteed to have the user's attention.
  if (details.reason === 'install') {
    await chrome.tabs.create({ url: chrome.runtime.getURL('src/ui/onboarding.html') });
  }
});

chrome.runtime.onStartup.addListener(async () => {
  await chrome.alarms.create(TICK, { periodInMinutes: 1, delayInMinutes: 0.1 });
  await refreshBadge();
  await syncContentScripts();
});

/**
 * The recorder/bridge content scripts used to be declared statically in
 * manifest.json against <all_urls> — the single most likely Chrome Web
 * Store rejection reason for a monitoring extension. Host permission is now
 * optional and requested per-site, at the moment a watch is recorded
 * (options.js), so there's nothing to inject anywhere until the user has
 * actually granted that specific site. This keeps the two content scripts'
 * registered `matches` in sync with whatever's currently granted — firing on
 * every permission change (including a manual revoke in chrome://extensions)
 * and once on startup, since dynamic registrations need re-establishing
 * after a full browser restart.
 */
async function syncContentScripts() {
  const { origins = [] } = await chrome.permissions.getAll();
  const existingIds = new Set((await chrome.scripting.getRegisteredContentScripts()).map((s) => s.id));

  if (!origins.length) {
    if (existingIds.size) await chrome.scripting.unregisterContentScripts();
    return;
  }

  const specs = [
    { id: 'vigil-recorder', matches: origins, js: ['src/content/recorder.js'], runAt: 'document_start', world: 'MAIN', allFrames: false },
    { id: 'vigil-bridge', matches: origins, js: ['src/content/bridge.js'], runAt: 'document_start', world: 'ISOLATED', allFrames: false },
  ];
  const toRegister = specs.filter((s) => !existingIds.has(s.id));
  const toUpdate = specs.filter((s) => existingIds.has(s.id));
  if (toRegister.length) await chrome.scripting.registerContentScripts(toRegister);
  if (toUpdate.length) await chrome.scripting.updateContentScripts(toUpdate);
}

chrome.permissions.onAdded.addListener(syncContentScripts);
chrome.permissions.onRemoved.addListener(syncContentScripts);

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== TICK) return;
  await tick();
});

/* ---------- the pass ---------- */

// Reentrancy guard for tick() itself, and a per-watcher in-flight guard so
// the popup's "Check" button can never process the same watcher the
// scheduled sweep is already mid-replay on. Both are plain module-scope
// state, which is correct HERE specifically: unlike "is this tab
// recording" (a fact the user needs to survive a worker restart), an
// in-flight marker only needs to survive for the lifetime of the operation
// it's guarding — if the worker dies mid-replay, that replay is gone
// regardless, so the guard resetting to "nothing in flight" on restart is
// exactly correct, not a bug.
//
// Without this: chrome.alarms fires every minute regardless of whether the
// previous tick finished (no built-in backpressure), so one slow/hanging
// endpoint, or simply more due watchers than fit in a minute at ~1s each,
// causes tick #2 to start while tick #1 is still running. Both then read
// the SAME watcher list, both process the same due watchers, and both send
// a notification for the same real change — plus each one's read-modify
// -write of the watcher list can lose the other's freshly-written
// failure/backoff state.
let tickRunning = false;
const inFlightWatchers = new Set();

async function tick() {
  if (tickRunning) return;
  tickRunning = true;
  try {
    const settings = await Store.settings();
    if (!settings.armed) return;

    const watchers = await Store.watchers();
    const now = Date.now();

    const due = Object.values(watchers).filter(
      (w) => w.enabled !== false && (w.nextRunAt || 0) <= now
    );

    // Hits found during quiet hours get a badge count instead of a
    // notification (see announce()) — accumulated across the whole sweep
    // and applied ONCE at the end, because refreshBadge() below would
    // otherwise immediately overwrite a per-watcher badge write with the
    // routine "armed watcher count" badge within the same tick.
    let quietHits = 0;

    // Never fire two sites in the same millisecond; stagger politely.
    for (const w of due) {
      const result = await runWatcher(w, settings);
      if (result.quiet) quietHits += result.hitCount;
      await sleep(400 + Math.random() * 600);
    }

    if (quietHits > 0) {
      await chrome.action.setBadgeBackgroundColor({ color: '#E8A33D' });
      await chrome.action.setBadgeText({ text: String(Math.min(99, quietHits)) });
    } else {
      await refreshBadge();
    }
  } finally {
    tickRunning = false;
  }
}

/** @returns {{hitCount: number, quiet: boolean}} */
async function runWatcher(watcher, settings) {
  // A manual "Check now" from the popup and the scheduled sweep can both
  // pick up the same due watcher. Without this guard both would replay the
  // same request, evaluate the same transition, and each independently
  // fire a notification and log entry for one real change.
  if (inFlightWatchers.has(watcher.id)) return { hitCount: 0, quiet: false };
  inFlightWatchers.add(watcher.id);

  const patch = { lastRunAt: Date.now() };
  let hitCount = 0;
  const quiet = inQuietHours(settings);

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

    // Single batched read-modify-write for this whole poll's history,
    // instead of one per item — and prunes ids no longer in the listing,
    // so a large seat map's history doesn't grow without bound. Record
    // before evaluating, so the median includes today.
    await Store.syncHistory(watcher.id, items);
    const history = await Store.history(watcher.id);

    const hits = evaluate({ watcher, items, changes, firstRun, history });
    hitCount = hits.length;

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
  } finally {
    inFlightWatchers.delete(watcher.id);
  }

  // patchWatcher (not saveWatcher) merges onto a FRESH read and is a no-op
  // if the watcher was deleted while this replay was in flight — without
  // that, a delete followed shortly by this write resurrects the watcher
  // with whatever result this poll happened to produce, and it silently
  // keeps polling forever with no way to tell it was ever "deleted".
  await Store.patchWatcher(watcher.id, patch);

  return { hitCount, quiet };
}

// Exported despite this file being loaded directly as the background
// service worker (nothing else imports it at runtime) — purely so these two
// pure functions can be unit-tested under plain Node without needing a full
// chrome.* shim for the rest of the file's side effects.
export function schedule(minutes) {
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
  // During quiet hours the badge is set once, for the WHOLE sweep's total,
  // by tick() — setting it here per-watcher used to get silently
  // overwritten within the same second by tick()'s own refreshBadge() call
  // after the loop, so quiet-hours hits produced no visible signal at all
  // beyond the event log. A webhook is exactly as interruptive as the
  // desktop notification it's an alternative to (it's what puts an alert on
  // your phone via Discord), so it's held back the same way.
  if (inQuietHours(settings)) return;

  const top = hits.sort((a, b) => (b.priority || 0) - (a.priority || 0))[0];
  const more = hits.length - 1;

  await notify({
    title: `${top.watcherName} · ${top.title}`,
    body: more > 0 ? `${top.body}\n+${more} more` : top.body,
    priority: top.priority ?? 1,
    url: top.url,
  });

  if (settings.sound && (top.priority ?? 1) >= 2) await playChime();

  // Capped at 5 per sweep, same as newItemRule's own cap — a watcher with a
  // lot of hits in one poll (many seats, many restocked sizes) shouldn't
  // spam a Discord channel any harder than the desktop notification path.
  for (const hit of hits.slice(0, 5)) await sendWebhook(hit, settings);
}

/**
 * An optional second delivery channel straight from the browser — paste a
 * Discord or Slack incoming-webhook URL into settings and every hit also
 * posts there, no account or server involved. Competitive research found
 * this specific gap repeatedly: paid Discord "cook groups" ($30-95/mo)
 * largely sell delivery INTO Discord; almost no consumer monitoring tool
 * ships it directly. A webhook failure must never block the desktop
 * notification above it — it's a bonus channel, not the primary one.
 */
async function sendWebhook(hit, settings) {
  if (!settings.webhookUrl) return;
  try {
    await fetch(settings.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formatWebhookPayload(hit)),
    });
  } catch {
    /* best-effort — the desktop notification already fired */
  }
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

export function inQuietHours(settings) {
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

// Which tab is currently recording. This file's whole design is "nothing
// lives in module scope, because the worker is killed after ~30s idle" —
// a plain Set here would violate that: if the worker is evicted mid-recording
// (a real possibility between "start" and the user actually reloading the
// page), it comes back with an empty Set and silently stops collecting
// captures with no error. chrome.storage.session survives a worker restart
// within the same browser session and clears itself on browser close —
// exactly the lifetime "recording" should have.
async function getRecordingTabs() {
  const { recordingTabs } = await chrome.storage.session.get('recordingTabs');
  return new Set(recordingTabs || []);
}
async function setRecordingTabs(set) {
  await chrome.storage.session.set({ recordingTabs: [...set] });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    switch (msg?.type) {
      case 'vigil:isRecording':
        return sendResponse({ recording: (await getRecordingTabs()).has(sender.tab?.id) });

      case 'vigil:startRecording': {
        const tabs = await getRecordingTabs();
        // Starting a new recording used to leave any OTHER tab's recording
        // silently active — an abandoned tab from a previous, forgotten
        // recording kept capturing (and, worse, kept feeding its captures
        // into whatever buffer the CURRENT recording reads from, see
        // vigil:capture below) for the rest of the browser session. Stop
        // every other tab explicitly before starting this one.
        for (const oldTabId of tabs) {
          if (oldTabId === msg.tabId) continue;
          await chrome.tabs.sendMessage(oldTabId, { type: 'vigil:setRecording', recording: false }).catch(() => {});
        }
        await setRecordingTabs(new Set([msg.tabId]));
        await Store.clearCaptures();
        // Ensure the content scripts are actually registered for this
        // origin before responding — options.js decides whether to reload
        // the tab based on this call succeeding, and syncContentScripts()
        // is otherwise only triggered by a chrome.permissions.onAdded event
        // whose timing relative to this message isn't guaranteed.
        await syncContentScripts();
        await chrome.tabs.sendMessage(msg.tabId, { type: 'vigil:setRecording', recording: true }).catch(() => {});
        return sendResponse({ ok: true });
      }

      case 'vigil:stopRecording': {
        const tabs = await getRecordingTabs();
        tabs.delete(msg.tabId);
        await setRecordingTabs(tabs);
        await chrome.tabs.sendMessage(msg.tabId, { type: 'vigil:setRecording', recording: false }).catch(() => {});
        return sendResponse({ ok: true, captures: await Store.captures() });
      }

      case 'vigil:capture': {
        // Only accept a capture from a tab this extension believes is
        // currently recording. Without this, an abandoned recording tab
        // (see vigil:startRecording above) or simply background traffic
        // from ANY tab with a granted permission could push captures into
        // the buffer the user is picking from for a totally different
        // site's recording session — pushCapture's 40-item cap and
        // dedupe-by-URL then risk evicting the request the user actually
        // needs before they click Stop.
        const tabs = await getRecordingTabs();
        if (!tabs.has(sender.tab?.id)) return sendResponse({ ok: false, error: 'not recording' });
        await Store.pushCapture(msg.capture);
        return sendResponse({ ok: true });
      }

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
