/**
 * registry.js — the thing that turns a tool into a product.
 *
 * v1 asked every user to record a request and hand-map six fields. That's
 * fine for one person who built it. It's fatal for everyone else.
 *
 * The registry closes that gap in two moves:
 *
 *   1. IDENTIFY. Any URL resolves to a profile — chain or marketplace, country,
 *      currency, seat conventions, available formats, sensible default rules.
 *      All of it derived from the domain, before the user does anything.
 *
 *   2. TEMPLATES. A template is the volatile half — which request holds the
 *      data and where the fields live — recorded once by someone and reusable
 *      by everyone on that chain. The first person on a chain records it. The
 *      thousandth presses one button.
 *
 * Templates are matched by URL PATTERN, never by stored endpoint, so a chain
 * rotating a path version breaks matching gracefully into "record it again"
 * rather than into silent wrong data.
 */

import { matchChain, chainById, COUNTRY_DEFAULTS } from '../catalog/chains.js';
import { matchMarket, DEFAULT_RULES } from '../catalog/markets.js';
import { detectFormats } from '../catalog/vocab.js';

/* ---------- identify ---------- */

/**
 * @returns {{kind, id, name, currency, countries, seat, formats, rules, rtl, variantAxis, seated}}
 */
export function identify(url) {
  const chain = matchChain(url);
  if (chain) {
    return {
      kind: 'cinema',
      id: chain.id,
      name: chain.name,
      currency: chain.currency,
      countries: chain.countries,
      country: chain.countries[0],
      seat: chain.seat,
      formats: chain.formats || [],
      rtl: !!chain.rtl,
      aggregator: !!chain.aggregator,
      seated: true,
      rules: clone(DEFAULT_RULES.cinema),
      known: true,
    };
  }

  const market = matchMarket(url);
  if (market) {
    return {
      kind: market.type,
      id: market.id,
      name: market.name,
      currency: null,
      countries: market.countries,
      country: market.countries[0] === '*' ? null : market.countries[0],
      seat: market.seated ? { numbering: 'auto', rowOrder: 'auto' } : null,
      formats: [],
      rtl: false,
      seated: !!market.seated,
      variantAxis: market.variantAxis || null,
      notes: market.notes || null,
      rules: clone(DEFAULT_RULES[market.type] || []),
      known: true,
    };
  }

  // Unknown site. Guess a country from the TLD so at least the currency and
  // seat conventions start somewhere sane instead of defaulting to American.
  const tld = tldOf(url);
  const guess = COUNTRY_DEFAULTS[tld];
  return {
    kind: 'unknown',
    id: null,
    name: hostOf(url) || 'This site',
    currency: guess?.currency || null,
    countries: tld ? [tld] : [],
    country: tld || null,
    seat: guess?.seat || { numbering: 'auto', rowOrder: 'auto' },
    formats: [],
    rtl: ['AE', 'SA', 'IL', 'QA', 'EG'].includes(tld),
    seated: false,
    rules: [],
    known: false,
  };
}

const TLD_COUNTRY = {
  uk: 'GB', ie: 'IE', de: 'DE', at: 'AT', ch: 'CH', fr: 'FR', nl: 'NL', be: 'BE',
  es: 'ES', it: 'IT', pt: 'PT', pl: 'PL', cz: 'CZ', se: 'SE', no: 'NO', dk: 'DK',
  fi: 'FI', jp: 'JP', kr: 'KR', in: 'IN', br: 'BR', mx: 'MX', ae: 'AE', sa: 'SA',
  za: 'ZA', sg: 'SG', au: 'AU', nz: 'NZ', ca: 'CA', tw: 'TW', hk: 'HK', th: 'TH',
  my: 'MY', id: 'ID', ph: 'PH', vn: 'VN', il: 'IL', gr: 'GR', ro: 'RO', hu: 'HU',
};

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return null; }
}

function tldOf(url) {
  const host = hostOf(url);
  if (!host) return null;
  const parts = host.split('.');
  const last = parts[parts.length - 1];
  const penult = parts[parts.length - 2];
  // co.uk, com.au, co.jp …
  if (['co', 'com', 'org', 'net', 'gov'].includes(penult) && TLD_COUNTRY[last]) return TLD_COUNTRY[last];
  return TLD_COUNTRY[last] || null;
}

const clone = (x) => JSON.parse(JSON.stringify(x));

/* ---------- templates ---------- */

/**
 * Turn a working watcher into something shareable.
 *
 * Everything identifying is stripped. Cookies never appear here (they're not
 * captured in the first place — `credentials: 'include'` means the browser
 * attaches them at replay time and they never touch storage). This strips the
 * rest: bearer tokens, API keys, session ids in the query string, and the
 * user's own booking/order identifiers.
 */
// Exported so anything else that has to make the same "is this safe to ship
// in a public feed?" call — the build-feed script's validator, in
// particular — checks against the exact same patterns instead of a
// second, driftable copy.
export const SECRET_HEADER = /auth|token|key|secret|session|cookie|bearer|signature|csrf|api[-_]?k/i;
export const SECRET_PARAM = /token|session|sid|auth|key|signature|uid|user|customer|order|basket|cart|email/i;

