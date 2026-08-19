import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { toSnapshot, diffItems, median, baselinePrice, CHANGE } from '../src/core/diff.js';

const item = (id, available, status, price) => ({ id, label: id, available, status, price });

describe('diffItems — every alert is a transition, never a level', () => {
  test('first sight of a page is silent (no changes), even if seats are open', () => {
    const items = [item('a', true, 'available', null)];
    const { changes, firstRun } = diffItems(null, items);
    assert.equal(firstRun, true);
    assert.deepEqual(changes, []);
  });

  test('unavailable -> available is REOPENED (the refund)', () => {
    const prev = toSnapshot([item('a', false, 'unavailable', null)]);
    const { changes } = diffItems(prev, [item('a', true, 'available', null)]);
    assert.equal(changes.length, 1);
    assert.equal(changes[0].type, CHANGE.REOPENED);
  });

  test('notyet -> available is RELEASED, not REOPENED — presale opening != cancellation', () => {
    const prev = toSnapshot([item('a', false, 'notyet', null)]);
    const { changes } = diffItems(prev, [item('a', true, 'available', null)]);
    assert.equal(changes.length, 1);
    assert.equal(changes[0].type, CHANGE.RELEASED);
    assert.notEqual(changes[0].type, CHANGE.REOPENED);
  });

  test('available -> unavailable is CLOSED', () => {
    const prev = toSnapshot([item('a', true, 'available', null)]);
    const { changes } = diffItems(prev, [item('a', false, 'unavailable', null)]);
    assert.equal(changes[0].type, CHANGE.CLOSED);
  });

  test('a brand-new id is APPEARED', () => {
    const prev = toSnapshot([item('a', true, 'available', null)]);
    const { changes } = diffItems(prev, [item('a', true, 'available', null), item('b', true, 'available', null)]);
    assert.equal(changes.length, 1);
    assert.equal(changes[0].type, CHANGE.APPEARED);
    assert.equal(changes[0].item.id, 'b');
  });

  test('an id that drops out of the payload is VANISHED', () => {
    const prev = toSnapshot([item('a', true, 'available', null), item('b', true, 'available', null)]);
    const { changes } = diffItems(prev, [item('a', true, 'available', null)]);
    assert.equal(changes.length, 1);
    assert.equal(changes[0].type, CHANGE.VANISHED);
    assert.equal(changes[0].item.id, 'b');
  });

  test('no change at all -> empty changes (silence is the product working)', () => {
    const prev = toSnapshot([item('a', true, 'available', { amount: 10, currency: 'USD' })]);
    const { changes } = diffItems(prev, [item('a', true, 'available', { amount: 10, currency: 'USD' })]);
    assert.deepEqual(changes, []);
  });

  test('price drop/rise within the same currency fires PRICE_DOWN/PRICE_UP', () => {
    const prev = toSnapshot([item('a', true, 'available', { amount: 100, currency: 'USD' })]);
    const down = diffItems(prev, [item('a', true, 'available', { amount: 80, currency: 'USD' })]).changes[0];
    assert.equal(down.type, CHANGE.PRICE_DOWN);
    assert.equal(down.delta, -20);

    const up = diffItems(prev, [item('a', true, 'available', { amount: 120, currency: 'USD' })]).changes[0];
    assert.equal(up.type, CHANGE.PRICE_UP);
  });

  test('a price change across DIFFERENT currencies never fires — locale change, not a discount', () => {
    const prev = toSnapshot([item('a', true, 'available', { amount: 100, currency: 'EUR' })]);
    const { changes } = diffItems(prev, [item('a', true, 'available', { amount: 90, currency: 'USD' })]);
    assert.equal(changes.find((c) => c.type === CHANGE.PRICE_DOWN || c.type === CHANGE.PRICE_UP), undefined);
  });
});

