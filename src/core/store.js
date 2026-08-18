/**
 * store.js — everything VIGIL knows, on disk.
 *
 * chrome.storage.local is the only persistent state. The service worker is
 * killed every ~30s of idle, so nothing may live in module scope between runs.
 *
 * Keys:
 *   settings          global config
 *   watchers          { [id]: Watcher }
 *   snap:<watcherId>  last normalised observation, keyed by item id
 *   hist:<watcherId>  rolling price history for drop detection
 *   events            capped log of things worth telling the user about
 *   captures          requests recorded by the page recorder, awaiting adoption
 */

const DEFAULT_SETTINGS = {
  armed: false,
  defaultIntervalMin: 5,
  quietHours: { enabled: false, from: 1, to: 8 }, // local hours, 24h
  sound: true,
  maxEvents: 200,
  // Optional: a Discord or Slack incoming-webhook URL. Empty means "off" —
  // this never sends anywhere unless the user pastes a URL in themselves.
  webhookUrl: '',
};

async function get(key, fallback) {
  const out = await chrome.storage.local.get(key);
  return key in out ? out[key] : fallback;
}

async function set(obj) {
  return chrome.storage.local.set(obj);
}

/**
 * Every method below that reads a key, mutates it in memory, and writes it
 * back is NOT atomic across those steps — chrome.storage.local.get and
 * .set are each atomic individually, but nothing stops two calls to e.g.
 * saveWatcher() from both reading the same map before either writes,
 * silently losing whichever write lands first. This is a real, everyday
 * race: a scheduled tick finishing a watcher's replay at the same moment
 * the user clicks Delete or Pause in Options, or two 'vigil:capture'
 * messages arriving from the same page a few milliseconds apart.
 *
 * A per-key async lock fixes this for everything issued from a single live
 * service worker instance (MV3 has no real threads — "concurrent" here
 * means interleaved async chains, and a promise-chain lock fully serialises
 * those). It does NOT need to survive a worker restart — if the worker
 * dies, whatever was "in flight" is gone anyway, so an empty lock map on
 * restart is exactly the correct starting state, not a bug.
 */
const locks = new Map();
function withLock(key, fn) {
  const prev = locks.get(key) || Promise.resolve();
  const run = prev.then(fn, fn);
  locks.set(key, run.then(() => {}, () => {}));
  return run;
}

