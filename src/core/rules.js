/**
 * rules.js — deciding what's worth interrupting you for.
 *
 * Changes from diff.js are run past a watcher's rules. Anything that passes
 * becomes a Hit: a title, a line of detail, a priority.
 */

import { CHANGE, baselinePrice } from './diff.js';
import { findBlocks } from './seats.js';
import { formatPrice } from './money.js';
import { detectFormats, formatLabel } from '../catalog/vocab.js';

export const RULE_TYPES = {
  SEAT_BLOCK: 'seat_block',
  RESTOCK: 'restock',
  NEW_ITEM: 'new_item',
  PRICE_BELOW: 'price_below',
  PRICE_DROP: 'price_drop',
  FORMAT_ADDED: 'format_added',
};

/**
 * @param ctx { watcher, items, changes, firstRun, history, geometry }
 */
export function evaluate(ctx) {
  const { watcher, items, changes, firstRun, history } = ctx;
  if (firstRun) return [];

  const hasSeatBlock = (watcher.rules || []).some((r) => r.type === RULE_TYPES.SEAT_BLOCK);

  const hits = [];
  for (const rule of watcher.rules || []) {
    switch (rule.type) {
      case RULE_TYPES.SEAT_BLOCK: hits.push(...seatBlockRule(rule, items, changes, watcher)); break;
      case RULE_TYPES.RESTOCK: hits.push(...restockRule(rule, changes, hasSeatBlock)); break;
      case RULE_TYPES.NEW_ITEM: hits.push(...newItemRule(rule, changes)); break;
      case RULE_TYPES.FORMAT_ADDED: hits.push(...formatAddedRule(rule, changes)); break;
      case RULE_TYPES.PRICE_BELOW: hits.push(...priceBelowRule(rule, changes)); break;
      case RULE_TYPES.PRICE_DROP: hits.push(...priceDropRule(rule, changes, history)); break;
    }
  }
  return dedupe(hits);
}

/* ---------- seats ---------- */

function seatBlockRule(rule, items, changes, watcher) {
  // Only recompute geometry if something actually opened up.
  const opened = changes.filter(
    (c) =>
      c.type === CHANGE.REOPENED ||
      c.type === CHANGE.RELEASED ||
      (c.type === CHANGE.APPEARED && c.item.available === true)
  );
  if (!opened.length) return [];

  const openedIds = new Set(opened.map((c) => c.item.id));

  const geo = watcher.geometry || {};
  // mustIncludeIds: without this, an odd-length run of free seats produces
  // overlapping candidate blocks and the score-based dedup in findBlocks can
  // discard the ONE block that contains the seat which just reopened — the
  // alert this rule exists to produce would silently never fire.
  const { blocks } = findBlocks(items, {
    size: rule.partySize || 2,
    profile: rule.profile || 'standard',
    minScore: rule.minScore ?? 60,
    numbering: geo.numbering || 'sequential',
    rowOrder: geo.rowOrder || 'front-first',
    mustIncludeIds: openedIds,
  });
  if (!blocks.length) return [];

  // A block counts only if one of the newly-freed seats is in it — otherwise
  // good seats that have sat there all week would re-alert every poll.
  let fresh = blocks.filter((b) => b.ids.some((id) => openedIds.has(id)));

  if (rule.rows?.length) {
    const want = new Set(rule.rows.map((r) => String(r).toUpperCase()));
    fresh = fresh.filter((b) => want.has(String(b.row).toUpperCase()));
  }
  if (rule.section) {
    // A user-typed regex (copied off a section name like "Saal 1 (+VIP)" or
    // "Circle [A") can easily be invalid. matcher() below already guards the
    // identical case for restock/new_item's `match` field — this didn't,
    // which meant a bad section filter threw out of evaluate() entirely,
    // landing in the poll's failure path: backoff, a "keeps failing"
    // notification, and the shared template's health getting penalised for
    // a fault that has nothing to do with the template.
    const re = safeRegExp(rule.section);
    fresh = re ? fresh.filter((b) => re.test(String(b.section ?? ''))) : fresh;
  }
  if (!fresh.length) return [];

  const best = fresh[0];
  const wasPresale = opened.some((c) => c.type === CHANGE.RELEASED && best.ids.includes(c.item.id));

  return [{
    key: `seat:${watcher.id}:${best.ids.join(',')}`,
    priority: 2,
    title: `${best.ids.length} seats ${wasPresale ? 'released' : 'opened'} — score ${best.score}`,
    body: [
      best.section ? `${best.section} · ` : '',
      `Row ${best.row}, seats ${best.cols.join(', ')}`,
      best.price ? ` · ${formatPrice({ amount: best.price, currency: best.currency })}` : '',
    ].join(''),
    score: best.score,
    seatIds: best.ids,
    extra: fresh.length > 1 ? `${fresh.length - 1} other block(s) also open` : null,
  }];
}

/* ---------- stock ---------- */

function safeRegExp(pattern) {
  if (!pattern) return null;
  try { return new RegExp(pattern, 'i'); } catch { return null; }
}

const matcher = (rule) => safeRegExp(rule.match);