export function toTemplate(watcher, profile) {
  const url = new URL(watcher.request.url);

  const params = new URLSearchParams(url.search);
  const kept = [];
  for (const [k] of params) {
    if (SECRET_PARAM.test(k)) params.delete(k);
    else kept.push(k);
  }

  const headerNames = Object.keys(watcher.request.headers || {}).filter((h) => !SECRET_HEADER.test(h));

  return {
    v: 1,
    chainId: profile?.id || null,
    chainName: profile?.name || hostOf(watcher.request.url),
    kind: profile?.kind || 'unknown',
    host: url.hostname,
    // Path with volatile segments generalised: ids, uuids, dates, locales.
    urlPattern: generalisePath(url.pathname),
    method: watcher.request.method || 'GET',
    queryKeys: kept,
    headerNames,
    spec: {
      itemsPath: watcher.spec.itemsPath,
      fields: watcher.spec.fields,
      invertAvailable: !!watcher.spec.invertAvailable,
    },
    seat: profile?.seat || null,
    rules: (watcher.rules || []).map((r) => ({ ...r })),
    contributedAt: Date.now(),
  };
}

/** /booking/12345/seats/AB-99 → /booking/{id}/seats/{id} */
export function generalisePath(pathname) {
  return pathname
    .split('/')
    .map((seg) => {
      if (!seg) return seg;
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(seg)) return '{uuid}';
      if (/^\d{4}-\d{2}-\d{2}$/.test(seg)) return '{date}';
      if (/^\d+$/.test(seg)) return '{id}';
      if (/^[a-z]{2}(-[a-z]{2})?$/i.test(seg) && seg.length <= 5) return '{locale}';
      if (/^[A-Z0-9]{6,}$/.test(seg)) return '{id}';
      return seg;
    })
    .join('/');
}

/** Does a freshly captured request look like this template's request? */
export function templateMatches(template, capture) {
  let url;
  try { url = new URL(capture.url); } catch { return 0; }

  // matchChain/matchMarket both normalise away a leading "www." (chains.js,
  // markets.js); this didn't, so a template contributed from a session on
  // www.example.com never matched a capture on the apex domain or on
  // api.example.com — a silent feed miss, not a wrong match, but worth
  // being consistent about.
  const host = url.hostname.replace(/^www\./, '');
  const templateHost = template.host.replace(/^www\./, '');
  if (host !== templateHost && !host.endsWith(`.${templateHost}`)) return 0;

  const pattern = generalisePath(url.pathname);
  if (pattern === template.urlPattern) return 1;

  // Partial credit for a path that differs in exactly one segment — sites
  // version their APIs (/v1/ → /v2/) far more often than they restructure
  // them — but ONLY if that segment isn't the LAST one. The last segment is
  // almost always the actual resource name ("seatplan" vs "prices", "seats"
  // vs "checkout"), and those score 0.75-0.8 under a pure same/total ratio —
  // exactly the auto-apply threshold options.js uses to offer one-click
  // "Apply template" — which would silently hand a user a completely
  // unrelated endpoint's field mapping because the path merely happened to
  // be the same length.
  const a = pattern.split('/');
  const b = template.urlPattern.split('/');
  if (a.length !== b.length) return 0;
  const diffs = a.reduce((idxs, seg, i) => (seg === b[i] ? idxs : [...idxs, i]), []);
  if (diffs.length !== 1 || diffs[0] === a.length - 1) return 0;
  return (a.length - 1) / a.length;
}

/** Best template for a capture, or null. */
export function pickTemplate(templates, capture) {
  let best = null;
  let bestScore = 0;
  for (const t of templates) {
    const s = templateMatches(t, capture);
    if (s > bestScore) { best = t; bestScore = s; }
  }
  return best ? { template: best, confidence: bestScore } : null;
}

/**
 * A stable key for a template's LOCAL health record. Templates from the feed
 * don't carry a durable id (the feed is just JSON, regenerated over time), so
 * health is tracked against the thing that actually identifies a template:
 * which host, and which generalised path on it.
 */
export function templateKey(template) {
  return `${template.host}|${template.urlPattern}`;
}

/**
 * Remote template packs. Ships as static JSON on a CDN — no server, no
 * accounts, no per-user state — so v1 stays a pure client-side product while
 * still getting same-day fixes when a chain changes its API.
 */
export const TEMPLATE_FEED = 'https://dotzak25.github.io/vigil/templates.json';

export async function fetchTemplatePack(url = TEMPLATE_FEED) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Template feed HTTP ${res.status}`);
  const pack = await res.json();
  if (!Array.isArray(pack?.templates)) throw new Error('Malformed template pack');
  return pack;
}

/**
 * A template that fails for many people is worse than no template — it sends
 * users into a broken flow with false confidence. Health is tracked locally
 * and a template that fails repeatedly is set aside with an explanation.
 */
export function templateHealth(record) {
  const fails = record?.failures || 0;
  if (fails === 0) return { state: 'ok', label: 'Working' };
  if (fails < 3) return { state: 'shaky', label: `Failed ${fails}×` };
  return { state: 'broken', label: 'Stopped working — re-record to fix' };
}

/* ---------- showtime helpers ---------- */

/**
 * For "tell me when they add IMAX 70mm screenings", the watch target is the
 * showtime list rather than a seat map, and the filter is a format not a seat.
 */
export function filterShowtimesByFormat(items, formatIds) {
  if (!formatIds?.length) return items;
  const want = new Set(formatIds);
  return items.filter((it) => {
    const text = [it.label, it.meta?.section, it.meta?.size].filter(Boolean).join(' ');
    return detectFormats(text).some((f) => want.has(f));
  });
}
