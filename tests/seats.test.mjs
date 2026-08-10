import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { rowToIndex, colToIndex, labelToX, buildGeometry, scoreSeat, findBlocks, toMinimap } from '../src/core/seats.js';

describe('rowToIndex / colToIndex', () => {
  test('letters convert base-26, "A"->1 "Z"->26 "AA"->27', () => {
    assert.equal(rowToIndex('A'), 1);
    assert.equal(rowToIndex('Z'), 26);
    assert.equal(rowToIndex('AA'), 27);
  });
  test('numeric rows pass through', () => {
    assert.equal(rowToIndex(8), 8);
    assert.equal(rowToIndex('12'), 12);
  });
  test('colToIndex pulls the numeric part out of a label', () => {
    assert.equal(colToIndex('14'), 14);
    assert.equal(colToIndex(14), 14);
  });
});

describe('labelToX — the whole worldwide-correctness story', () => {
  test('sequential numbering: label is already the coordinate', () => {
    for (let n = 1; n <= 16; n++) assert.equal(labelToX(n, 'sequential'), n);
  });

  test('centerout numbering reproduces the README\'s exact physical order:\n' +
       '  15 13 11 9 7 5 3 1 | 2 4 6 8 10 12 14 16', () => {
    const byLabel = {};
    for (let n = 1; n <= 16; n++) byLabel[n] = labelToX(n, 'centerout');

    const physicalOrder = Object.entries(byLabel)
      .sort((a, b) => a[1] - b[1])
      .map(([label]) => Number(label));

    assert.deepEqual(physicalOrder, [15, 13, 11, 9, 7, 5, 3, 1, 2, 4, 6, 8, 10, 12, 14, 16]);
  });

  test('seats 1 and 2 are adjacent and straddle the centre under centerout', () => {
    assert.equal(labelToX(1, 'centerout'), 0);
    assert.equal(labelToX(2, 'centerout'), 1);
  });

  test('seats 8 and 9 are NOT physically adjacent under centerout (the bug this file exists to prevent)', () => {
    const x8 = labelToX(8, 'centerout');
    const x9 = labelToX(9, 'centerout');
    assert.notEqual(Math.abs(x8 - x9), 1, `labels 8 and 9 should not be physically adjacent (x8=${x8}, x9=${x9})`);
  });
});

function seatRow(row, labels, opts = {}) {
  const { available = () => true, section = null } = opts;
  return labels.map((label, i) => ({
    id: `${section ?? 's'}-${row}-${label}`,
    label: `${row}${label}`,
    available: available(label, i),
    status: 'available',
    price: null,
    meta: { row, col: String(label), section },
  }));
}

describe('findBlocks — regression test for the centre-out seat bug', () => {
  const items = seatRow('H', Array.from({ length: 16 }, (_, i) => i + 1));

  test('with correct centerout numbering, the best pair is labels 1 & 2, dead centre', () => {
    const { blocks } = findBlocks(items, { size: 2, numbering: 'centerout' });
    assert.ok(blocks.length > 0, 'expected at least one block');
    const best = blocks[0];
    const labels = best.cols.map(String).sort();
    assert.deepEqual(labels, ['1', '2'], `expected top block to be seats 1,2, got ${JSON.stringify(best.cols)}`);
  });

  test('labels 8 and 9 are never grouped into the same block under centerout', () => {
    const { blocks } = findBlocks(items, { size: 2, numbering: 'centerout' });
    const bad = blocks.find((b) => {
      const cols = b.cols.map(String);
      return cols.includes('8') && cols.includes('9');
    });
    assert.equal(bad, undefined, 'seats 8 and 9 must not be treated as adjacent');
  });

  test('under (wrong) sequential numbering, 8 & 9 WOULD be adjacent — demonstrating why the fix matters', () => {
    const { blocks } = findBlocks(items, { size: 2, numbering: 'sequential' });
    const found = blocks.find((b) => {
      const cols = b.cols.map(String);
      return cols.includes('8') && cols.includes('9');
    });
    assert.ok(found, 'under naive sequential numbering, labels 8 and 9 are (wrongly) adjacent');
  });
});

