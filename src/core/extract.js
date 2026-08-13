/**
 * extract.js — turn whatever a site returns into a flat list of Items.
 *
 *   Item = {
 *     id,          stable identity across polls — what diffing keys on
 *     label,       human string for the notification
 *     available,   true | false | null (null = genuinely unknown, never guessed)
 *     status,      'available' | 'unavailable' | 'notyet' | 'blocked' | null
 *     price,       { amount, currency } | null
 *     meta,        { row, col, x, section, size, ... }
 *   }
 *
 * A cinema seat, a watch in your size, and a resale listing are all Items.
 * That's why one engine covers all three verticals.
 */

import { classifyStatus } from '../catalog/vocab.js';
import { parsePrice } from './money.js';

/* ---------- path helpers ---------- */

export function getPath(obj, path) {
  return path.reduce((acc, k) => (acc == null ? acc : acc[k]), obj);
}

export function pathToString(path) {
  return path.length ? path.join('.') : '(root)';
}

export function parseFieldPath(str) {
  if (!str) return null;
  return String(str)
    .split('.')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (/^\d+$/.test(s) ? Number(s) : s));
}

/* ---------- array discovery ---------- */

const KEY_HINTS = [
  { re: /price|amount|cost|fare|total|value|ask|bid/i, weight: 3, tag: 'price' },
  { re: /avail|status|state|sold|stock|inventory|reserved|occupied|taken|frei|besetzt|vendu/i, weight: 3, tag: 'availability' },
  { re: /seat|row|col(umn)?|section|zone|block|reihe|fila|sitz/i, weight: 4, tag: 'seat' },
  { re: /size|variant|colou?r|sku|talla|taille/i, weight: 3, tag: 'variant' },
  { re: /^id$|guid|uuid|code|key$/i, weight: 2, tag: 'id' },
  { re: /name|title|label|desc/i, weight: 2, tag: 'label' },
  { re: /time|date|showtime|session|start/i, weight: 2, tag: 'time' },
  { re: /^x$|^y$|coord|posx|posy|left|top/i, weight: 4, tag: 'coords' },
];

function scoreObjectKeys(sample) {
  const keys = Object.keys(sample || {});
  let score = 0;
  const tags = new Set();
  for (const k of keys) {
    for (const h of KEY_HINTS) {
      if (h.re.test(k)) {
        score += h.weight;
        tags.add(h.tag);
      }
    }
  }
  return { score, tags: [...tags], keys };
}

export function findItemArrays(root, { maxDepth = 8, minLength = 2 } = {}) {
  const found = [];

  (function walk(node, path, depth) {
    if (depth > maxDepth || node == null) return;

    if (Array.isArray(node)) {
      const objs = node.filter((x) => x && typeof x === 'object' && !Array.isArray(x));
      if (node.length >= minLength && objs.length >= Math.min(2, node.length)) {
        const { score, tags, keys } = scoreObjectKeys(objs[0]);
        found.push({
          path,
          length: node.length,
          keys,
          tags,
          sample: objs[0],
          score: score * 10 + Math.min(node.length, 400) / 10,
        });
      }
      node.slice(0, 4).forEach((child, i) => walk(child, [...path, i], depth + 1));
      return;
    }

    if (typeof node === 'object') {
      for (const k of Object.keys(node)) walk(node[k], [...path, k], depth + 1);
    }
  })(root, [], 0);

  return found.sort((a, b) => b.score - a.score).slice(0, 12);
}

/* ---------- anchored path resolution ---------- */

/** Field names that plausibly identify a sibling regardless of position. */
const ANCHOR_KEY_RE = /^(id|code|key|slug|uuid|guid|date|time|start|showtimeid|sessionid|performanceid|screeningid)$/i;

/**
 * itemsPath can contain a numeric array index picked up by findItemArrays —
 * e.g. ["screenings", 5, "seatmap", "seats"], "the 6th screening today". On
 * every future poll that same index is re-resolved against whatever's THEN
 * at position 5. A site listing "today's showtimes" commonly drops past
 * ones as the day goes on, so index 5 silently becomes a different
 * screening — the watcher keeps running, keeps finding "seats", and can
 * produce a fully-formed, wrong seat_block alert for an auditorium nobody
 * is watching. suggestAnchor(), called once when a capture is picked, looks
 * for a stable-looking identifying field on the object at that index so
 * resolveItemsPath() can re-locate the right sibling by VALUE instead of by
 * position on every subsequent poll.
 */
export function suggestAnchor(payload, path) {
  for (let i = 0; i < path.length; i++) {
    if (typeof path[i] !== 'number') continue;
    const parentPath = path.slice(0, i);
    const parent = getPath(payload, parentPath);
    if (!Array.isArray(parent)) continue;
    const sample = parent[path[i]];
    if (!sample || typeof sample !== 'object') continue;
    const key = Object.keys(sample).find((k) => ANCHOR_KEY_RE.test(k));
    if (key == null || sample[key] == null) continue;
    return { parentPath, key, value: sample[key] };
  }
  return null;
}