export const Store = {
  async settings() {
    return { ...DEFAULT_SETTINGS, ...(await get('settings', {})) };
  },

  async saveSettings(patch) {
    return withLock('settings', async () => {
      const next = { ...DEFAULT_SETTINGS, ...(await get('settings', {})), ...patch };
      await set({ settings: next });
      return next;
    });
  },

  async watchers() {
    return get('watchers', {});
  },

  async watcher(id) {
    return (await this.watchers())[id] || null;
  },

  /**
   * Full replace-or-create. Use this when the caller genuinely means "this
   * IS the whole watcher now" — saving a new watch from the builder. For
   * updating a FEW fields of an existing one (pause/enable, a scheduled
   * poll's result), use patchWatcher instead: closing over a possibly-stale
   * copy of the whole object and writing it back wholesale is how a
   * background sweep's fresh nextRunAt/failures gets clobbered by a UI
   * render from a minute ago, or how a deleted watcher gets resurrected by
   * an in-flight tick that started before the delete.
   */
  async saveWatcher(w) {
    return withLock('watchers', async () => {
      const all = await get('watchers', {});
      all[w.id] = w;
      await set({ watchers: all });
      return w;
    });
  },

  /**
   * Partial update against a FRESH read, not a caller-held copy — and a
   * no-op if the watcher was deleted in the meantime, rather than
   * resurrecting it. This is what both the background's post-replay write
   * and the UI's pause/enable toggle should use.
   */
  async patchWatcher(id, patch) {
    return withLock('watchers', async () => {
      const all = await get('watchers', {});
      if (!all[id]) return null; // deleted meanwhile — nothing to patch, and must not recreate it
      all[id] = { ...all[id], ...patch };
      await set({ watchers: all });
      return all[id];
    });
  },

  async deleteWatcher(id) {
    return withLock('watchers', async () => {
      const all = await get('watchers', {});
      delete all[id];
      await set({ watchers: all });
      await chrome.storage.local.remove([`snap:${id}`, `hist:${id}`]);
    });
  },

  async snapshot(id) {
    return get(`snap:${id}`, null);
  },

  async saveSnapshot(id, snap) {
    return set({ [`snap:${id}`]: snap });
  },

  /**
   * Price history is a ring buffer of {t, p} used to compute a rolling median,
   * which is what "dropped drastically" actually has to mean. A drop against
   * the last observed price is noise; a drop against the 30-day median is news.
   */
  async history(id) {
    return get(`hist:${id}`, {});
  },

  async pushHistory(id, itemId, price, cap = 240) {
    if (price?.amount == null) return;
    return withLock(`hist:${id}`, async () => {
      const hist = await get(`hist:${id}`, {});
      const series = hist[itemId] || [];
      // Currency is stored per point so a median is never taken across currencies.
      series.push({ t: Date.now(), p: price.amount, c: price.currency || null });
      hist[itemId] = series.slice(-cap);
      await set({ [`hist:${id}`]: hist });
    });
  },

  /**
   * Batched form of pushHistory for a full poll's worth of items in one go:
   * a single read + single write instead of one read-modify-write PER item,
   * and prunes item ids that are no longer in the current listing at all.
   *
   * Without pruning, hist:<id> only ever grows — every seat id, every
   * rotated resale listing id that ever appeared stays in the blob forever,
   * since nothing but deleteWatcher ever removed anything from it. For a
   * seat-map watcher (the headline use case, and seats carry prices) with
   * hundreds or low thousands of priced seats, that's O(items × cap) bytes
   * growing without bound, and one read-modify-write per item every poll —
   * O(N²) growth against a 10MB chrome.storage.local quota the manifest
   * doesn't even request unlimitedStorage to raise. Once the quota is hit,
   * every future poll fails, is recorded as a watcher failure, and
   * penalises the shared template's health for a fault that's really just
   * unbounded local growth.
   *
   * Once an item vanishes from the current listing, its price history has
   * no ongoing purpose anyway — baselinePrice() computes a median for a
   * SPECIFIC item id against its own series, and there's no current price
   * left to compare it to.
   */
  async syncHistory(id, items, cap = 240) {
    return withLock(`hist:${id}`, async () => {
      const hist = await get(`hist:${id}`, {});
      const now = Date.now();
      const seen = new Set();

      for (const it of items) {
        seen.add(it.id);
        if (it.price?.amount == null) continue;
        const series = hist[it.id] || [];
        series.push({ t: now, p: it.price.amount, c: it.price.currency || null });
        hist[it.id] = series.slice(-cap);
      }

      for (const itemId of Object.keys(hist)) {
        if (!seen.has(itemId)) delete hist[itemId];
      }

      await set({ [`hist:${id}`]: hist });
    });
  },

  async events() {
    return get('events', []);
  },

  async pushEvents(list) {
    if (!list.length) return;
    return withLock('events', async () => {
      const { maxEvents } = { ...DEFAULT_SETTINGS, ...(await get('settings', {})) };
      const events = await get('events', []);
      const next = [...list, ...events].slice(0, maxEvents);
      await set({ events: next });
      return next;
    });
  },

  async clearEvents() {
    await set({ events: [] });
  },

  async captures() {
    return get('captures', []);
  },

  async pushCapture(cap) {
    return withLock('captures', async () => {
      const list = await get('captures', []);
      // De-dupe by URL shape so a chatty page doesn't flood the picker.
      const key = cap.url.split('?')[0];
      const filtered = list.filter((c) => c.url.split('?')[0] !== key);
      await set({ captures: [cap, ...filtered].slice(0, 40) });
    });
  },

  async clearCaptures() {
    await set({ captures: [] });
  },

  /**
   * The shared template feed, cached locally with a fetch timestamp so the
   * background doesn't hit the CDN on every popup open. Empty/missing is the
   * honest default until the feed — and the community contributing to it —
   * actually exists.
   */
  async templateCache() {
    return get('templateCache', { fetchedAt: 0, templates: [] });
  },

  async saveTemplateCache(cache) {
    await set({ templateCache: cache });
  },

  /**
   * Per-template local health: has THIS install's use of a given template
   * been working? Keyed by registry.js's templateKey(), not by anything the
   * feed assigns, since the feed is just JSON and ids aren't guaranteed
   * stable across regenerations.
   */
  async templateHealth() {
    return get('templateHealth', {});
  },

  async recordTemplateOutcome(key, ok) {
    if (!key) return;
    return withLock('templateHealth', async () => {
      const health = await get('templateHealth', {});
      const rec = health[key] || { failures: 0, lastOkAt: null, lastFailAt: null };
      if (ok) Object.assign(rec, { failures: 0, lastOkAt: Date.now() });
      else Object.assign(rec, { failures: (rec.failures || 0) + 1, lastFailAt: Date.now() });
      health[key] = rec;
      await set({ templateHealth: health });
      return rec;
    });
  },
};

export { DEFAULT_SETTINGS };
