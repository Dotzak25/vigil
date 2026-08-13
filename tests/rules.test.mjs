import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, RULE_TYPES } from '../src/core/rules.js';
import { CHANGE } from '../src/core/diff.js';

const item = (id, meta = {}, extra = {}) => ({ id, label: id, available: true, status: 'available', price: null, meta, ...extra });

describe('seat_block — the odd-length-run regression (mustIncludeIds wiring)', () => {
  // 20-wide row, seats 10,11,12 free; seat 12 is the one that JUST reopened.
  const items = Array.from({ length: 20 }, (_, i) => {
    const label = i + 1;
    return item(`H-${label}`, { row: 'H', col: String(label) }, { available: [10, 11, 12].includes(label) });
  });

  test('a freshly-reopened seat at the edge of an odd-length run still fires an alert', () => {
    const watcher = { id: 'w', geometry: { numbering: 'sequential' }, rules: [{ type: 'seat_block', partySize: 2, minScore: 0 }] };
    const seat12 = items.find((it) => it.meta.col === '12');
    const changes = [{ type: CHANGE.REOPENED, item: seat12, from: { a: false } }];
    const hits = evaluate({ watcher, items, changes, firstRun: false, history: {} });
    assert.equal(hits.length, 1);
    assert.ok(hits[0].seatIds.includes(seat12.id));
  });

  test('an invalid section regex is guarded, not thrown — evaluate() degrades to "no section filter" instead of crashing the poll', () => {
    const watcher = {
      id: 'w', geometry: { numbering: 'sequential' },
      rules: [{ type: 'seat_block', partySize: 2, minScore: 0, section: 'Saal 1 (+VIP)' }], // invalid regex
    };
    const seat12 = items.find((it) => it.meta.col === '12');
    const changes = [{ type: CHANGE.REOPENED, item: seat12, from: { a: false } }];
    assert.doesNotThrow(() => evaluate({ watcher, items, changes, firstRun: false, history: {} }));
  });

  test('no fresh transition -> no hit, even with plenty of available seats', () => {
    const watcher = { id: 'w', geometry: { numbering: 'sequential' }, rules: [{ type: 'seat_block', partySize: 2, minScore: 0 }] };
    const hits = evaluate({ watcher, items, changes: [], firstRun: false, history: {} });
    assert.deepEqual(hits, []);
  });
});

describe('restock — only suppressed by row/col when seat_block is actually configured', () => {
  test('an item with row/col-shaped meta (a false-positive field mapping) still fires restock when there is no seat_block rule', () => {
    const watcher = { id: 'w', rules: [{ type: 'restock' }] }; // no seat_block configured
    const it = item('sneaker-1', { row: 'browseUrl', col: 'position-9' }); // suggestFields false-positive shape
    const changes = [{ type: CHANGE.REOPENED, item: it, from: { a: false, s: 'unavailable' } }];
    const hits = evaluate({ watcher, items: [it], changes, firstRun: false, history: {} });
    assert.equal(hits.length, 1);
    assert.match(hits[0].title, /back in stock/i);
  });

  test('a genuine seat is still excluded from restock when seat_block IS configured on the same watcher', () => {
    const watcher = { id: 'w', geometry: { numbering: 'sequential' }, rules: [{ type: 'seat_block' }, { type: 'restock' }] };
    const it = item('H-5', { row: 'H', col: '5' });
    const changes = [{ type: CHANGE.REOPENED, item: it, from: { a: false, s: 'unavailable' } }];
    const hits = evaluate({ watcher, items: [it], changes, firstRun: false, history: {} });
    assert.equal(hits.filter((h) => /back in stock/i.test(h.title)).length, 0);
  });

  test('RELEASED (presale opening) never fires restock, seat_block or not', () => {
    const watcher = { id: 'w', rules: [{ type: 'restock' }] };
    const it = item('x', {});
    const changes = [{ type: CHANGE.RELEASED, item: it, from: { a: false, s: 'notyet' } }];
    const hits = evaluate({ watcher, items: [it], changes, firstRun: false, history: {} });
    assert.deepEqual(hits, []);
  });
});

describe('price_below — the null-sentinel regression', () => {
  test('the shipped default (value: null) never fires, instead of firing at a limit of $0', () => {
    const watcher = { id: 'w', rules: [{ type: 'price_below', value: null }] };
    const it = item('x', {}, { price: { amount: 0, currency: 'USD' } });
    const changes = [{ type: CHANGE.PRICE_DOWN, item: it, from: { p: 120, c: 'USD' }, delta: -120 }];
    const hits = evaluate({ watcher, items: [it], changes, firstRun: false, history: {} });
    assert.deepEqual(hits, []);
  });

  test('an actually-configured threshold still fires correctly', () => {
    const watcher = { id: 'w', rules: [{ type: 'price_below', value: 100 }] };
    const it = item('x', {}, { price: { amount: 80, currency: 'USD' } });
    const changes = [{ type: CHANGE.PRICE_DOWN, item: it, from: { p: 120, c: 'USD' }, delta: -40 }];
    const hits = evaluate({ watcher, items: [it], changes, firstRun: false, history: {} });
    assert.equal(hits.length, 1);
  });

  test('a threshold in one currency never fires against a price in another', () => {
    const watcher = { id: 'w', rules: [{ type: 'price_below', value: 100, currency: 'USD' }] };
    const it = item('x', {}, { price: { amount: 80, currency: 'EUR' } });
    const changes = [{ type: CHANGE.PRICE_DOWN, item: it, from: { p: 120, c: 'EUR' }, delta: -40 }];
    const hits = evaluate({ watcher, items: [it], changes, firstRun: false, history: {} });
    assert.deepEqual(hits, []);
  });
});

describe('evaluate() housekeeping', () => {
  test('firstRun always returns no hits regardless of configured rules', () => {
    const watcher = { id: 'w', rules: [{ type: 'restock' }, { type: 'new_item' }] };
    const hits = evaluate({ watcher, items: [], changes: [{ type: CHANGE.APPEARED, item: item('x') }], firstRun: true, history: {} });
    assert.deepEqual(hits, []);
  });

  test('duplicate hit keys across rules are deduped', () => {
    // Construct a scenario where two different rule evaluations could
    // otherwise emit the same key — restock and new_item both keyed by item id
    // would collide only if literally identical; here we just confirm the
    // dedupe utility drops an exact repeat within a single evaluate() call.
    const watcher = { id: 'w', rules: [{ type: 'restock' }, { type: 'restock' }] }; // duplicated rule
    const it = item('x', {});
    const changes = [{ type: CHANGE.REOPENED, item: it, from: { a: false, s: 'unavailable' } }];
    const hits = evaluate({ watcher, items: [it], changes, firstRun: false, history: {} });
    assert.equal(hits.length, 1); // not 2
  });
});
