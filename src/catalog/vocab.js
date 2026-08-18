/**
 * vocab.js — what "sold out" looks like in the languages people book in.
 *
 * The v1 engine read English only, which meant a watch on a German, Korean or
 * Brazilian cinema silently produced `null` availability for every seat and
 * could never fire. This file is the fix, and it is the single most edited
 * file in the project — new markets arrive as new words, not new code.
 *
 * Matching is accent-insensitive and case-insensitive. Entries are matched as
 * whole tokens first, then as substrings, because sites mix
 * "SOLD_OUT", "sold out" and "seatSoldOut" freely.
 */

/**
 * Strip diacritics so `disponivel`, `disponible` and `ocupado` all normalise.
 *
 * NFD decomposition handles accented letters (e with acute -> e + a
 * combining mark, stripped below) but NOT letters that are structurally
 * distinct rather than accented: Vietnamese d-with-stroke (dd/DD) and
 * Turkish dotless i have no decomposition and pass straight through
 * untouched. Real Vietnamese/Turkish text never matched this file's own
 * Vietnamese/Turkish entries until these two were special-cased.
 */
export function fold(s) {
  return String(s)
    .replace(/[\u0111\u0110]/g, 'd')
    .replace(/\u0131/g, 'i')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\s_\-]+/g, '');
}

export const AVAILABLE = [
  // English
  'available', 'free', 'open', 'vacant', 'unsold', 'selectable', 'instock', 'bookable', 'empty', 'yes', 'true', 'active', 'sellable',
  // Spanish / Portuguese
  'disponible', 'libre', 'vacante', 'disponivel', 'livre', 'vago',
  // French
  'disponible', 'libre', 'nonvendu',
  // German / Dutch
  'frei', 'verfugbar', 'freiplatz', 'vrij', 'beschikbaar', 'onbezet',
  // Italian
  'disponibile', 'libero',
  // Nordic
  'ledig', 'tillganglig', 'tilgjengelig', 'vapaa', 'saatavilla',
  // Polish / Czech / Slovak / Hungarian / Romanian
  'wolne', 'wolny', 'dostepne', 'volne', 'dostupne', 'szabad', 'elerheto', 'liber', 'disponibil',
  // Greek / Turkish. The romanised Greek forms below never matched real
  // payload text at all — Greek script doesn't transliterate to Latin under
  // fold()'s NFD pipeline the way an accented Latin letter does. Both the
  // romanisation and the actual Greek word are kept: the romanisation in
  // case a site's own API renders it that way (real, if unlikely), the
  // Greek script for real Greek-language sites.
  'diathesimo', 'διαθέσιμο', 'bos', 'musait',
  // Russian / Ukrainian (folded Cyrillic is left as-is; compared directly)
  'свободно', 'свободен', 'доступно', 'вільно',
  // CJK
  '空席', '空き', '販売中', '選択可能',
  '예매가능', '선택가능', '잔여', '가능',
  '可选', '可售', '空位', '有票', '可購', '可选座',
  // South / Southeast Asia
  'उपलब्ध', 'ว่าง', 'controng', 'trong', 'tersedia', 'kosong', 'available',
  // Middle East
  'متاح', 'متوفر', 'פנוי',
];

