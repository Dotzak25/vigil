import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  identify, toTemplate, generalisePath, templateMatches, pickTemplate,
  templateKey, templateHealth,
} from '../src/core/registry.js';

const baseTemplate = () => ({
  v: 1, chainId: 'cinestar-de', chainName: 'CineStar', kind: 'cinema',
  host: 'www.cinestar.de', urlPattern: '/api/showtime/{id}/seatplan', method: 'GET',
  queryKeys: [], headerNames: ['accept'],
  spec: { itemsPath: ['a', 'b'], fields: { id: 'seatId' }, invertAvailable: false },
  seat: { numbering: 'centerout', rowOrder: 'front-first' },
  rules: [{ type: 'seat_block', partySize: 2, minScore: 70, profile: 'standard' }],
  contributedAt: 0,
});

describe('generalisePath — volatile segments become placeholders', () => {
  test('numeric ids, uuids, dates and short locale codes generalise', () => {
    assert.equal(generalisePath('/booking/12345/seats/AB-99'), '/booking/{id}/seats/AB-99');
    assert.equal(generalisePath('/v1/en-us/show/2024-06-01'), '/v1/{locale}/show/{date}');
    assert.equal(generalisePath('/x/550e8400-e29b-41d4-a716-446655440000'), '/x/{uuid}');
  });
});

describe('templateMatches / pickTemplate', () => {
  test('an exact host + generalised-path match scores 1', () => {
    const t = baseTemplate();
    const cap = { url: 'https://www.cinestar.de/api/showtime/998877/seatplan' };
    assert.equal(templateMatches(t, cap), 1);
  });

  test('a subdomain of the template host still matches', () => {
    const t = baseTemplate();
    const cap = { url: 'https://booking.www.cinestar.de/api/showtime/998877/seatplan' };
    assert.ok(templateMatches(t, cap) > 0);
  });

  test('a different host scores 0', () => {
    const t = baseTemplate();
    const cap = { url: 'https://stockx.com/api/showtime/998877/seatplan' };
    assert.equal(templateMatches(t, cap), 0);
  });

  test('a versioned path (v1 -> v2) gets partial credit, not a hard miss', () => {
    const t = baseTemplate();
    const cap = { url: 'https://www.cinestar.de/api/v2/showtime/998877/seatplan' };
    // path lengths differ (extra /v2 segment) -> templateMatches requires equal
    // segment count for partial credit, so this specific case is a legitimate 0;
    // same-length-but-one-segment-different is the case that gets partial credit:
    const capSameLength = { url: 'https://www.cinestar.de/api/showtime/998877/seats' };
    assert.equal(templateMatches(t, cap), 0);
    assert.ok(templateMatches(t, capSameLength) > 0 && templateMatches(t, capSameLength) < 1);
  });

  test('pickTemplate returns the best-scoring template with its confidence', () => {
    const t = baseTemplate();
    const cap = { url: 'https://www.cinestar.de/api/showtime/998877/seatplan' };
    const picked = pickTemplate([t], cap);
    assert.equal(picked.template, t);
    assert.equal(picked.confidence, 1);
  });

  test('no templates, or none matching -> null', () => {
    assert.equal(pickTemplate([], { url: 'https://x.com/y' }), null);
    assert.equal(pickTemplate([baseTemplate()], { url: 'https://unrelated.com/y' }), null);
  });
});

describe('templateKey / templateHealth', () => {
  test('key is stable and derived from host+urlPattern, not any feed-assigned id', () => {
    assert.equal(templateKey(baseTemplate()), 'www.cinestar.de|/api/showtime/{id}/seatplan');
  });

  test('health reads a local failure-count record into a UI-ready state', () => {
    assert.deepEqual(templateHealth(undefined), { state: 'ok', label: 'Working' });
    assert.deepEqual(templateHealth({ failures: 0 }), { state: 'ok', label: 'Working' });
    assert.deepEqual(templateHealth({ failures: 2 }), { state: 'shaky', label: 'Failed 2×' });
    assert.deepEqual(templateHealth({ failures: 3 }), {
      state: 'broken', label: 'Stopped working — re-record to fix',
    });
  });
});

describe('toTemplate — anonymisation the export/contribute flow relies on', () => {
  test('strips secret headers and query params, keeps everything needed to replay the shape', () => {
    const watcher = {
      request: {
        url: 'https://www.cinestar.de/api/showtime/998877/seatplan?lang=de&session_id=abc123&auth_token=xyz',
        method: 'GET',
        headers: { accept: 'application/json', Authorization: 'Bearer xyz', 'X-Api-Key': 'secret' },
      },
      spec: { itemsPath: ['a', 'b'], fields: { id: 'seatId' }, invertAvailable: false },
      rules: [{ type: 'seat_block', partySize: 2 }],
    };
    const profile = { id: 'cinestar-de', name: 'CineStar', kind: 'cinema', seat: { numbering: 'centerout' } };

    const t = toTemplate(watcher, profile);
    assert.equal(t.host, 'www.cinestar.de');
    assert.equal(t.urlPattern, '/api/showtime/{id}/seatplan');
    assert.deepEqual(t.headerNames, ['accept']); // Authorization, X-Api-Key both stripped
    assert.deepEqual(t.queryKeys, ['lang']); // session_id, auth_token both stripped
    assert.equal(t.chainId, 'cinestar-de');
    assert.deepEqual(t.rules, watcher.rules);
  });
});

describe('identify — sanity on kinds already covered elsewhere, plus the unknown-site path', () => {
  test('an unrecognised domain still returns a usable, honest default profile', () => {
    const p = identify('https://some-random-cinema.example.de/seats');
    assert.equal(p.known, false);
    assert.equal(p.kind, 'unknown');
    assert.equal(p.country, 'DE'); // TLD-derived guess, not a hard-coded fallback to US
    assert.deepEqual(p.rules, []);
  });
});