/**
 * Resolves itemsPath, preferring spec.itemsAnchor (see suggestAnchor) over
 * the raw numeric index it was recorded next to, when one is present and
 * still matches something. Falls back to the raw path — today's behaviour,
 * never worse — when there's no anchor, or the anchor no longer matches
 * anything (the item it pointed at has genuinely rotated out).
 */
export function resolveItemsPath(payload, spec) {
  if (!spec.itemsPath?.length) return Array.isArray(payload) ? payload : [];

  const anchor = spec.itemsAnchor;
  if (anchor) {
    const parent = getPath(payload, anchor.parentPath);
    if (Array.isArray(parent)) {
      const idx = parent.findIndex((el) => el && typeof el === 'object' && String(el[anchor.key]) === String(anchor.value));
      if (idx !== -1) {
        const rest = spec.itemsPath.slice(anchor.parentPath.length + 1);
        const resolved = getPath(parent[idx], rest);
        if (Array.isArray(resolved)) return resolved;
      }
    }
  }

  const raw = getPath(payload, spec.itemsPath);
  return Array.isArray(raw) ? raw : [];
}

/* ---------- the extractor ---------- */

/**
 * spec = {
 *   itemsPath, itemsAnchor, fields: { id,label,price,available,row,col,x,section,size,url },
 *   invertAvailable, countryHint, defaultCurrency, numbering
 * }
 */
export function extractItems(payload, spec = {}) {
  const list = spec.itemsPath?.length ? resolveItemsPath(payload, spec) : (Array.isArray(payload) ? payload : []);
  const f = spec.fields || {};

  const pick = (obj, key) => {
    const p = parseFieldPath(f[key]);
    return p ? getPath(obj, p) : undefined;
  };

  return list
    .filter((o) => o && typeof o === 'object')
    .map((o, i) => {
      let status = classifyStatus(pick(o, 'available'));

      if (spec.invertAvailable && status) {
        if (status === 'available') status = 'unavailable';
        else if (status === 'unavailable') status = 'available';
      }

      // 'notyet' and 'blocked' are not available, but they are tracked
      // separately so a presale opening doesn't masquerade as a restock.
      const available = status === null ? null : status === 'available';

      const row = pick(o, 'row');
      const col = pick(o, 'col');
      const xRaw = pick(o, 'x');

      const explicit = pick(o, 'id');
      const id =
        explicit != null
          ? String(explicit)
          : row != null && col != null
            ? `r${row}c${col}`
            : `#${i}`;

      const price = parsePrice(pick(o, 'price'), {
        countryHint: spec.countryHint,
        defaultCurrency: spec.defaultCurrency,
      });

      return {
        id,
        label: String(pick(o, 'label') ?? (row != null ? `Row ${row}, seat ${col}` : id)),
        available,
        status,
        price,
        url: pick(o, 'url') ?? null,
        meta: {
          row: row ?? null,
          col: col ?? null,
          x: xRaw != null && Number.isFinite(Number(xRaw)) ? Number(xRaw) : null,
          section: pick(o, 'section') ?? null,
          size: pick(o, 'size') ?? null,
        },
      };
    });
}

/** Guess a field mapping from a sample object so setup isn't a blank form. */
export function suggestFields(sample) {
  const out = {};
  const keys = Object.keys(sample || {});
  const find = (re) => keys.find((k) => re.test(k));

  out.id = find(/^(id|seatId|sku|listingId|guid|code)$/i) || find(/id$/i) || '';
  out.label =
    find(/^(name|title|label|displayName|productName)$/i) ||
    find(/^(titel|titre|titulo|titolo|nombre|nom|naam|nazwa|이름|名前|名称)$/i) ||
    '';
  // Field names are localised too — a German payload says `preis`, not `price`.
  out.price =
    find(/^(price|amount|cost|total|lastSale|lowestAsk|ask)$/i) ||
    find(/^(preis|prix|precio|prezzo|preco|pris|hinta|cena|ar|fiyat|цена|가격|価格|价格|kosten|tarif)$/i) ||
    find(/price|ask|preis|prix|precio|prezzo|tarif|kosten/i) ||
    '';
  out.available =
    find(/^(available|isAvailable|status|state|inStock|sold|seatStatus)$/i) ||
    find(/avail|status|stock|sold|frei|besetzt/i) ||
    '';
  out.row = find(/^(row|rowLabel|rowName|rowIndex|reihe|fila)$/i) || find(/row/i) || '';
  out.col = find(/^(col|column|seat|seatNumber|number|position|platz|asiento)$/i) || find(/seat.*num|col/i) || '';
  // A real coordinate beats any numbering convention, so it's worth finding.
  out.x = find(/^(x|posX|coordX|xPos|left|physicalX)$/i) || '';
  out.section = find(/^(section|zone|area|block|tier|saal)$/i) || '';
  out.size = find(/^(size|variant|option|talla)$/i) || '';
  out.url = find(/^(url|link|permalink|href)$/i) || '';
  return out;
}
