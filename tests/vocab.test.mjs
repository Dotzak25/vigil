import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { classifyStatus, detectFormats, formatLabel, fold } from '../src/catalog/vocab.js';

describe('classifyStatus — "sold out" in ~14 languages, not just English', () => {
  test('English', () => {
    assert.equal(classifyStatus('sold out'), 'unavailable');
    assert.equal(classifyStatus('AVAILABLE'), 'available');
  });

  test('German — the README\'s own example: "besetzt"', () => {
    assert.equal(classifyStatus('besetzt'), 'unavailable');
    assert.equal(classifyStatus('frei'), 'available');
  });

  test('Korean — the README\'s own example: "예매완료"', () => {
    assert.equal(classifyStatus('예매완료'), 'unavailable');
  });

  test('French, Spanish, Italian, Portuguese', () => {
    assert.equal(classifyStatus('complet'), 'unavailable');
    assert.equal(classifyStatus('agotado'), 'unavailable');
    assert.equal(classifyStatus('esaurito'), 'unavailable');
    assert.equal(classifyStatus('esgotado'), 'unavailable');
    assert.equal(classifyStatus('disponible'), 'available');
  });

  test('booleans and numbers classify without touching vocab', () => {
    assert.equal(classifyStatus(true), 'available');
    assert.equal(classifyStatus(false), 'unavailable');
    assert.equal(classifyStatus(1), 'available');
    assert.equal(classifyStatus(0), 'unavailable');
  });

  test('accent- and case-insensitive matching', () => {
    assert.equal(classifyStatus('DISPONÍVEL'), 'available');
    assert.equal(classifyStatus('Disponivel'), 'available');
  });

  test('sites mix delimiters freely: "SOLD_OUT", "sold out", "seatSoldOut"', () => {
    assert.equal(classifyStatus('SOLD_OUT'), 'unavailable');
    assert.equal(classifyStatus('sold out'), 'unavailable');
    // "seatSoldOut" is not a whole-token match, but should hit via substring pass
    assert.equal(classifyStatus('seatSoldOut'), 'unavailable');
  });

  test('"notavailable" beats "available" as a substring (longest-match wins)', () => {
    assert.equal(classifyStatus('notavailable'), 'unavailable');
  });

  test('notyet (presale) is distinct from unavailable — never masquerades as sold out', () => {
    assert.equal(classifyStatus('presale'), 'notyet');
    assert.equal(classifyStatus('coming soon'), 'notyet');
    assert.notEqual(classifyStatus('presale'), 'unavailable');
  });

  test('blocked (wheelchair/companion) is distinct from unavailable', () => {
    assert.equal(classifyStatus('wheelchair'), 'blocked');
  });

  test('unknown / unrecognised text -> null, never guessed', () => {
    assert.equal(classifyStatus('xyzzy123'), null);
    assert.equal(classifyStatus(null), null);
    assert.equal(classifyStatus(''), null);
  });
});

describe('fold', () => {
  test('strips diacritics, case, spaces/underscores/hyphens', () => {
    assert.equal(fold('Disponível'), 'disponivel');
    assert.equal(fold('SOLD_OUT'), 'soldout');
    assert.equal(fold('sold-out'), 'soldout');
  });
});

describe('detectFormats — premium format detection, most-specific wins', () => {
  test('IMAX 70mm beats plain IMAX when both patterns match', () => {
    const found = detectFormats('Dune: Part Two — IMAX 70mm Film');
    assert.ok(found.includes('imax70'));
    assert.ok(!found.includes('imax'), 'generic imax should be dropped when imax70 matched');
  });

  test('plain IMAX still detected on its own', () => {
    assert.deepEqual(detectFormats('Oppenheimer IMAX'), ['imax']);
  });

  test('Dolby Cinema and Atmos are distinguished', () => {
    assert.ok(detectFormats('Dolby Cinema').includes('dolby'));
    assert.ok(detectFormats('Dolby Atmos').includes('atmos'));
  });

  test('4DX and ScreenX', () => {
    assert.ok(detectFormats('4DX Experience').includes('4dx'));
    assert.ok(detectFormats('ScreenX').includes('screenx'));
  });

  test('no format text -> empty array, not null/throw', () => {
    assert.deepEqual(detectFormats(''), []);
    assert.deepEqual(detectFormats(null), []);
  });

  test('formatLabel round-trips ids to human labels, falls back to the id itself', () => {
    assert.equal(formatLabel('imax70'), 'IMAX 70mm');
    assert.equal(formatLabel('not-a-real-id'), 'not-a-real-id');
  });
});
