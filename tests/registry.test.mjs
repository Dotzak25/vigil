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

  test('a versioned MIDDLE segment (v1 -> v2) gets partial credit, not a hard miss', () => {
    // 6 segments so the single differing one (not the last) still clears
    // the >=0.75 auto-apply threshold used in options.js: 5/6 ≈ 0.83.
    const t = { ...baseTemplate(), urlPattern: '/api/v1/showtime/{id}/seats/data' };
    const cap = { url: 'https://www.cinestar.de/api/v2/showtime/998877/seats/data' };
    const score = templateMatches(t, cap);
    assert.ok(score > 0 && score < 1, `expected partial credit for a versioned middle segment, got ${score}`);
  });

  test('a same-length path differing only in its LAST segment scores 0 — never partial-credit the actual resource name', () => {
    // This is the regression case: "seatplan" vs "seats" (or "prices",
    // "checkout", "tickets"...) is a different endpoint, not a version bump,
    // even though it scores 0.75-0.8 under a naive same/total ratio — which
    // is exactly options.js's auto-apply threshold for "Apply template".
    const t = baseTemplate(); // urlPattern: /api/showtime/{id}/seatplan
    const capDifferentResource = { url: 'https://www.cinestar.de/api/showtime/998877/prices' };
    const capCheckout = { url: 'https://www.cinestar.de/booking/998877/checkout' }; // different path shape too, sanity 0
    assert.equal(templateMatches(t, capDifferentResource), 0);
    assert.equal(templateMatches(t, capCheckout), 0);
  });

  test('more than one differing segment never gets partial credit, regardless of ratio', () => {
    const t = { ...baseTemplate(), urlPattern: '/api/v1/showtime/{id}/seats/data' };
    const cap = { url: 'https://www.cinestar.de/api/v2/session/998877/seats/info' }; // 2 segments differ, one of them the last
    assert.equal(templateMatches(t, cap), 0);
  });

  test('a template contributed from www.<host> still matches a capture on the apex domain (and vice versa)', () => {
    const t = baseTemplate(); // host: 'www.cinestar.de'
    const apex = { url: 'https://cinestar.de/api/showtime/998877/seatplan' };
    assert.equal(templateMatches(t, apex), 1);

    const tApex = { ...baseTemplate(), host: 'cinestar.de' };
    const withWww = { url: 'https://www.cinestar.de/api/showtime/998877/seatplan' };
    assert.equal(templateMatches(tApex, withWww), 1);
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

describe('identify() — per-domain currency/seat convention for multi-country chains', () => {
  test('a chain with one domain per country reports the CORRECT country\'s currency, not always the first', () => {
    // Regression: Cinema City is PL/CZ/HU/RO/BG/SK but only ever reported
    // PLN — displayed directly in the confidence-building profile banner,
    // and silently wrong for 5 of its 6 countries.
    assert.deepEqual(
      [identify('https://www.cinemacity.hu/x').currency, identify('https://cinemacity.cz/x').currency, identify('https://cinemacity.sk/x').currency],
      ['HUF', 'CZK', 'EUR'],
    );
  });

  test('Ireland is EUR, not GBP, for both ODEON and Cineworld', () => {
    assert.equal(identify('https://odeon.ie/x').currency, 'EUR');
    assert.equal(identify('https://cineworld.ie/x').currency, 'EUR');
    assert.equal(identify('https://cineworld.co.uk/x').currency, 'GBP');
  });

  test('New Zealand is NZD, not AUD, across every AU/NZ chain', () => {
    assert.equal(identify('https://eventcinemas.co.nz/x').currency, 'NZD');
    assert.equal(identify('https://hoyts.co.nz/x').currency, 'NZD');
    assert.equal(identify('https://readingcinemas.co.nz/x').currency, 'NZD');
  });

  test('Serbia is RSD, not EUR, for Cineplexx', () => {
    assert.equal(identify('https://cineplexx.rs/x').currency, 'RSD');
    assert.equal(identify('https://cineplexx.at/x').currency, 'EUR');
  });

  test('Cinépolis reports the right currency for each of its 4 distinct domains', () => {
    assert.equal(identify('https://cinepolis.com/x').currency, 'MXN');
    assert.equal(identify('https://cinepolis.com.br/x').currency, 'BRL');
    assert.equal(identify('https://cinepolis.com.ar/x').currency, 'ARS');
    assert.equal(identify('https://cinepolis.es/x').currency, 'EUR');
  });

  test('Kinepolis reports centre-out for BE/FR but sequential for ES/NL, within the same chain', () => {
    assert.equal(identify('https://kinepolis.be/x').seat.numbering, 'centerout');
    assert.equal(identify('https://kinepolis.fr/x').seat.numbering, 'centerout');
    assert.equal(identify('https://kinepolis.es/x').seat.numbering, 'sequential');
    assert.equal(identify('https://kinepolis.nl/x').seat.numbering, 'sequential');
  });

  test('a single-domain multi-country chain (VOX) has no per-domain signal to key off, and honestly falls back to the flat value', () => {
    // Documents the known limitation rather than asserting a fixed
    // behaviour would silently regress unnoticed.
    const p = identify('https://voxcinemas.com/x');
    assert.equal(p.country, 'AE');
    assert.equal(p.currency, 'AED');
  });
});

describe('identify() — Spain/Italy/Portugal/Netherlands are sequential, matching the README\'s own EU_CENTEROUT scope', () => {
  test('standalone chains', () => {
    assert.equal(identify('https://cinesa.es/x').seat.numbering, 'sequential');
    assert.equal(identify('https://yelmocines.es/x').seat.numbering, 'sequential');
    assert.equal(identify('https://ucicinemas.it/x').seat.numbering, 'sequential');
    assert.equal(identify('https://thespacecinema.it/x').seat.numbering, 'sequential');
    assert.equal(identify('https://cinemas.nos.pt/x').seat.numbering, 'sequential');
    assert.equal(identify('https://pathe.nl/x').seat.numbering, 'sequential');
  });

  test('COUNTRY_DEFAULTS fallback (unknown chain, known TLD) agrees', () => {
    assert.equal(identify('https://some-unlisted-cinema.es/x').seat.numbering, 'sequential');
    assert.equal(identify('https://some-unlisted-cinema.nl/x').seat.numbering, 'sequential');
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
