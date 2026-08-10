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

  const hits = [];
  for (const rule of watcher.rules || []) {
    switch (rule.type) {
      case RULE_TYPES.SEAT_BLOCK: hits.push(...seatBlockRule(rule, items, changes, watcher)); break;
      case RULE_TYPES.RESTOCK: hits.push(...restockRule(rule, changes)); break;
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

  const geo = watcher.geometry || {};
  const { blocks } = findBlocks(items, {
    size: rule.partySize || 2,
    profile: rule.profile || 'standard',
    minScore: rule.minScore ?? 60,
    numbering: geo.numbering || 'sequential',
    rowOrder: geo.rowOrder || 'front-first',
  });
  if (!blocks.length) return [];

  const openedIds = new Set(opened.map((c) => c.item.id));

  // A block counts only if one of the newly-freed seats is in it — otherwise
  // good seats that have sat there all week would re-alert every poll.
  let fresh = blocks.filter((b) => b.ids.some((id) => openedIds.has(id)));

  if (rule.rows?.length) {
    const want = new Set(rule.rows.map((r) => String(r).toUpperCase()));
    fresh = fresh.filter((b) => want.has(String(b.row).toUpperCase()));
  }
  if (rule.section) {
    const re = new RegExp(rule.section, 'i');
    fresh = fresh.filter((b) => re.test(String(b.section ?? '')));
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

function matcher(rule) {
  if (!rule.match) return null;
  try { return new RegExp(rule.match, 'i'); } catch { return null; }
}

function restockRule(rule, changes) {
  const re = matcher(rule);
  return changes
    // Seats belong to seat_block. Without this guard a watcher carrying both
    // rules reports every freed seat twice — once as a block, once each as a
    // "back in stock" item.
    .filter((c) => !(c.item.meta?.row != null && c.item.meta?.col != null))
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
