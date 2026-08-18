/**
 * diagnose.js — answering "why haven't I heard anything?"
 *
 * VIGIL's core promise is that silence means nothing has changed. That
 * promise has a hole in it: a MISCONFIGURED watch is also silent, and from
 * the outside the two are indistinguishable. A watch can poll successfully
 * for weeks — 200 OK, items extracted, no error anywhere — while being
 * structurally incapable of ever producing a hit, because its rules can't
 * match the shape of its own data.
 *
 * That's the worst possible failure for this product: the user believes
 * they're covered, and they aren't. They find out by missing the thing
 * they were waiting for.
 *
 * These checks run against a watcher plus a sample of its CURRENT items,
 * and report the reasons it could never fire. Everything here is a
 * structural impossibility, not a guess about likelihood — a rule whose
 * required field is mapped to nothing, a seat score threshold no seat in
 * this specific house can reach. If a check can't prove impossibility, it
 * says nothing, because a false warning on a healthy watch would undermine
 * exactly the trust in silence this file exists to protect.
 */

import { RULE_TYPES } from './rules.js';
import { findBlocks } from './seats.js';
import { detectFormats } from '../catalog/vocab.js';

/** @returns {Array<{rule: string, severity: 'blocked'|'warn', message: string}>} */
export function diagnoseWatcher(watcher, items) {
  const problems = [];
  const rules = watcher?.rules || [];
  const list = items || [];

  if (!rules.length) {
    problems.push({
      rule: '(none)',
      severity: 'blocked',
      message: 'This watch has no rules, so nothing can ever trigger an alert.',
    });
    return problems;
  }

  if (!list.length) return problems; // nothing to reason about yet

  const anyPrice = list.some((i) => i.price?.amount != null);
  const anyRowCol = list.some((i) => i.meta?.row != null && i.meta?.col != null);
  const anyUnavailable = list.some((i) => i.available === false);
  const anyAvailable = list.some((i) => i.available === true);
  const allUnknown = list.every((i) => i.available == null);

  for (const rule of rules) {
    switch (rule.type) {
      case RULE_TYPES.SEAT_BLOCK: {
        if (!anyRowCol) {
          problems.push({
            rule: rule.type,
            severity: 'blocked',
            message: 'No row/seat data in this page\'s items, so seat blocks can never be found. This looks like unreserved seating — "back in stock" would fit better.',
          });
          break;
        }
        // Score the whole house as if everything were free: the best
        // POSSIBLE block here. If that can't clear minScore, no real
        // cancellation ever will either.
        const asIfEmpty = list.map((i) => ({ ...i, available: true }));
        const { blocks } = findBlocks(asIfEmpty, {
          size: rule.partySize || 2,
          profile: rule.profile || 'standard',
          minScore: 0,
          numbering: watcher.geometry?.numbering || 'sequential',
          rowOrder: watcher.geometry?.rowOrder || 'front-first',
        });
        const best = blocks[0]?.score ?? 0;
        const floor = rule.minScore ?? 60;
        if (blocks.length === 0) {
          problems.push({
            rule: rule.type,
            severity: 'blocked',
            message: `No ${rule.partySize || 2} physically adjacent seats exist anywhere in this room, even with every seat free. Try a smaller party size.`,
          });
        } else if (best < floor) {
          problems.push({
            rule: rule.type,
            severity: 'blocked',
            message: `The best possible seats here score ${best}, but your minimum is ${floor} — so this watch can never fire. Lower the minimum to about ${Math.max(0, best - 5)} or below.`,
          });
        }
        break;
      }

      case RULE_TYPES.RESTOCK: {
        if (allUnknown) {
          problems.push({
            rule: rule.type,
            severity: 'blocked',
            message: 'Availability is unreadable for every item, so a restock can never be detected.',
          });
        } else if (!anyUnavailable) {
          problems.push({
            rule: rule.type,
            severity: 'warn',
            message: 'Everything is currently available, so there is nothing waiting to come back in stock yet. This is fine if you are watching for it to sell out and return.',
          });
        }
        break;
      }

      case RULE_TYPES.PRICE_BELOW:
      case RULE_TYPES.PRICE_DROP: {
        if (!anyPrice) {
          problems.push({
            rule: rule.type,
            severity: 'blocked',
            message: 'No prices could be read from this page\'s items, so price rules can never fire. Check the Price field mapping.',
          });
          break;
        }
        if (rule.type === RULE_TYPES.PRICE_BELOW) {
          if (rule.value == null || rule.value === '') {
            problems.push({
              rule: rule.type,
              severity: 'blocked',
              message: 'No price threshold set, so this rule does nothing.',
            });
          } else {
            const cheapest = Math.min(...list.filter((i) => i.price?.amount != null).map((i) => i.price.amount));
            if (Number(rule.value) < cheapest * 0.2) {
              problems.push({
                rule: rule.type,
                severity: 'warn',
                message: `Your threshold is ${rule.value}, but the cheapest item here is ${cheapest}. That is a very large drop to wait for — it may never happen.`,
              });
            }
          }
        }
        break;
      }

      case RULE_TYPES.FORMAT_ADDED: {
        const want = new Set(rule.formats || []);
        if (!want.size) {
          problems.push({
            rule: rule.type,
            severity: 'blocked',
            message: 'No formats are ticked, so this rule can never fire.',
          });
          break;
        }
        // Does this page's own text ever mention ANY of the wanted formats?
        const seen = new Set();
        for (const it of list) {
          const text = [it.label, it.meta?.section, it.meta?.size].filter(Boolean).join(' ');
          for (const f of detectFormats(text)) seen.add(f);
        }
        const overlap = [...want].some((f) => seen.has(f));
        if (!overlap && seen.size > 0) {
          problems.push({
            rule: rule.type,
            severity: 'warn',
            message: `None of the formats you picked appear on this page right now (it currently shows: ${[...seen].join(', ')}). That is correct if you are waiting for one to be added — but check you picked the right one.`,
          });
        }
        break;
      }

      case RULE_TYPES.NEW_ITEM:
        // Can always fire in principle — a new id can appear at any time.
        break;
    }
  }

  return problems;
}

/**
 * Long-running silence check, from stored counters alone — no re-fetch.
 * Deliberately conservative: a genuinely quiet watch is the NORMAL case
 * and must never be nagged about. This only speaks up once a watch has
 * had enough successful runs that "never once, not even a price flicker"
 * has become information rather than noise.
 */
export function silenceReport(watcher, now = Date.now()) {
  const runs = watcher?.runCount || 0;
  const hits = watcher?.hitCount || 0;
  const age = now - (watcher?.createdAt || now);
  const days = age / 864e5;

  if (hits > 0) return null;
  if (runs < 200 || days < 7) return null;

  return {
    severity: 'warn',
    message: `${watcher.name} has checked ${runs} times over ${Math.round(days)} days without a single hit. That can be perfectly normal — or the rules may not match this page. Open it and use "Why is this quiet?" to check.`,
  };
}
