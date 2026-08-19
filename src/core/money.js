/**
 * money.js — prices, worldwide, without silent 1000x errors.
 *
 * The v1 parser read "1.234,56 €" as 1.234 and "Rp 55.000" as 55. Both are
 * off by a factor of a thousand, and both would have fired a "price dropped
 * 99%!" alert on a price that never moved.
 *
 * Two rules carry the whole file:
 *   1. Work out which separator is the decimal one before parsing.
 *   2. Never compare two prices in different currencies.
 */

/** Symbol → ISO code. Ambiguous symbols resolve via an explicit locale hint. */
const SYMBOLS = [
  ['€', 'EUR'], ['£', 'GBP'], ['₩', 'KRW'], ['₹', 'INR'], ['₽', 'RUB'],
  ['₺', 'TRY'], ['₪', 'ILS'], ['₫', 'VND'], ['฿', 'THB'], ['₱', 'PHP'],
  ['R$', 'BRL'], ['CHF', 'CHF'], ['zł', 'PLN'], ['Kč', 'CZK'], ['Ft', 'HUF'],
  ['лв', 'BGN'], ['kn', 'HRK'], ['lei', 'RON'], ['RM', 'MYR'], ['Rp', 'IDR'],
  ['NT$', 'TWD'], ['HK$', 'HKD'], ['S$', 'SGD'], ['A$', 'AUD'], ['C$', 'CAD'],
  ['NZ$', 'NZD'], ['R', 'ZAR'], ['د.إ', 'AED'], ['﷼', 'SAR'], ['E£', 'EGP'],
];

/** These need a country hint — the symbol alone is not enough. */
const AMBIGUOUS = {
  $: { US: 'USD', CA: 'CAD', AU: 'AUD', NZ: 'NZD', SG: 'SGD', HK: 'HKD', MX: 'MXN', AR: 'ARS', CL: 'CLP', CO: 'COP', TW: 'TWD', BR: 'BRL' },
  '¥': { JP: 'JPY', CN: 'CNY' },
  kr: { SE: 'SEK', NO: 'NOK', DK: 'DKK', IS: 'ISK' },
  '£': { GB: 'GBP', EG: 'EGP', LB: 'LBP' },
};

/** Currencies with no minor unit — a bare integer is already the full price. */
export const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND', 'IDR', 'CLP', 'ISK', 'HUF', 'TWD', 'COP']);

export function detectCurrency(raw, countryHint) {
  if (raw == null) return null;
  const s = String(raw);

  const iso = s.match(/\b(USD|EUR|GBP|CAD|AUD|NZD|JPY|KRW|CNY|INR|BRL|MXN|SEK|NOK|DKK|PLN|CZK|HUF|RON|TRY|ILS|AED|SAR|SGD|HKD|TWD|THB|VND|IDR|MYR|PHP|ZAR|CHF|RUB|ARS|CLP|COP|EGP)\b/i);
  if (iso) return iso[1].toUpperCase();

  for (const [sym, code] of SYMBOLS) {
    if (symbolPresent(s, sym)) return code;
  }
  for (const [sym, byCountry] of Object.entries(AMBIGUOUS)) {
    if (symbolPresent(s, sym)) {
      return byCountry[countryHint] || byCountry[Object.keys(byCountry)[0]];
    }
  }
  return null;
}

/**
 * A letter-based currency code must stand as its own word. A plain
 * `includes` matched "kn" inside the ordinary English word "unknown" and
 * confidently reported Croatian Kuna for a page with no currency on it at
 * all — which then feeds the never-compare-across-currencies guard and can
 * silently suppress a real price alert. Symbols made of punctuation
 * (currency signs) have no such ambiguity and are matched as-is.
 *
 * Matching stays case-SENSITIVE on purpose: it is what keeps "lei" (RON)
 * from firing on "Leisure" and "Rp" (IDR) from firing on "Corporate report".
 */
function symbolPresent(s, sym) {
  if (!/^[A-Za-z]+$/.test(sym)) return s.includes(sym);
  const i = s.indexOf(sym);
  if (i === -1) return false;
  const before = s[i - 1];
  const after = s[i + sym.length];
  const isLetter = (ch) => ch != null && /[A-Za-z]/.test(ch);
  return !isLetter(before) && !isLetter(after);
}

