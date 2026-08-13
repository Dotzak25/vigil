/**
 * seats.js — "good seats" made into a number, in any country.
 *
 * THE BUG THIS FILE EXISTS TO PREVENT
 *
 * Anglophone cinemas number seats left to right: 1,2,3,…  Much of Europe —
 * German-speaking, Nordic, French, Central and Eastern markets — numbers them
 * outward from the centre:
 *
 *        physical layout:   15 13 11  9  7  5  3  1 │ 2  4  6  8 10 12 14 16
 *                                                   ^
 *                                             centre of house
 *
 * Read those labels as x-coordinates and everything inverts. Seats 8 and 9
 * look adjacent and central; they are actually on opposite sides of the room.
 * Seats 1 and 2 — the best pair in the house — look like the far-left edge.
 *
 * So position is never read from the label. It is resolved into a physical
 * coordinate first, and every score works off that.
 */

/** "A"→1, "Z"→26, "AA"→27. Numeric rows pass through. */
export function rowToIndex(row) {
  if (row == null) return null;
  if (typeof row === 'number') return row;
  const s = String(row).trim().toUpperCase();
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  const m = s.match(/^([A-Z]+)/);
  if (!m) {
    const n = s.match(/\d+/);
    return n ? parseInt(n[0], 10) : null;
  }
  let n = 0;
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

export function colToIndex(col) {
  if (col == null) return null;
  if (typeof col === 'number') return col;
  const m = String(col).match(/-?\d+/);
  return m ? parseInt(m[0], 10) : null;
}

/**
 * Label → physical x. The whole worldwide correctness story is these lines.
 *
 * centre-out: odd numbers run leftward from the centre, evens run rightward.
 *   seat 1 → 0, 3 → -1, 5 → -2 …    seat 2 → 1, 4 → 2, 6 → 3 …
 * which produces one contiguous ascending run across the row.
 */
export function labelToX(col, numbering) {
  const n = colToIndex(col);
  if (n == null) return null;
  if (numbering === 'centerout') {
    return n % 2 === 1 ? -((n + 1) / 2) + 1 : n / 2;
  }
  return n;
}

const clamp01 = (x) => Math.max(0, Math.min(1, x));

export const AUDITORIUM_PROFILES = {
  standard: { idealRowFrac: 0.60, fwdTol: 0.46, backTol: 0.58, wRow: 0.42, wCenter: 0.48, wEdge: 0.10 },
  imax:     { idealRowFrac: 0.64, fwdTol: 0.38, backTol: 0.50, wRow: 0.44, wCenter: 0.50, wEdge: 0.06 },
  premium:  { idealRowFrac: 0.58, fwdTol: 0.50, backTol: 0.62, wRow: 0.38, wCenter: 0.46, wEdge: 0.16 },
};

/**
 * Build physical geometry.
 *
 * @param opts.numbering  'sequential' | 'centerout' | 'auto'
 * @param opts.rowOrder   'front-first' | 'back-first' | 'auto'
 *
 * If the payload carries a real coordinate (meta.x), it always wins over any
 * convention guess — a number the site itself computed beats an inference.
 */
export function buildGeometry(items, opts = {}) {
  const numbering = opts.numbering === 'auto' ? 'sequential' : opts.numbering || 'sequential';
  const backFirst = opts.rowOrder === 'back-first';

  const seats = items
    .map((it) => {
      const r = rowToIndex(it.meta?.row);
      const explicitX = it.meta?.x != null ? Number(it.meta.x) : null;
      const x = Number.isFinite(explicitX) ? explicitX : labelToX(it.meta?.col, numbering);
      return { ...it, r, x, section: it.meta?.section ?? null, hasExplicitX: Number.isFinite(explicitX) };
    })
    .filter((s) => s.r != null && s.x != null);

  if (seats.length < 6) return null;

  // Sections are separate rooms as far as geometry is concerned. Without this,
  // row 12 of the balcony merges with row 12 of the stalls.
  const sections = new Map();
  for (const s of seats) {
    const key = s.section == null ? '' : String(s.section);
    if (!sections.has(key)) sections.set(key, []);
    sections.get(key).push(s);
  }

  // A real coordinate from the page always wins over a numbering guess — but
  // "real" often means pixels (100, 124, 148…) or percentages (12.5, 25.0…),
  // not integers spaced 1 apart. Adjacency below is exactly "x === prev.x+1",
  // so on raw pixel/percent values every seat looks isolated and no block is
  // ever found, while describeGeometry() confidently reports the positions
  // as exact. Only the RELATIVE ORDER of coordinates matters for adjacency
  // and centring, so rank-normalise them to sequential integers per section —
  // this is a no-op when x already is sequential integers.
  for (const [, list] of sections) {
    if (list.some((s) => s.hasExplicitX)) {
      const distinct = [...new Set(list.map((s) => s.x))].sort((a, b) => a - b);
      const rank = new Map(distinct.map((v, i) => [v, i]));
      for (const s of list) s.x = rank.get(s.x);
    }
  }

  const built = new Map();
  for (const [key, list] of sections) {
    const rows = [...new Set(list.map((s) => s.r))].sort((a, b) => a - b);
    const rowSpan = rows.length > 1 ? rows[rows.length - 1] - rows[0] : 1;

    const extents = new Map();
    for (const s of list) {
      const e = extents.get(s.r) || { min: Infinity, max: -Infinity };
      e.min = Math.min(e.min, s.x);
      e.max = Math.max(e.max, s.x);
      extents.set(s.r, e);
    }

    // House centre from the widest row, not per-row, so a short front row
    // doesn't redefine where the middle of the auditorium is.
    const widest = [...extents.values()].reduce((a, b) => (b.max - b.min > a.max - a.min ? b : a));
    const houseCenter = (widest.min + widest.max) / 2;
    const houseHalfWidth = Math.max(1, (widest.max - widest.min) / 2);

    built.set(key, {
      seats: list, rows, rowMin: rows[0], rowSpan: rowSpan || 1,
      extents, houseCenter, houseHalfWidth, backFirst,
    });
  }

  return {
    sections: built,
    seats,
    numbering,
    usedExplicitX: seats.some((s) => s.hasExplicitX),
  };
}

function sectionOf(geo, seat) {
  return geo.sections.get(seat.section == null ? '' : String(seat.section));
}

/** Score a single seat 0–100 on physical position. */
export function scoreSeat(seat, geo, profile = 'standard') {
  const p = AUDITORIUM_PROFILES[profile] || AUDITORIUM_PROFILES.standard;
  const sec = sectionOf(geo, seat);
  if (!sec) return 0;

  let rowFrac = (seat.r - sec.rowMin) / sec.rowSpan;
  if (sec.backFirst) rowFrac = 1 - rowFrac;

  const dRow = rowFrac - p.idealRowFrac;
  const tol = dRow < 0 ? p.fwdTol : p.backTol;
  const rowScore = 1 - clamp01(Math.pow(Math.abs(dRow) / tol, 1.5));

  // Centre measured against the house centreline in physical space.
  const centerScore = 1 - clamp01(Math.abs(seat.x - sec.houseCenter) / sec.houseHalfWidth);

  const e = sec.extents.get(seat.r);
  const edgeDist = e ? Math.min(seat.x - e.min, e.max - seat.x) : 0;
  const edgeScore = clamp01(edgeDist / 3);

  return Math.round(100 * (p.wRow * rowScore + p.wCenter * centerScore + p.wEdge * edgeScore));
}

/**
 * Runs of `size` physically adjacent available seats.
 * Adjacency is a gap of exactly 1 in x — never in label.
 *
 * @param opts.mustIncludeIds  Set of item ids that must survive the overlap
 *   dedup below if any block containing one exists. Without this, a run of
 *   N free seats produces N-1 overlapping candidate blocks and the dedup
 *   keeps an arbitrary, score-ordered subset — for an odd-length run this
 *   can silently drop the ONE block that contains the seat which just
 *   opened, so the alert this function exists to produce never fires. This
 *   is what rules.js passes the freshly-reopened seat ids as, every time.
 */
export function findBlocks(items, opts = {}) {
  const { size = 2, profile = 'standard', minScore = 0, mustIncludeIds = null } = opts;
  const geo = buildGeometry(items, opts);
  if (!geo) return { geometry: null, blocks: [], reason: 'no-geometry' };

  const groups = new Map();
  for (const s of geo.seats) {
    const key = `${s.section ?? ''}|${s.r}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }

  const blocks = [];

  for (const rowSeats of groups.values()) {
    rowSeats.sort((a, b) => a.x - b.x);

    let run = [];
    const flush = () => {
      if (run.length >= size) {
        for (let i = 0; i + size <= run.length; i++) {
          const win = run.slice(i, i + size);
          const scores = win.map((s) => scoreSeat(s, geo, profile));
          blocks.push({
            row: win[0].meta?.row ?? win[0].r,
            rowIndex: win[0].r,
            section: win[0].section,
            cols: win.map((s) => s.meta?.col ?? s.x),
            ids: win.map((s) => s.id),
            seats: win,
            score: Math.round(scores.reduce((a, b) => a + b, 0) / size),
            price: win.reduce((a, s) => a + (s.price?.amount ?? 0), 0) || null,
            currency: win.find((s) => s.price?.currency)?.price?.currency || null,
          });
        }
      }
      run = [];
    };

    for (const s of rowSeats) {
      const contiguous = run.length === 0 || s.x === run[run.length - 1].x + 1;
      if (s.available === true && contiguous) run.push(s);
      else {
        flush();
        if (s.available === true) run = [s];
      }
    }
    flush();
  }

  const filtered = blocks.filter((b) => b.score >= minScore).sort((a, b) => b.score - a.score);

  const overlaps = (kept, b) =>
    kept.some((k) => k.rowIndex === b.rowIndex && k.section === b.section && k.ids.some((id) => b.ids.includes(id)));

  // Two passes: first guarantee every non-overlapping block touching a
  // must-include id makes it in — regardless of score or the cap below —
  // then fill remaining slots by score as before. A must-include block can
  // still lose to an EARLIER must-include block it overlaps with (there's
  // no ambiguity to resolve there: they share a seat, only one can be kept),
  // but it can never lose to an unrelated higher-scoring block the way it
  // could when everything was a single score-sorted pass.
  const must = mustIncludeIds ? filtered.filter((b) => b.ids.some((id) => mustIncludeIds.has(id))) : [];
  const rest = mustIncludeIds ? filtered.filter((b) => !b.ids.some((id) => mustIncludeIds.has(id))) : filtered;

  const kept = [];
  for (const b of must) {
    if (!overlaps(kept, b)) kept.push(b);
  }
  for (const b of rest) {
    if (kept.length >= 20) break;
    if (!overlaps(kept, b)) kept.push(b);
  }

  kept.sort((a, b) => b.score - a.score);
  return { geometry: geo, blocks: kept };
}

/**
 * Compact grid for the popup minimap, drawn in PHYSICAL order so what you see
 * matches what you'd see walking into the room.
 *   '!' just opened   'o' open   'x' taken   '.' aisle or no seat
 */
export function toMinimap(items, highlightIds = [], opts = {}) {
  const geo = buildGeometry(items, opts);
  if (!geo) return null;

  // Largest section only — a minimap of an entire arena is unreadable at 5px.
  const [, sec] = [...geo.sections.entries()].reduce((a, b) => (b[1].seats.length > a[1].seats.length ? b : a));

  const hi = new Set(highlightIds);
  const index = new Map();
  for (const s of sec.seats) index.set(`${s.r}:${s.x}`, s);

  const left = Math.min(...[...sec.extents.values()].map((e) => e.min));
  const right = Math.max(...[...sec.extents.values()].map((e) => e.max));

  const orderedRows = sec.backFirst ? [...sec.rows].reverse() : sec.rows;
  const rows = orderedRows.map((r) => {
    let line = '';
    for (let x = left; x <= right; x++) {
      const s = index.get(`${r}:${x}`);
      line += !s ? '.' : hi.has(s.id) ? '!' : s.available === true ? 'o' : 'x';
    }
    return line;
  });

  return { rows, width: right - left + 1, section: sec.seats[0]?.section ?? null };
}

/**
 * Honest capability report for the setup UI.
 *
 * There is no way to detect centre-out numbering from labels alone — the label
 * set {1..20} is identical under both conventions. It can only come from a
 * coordinate in the payload, or from the chain profile, or from the user
 * looking at the minimap and saying "that's not my cinema". So the UI asks,
 * rather than guessing and being confidently wrong.
 */
export function describeGeometry(items, opts = {}) {
  const withRC = items.filter((i) => i.meta?.row != null && i.meta?.col != null).length;
  if (withRC < 6) {
    return {
      ok: false,
      seatScoring: false,
      message:
        'No row/seat data found — this looks like unreserved seating. Seat rules are off; use "back in stock" instead.',
    };
  }
  const geo = buildGeometry(items, opts);
  if (!geo) return { ok: false, seatScoring: false, message: 'Row and seat values could not be read as positions.' };

  return {
    ok: true,
    seatScoring: true,
    sections: geo.sections.size,
    seats: geo.seats.length,
    usedExplicitX: geo.usedExplicitX,
    message: geo.usedExplicitX
      ? 'Using real coordinates from the page — seat positions are exact.'
      : `Positions inferred from seat numbers using "${geo.numbering}" numbering. Check the map below looks like your cinema.`,
  };
}
