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
