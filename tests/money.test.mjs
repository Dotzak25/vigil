import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseAmount, detectCurrency, parsePrice, sameCurrency, formatPrice, ZERO_DECIMAL } from '../src/core/money.js';

describe('parseAmount — the two README-cited off-by-1000x bugs', () => {
  test('"1.234,56 €" reads as 1234.56, not 1.234 (dot-thousands, comma-decimal)', () => {
    assert.equal(parseAmount('1.234,56 €'), 1234.56);
  });

  test('"Rp 55.000" reads as 55000, not 55 (dot as thousands separator, no decimal)', () => {
    assert.equal(parseAmount('Rp 55.000'), 55000);
  });

  test('US-style "1,234.56" still reads correctly the other way round', () => {
    assert.equal(parseAmount('1,234.56'), 1234.56);
  });

  test('plain "1,500" (comma, 3-digit tail) is a thousands group, not a decimal', () => {
    assert.equal(parseAmount('1,500'), 1500);
  });

  test('a lone 1-2 digit tail after a separator is treated as decimal', () => {
    assert.equal(parseAmount('42,5'), 42.5);
    assert.equal(parseAmount('42.5'), 42.5);
  });

  test('non-breaking / thin spaces used as thousands separators (French style)', () => {
    assert.equal(parseAmount('1 234,56'), 1234.56);
  });

  test('parenthesised and leading-minus amounts are negative', () => {
    assert.equal(parseAmount('(42.50)'), -42.5);
    assert.equal(parseAmount('-42.50'), -42.5);
  });

  test('numbers pass through unchanged; junk / non-numeric returns null', () => {
    assert.equal(parseAmount(42.5), 42.5);
    assert.equal(parseAmount(null), null);
    assert.equal(parseAmount('sold out'), null);
    assert.equal(parseAmount(''), null);
  });
});

describe('detectCurrency', () => {
  test('unambiguous symbols map directly', () => {
    assert.equal(detectCurrency('1.234,56 €'), 'EUR');
    assert.equal(detectCurrency('Rp 55.000'), 'IDR');
    assert.equal(detectCurrency('£42.00'), 'GBP');
  });

  test('an explicit ISO code in the string wins outright', () => {
    assert.equal(detectCurrency('USD 42.00'), 'USD');
  });

  test('ambiguous "$" resolves via the country hint', () => {
    assert.equal(detectCurrency('$42.00', 'AU'), 'AUD');
    assert.equal(detectCurrency('$42.00', 'CA'), 'CAD');
    assert.equal(detectCurrency('$42.00', 'US'), 'USD');
  });

  test('ambiguous "$" with no hint falls back to a deterministic default rather than throwing', () => {
    assert.equal(typeof detectCurrency('$42.00'), 'string');
  });

  test('no symbol, no ISO code -> null', () => {
    assert.equal(detectCurrency('42.00'), null);
  });
});

describe('parsePrice + sameCurrency — never compare across currencies', () => {
  test('carries amount and currency together', () => {
    const p = parsePrice('1.234,56 €');
    assert.deepEqual(p, { amount: 1234.56, currency: 'EUR' });
  });

  test('falls back to defaultCurrency when no symbol/code is present', () => {
    const p = parsePrice('42.50', { defaultCurrency: 'USD' });
    assert.deepEqual(p, { amount: 42.5, currency: 'USD' });
  });

  test('sameCurrency is false only when both sides are known and differ', () => {
    assert.equal(sameCurrency({ currency: 'EUR' }, { currency: 'EUR' }), true);
    assert.equal(sameCurrency({ currency: 'EUR' }, { currency: 'USD' }), false);
    assert.equal(sameCurrency({ currency: 'EUR' }, {}), true); // unknown side: allow
  });
});

describe('formatPrice + ZERO_DECIMAL', () => {
  test('zero-decimal currencies (JPY, KRW, ...) format with no minor unit', () => {
    assert.ok(ZERO_DECIMAL.has('JPY'));
    const out = formatPrice({ amount: 1000, currency: 'JPY' });
    assert.ok(!out.includes('.00'), `expected no decimals in "${out}"`);
  });

  test('normal currencies keep 2 decimal places', () => {
    const out = formatPrice({ amount: 42.5, currency: 'USD' });
    assert.match(out, /42\.50/);
  });

  test('null price formats as an em dash placeholder', () => {
    assert.equal(formatPrice(null), '—');
  });
});
