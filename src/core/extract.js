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

/* ---------- the extractor ---------- */

/**
 * spec = {
 *   itemsPath, fields: { id,label,price,available,row,col,x,section,size,url },
 *   invertAvailable, countryHint, defaultCurrency, numbering
 * }
 */
export function extractItems(payload, spec = {}) {
  const raw = spec.itemsPath?.length ? getPath(payload, spec.itemsPath) : payload;
  const list = Array.isArray(raw) ? raw : [];
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
