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
    if (s.includes(sym)) return code;
  }
  for (const [sym, byCountry] of Object.entries(AMBIGUOUS)) {
    if (s.includes(sym)) {
      return byCountry[countryHint] || byCountry[Object.keys(byCountry)[0]];
    }
  }
  return null;
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

  const negative = /^-|\(.*\)$/.test(s);

  // Keep digits and separators only. Non-breaking and thin spaces are used as
  // thousands separators across Europe, so they count as separators too.
  s = s.replace(/[\u00A0\u202F\u2009]/g, ' ');
  const cleaned = s.replace(/[^\d.,\s]/g, '').trim();
  if (!/\d/.test(cleaned)) return null;

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