export const UNAVAILABLE = [
  // English. 'blocked' and 'companion' removed: both also appear in BLOCKED
  // below, and classifyStatus checks UNAVAIL_SET first, so a wheelchair or
  // companion seat literally labelled "blocked" was always read as ordinary
  // sold inventory — meaning when the venue released the accessibility
  // hold, it fired a restock/seat_block alert for a seat that was never
  // actually purchasable. 'house' removed: too generic a single word for
  // an availability signal, and a real collision risk against section
  // names ("House Left/Right") via the substring fallback.
  // 'inactive' added: without it, the substring fallback matched AVAILABLE's
  // whole-token 'active' inside 'inactive' and read it backwards.
  'sold', 'soldout', 'unavailable', 'taken', 'occupied', 'reserved', 'booked', 'held', 'broken', 'outofstock', 'no', 'false', 'unselectable', 'notavailable', 'inactive',
  // Spanish / Portuguese. 'lotado' is Brazilian Portuguese for a sold-out
  // house; feminine forms (ocupada/vendida/reservada) added because the
  // substring fallback only catches a suffix GROWING, not a vowel changing,
  // so "ocupada" was simply unmatched by "ocupado" without an entry of its own.
  'vendido', 'ocupado', 'ocupada', 'agotado', 'nodisponible', 'reservado', 'reservada', 'esgotado', 'indisponivel', 'lotado', 'vendida',
  // French
  'vendu', 'occupe', 'complet', 'indisponible', 'reserve',
  // German / Dutch
  'besetzt', 'belegt', 'verkauft', 'ausverkauft', 'reserviert', 'nichtverfugbar', 'bezet', 'verkocht', 'uitverkocht', 'gereserveerd',
  // Italian
  'venduto', 'occupato', 'esaurito', 'nondisponibile', 'prenotato',
  // Nordic
  'upptagen', 'sald', 'slutsald', 'optaget', 'solgt', 'udsolgt', 'utsolgt', 'varattu', 'myyty', 'loppuunmyyty',
  // Polish / Czech / Slovak / Hungarian / Romanian
  'zajete', 'zajety', 'sprzedane', 'wyprzedane', 'obsazeno', 'prodano', 'vyprodano', 'foglalt', 'elkelt', 'ocupat', 'vandut',
  // Greek / Turkish — see the AVAILABLE list's comment: real Greek script
  // added alongside the romanised forms, which never matched real text.
  'kateilimmeno', 'κατειλημμένο', 'poulithike', 'πουλήθηκε', 'dolu', 'satildi', 'tukendi', 'satilmis',
  // Russian / Ukrainian
  'занято', 'продано', 'недоступно', 'зайнято',
  // CJK. Traditional Chinese added alongside simplified — '已預訂' was the
  // only genuinely traditional entry before; the common Taiwan/HK "house
  // full" terms (客滿 and friends) were entirely absent, affecting every
  // TW/HK chain in the catalogue.
  '満席', '売切', '売り切れ', '販売終了', '予約済', '選択不可',
  '예매완료', '매진', '선택불가', '불가', '판매완료',
  '已售', '售罄', '已占', '不可选', '已售罄', '已預訂', '已订',
  '客滿', '已滿', '售完', '額滿', '爆滿',
  // South / Southeast Asia. अनुपलब्ध (Hindi "not available") added — the
  // negation, not a substring of उपलब्ध ("available") in AVAILABLE, so it
  // was previously unreadable on both India-serving chains in the catalog.
  'बुक', 'बिक', 'अनुपलब्ध', 'เต็ม', 'ขายแล้ว', 'จองแล้ว', 'daban', 'dadat', 'het', 'terjual', 'habis', 'dipesan', 'penuh',
  // Middle East
  'محجوز', 'مباع', 'غيرمتاح', 'תפוס', 'נמכר',
];

/**
 * Distinct from "sold out": the seat or item exists but isn't purchasable yet.
 * Treating these as unavailable is right, but they must never trigger a
 * "back in stock" alert when they later flip — that's a false positive that
 * would fire on every single presale opening.
 */
export const NOT_YET = [
  // 'availablesoon' added: without a whole-token entry, "Available Soon"
  // fell through to the substring pass and matched AVAILABLE's 'available'
  // — read as on-sale right now, not "not yet".
  'comingsoon', 'availablesoon', 'notonsale', 'presale', 'notyetavailable', 'pending', 'scheduled', 'upcoming',
  'proximamente', 'prochainement', 'demnachst', 'binnenkort', 'prossimamente', 'wkrotce',
  '近日', '発売前', '판매예정', '即将', 'segera',
];

export const BLOCKED = [
  'wheelchair', 'accessible', 'companion', 'handicap', 'rollstuhl', 'pmr',
  'blocked', 'distancing', 'socialdistance', 'unsellable', 'aisle', 'stairs', 'obstructed',
  '車椅子', '휠체어', '轮椅',
];

function buildIndex(list) {
  return new Set(list.map(fold));
}

const AVAIL_SET = buildIndex(AVAILABLE);
const UNAVAIL_SET = buildIndex(UNAVAILABLE);
const NOTYET_SET = buildIndex(NOT_YET);
const BLOCKED_SET = buildIndex(BLOCKED);

