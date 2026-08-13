import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  getPath, pathToString, parseFieldPath, findItemArrays, extractItems,
  suggestFields, suggestAnchor, resolveItemsPath,
} from '../src/core/extract.js';

describe('getPath / pathToString / parseFieldPath', () => {
  test('getPath walks a mixed string/number path', () => {
    assert.equal(getPath({ a: [{ b: 1 }, { b: 2 }] }, ['a', 1, 'b']), 2);
  });
  test('getPath short-circuits through a null without throwing', () => {
    assert.equal(getPath({ a: null }, ['a', 'b']), null);
  });
  test('pathToString / parseFieldPath round-trip, numeric segments become numbers', () => {
    const path = parseFieldPath('a.1.b');
    assert.deepEqual(path, ['a', 1, 'b']);
  });
});

describe('itemsPath index-drift regression (suggestAnchor / resolveItemsPath)', () => {
  const payloadOf = (screenings) => ({ screenings });
  const screening = (id, seatCount) => ({
    id, seats: Array.from({ length: seatCount }, (_, i) => ({ seatId: `${id}-${i}`, available: true })),
  });

  test('suggestAnchor finds an "id"-shaped field on the sibling at the numeric index', () => {
    const payload = payloadOf([screening('s1', 2), screening('s2', 2), screening('s3', 2)]);
    const path = ['screenings', 1, 'seats'];
    const anchor = suggestAnchor(payload, path);
    assert.deepEqual(anchor, { parentPath: ['screenings'], key: 'id', value: 's2' });
  });

  test('resolveItemsPath re-locates the anchored sibling after the list reorders — the actual regression', () => {
    const before = payloadOf([screening('s1', 2), screening('s2', 2), screening('s3', 2)]);
    const path = ['screenings', 1, 'seats']; // pinned to index 1 = "s2"
    const anchor = suggestAnchor(before, path);
    const spec = { itemsPath: path, itemsAnchor: anchor };

    // s1 has vanished (a past showtime dropped off the list) — everything
    // shifts left. Index 1 is now "s3", not "s2".
    const after = payloadOf([screening('s2', 2), screening('s3', 2)]);

    const byRawIndex = getPath(after, path); // what the OLD code did — silently wrong
    assert.equal(byRawIndex[0].seatId, 's3-0', 'sanity: raw index really does point at the wrong screening now');

    const resolved = resolveItemsPath(after, spec);
    assert.equal(resolved[0].seatId, 's2-0', 'anchor must re-locate screening s2, not silently read whatever is now at index 1');
  });

  test('extractItems uses the anchor transparently — items still resolve to the correct screening', () => {
    const before = payloadOf([screening('s1', 1), screening('s2', 1)]);
    const path = ['screenings', 1, 'seats'];
    const anchor = suggestAnchor(before, path);
    const spec = { itemsPath: path, itemsAnchor: anchor, fields: { id: 'seatId', available: 'available' } };

    const after = payloadOf([screening('s2', 1)]); // s1 dropped off entirely
    const items = extractItems(after, spec);
    assert.equal(items.length, 1);
    assert.equal(items[0].id, 's2-0');
  });

  test('a stale anchor that no longer matches anything falls back to the raw path — no worse than before the fix', () => {
    const spec = {
      itemsPath: ['screenings', 1, 'seats'],
      itemsAnchor: { parentPath: ['screenings'], key: 'id', value: 'does-not-exist-anymore' },
    };
    const payload = payloadOf([screening('s1', 1), screening('s2', 1)]);
    const resolved = resolveItemsPath(payload, spec);
    assert.equal(resolved[0].seatId, 's2-0'); // raw index 1 fallback, same as no anchor at all
  });

  test('no numeric segment in the path -> suggestAnchor returns null, resolveItemsPath behaves exactly as plain getPath', () => {
    const payload = { a: { b: [{ x: 1 }, { x: 2 }] } };
    assert.equal(suggestAnchor(payload, ['a', 'b']), null);
    assert.deepEqual(resolveItemsPath(payload, { itemsPath: ['a', 'b'] }), payload.a.b);
  });

  test('a numeric-indexed sibling with no id-shaped field -> suggestAnchor returns null', () => {
    const payload = { list: [{ nothingIdLike: 1, seats: [] }] };
    assert.equal(suggestAnchor(payload, ['list', 0, 'seats']), null);
  });
});

describe('findItemArrays / suggestFields — sanity (deeper edge cases audited separately)', () => {
  test('finds a plausible seat array and suggests German field names correctly', () => {
    const payload = { hall: { seats: [
      { seatId: 'a', reihe: 'H', platz: '1', seatStatus: 'frei', preis: '1,00' },
      { seatId: 'b', reihe: 'H', platz: '2', seatStatus: 'besetzt', preis: '1,00' },
    ] } };
    const found = findItemArrays(payload);
    assert.ok(found.length > 0);
    const top = found[0];
    assert.equal(pathToString(top.path), 'hall.seats');
    const fields = suggestFields(top.sample);
    assert.equal(fields.id, 'seatId');
    assert.equal(fields.row, 'reihe');
    assert.equal(fields.col, 'platz');
  });
});
