/**
 * diff.js — the part that actually catches the refund.
 *
 * Polling tells you the current state. Only a diff tells you a seat went from
 * taken to open at 11:04pm because someone cancelled. Every alert comes from a
 * transition, never a level — otherwise the same open seat would notify you
 * 288 times a day.
 */

export const CHANGE = {
  APPEARED: 'appeared',   // an id never seen before — new showtime, new listing
  REOPENED: 'reopened',   // unavailable -> available. The refund.
  RELEASED: 'released',   // notyet -> available. A presale opening, not a refund.
  CLOSED: 'closed',
  PRICE_DOWN: 'price_down',
  PRICE_UP: 'price_up',
  VANISHED: 'vanished',
};

export function toSnapshot(items) {
  const map = {};
  for (const it of items) {
    map[it.id] = {
      a: it.available,
      s: it.status,
      p: it.price?.amount ?? null,
      c: it.price?.currency ?? null,
      l: it.label,
    };
  }
  return { t: Date.now(), items: map, count: items.length };
}

export function diffItems(prev, items) {
  if (!prev) {
    // First sight of a page is not news. Establish a baseline silently, or
    // every new watch would scream once with the entire seat map.
    return { changes: [], firstRun: true };
  }

  const changes = [];
  const seen = new Set();

  for (const it of items) {
    seen.add(it.id);
    const before = prev.items[it.id];

    if (!before) {
      changes.push({ type: CHANGE.APPEARED, item: it });
      continue;
    }

    if (before.a !== true && it.available === true) {
      // A seat coming off "not on sale yet" is a scheduled presale opening,
      // not somebody's cancellation. Different event, different urgency.
      const type = before.s === 'notyet' ? CHANGE.RELEASED : CHANGE.REOPENED;
      changes.push({ type, item: it, from: before });
    } else if (before.a === true && it.available === false) {
      changes.push({ type: CHANGE.CLOSED, item: it, from: before });
    }

    const nowP = it.price?.amount ?? null;
    const nowC = it.price?.currency ?? null;
    // Never compare across currencies. A page switching from EUR to USD is a
    // locale change, not a 10% discount.
    const comparable = before.p != null && nowP != null && (!before.c || !nowC || before.c === nowC);

    if (comparable && nowP !== before.p) {
      changes.push({
        type: nowP < before.p ? CHANGE.PRICE_DOWN : CHANGE.PRICE_UP,
        item: it,
        from: before,
        delta: nowP - before.p,
        pct: before.p ? ((nowP - before.p) / before.p) * 100 : 0,
      });
    }
  }

  for (const id of Object.keys(prev.items)) {
    if (!seen.has(id)) {
      changes.push({ type: CHANGE.VANISHED, item: { id, label: prev.items[id].l } });
    }
  }

  return { changes, firstRun: false };
}

export function median(nums) {
  const s = nums.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!s.length) return null;
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Rolling median over a window, in days, restricted to a single currency.
 *
 * This is the honest baseline for "dropped drastically". Comparing to
 * yesterday flags noise; comparing to the last month flags a real dip. And
 * mixing currencies into one median produces a number that means nothing.
 */
export function baselinePrice(series, windowDays = 30, currency = null) {
  if (!series?.length) return null;

  const sameCcy = currency ? series.filter((x) => !x.c || x.c === currency) : series;
  if (!sameCcy.length) return null;

  const cutoff = Date.now() - windowDays * 864e5;
  const recent = sameCcy.filter((x) => x.t >= cutoff).map((x) => x.p);

  // Fall back to the full series if the window is too thin to be meaningful —
  // three points is the floor for a median worth acting on.
  return median(recent.length >= 3 ? recent : sameCcy.map((x) => x.p));
}
