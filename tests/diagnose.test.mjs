import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { diagnoseWatcher, silenceReport } from '../src/core/diagnose.js';

const seat = (row, col, available = false) => ({
  id: `${row}-${col}`, label: `Row ${row} seat ${col}`, available,
  status: available ? 'available' : 'unavailable', price: null,
  meta: { row, col: String(col), section: null },
});

const product = (id, available, price) => ({
  id, label: id, available, status: available ? 'available' : 'unavailable',
  price: price == null ? null : { amount: price, currency: 'USD' },
  meta: {},
});

describe('diagnoseWatcher — seat_block impossibilities', () => {
  // A 12-row x 20-seat house. Best possible seats score in the 90s.
  const house = [];
  for (let r = 1; r <= 12; r++) for (let c = 1; c <= 20; c++) house.push(seat(r, c));

  test('a minScore no seat in THIS house can reach is reported as never-fires, with the actual best score', () => {
    const w = { name: 'x', geometry: { numbering: 'sequential' }, rules: [{ type: 'seat_block', partySize: 2, minScore: 99 }] };
    const [p] = diagnoseWatcher(w, house);
    assert.equal(p.severity, 'blocked');
    assert.match(p.message, /can never fire/);
    assert.match(p.message, /score \d+/);
  });

  test('a reachable minScore produces no complaint', () => {
    const w = { name: 'x', geometry: { numbering: 'sequential' }, rules: [{ type: 'seat_block', partySize: 2, minScore: 70 }] };
    assert.deepEqual(diagnoseWatcher(w, house), []);
  });

  test('a party size larger than any contiguous run in the room is reported', () => {
    // A room where no row is wider than 3 seats.
    const narrow = [];
    for (let r = 1; r <= 4; r++) for (let c = 1; c <= 3; c++) narrow.push(seat(r, c));
    const w = { name: 'x', geometry: { numbering: 'sequential' }, rules: [{ type: 'seat_block', partySize: 8, minScore: 0 }] };
    const [p] = diagnoseWatcher(w, narrow);
    assert.equal(p.severity, 'blocked');
    assert.match(p.message, /adjacent seats exist/);
  });

  test('a seat_block rule on a page with no row/seat data is reported, and suggests the rule that would fit', () => {
    const items = [product('a', false, 10), product('b', true, 10), product('c', false, 10)];
    const w = { name: 'x', rules: [{ type: 'seat_block', partySize: 2, minScore: 70 }] };
    const [p] = diagnoseWatcher(w, items);
    assert.equal(p.severity, 'blocked');
    assert.match(p.message, /back in stock/i);
  });
});

describe('diagnoseWatcher — price rules', () => {
  test('a price rule on items with no readable price is reported as never-fires', () => {
    const items = [product('a', true, null), product('b', true, null)];
    const w = { name: 'x', rules: [{ type: 'price_drop', pct: 20 }] };
    const [p] = diagnoseWatcher(w, items);
    assert.equal(p.severity, 'blocked');
    assert.match(p.message, /Price field mapping/);
  });

  test('price_below with no threshold set is reported', () => {
    const items = [product('a', true, 100)];
    const w = { name: 'x', rules: [{ type: 'price_below', value: null }] };
    const [p] = diagnoseWatcher(w, items);
    assert.equal(p.severity, 'blocked');
    assert.match(p.message, /No price threshold/);
  });

  test('an implausibly low threshold warns but does not claim impossibility', () => {
    const items = [product('a', true, 500)];
    const w = { name: 'x', rules: [{ type: 'price_below', value: 5 }] };
    const [p] = diagnoseWatcher(w, items);
    assert.equal(p.severity, 'warn');
  });

  test('a sensible threshold produces no complaint', () => {
    const items = [product('a', true, 100)];
    const w = { name: 'x', rules: [{ type: 'price_below', value: 80 }] };
    assert.deepEqual(diagnoseWatcher(w, items), []);
  });
});

describe('diagnoseWatcher — restock and format rules', () => {
  test('restock where availability is unreadable everywhere is blocked', () => {
    const items = [{ id: 'a', available: null, meta: {} }, { id: 'b', available: null, meta: {} }];
    const w = { name: 'x', rules: [{ type: 'restock' }] };
    const [p] = diagnoseWatcher(w, items);
    assert.equal(p.severity, 'blocked');
  });

  test('restock where everything is already in stock warns gently, not as an error', () => {
    const items = [product('a', true, 10), product('b', true, 10)];
    const w = { name: 'x', rules: [{ type: 'restock' }] };
    const [p] = diagnoseWatcher(w, items);
    assert.equal(p.severity, 'warn');
    assert.match(p.message, /fine if you are watching/);
  });

  test('format_added with nothing ticked is blocked', () => {
    const items = [product('a', true, 10)];
    const w = { name: 'x', rules: [{ type: 'format_added', formats: [] }] };
    const [p] = diagnoseWatcher(w, items);
    assert.equal(p.severity, 'blocked');
  });

  test('format_added for a format absent from a page that DOES show other formats warns', () => {
    const items = [
      { id: 'a', label: 'Dune — IMAX', available: true, meta: {} },
      { id: 'b', label: 'Dune — Standard 2D', available: true, meta: {} },
    ];
    const w = { name: 'x', rules: [{ type: 'format_added', formats: ['4dx'] }] };
    const [p] = diagnoseWatcher(w, items);
    assert.equal(p.severity, 'warn');
    assert.match(p.message, /imax/i);
  });

  test('new_item is never flagged — a new id can always appear', () => {
    const items = [product('a', true, 10)];
    const w = { name: 'x', rules: [{ type: 'new_item' }] };
    assert.deepEqual(diagnoseWatcher(w, items), []);
  });
});

describe('diagnoseWatcher — guard rails', () => {
  test('a watcher with no rules at all is reported', () => {
    const [p] = diagnoseWatcher({ name: 'x', rules: [] }, [product('a', true, 1)]);
    assert.equal(p.severity, 'blocked');
    assert.match(p.message, /no rules/i);
  });

  test('with no items yet, it stays silent rather than guessing', () => {
    assert.deepEqual(diagnoseWatcher({ name: 'x', rules: [{ type: 'restock' }] }, []), []);
  });
});

describe('silenceReport — conservative by design', () => {
  const DAY = 864e5;

  test('a watch that HAS produced hits is never nagged', () => {
    const w = { name: 'x', runCount: 5000, hitCount: 3, createdAt: Date.now() - 90 * DAY };
    assert.equal(silenceReport(w), null);
  });

  test('a young watch is never nagged, however many runs', () => {
    const w = { name: 'x', runCount: 5000, hitCount: 0, createdAt: Date.now() - 2 * DAY };
    assert.equal(silenceReport(w), null);
  });

  test('a low-run watch is never nagged, however old', () => {
    const w = { name: 'x', runCount: 12, hitCount: 0, createdAt: Date.now() - 300 * DAY };
    assert.equal(silenceReport(w), null);
  });

  test('only a long-running, high-run, zero-hit watch is surfaced — and the wording allows that it may be fine', () => {
    const w = { name: 'Odeon IMAX', runCount: 3000, hitCount: 0, createdAt: Date.now() - 30 * DAY };
    const r = silenceReport(w);
    assert.equal(r.severity, 'warn');
    assert.match(r.message, /perfectly normal/);
    assert.match(r.message, /Odeon IMAX/);
  });
});
