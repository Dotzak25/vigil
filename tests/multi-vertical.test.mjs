/**
 * multi-vertical.test.mjs — proves VIGIL is not a cinema-only tool.
 *
 * The engine is one pipeline (identify -> extract -> diff -> rules) shared by
 * all three verticals from the README: cinema/events, limited-edition drops,
 * and resale. The earlier test files exercise the cinema/seat path in depth;
 * this file runs the SAME pipeline end-to-end for a sneaker restock (drop)
 * and a resale price drop, using the real market catalogue and default rules
 * — not a cinema seat in sight.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { identify } from '../src/core/registry.js';
import { extractItems } from '../src/core/extract.js';
import { toSnapshot, diffItems } from '../src/core/diff.js';
import { evaluate } from '../src/core/rules.js';
import { MARKET_COUNT } from '../src/catalog/markets.js';

describe('the catalogue really does cover non-cinema sites', () => {
  test('37 marketplaces across drop/resale/ticket, as the README claims', () => {
    assert.equal(MARKET_COUNT, 37);
  });

  test('identify() recognises a sneaker drop site and proposes restock + new_item', () => {
    const p = identify('https://www.nike.com/launch/t/some-drop');
    assert.equal(p.kind, 'drop');
    assert.equal(p.name, 'Nike / SNKRS');
    assert.equal(p.variantAxis, 'size');
    assert.deepEqual(p.rules.map((r) => r.type), ['restock', 'new_item']);
  });

  test('identify() recognises a resale marketplace and proposes price_drop + price_below', () => {
    const p = identify('https://stockx.com/some-sneaker');
    assert.equal(p.kind, 'resale');
    assert.equal(p.name, 'StockX');
    assert.deepEqual(p.rules.map((r) => r.type), ['price_drop', 'price_below']);
  });

  test('identify() recognises a watch resale site with a "reference" variant axis', () => {
    const p = identify('https://www.chrono24.com/some-watch');
    assert.equal(p.kind, 'resale');
    assert.equal(p.variantAxis, 'reference');
  });
});

describe('end-to-end: a sneaker size restocking (drop vertical)', () => {
  // A poll -> poll transition with no seats, no rows, no cinema anywhere.
  const sizesUnavailable = [
    { id: 'US-8', label: 'US 8', available: false, price: 150, size: '8' },
    { id: 'US-9', label: 'US 9', available: false, price: 150, size: '9' },
    { id: 'US-10', label: 'US 10', available: false, price: 150, size: '10' },
  ];
  const sizesRestocked = [
    { id: 'US-8', label: 'US 8', available: false, price: 150, size: '8' },
    { id: 'US-9', label: 'US 9', available: true, price: 150, size: '9' }, // <- restocked
    { id: 'US-10', label: 'US 10', available: false, price: 150, size: '10' },
  ];

  const spec = { fields: { id: 'id', label: 'label', available: 'available', price: 'price', size: 'size' } };
  const watcher = { id: 'w1', rules: [{ type: 'restock' }, { type: 'new_item' }] };

  test('first poll is silent (baseline), then a size flip fires a restock Hit', () => {
    const before = extractItems(sizesUnavailable, spec);
    const baseline = diffItems(null, before);
    assert.equal(baseline.firstRun, true);
    assert.deepEqual(evaluate({ watcher, items: before, changes: baseline.changes, firstRun: true }), []);

    const snap = toSnapshot(before);
    const after = extractItems(sizesRestocked, spec);
    const { changes, firstRun } = diffItems(snap, after);
    assert.equal(firstRun, false);

    const hits = evaluate({ watcher, items: after, changes, firstRun });
    assert.equal(hits.length, 1);
    assert.match(hits[0].title, /back in stock/i);
    assert.match(hits[0].body, /US 9/);
    assert.match(hits[0].body, /150\.00/); // formatPrice with no currency detected -> plain decimal, still legible
  });
});

describe('end-to-end: a resale price drop vs rolling median (resale vertical)', () => {
  const spec = { fields: { id: 'id', label: 'label', price: 'price' }, defaultCurrency: 'USD' };
  const watcher = { id: 'w2', rules: [{ type: 'price_drop', pct: 20, windowDays: 30 }] };

  test('a price fall past 20% of the 30-day median fires; a small dip does not', () => {
    const now = Date.now();
    // A rolling history sitting around $200 for the last month.
    const history = {
      'listing-1': [
        { t: now - 20 * 864e5, p: 200, c: 'USD' },
        { t: now - 15 * 864e5, p: 205, c: 'USD' },
        { t: now - 10 * 864e5, p: 195, c: 'USD' },
        { t: now - 5 * 864e5, p: 200, c: 'USD' },
      ],
    };

    const prevRaw = [{ id: 'listing-1', label: 'Air Jordan 1 "Lost & Found"', price: 200 }];
    const prev = toSnapshot(extractItems(prevRaw, spec));

    // A 40% drop -> should fire.
    const bigDropRaw = [{ id: 'listing-1', label: 'Air Jordan 1 "Lost & Found"', price: 120 }];
    const bigDrop = diffItems(prev, extractItems(bigDropRaw, spec));
    const bigHits = evaluate({ watcher, items: [], changes: bigDrop.changes, firstRun: false, history });
    assert.equal(bigHits.length, 1);
    assert.match(bigHits[0].title, /down 4\d% vs 30-day median/i);

    // A 2.5% drop -> should NOT fire (below the 20% threshold).
    const smallDropRaw = [{ id: 'listing-1', label: 'Air Jordan 1 "Lost & Found"', price: 195 }];
    const smallDrop = diffItems(prev, extractItems(smallDropRaw, spec));
    const smallHits = evaluate({ watcher, items: [], changes: smallDrop.changes, firstRun: false, history });
    assert.equal(smallHits.length, 0);
  });

  test('a price rise never fires a price_drop hit', () => {
    const prev = toSnapshot(extractItems([{ id: 'listing-1', price: 100 }], spec));
    const { changes } = diffItems(prev, extractItems([{ id: 'listing-1', price: 250 }], spec));
    const hits = evaluate({ watcher, items: [], changes, firstRun: false, history: {} });
    assert.equal(hits.length, 0);
  });
});