function restockRule(rule, changes, hasSeatBlock) {
  const re = matcher(rule);
  return changes
    // Seats belong to seat_block, not restock — but only when this watcher
    // actually HAS a seat_block rule configured. This guard used to apply
    // unconditionally, so a drop/resale item whose payload merely contains
    // any field loosely matching /row/i or named "position"/"number" (both
    // suggestFields fallbacks, in extract.js) would get meta.row/meta.col
    // populated and silently lose its restock alert forever, with nothing
    // in the UI to explain why. If there's no seat_block rule to conflict
    // with, there's nothing to double-report, so the guard has no reason
    // to apply at all.
    .filter((c) => !(hasSeatBlock && c.item.meta?.row != null && c.item.meta?.col != null))
    // RELEASED is excluded on purpose: a scheduled presale opening is not the
    // same event as an item genuinely coming back into stock.
    .filter((c) => c.type === CHANGE.REOPENED)
    .filter((c) => !re || re.test(c.item.label) || re.test(String(c.item.meta?.size ?? '')))
    .map((c) => ({
      key: `restock:${c.item.id}`,
      priority: 2,
      title: 'Back in stock',
      body: `${c.item.label}${c.item.meta?.size ? ` · ${c.item.meta.size}` : ''}${
        c.item.price ? ` · ${formatPrice(c.item.price)}` : ''
      }`,
      url: c.item.url,
    }));
}

function newItemRule(rule, changes) {
  const re = matcher(rule);
  return changes
    .filter((c) => c.type === CHANGE.APPEARED)
    .filter((c) => !re || re.test(c.item.label))
    .slice(0, 5)
    .map((c) => ({
      key: `new:${c.item.id}`,
      priority: 1,
      title: 'New listing',
      body: c.item.label,
      url: c.item.url,
    }));
}

/**
 * The Doomsday / Dune case: not "a seat opened" but "they finally added an
 * IMAX 70mm screening". The target is the showtime list, and the filter is a
 * projection format rather than a seat position.
 */
function formatAddedRule(rule, changes) {
  const want = new Set(rule.formats || []);
  if (!want.size) return [];

  return changes
    .filter((c) => c.type === CHANGE.APPEARED)
    .map((c) => {
      const text = [c.item.label, c.item.meta?.section, c.item.meta?.size].filter(Boolean).join(' ');
      const found = detectFormats(text).filter((f) => want.has(f));
      return found.length ? { c, found } : null;
    })
    .filter(Boolean)
    .slice(0, 5)
    .map(({ c, found }) => ({
      key: `fmt:${c.item.id}`,
      priority: 2,
      title: `${found.map(formatLabel).join(' + ')} screening added`,
      body: c.item.label,
      url: c.item.url,
    }));
}

/* ---------- price ---------- */

function priceBelowRule(rule, changes) {
  // markets.js ships resale's default price_below rule with `value: null` —
  // an explicit "not set yet, the user should fill this in" sentinel. But
  // Number(null) is 0, not NaN, so the isFinite check below let it through
  // as an active limit of $0 — every watcher inheriting the resale default
  // untouched fired a nonsense "Under $0.00" alert the first time a listing
  // dropped to $0 (a common way sites represent sold/withdrawn). Reject the
  // sentinel explicitly, before it ever reaches Number().
  if (rule.value == null || rule.value === '') return [];
  const limit = Number(rule.value);
  if (!Number.isFinite(limit)) return [];

  return changes
    .filter((c) => c.type === CHANGE.PRICE_DOWN)
    .filter((c) => {
      const amt = c.item.price?.amount;
      if (amt == null || amt > limit) return false;
      // A threshold typed in one currency must not fire against another.
      if (rule.currency && c.item.price?.currency && rule.currency !== c.item.price.currency) return false;
      return true;
    })
    .map((c) => ({
      key: `below:${c.item.id}:${c.item.price.amount}`,
      priority: 2,
      title: `Under ${formatPrice({ amount: limit, currency: rule.currency || c.item.price.currency })}`,
      body: `${c.item.label} · ${formatPrice(c.item.price)} (was ${formatPrice({ amount: c.from.p, currency: c.from.c })})`,
      url: c.item.url,
    }));
}

function priceDropRule(rule, changes, history) {
  const threshold = Number(rule.pct ?? 20);
  const windowDays = rule.windowDays ?? 30;
  const out = [];

  for (const c of changes) {
    if (c.type !== CHANGE.PRICE_DOWN) continue;
    const price = c.item.price;
    if (price?.amount == null) continue;

    const base = baselinePrice(history?.[c.item.id], windowDays, price.currency);
    if (base == null || base <= 0) continue;

    const dropPct = ((base - price.amount) / base) * 100;
    if (dropPct < threshold) continue;

    out.push({
      key: `drop:${c.item.id}:${Math.round(price.amount)}`,
      priority: 2,
      title: `Down ${dropPct.toFixed(0)}% vs ${windowDays}-day median`,
      body: `${c.item.label} · ${formatPrice(price)} (median ${formatPrice({ amount: base, currency: price.currency })})`,
      url: c.item.url,
    });
  }
  return out;
}

/* ---------- housekeeping ---------- */

function dedupe(hits) {
  const seen = new Set();
  return hits.filter((h) => (seen.has(h.key) ? false : (seen.add(h.key), true)));
}
