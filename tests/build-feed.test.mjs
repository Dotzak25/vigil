import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { validateTemplate, templateKeyOf, buildFeed } from '../scripts/build-feed.mjs';

const goodTemplate = (overrides = {}) => ({
  v: 1,
  chainId: 'cinestar-de',
  chainName: 'CineStar',
  kind: 'cinema',
  host: 'www.cinestar.de',
  urlPattern: '/api/showtime/{id}/seatplan',
  method: 'GET',
  queryKeys: ['lang'],
  headerNames: ['accept'],
  spec: { itemsPath: ['a', 'b'], fields: { id: 'seatId' }, invertAvailable: false },
  seat: { numbering: 'centerout', rowOrder: 'front-first' },
  rules: [{ type: 'seat_block', partySize: 2 }],
  contributedAt: 1000,
  ...overrides,
});

describe('validateTemplate — the gate before anything reaches a public feed', () => {
  test('a well-formed template passes', () => {
    assert.equal(validateTemplate(goodTemplate()), null);
  });

  test('missing required fields are rejected', () => {
    const t = goodTemplate();
    delete t.host;
    assert.match(validateTemplate(t), /missing "host"/);
  });

  test('a urlPattern that isn\'t a path is rejected', () => {
    assert.match(validateTemplate(goodTemplate({ urlPattern: 'not-a-path' })), /urlPattern/);
  });

  test('a host without a dot is rejected (catches garbage/placeholder values)', () => {
    assert.match(validateTemplate(goodTemplate({ host: 'localhost' })), /host/);
  });

  test('malformed spec is rejected', () => {
    assert.match(validateTemplate(goodTemplate({ spec: { fields: {} } })), /spec/);
    assert.match(validateTemplate(goodTemplate({ spec: { itemsPath: ['a'] } })), /spec/);
  });

  test('a contribution that still carries something secret-looking is rejected outright — safety net behind the export flow, not instead of it', () => {
    assert.match(
      validateTemplate(goodTemplate({ headerNames: ['accept', 'x-session-token'] })),
      /secret/
    );
    assert.match(
      validateTemplate(goodTemplate({ queryKeys: ['lang', 'auth'] })),
      /secret/
    );
  });

  test('non-object input is rejected without throwing', () => {
    assert.equal(validateTemplate(null), 'not an object');
    assert.equal(validateTemplate('nope'), 'not an object');
  });
});

describe('templateKeyOf', () => {
  test('matches registry.js\'s templateKey() derivation exactly (host|urlPattern)', () => {
    assert.equal(templateKeyOf(goodTemplate()), 'www.cinestar.de|/api/showtime/{id}/seatplan');
  });
});

describe('buildFeed — one bad contribution never takes the whole feed down', () => {
  test('valid templates pass through, invalid ones are warned about and dropped', () => {
    const { templates, warnings } = buildFeed([
      { filename: 'good.json', template: goodTemplate() },
      { filename: 'bad.json', template: { v: 1 } },
    ]);
    assert.equal(templates.length, 1);
    assert.equal(templates[0].chainId, 'cinestar-de');
    assert.ok(warnings.some((w) => w.includes('bad.json')));
  });

  test('two contributions for the same site dedupe by (host, urlPattern), keeping the newer one', () => {
    const older = goodTemplate({ contributedAt: 1000, chainName: 'CineStar (old)' });
    const newer = goodTemplate({ contributedAt: 2000, chainName: 'CineStar (new)' });
    const { templates, warnings } = buildFeed([
      { filename: 'old.json', template: older },
      { filename: 'new.json', template: newer },
    ]);
    assert.equal(templates.length, 1);
    assert.equal(templates[0].chainName, 'CineStar (new)');
    assert.ok(warnings.some((w) => w.includes('superseded')));
  });

  test('a null/unparseable entry is treated as invalid, not a crash', () => {
    const { templates, warnings } = buildFeed([{ filename: 'broken.json', template: null }]);
    assert.equal(templates.length, 0);
    assert.ok(warnings.some((w) => w.includes('broken.json')));
  });

  test('an empty input produces an empty, valid feed', () => {
    assert.deepEqual(buildFeed([]), { templates: [], warnings: [] });
  });
});