/**
 * @returns 'available' | 'unavailable' | 'notyet' | 'blocked' | null
 * null means genuinely unknown, which the UI surfaces rather than guessing.
 */
export function classifyStatus(value) {
  if (value == null) return null;
  if (typeof value === 'boolean') return value ? 'available' : 'unavailable';
  if (typeof value === 'number') return value > 0 ? 'available' : 'unavailable';

  const f = fold(value);
  if (!f) return null;

  if (AVAIL_SET.has(f)) return 'available';
  if (UNAVAIL_SET.has(f)) return 'unavailable';
  if (NOTYET_SET.has(f)) return 'notyet';
  if (BLOCKED_SET.has(f)) return 'blocked';

  // Substring pass, longest-first so "notavailable" beats "available".
  const contains = (set) =>
    [...set].filter((w) => w.length >= 3 && f.includes(w)).sort((a, b) => b.length - a.length)[0];

  const hits = [
    ['blocked', contains(BLOCKED_SET)],
    ['notyet', contains(NOTYET_SET)],
    ['unavailable', contains(UNAVAIL_SET)],
    ['available', contains(AVAIL_SET)],
  ].filter(([, w]) => w);

  if (!hits.length) return null;
  hits.sort((a, b) => b[1].length - a[1].length);
  return hits[0][0];
}

/* ---------- premium formats ---------- */

/**
 * Format detection drives "only tell me about IMAX 70mm" watches. Order
 * matters: the most specific pattern must win, so 70mm beats plain IMAX.
 */
export const FORMATS = [
  { id: 'imax70', label: 'IMAX 70mm', re: /imax.*(70\s?mm|film)|(70\s?mm).*imax/i, premium: true },
  { id: 'imaxlaser', label: 'IMAX Laser', re: /imax.*(laser|gt)/i, premium: true },
  { id: 'imax', label: 'IMAX', re: /\bimax\b/i, premium: true },
  { id: 'film70', label: '70mm', re: /\b70\s?mm\b/i, premium: true },
  { id: 'film35', label: '35mm', re: /\b35\s?mm\b/i, premium: true },
  { id: 'dolby', label: 'Dolby Cinema', re: /dolby\s?cinema|dolby\s?vision|\bdbox\b/i, premium: true },
  { id: 'atmos', label: 'Dolby Atmos', re: /atmos/i, premium: false },
  { id: '4dx', label: '4DX', re: /\b4dx\b/i, premium: true },
  { id: 'screenx', label: 'ScreenX', re: /screenx/i, premium: true },
  { id: 'icon', label: 'ICON / LUXE', re: /\bicon\b|\bluxe\b|superscreen|\bxplus\b/i, premium: true },
  { id: 'prime', label: 'Prime / Grand', re: /prime|grand\s?screen|\bvip\b|premiere|director'?s\s?hall/i, premium: true },
  { id: 'rpx', label: 'RPX', re: /\brpx\b/i, premium: true },
  { id: 'xd', label: 'Cinemark XD', re: /\bxd\b/i, premium: true },
  { id: 'thebigscreen', label: 'Big screen', re: /big\s?screen|megascreen|\bmax\b/i, premium: false },
  { id: '3d', label: '3D', re: /\b3\s?-?d\b/i, premium: false },
  { id: '2d', label: '2D', re: /\b2\s?-?d\b/i, premium: false },
  { id: 'ost', label: 'Original language', re: /\bost\b|\bov\b|original\s?version|vost|subtitl|legendado|sottotitol/i, premium: false },
  { id: 'dub', label: 'Dubbed', re: /dubbed|synchron|doblada|doppiato|dublado/i, premium: false },
];

/** @returns string[] of format ids found in a free-text showtime label. */
export function detectFormats(text) {
  if (!text) return [];
  const s = String(text);
  const found = [];
  for (const f of FORMATS) {
    if (f.re.test(s)) found.push(f.id);
  }
  // If a more specific IMAX variant matched, drop the generic one.
  if (found.includes('imax70') || found.includes('imaxlaser')) {
    return found.filter((x) => x !== 'imax');
  }
  return found;
}

export function formatLabel(id) {
  return FORMATS.find((f) => f.id === id)?.label || id;
}
