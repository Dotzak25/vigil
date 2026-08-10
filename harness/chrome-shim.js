/**
 * chrome-shim.js — a fake `chrome.*` so VIGIL's real popup.js/options.js can
 * run in a plain browser tab (no unpacked-extension load needed).
 *
 * This is a TEST HARNESS ONLY. It is not part of the extension and is not
 * loaded by manifest.json. It exists because this environment's browser
 * automation cannot script chrome-extension:// pages at all, so the only way
 * to actually exercise the real UI code (not a reimplementation of it) is to
 * run that same code against a stand-in chrome API.
 *
 * Every call is logged to console with a "[shim]" prefix so the test run can
 * assert on what the UI actually asked the "background" to do.
 */

// Backed by localStorage (not a plain object) so state persists across
// popup.html / options.html — real chrome.storage.local is shared across all
// of an extension's pages the same way; a page-scoped JS object would not be.
const LS_KEY = '__vigil_harness_storage__';
const mem = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
function persist() {
  localStorage.setItem(LS_KEY, JSON.stringify(mem));
}

function log(...args) {
  console.log('[shim]', ...args);
}

// ---- a realistic captured request: a German cinema (CineStar, center-out
// seat numbering) seat map, in German, with a comma-decimal EUR price ----

const SEAT_LABELS = Array.from({ length: 16 }, (_, i) => i + 1);

// Only seats 1 & 2 are free -> they are the physically-adjacent, dead-centre
// pair under center-out numbering (see README's seat-numbering section).
// Every other seat is "besetzt" (taken).
const FREE = new Set([1, 2]);

const SEAT_ITEMS = SEAT_LABELS.map((label) => ({
  seatId: `H-${label}`,
  reihe: 'H',
  platz: String(label),
  seatStatus: FREE.has(label) ? 'frei' : 'besetzt',
  preis: '12,50 €', // German decimal-comma formatting — money.js's other worked example
  saal: 'Saal 3',
}));

const SEED_PAYLOAD = { kinoprogramm: { saalplan: { sitze: SEAT_ITEMS } } };

const PAGE_URL = 'https://www.cinestar.de/kinoprogramm/showtime/998877/sitzplan';

const SEED_CAPTURE = {
  url: 'https://www.cinestar.de/api/showtime/998877/seatplan',
  method: 'GET',
  headers: { accept: 'application/json' },
  requestBody: null,
  pageUrl: PAGE_URL,
  title: 'Seatplan',
  body: JSON.stringify(SEED_PAYLOAD),
};

const RECORDING_TAB = { id: 1, title: 'CineStar Berlin — Sitzplan', url: PAGE_URL };
const OTHER_TAB = { id: 2, title: 'New Tab', url: 'chrome://newtab/' };

// A fixture "shared template" for this same synthetic capture — i.e. what
// the community feed (Phase 3 of the README) would contain if someone had
// already recorded this exact site. This is NOT a claim about a real
// cinestar.de response shape; it's self-consistent test data only, used to
// exercise the new "apply template" path end-to-end without needing a real
// live feed. Shape matches registry.js's toTemplate() output exactly.
const SEED_TEMPLATE = {
  v: 1,
  chainId: 'cinestar-de',
  chainName: 'CineStar',
  kind: 'cinema',
  host: 'www.cinestar.de',
  urlPattern: '/api/showtime/{id}/seatplan',
  method: 'GET',
  queryKeys: [],
  headerNames: ['accept'],
  spec: {
    itemsPath: ['kinoprogramm', 'saalplan', 'sitze'],
    fields: {
      id: 'seatId', label: '', price: 'preis', available: 'seatStatus',
      row: 'reihe', col: 'platz', x: '', section: 'saal', size: '', url: '',
    },
    invertAvailable: false,
  },
  seat: { numbering: 'centerout', rowOrder: 'front-first' },
  rules: [{ type: 'seat_block', partySize: 2, minScore: 70, profile: 'standard' }],
  contributedAt: 1700000000000,
};

// ---- chrome.runtime.sendMessage handling — mirrors service-worker.js's
// message contract closely enough to drive the UI, without a real backend ----

async function handleMessage(msg) {
  log('runtime.sendMessage', msg);
  switch (msg?.type) {
    case 'vigil:startRecording':
      return { ok: true };
    case 'vigil:stopRecording':
      return { captures: [SEED_CAPTURE] };
    case 'vigil:testRequest':
      return { ok: true, payload: SEED_PAYLOAD };
    case 'vigil:runNow':
      return { ok: true };
    case 'vigil:refreshBadge':
      return { ok: true };
    case 'vigil:getTemplates':
      return { ok: true, templates: [SEED_TEMPLATE], health: {} };
    default:
      return {};
  }
}

globalThis.chrome = {
  storage: {
    local: {
      async get(keys) {
        let out;
        if (keys == null) out = { ...mem };
        else if (typeof keys === 'string') out = keys in mem ? { [keys]: mem[keys] } : {};
        else if (Array.isArray(keys)) out = Object.fromEntries(keys.filter((k) => k in mem).map((k) => [k, mem[k]]));
        else out = Object.fromEntries(Object.keys(keys).map((k) => [k, k in mem ? mem[k] : keys[k]]));
        log('storage.get', keys, '->', out);
        return out;
      },
      async set(obj) {
        Object.assign(mem, obj);
        persist();
        log('storage.set', obj);
      },
      async remove(keys) {
        for (const k of Array.isArray(keys) ? keys : [keys]) delete mem[k];
        persist();
        log('storage.remove', keys);
      },
    },
  },
  runtime: {
    sendMessage: handleMessage,
    getURL: (path) => `/${path}`,
    openOptionsPage: () => log('runtime.openOptionsPage()'),
    onMessage: { addListener: () => {} },
  },
  tabs: {
    async query(filter) {
      const tabs = [RECORDING_TAB, OTHER_TAB];
      if (filter?.active && filter?.currentWindow) return [RECORDING_TAB];
      return tabs;
    },
    create: (opts) => log('tabs.create', opts),
    update: (id, opts) => log('tabs.update', id, opts),
    sendMessage: async (id, msg) => { log('tabs.sendMessage', id, msg); return {}; },
  },
  action: {
    setBadgeText: (o) => log('action.setBadgeText', o),
    setBadgeBackgroundColor: (o) => log('action.setBadgeBackgroundColor', o),
  },
  notifications: { create: (id, opts) => log('notifications.create', id, opts) },
  alarms: { create: (name, opts) => log('alarms.create', name, opts), clear: (name) => log('alarms.clear', name) },
  permissions: { request: async (p) => { log('permissions.request', p); return true; } },
};

// navigator.clipboard.writeText needs a secure-ish context / permission in a
// real browser; stub it so the "Export as template" button doesn't throw.
try {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: async (text) => log('clipboard.writeText', text) },
    configurable: true,
  });
} catch (e) {
  log('could not stub navigator.clipboard', e);
}

window.__vigilHarness = { mem, SEED_PAYLOAD, SEED_CAPTURE };
log('chrome shim installed');