describe('scoreSeat — row/centre/edge scoring', () => {
  // A 12-row house (rows 1..12), 20 seats wide (1..20), sequential numbering
  // so seat 10/11 sit dead centre (x = 9/10, house centre = 9.5).
  const rows = 12;
  const width = 20;
  const items = [];
  for (let r = 1; r <= rows; r++) {
    items.push(...seatRow(r, Array.from({ length: width }, (_, i) => i + 1)));
  }

  test('a centred seat in a mid-to-back row scores much higher than a front-row corner seat', () => {
    const geo = buildGeometry(items, { numbering: 'sequential' });
    const centredMidRow = items.find((s) => s.meta.row === 8 && s.meta.col === '10');
    const frontCorner = items.find((s) => s.meta.row === 1 && s.meta.col === '1');

    const scoreCentred = scoreSeat({ ...centredMidRow, r: 8, x: 10 }, geo);
    const scoreCorner = scoreSeat({ ...frontCorner, r: 1, x: 1 }, geo);

    assert.ok(scoreCentred > 80, `expected a centred mid-row seat to score high, got ${scoreCentred}`);
    assert.ok(scoreCorner < 20, `expected a front-corner seat to score low, got ${scoreCorner}`);
    assert.ok(scoreCentred > scoreCorner);
  });

  test('the row penalty is asymmetric: being N rows too close costs more than N rows too far back', () => {
    const geo = buildGeometry(items, { numbering: 'sequential' });
    // idealRowFrac ~0.60 of an 11-row span (rows 1..12) -> ideal row ~= 7.6
    // Compare a row equally far in front of vs. behind the ideal row.
    const tooClose = scoreSeat({ r: 2, x: 10, section: null }, geo);   // well forward of ideal
    const tooFar = scoreSeat({ r: 12, x: 10, section: null }, geo);    // well back of ideal
    assert.ok(tooClose < tooFar, `expected forward overshoot (${tooClose}) to be penalised harder than backward overshoot (${tooFar})`);
  });

  test('centre seat outscores a same-row wall seat', () => {
    const geo = buildGeometry(items, { numbering: 'sequential' });
    const centre = scoreSeat({ r: 8, x: 10, section: null }, geo);
    const wall = scoreSeat({ r: 8, x: 1, section: null }, geo);
    assert.ok(centre > wall);
  });
});

describe('buildGeometry', () => {
  test('a real payload coordinate (meta.x) always wins over a numbering guess', () => {
    const items = [
      { id: 'a', available: true, meta: { row: 1, col: '1', x: 100 } },
      { id: 'b', available: true, meta: { row: 1, col: '2', x: 101 } },
      { id: 'c', available: true, meta: { row: 2, col: '1', x: 100 } },
      { id: 'd', available: true, meta: { row: 2, col: '2', x: 101 } },
      { id: 'e', available: true, meta: { row: 3, col: '1', x: 100 } },
      { id: 'f', available: true, meta: { row: 3, col: '2', x: 101 } },
    ];
    const geo = buildGeometry(items, { numbering: 'centerout' });
    assert.equal(geo.usedExplicitX, true);
    assert.deepEqual(geo.seats.map((s) => s.x).sort(), [100, 100, 100, 101, 101, 101]);
  });

  test('fewer than 6 resolvable seats -> no geometry (unreserved seating)', () => {
    const items = [
      { id: 'a', available: true, meta: { row: 1, col: '1' } },
      { id: 'b', available: true, meta: { row: 1, col: '2' } },
    ];
    assert.equal(buildGeometry(items), null);
  });

  test('sections are kept as separate rooms — same row/col in different sections do not merge', () => {
    const balcony = seatRow(12, [1, 2, 3, 4, 5, 6], { section: 'balcony' });
    const stalls = seatRow(12, [1, 2, 3, 4, 5, 6], { section: 'stalls' });
    const geo = buildGeometry([...balcony, ...stalls], { numbering: 'sequential' });
    assert.equal(geo.sections.size, 2);
  });
});

describe('toMinimap', () => {
  test('renders open/taken/highlighted/empty using o / x / ! / .', () => {
    const items = seatRow('A', [1, 2, 3, 4, 5, 6], { available: (label) => label % 2 === 0 });
    const map = toMinimap(items, [items[0].id], { numbering: 'sequential' });
    assert.ok(map, 'expected a minimap for >=6 resolvable seats');
    assert.equal(map.rows.length, 1);
    assert.equal(map.rows[0][0], '!'); // seat 1: odd (unavailable) but highlighted
    assert.equal(map.rows[0][1], 'o'); // seat 2: even -> available
  });
});
