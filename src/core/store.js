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
};

async function get(key, fallback) {
  const out = await chrome.storage.local.get(key);
  return key in out ? out[key] : fallback;
}

async function set(obj) {
  return chrome.storage.local.set(obj);
}

export const Store = {
  async settings() {
    return { ...DEFAULT_SETTINGS, ...(await get('settings', {})) };
  },

  async saveSettings(patch) {
    const next = { ...(await this.settings()), ...patch };
    await set({ settings: next });
    return next;
  },

  async watchers() {
    return get('watchers', {});
  },

  async watcher(id) {
    return (await this.watchers())[id] || null;
  },

  async saveWatcher(w) {
    const all = await this.watchers();
    all[w.id] = w;
    await set({ watchers: all });
    return w;
  },

  async deleteWatcher(id) {
    const all = await this.watchers();
    delete all[id];
    await set({ watchers: all });
    await chrome.storage.local.remove([`snap:${id}`, `hist:${id}`]);
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
    const hist = await this.history(id);
    const series = hist[itemId] || [];
    // Currency is stored per point so a median is never taken across currencies.
    series.push({ t: Date.now(), p: price.amount, c: price.currency || null });
    hist[itemId] = series.slice(-cap);
    await set({ [`hist:${id}`]: hist });
  },

  async events() {
    return get('events', []);
  },

  async pushEvents(list) {
    if (!list.length) return;
    const { maxEvents } = await this.settings();
    const events = await this.events();
    const next = [...list, ...events].slice(0, maxEvents);
    await set({ events: next });
    return next;
  },

  async clearEvents() {
    await set({ events: [] });
  },

  async captures() {
    return get('captures', []);
  },

  async pushCapture(cap) {
    const list = await this.captures();
    // De-dupe by URL shape so a chatty page doesn't flood the picker.
    const key = cap.url.split('?')[0];
    const filtered = list.filter((c) => c.url.split('?')[0] !== key);
    await set({ captures: [cap, ...filtered].slice(0, 40) });
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
    const health = await this.templateHealth();
    const rec = health[key] || { failures: 0, lastOkAt: null, lastFailAt: null };
    if (ok) Object.assign(rec, { failures: 0, lastOkAt: Date.now() });
    else Object.assign(rec, { failures: (rec.failures || 0) + 1, lastFailAt: Date.now() });
    health[key] = rec;
    await set({ templateHealth: health });
    return rec;
  },
};

export { DEFAULT_SETTINGS };