/**
 * The core problem: is "1,234" one thousand two hundred and thirty-four, or
 * one point two three four? Decided by position and grouping, not by locale
 * guessing, because a page's markup often disagrees with its own locale.
 */
export function parseAmount(raw) {
  if (raw == null) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;

  let s = String(raw).trim();
  if (!s) return null;

  // Accounting-style negatives wrap the WHOLE value in parentheses. The
  // anchor matters: without it, any string merely ending in ")" counted as
  // negative, so "$20 (20% off)" parsed as -20.
  const negative = /^-/.test(s) || /^\(.*\)$/.test(s);

  // Non-breaking and thin spaces are used as thousands separators across
  // Europe, so they count as separators too.
  s = s.replace(/[\u00A0\u202F\u2009]/g, ' ');

  // Everything that isn't a digit or a separator becomes a SPACE, not
  // nothing. This is the difference between reading one number and welding
  // several together: deleting the non-numeric characters from
  // "from $12.99 to $19.99" left "12.99  19.99", whose digits then
  // concatenated into 129919.99 \u2014 a price four orders of magnitude too
  // large, silently stored as a real observation and poisoning every
  // future comparison against it. "12-15" became 1215 the same way.
  const spaced = s.replace(/[^\d.,\s]/g, ' ');
  if (!/\d/.test(spaced)) return null;

  // A numeric run is digits joined by single separators. A SPACE only
  // continues the run when it's followed by exactly three digits \u2014 that's
  // a thousands group ("1 234 567"). Any other spacing ends the run, which
  // is what keeps a range like "12-15" from reading as 1215 once the
  // hyphen has become a space.
  const runs = [...spaced.matchAll(/\d+(?:[.,]\d+|\s\d{3}(?!\d))*/g)];
  if (!runs.length) return null;

  // Skip a run that is immediately a percentage ("20% off") \u2014 that is a
  // discount, not a price, and reading it as one is how a promo badge
  // becomes a fabricated observation.
  const chosen = runs.find((m) => s[m.index + m[0].length] !== '%') || null;
  if (!chosen) return null;

  const cleaned = chosen[0].trim();

  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  const lastSep = Math.max(lastComma, lastDot);

  let intPart;
  let fracPart = '';

  if (lastSep === -1) {
    intPart = cleaned.replace(/\s/g, '');
  } else {
    const sepChar = lastComma > lastDot ? ',' : '.';
    const tail = cleaned.slice(lastSep + 1).replace(/\s/g, '');
    const head = cleaned.slice(0, lastSep);

    // 1–2 trailing digits => decimal. Exactly 3 => almost certainly a
    // thousands group ("Rp 55.000", "1,500"). More than 3 => not a separator.
    const isDecimal = tail.length > 0 && tail.length <= 2 && /^\d+$/.test(tail);

    if (isDecimal) {
      intPart = head;
      fracPart = tail;
    } else {
      intPart = cleaned;
      fracPart = '';
    }
    void sepChar;
  }

  intPart = intPart.replace(/[.,\s]/g, '');
  if (!intPart) intPart = '0';

  const n = parseFloat(`${intPart}${fracPart ? `.${fracPart}` : ''}`);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

/**
 * A Price always carries its currency. Rules refuse to compare across
 * currencies rather than pretending an exchange rate they don't have.
 */
export function parsePrice(raw, { countryHint, defaultCurrency } = {}) {
  const amount = parseAmount(raw);
  if (amount == null) return null;
  return {
    amount,
    currency: detectCurrency(raw, countryHint) || defaultCurrency || null,
  };
}

export function formatPrice(price) {
  if (price == null) return '—';
  const { amount, currency } = typeof price === 'number' ? { amount: price, currency: null } : price;
  if (amount == null) return '—';
  const digits = currency && ZERO_DECIMAL.has(currency) ? 0 : 2;
  try {
    return new Intl.NumberFormat(undefined, {
      style: currency ? 'currency' : 'decimal',
      currency: currency || undefined,
      maximumFractionDigits: digits,
      minimumFractionDigits: digits,
    }).format(amount);
  } catch {
    return `${amount.toFixed(digits)}${currency ? ` ${currency}` : ''}`;
  }
}

export function sameCurrency(a, b) {
  if (!a?.currency || !b?.currency) return true; // unknown on either side: allow
  return a.currency === b.currency;
}