describe('toSnapshot / diffItems — hostile item ids from third-party payloads', () => {
  test('an item whose id is "__proto__" is tracked normally instead of vanishing', () => {
    const items = [item('__proto__', true, 'available', null), item('normal', true, 'available', null)];
    const snap = toSnapshot(items);
    assert.deepEqual(Object.keys(snap.items).sort(), ['__proto__', 'normal']);
  });

  test('a "__proto__" item does not corrupt lookups for other single-letter ids', () => {
    // The snapshot's own field names are a/s/p/c/l. When "__proto__"
    // poisoned the map's prototype, an item with id "a" resolved through it
    // to a primitive, read as already-known, and its first appearance was
    // never reported.
    const prevSnap = toSnapshot([item('__proto__', true, 'available', null)]);
    const { changes } = diffItems(prevSnap, [item('a', true, 'available', null)]);
    assert.equal(changes.filter((c) => c.type === CHANGE.APPEARED && c.item.id === 'a').length, 1);
  });

  test('an id matching an Object.prototype member still reports as new (JSON-roundtripped snapshot)', () => {
    // A snapshot read back from storage has an ordinary prototype again, so
    // a bare lookup of "constructor" would inherit a function and read as
    // already-known.
    const stored = JSON.parse(JSON.stringify(toSnapshot([item('x', true, 'available', null)])));
    const { changes } = diffItems(stored, [item('constructor', true, 'available', null)]);
    assert.ok(changes.some((c) => c.type === CHANGE.APPEARED && c.item.id === 'constructor'));
  });

  test('numeric and string ids that collide after coercion are keyed consistently', () => {
    const snap = toSnapshot([item(1, true, 'available', null), item('2', true, 'available', null)]);
    assert.deepEqual(Object.keys(snap.items).sort(), ['1', '2']);
  });
});

describe('median', () => {
  test('odd and even length arrays', () => {
    assert.equal(median([3, 1, 2]), 2);
    assert.equal(median([1, 2, 3, 4]), 2.5);
  });
  test('ignores non-finite values, empty -> null', () => {
    assert.equal(median([1, NaN, 3, Infinity]), 2);
    assert.equal(median([]), null);
  });
});

describe('baselinePrice — the honest baseline for "dropped drastically"', () => {
  test('never mixes currencies into one median', () => {
    const now = Date.now();
    const series = [
      { t: now, p: 100, c: 'USD' },
      { t: now, p: 100, c: 'USD' },
      { t: now, p: 100, c: 'USD' },
      { t: now, p: 9999, c: 'EUR' }, // must never enter the USD median
    ];
    assert.equal(baselinePrice(series, 30, 'USD'), 100);
  });

  test('falls back to the full series when the recent window is too thin (<3 points)', () => {
    const now = Date.now();
    const old = now - 200 * 864e5; // 200 days ago, outside a 30-day window
    const series = [
      { t: old, p: 10, c: 'USD' },
      { t: old, p: 20, c: 'USD' },
      { t: old, p: 30, c: 'USD' },
    ];
    // 0 points in the last 30 days (<3) -> falls back to the full series median
    assert.equal(baselinePrice(series, 30, 'USD'), 20);
  });

  test('empty series -> null', () => {
    assert.equal(baselinePrice([], 30, 'USD'), null);
  });

  test('with NO currency argument it still refuses to blend currencies — it uses the most recent one', () => {
    // The old fallback used the whole mixed series, producing a baseline no
    // real price would ever sit near: exactly the bogus "dropped
    // drastically" this function exists to prevent.
    const now = Date.now();
    const series = [
      { t: now - 4000, p: 9000, c: 'EUR' },
      { t: now - 3000, p: 9500, c: 'EUR' },
      { t: now - 2000, p: 20, c: 'USD' },
      { t: now - 1000, p: 21, c: 'USD' },
      { t: now, p: 20, c: 'USD' },
    ];
    assert.equal(baselinePrice(series, 30), 20, 'should use the current (USD) currency, not blend in EUR');
  });
});
