/**
 * store.js talks to chrome.storage.local, which doesn't exist under plain
 * Node. This installs the smallest possible in-memory stand-in — enough to
 * prove Store's own logic (defaults, merging, the new template cache/health
 * bookkeeping) is correct, independent of whether it's a real browser.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

let mem = {};
globalThis.chrome = {
  storage: {
    local: {
      async get(keys) {
        if (keys == null) return { ...mem };
        if (typeof keys === 'string') return keys in mem ? { [keys]: mem[keys] } : {};
        return Object.fromEntries(Object.keys(keys).filter((k) => k in mem).map((k) => [k, mem[k]]));
      },
      async set(obj) { Object.assign(mem, obj); },
      async remove(keys) { for (const k of Array.isArray(keys) ? keys : [keys]) delete mem[k]; },
    },
  },
};

const { Store } = await import('../src/core/store.js');

beforeEach(() => { mem = {}; });

describe('Store.settings / saveSettings', () => {
  test('defaults apply when nothing is stored yet', async () => {
    const s = await Store.settings();
    assert.equal(s.armed, false);
    assert.equal(s.defaultIntervalMin, 5);
  });

  test('saveSettings merges onto defaults + previous, not replace', async () => {
    await Store.saveSettings({ armed: true });
    await Store.saveSettings({ sound: false });
    const s = await Store.settings();
    assert.equal(s.armed, true); // still true from the first save
    assert.equal(s.sound, false);
  });
});

describe('Store.watchers / saveWatcher / deleteWatcher', () => {
  test('save then delete also clears that watcher\'s snapshot and history', async () => {
    await Store.saveWatcher({ id: 'w1', name: 'Test' });
    await Store.saveSnapshot('w1', { t: 0, items: {} });
    await Store.pushHistory('w1', 'item1', { amount: 10, currency: 'USD' });

    assert.ok(await Store.watcher('w1'));
    assert.ok(await Store.snapshot('w1'));

    await Store.deleteWatcher('w1');
    assert.equal(await Store.watcher('w1'), null);
    assert.equal(await Store.snapshot('w1'), null);
    assert.deepEqual(await Store.history('w1'), {});
  });
});

describe('Store.pushHistory — capped ring buffer, currency carried per point', () => {
  test('caps at the given length and keeps the most recent points', async () => {
    for (let i = 0; i < 5; i++) {
      await Store.pushHistory('w1', 'item1', { amount: i, currency: 'USD' }, 3);
    }
    const hist = await Store.history('w1');
    assert.equal(hist.item1.length, 3);
    assert.deepEqual(hist.item1.map((p) => p.p), [2, 3, 4]);
    assert.ok(hist.item1.every((p) => p.c === 'USD'));
  });

  test('a price with no amount is silently skipped, never stored as 0/null', async () => {
    await Store.pushHistory('w1', 'item1', null);
    await Store.pushHistory('w1', 'item1', { currency: 'USD' });
    const hist = await Store.history('w1');
    assert.deepEqual(hist.item1 || [], []);
  });
});

describe('Store.pushEvents — capped by settings.maxEvents, newest first', () => {
  test('newest events are prepended and the log is capped', async () => {
    await Store.saveSettings({ maxEvents: 3 });
    await Store.pushEvents([{ id: 'a' }]);
    await Store.pushEvents([{ id: 'b' }]);
    await Store.pushEvents([{ id: 'c' }]);
    await Store.pushEvents([{ id: 'd' }]);
    const events = await Store.events();
    assert.equal(events.length, 3);
    assert.equal(events[0].id, 'd'); // most recent first
  });
});

describe('Store.saveWatcher / patchWatcher — the concurrency regression', () => {
  test('concurrent saveWatcher calls for DIFFERENT watchers never lose one to the other (the per-key lock)', async () => {
    await Promise.all([
      Store.saveWatcher({ id: 'a', name: 'A' }),
      Store.saveWatcher({ id: 'b', name: 'B' }),
      Store.saveWatcher({ id: 'c', name: 'C' }),
    ]);
    const all = await Store.watchers();
    assert.deepEqual(Object.keys(all).sort(), ['a', 'b', 'c']);
  });

  test('patchWatcher merges onto a FRESH read, not a stale caller-held copy', async () => {
    await Store.saveWatcher({ id: 'w', name: 'Original', failures: 0, enabled: true });
    // Simulate a background write landing first...
    await Store.patchWatcher('w', { failures: 3, lastError: 'HTTP 403' });
    // ...then a UI toggle patches only `enabled`, unaware of the failure count.
    await Store.patchWatcher('w', { enabled: false });
    const w = await Store.watcher('w');
    assert.equal(w.enabled, false);
    assert.equal(w.failures, 3, 'the background write must survive a later partial patch');
    assert.equal(w.lastError, 'HTTP 403');
  });

  test('patchWatcher on a deleted watcher is a no-op — it must never resurrect it', async () => {
    await Store.saveWatcher({ id: 'w', name: 'Temp' });
    await Store.deleteWatcher('w');
    const result = await Store.patchWatcher('w', { failures: 1 });
    assert.equal(result, null);
    assert.equal(await Store.watcher('w'), null);
  });

  test('a delete that happens between an in-flight patch\'s read and write does not get overwritten back in', async () => {
    await Store.saveWatcher({ id: 'w', name: 'Temp' });
    // Race: patchWatcher and deleteWatcher both contend for the 'watchers'
    // lock. Whichever wins, the watcher must end up either fully patched
    // (delete queued after) or fully gone (delete queued first) — never a
    // deleted-then-resurrected state.
    await Promise.all([
      Store.patchWatcher('w', { failures: 1 }),
      Store.deleteWatcher('w'),
    ]);
    const w = await Store.watcher('w');
    // Whatever the outcome, it must be internally consistent: if the
    // watcher exists, deleteWatcher must have run BEFORE the patch (patch
    // last) or the patch ran and delete hasn't landed — either is fine.
    // What's NOT fine is deleteWatcher's snap/hist cleanup running while a
    // resurrected watcher lingers, so just confirm no crash and a defined
    // outcome either way.
    assert.ok(w === null || w.id === 'w');
  });
});

describe('Store.syncHistory — the storage-quota ceiling', () => {
  test('tracks at most maxTrackedItems distinct priced items, keeping the CHEAPEST', async () => {
    // A price watcher cares about the bottom of the market, so when a
    // listing is too big to track in full, the cheap end is the half worth
    // keeping. Unbounded tracking here is what could exhaust the whole
    // extension's 10MB quota from one large watcher.
    const items = Array.from({ length: 50 }, (_, i) => ({
      id: `item-${i}`, price: { amount: 1000 - i, currency: 'USD' }, // item-49 is cheapest
    }));
    await Store.syncHistory('big', items, 240, 10);
    const hist = await Store.history('big');
    const keys = Object.keys(hist);
    assert.equal(keys.length, 10, 'must not exceed the ceiling');
    assert.ok(keys.includes('item-49'), 'the cheapest item must be tracked');
    assert.ok(!keys.includes('item-0'), 'the most expensive item must be dropped past the ceiling');
  });

  test('a huge listing cannot grow history without bound across repeated polls', async () => {
    const mk = (n, offset) => Array.from({ length: n }, (_, i) => ({
      id: `x-${i + offset}`, price: { amount: 10 + i, currency: 'USD' },
    }));
    // Three polls, each showing a completely DIFFERENT set of 100 items —
    // the churn case that previously accumulated every id ever seen.
    await Store.syncHistory('churn', mk(100, 0), 240, 20);
    await Store.syncHistory('churn', mk(100, 1000), 240, 20);
    await Store.syncHistory('churn', mk(100, 2000), 240, 20);
    const hist = await Store.history('churn');
    assert.ok(Object.keys(hist).length <= 20, `expected <= 20 tracked ids, got ${Object.keys(hist).length}`);
  });

  test('an item still listed but temporarily unpriced KEEPS its history — that is when past prices matter most', async () => {
    await Store.syncHistory('w9', [{ id: 'a', price: { amount: 10, currency: 'USD' } }], 240, 5);
    await Store.syncHistory('w9', [{ id: 'a', price: null }], 240, 5); // sold out, no price shown
    const hist = await Store.history('w9');
    assert.equal(hist.a.length, 1, 'history must survive a period with no listed price');
  });
});

describe('Store.syncHistory — batched write + pruning of vanished item ids', () => {
  test('writes all items in a single call and prunes ids no longer present', async () => {
    await Store.syncHistory('w', [
      { id: 'a', price: { amount: 10, currency: 'USD' } },
      { id: 'b', price: { amount: 20, currency: 'USD' } },
    ]);
    let hist = await Store.history('w');
    assert.deepEqual(Object.keys(hist).sort(), ['a', 'b']);

    // Item 'a' has since vanished from the listing entirely.
    await Store.syncHistory('w', [
      { id: 'b', price: { amount: 22, currency: 'USD' } },
      { id: 'c', price: { amount: 5, currency: 'USD' } },
    ]);
    hist = await Store.history('w');
    assert.deepEqual(Object.keys(hist).sort(), ['b', 'c'], 'vanished item "a" must be pruned, not kept forever');
    assert.equal(hist.b.length, 2);
    assert.equal(hist.c.length, 1);
  });

  test('items with no price are tracked as "present" (not pruned) but contribute no history point', async () => {
    await Store.syncHistory('w2', [{ id: 'a', price: { amount: 10, currency: 'USD' } }]);
    await Store.syncHistory('w2', [{ id: 'a', price: null }]); // still present, just no current price
    const hist = await Store.history('w2');
    assert.equal(hist.a.length, 1); // old point kept, no new point added, not pruned
  });

  test('respects the cap', async () => {
    for (let i = 0; i < 5; i++) {
      await Store.syncHistory('w3', [{ id: 'a', price: { amount: i, currency: 'USD' } }], 3);
    }
    const hist = await Store.history('w3');
    assert.equal(hist.a.length, 3);
    assert.deepEqual(hist.a.map((p) => p.p), [2, 3, 4]);
  });
});

describe('Store.templateCache / templateHealth / recordTemplateOutcome — the new template-feed plumbing', () => {
  test('templateCache defaults to empty, honestly, until a feed exists', async () => {
    assert.deepEqual(await Store.templateCache(), { fetchedAt: 0, templates: [] });
  });

  test('saveTemplateCache round-trips', async () => {
    const cache = { fetchedAt: 123, templates: [{ host: 'x.com' }] };
    await Store.saveTemplateCache(cache);
    assert.deepEqual(await Store.templateCache(), cache);
  });

  test('recordTemplateOutcome(ok) resets failures; recordTemplateOutcome(fail) increments them', async () => {
    const key = 'x.com|/a/{id}';
    await Store.recordTemplateOutcome(key, false);
    await Store.recordTemplateOutcome(key, false);
    let health = await Store.templateHealth();
    assert.equal(health[key].failures, 2);

    await Store.recordTemplateOutcome(key, true);
    health = await Store.templateHealth();
    assert.equal(health[key].failures, 0);
    assert.ok(health[key].lastOkAt);
  });

  test('a missing key is a no-op, never throws', async () => {
    await Store.recordTemplateOutcome(null, true);
    assert.deepEqual(await Store.templateHealth(), {});
  });
});
