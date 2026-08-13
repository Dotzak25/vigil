/**
 * service-worker.js registers a handful of chrome.* event listeners at
 * module load time (onInstalled, onStartup, onAlarm, onMessage,
 * permissions.onAdded/onRemoved, notifications.onClicked) — none of which
 * exist under plain Node. This is the smallest shim that lets the module
 * load at all, purely so its two pure, exported helper functions
 * (schedule, inQuietHours) can be unit-tested without pulling in a full
 * chrome.* environment for everything else in the file (storage, tabs,
 * alarms, scripting, notifications — all genuinely need a real browser and
 * are exercised via the browser harness instead, see harness/).
 */
const noop = () => {};
globalThis.chrome = {
  runtime: { onInstalled: { addListener: noop }, onStartup: { addListener: noop }, onMessage: { addListener: noop } },
  alarms: { onAlarm: { addListener: noop } },
  permissions: { onAdded: { addListener: noop }, onRemoved: { addListener: noop } },
  notifications: { onClicked: { addListener: noop } },
  storage: { local: { get: async () => ({}), set: async () => {} } },
};

const { schedule, inQuietHours } = await import('../src/background/service-worker.js');

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

describe('schedule — exponential backoff, clamped, with jitter', () => {
  test('a small minute count schedules roughly that far out (±20% jitter)', () => {
    const now = Date.now();
    const next = schedule(5);
    const deltaMin = (next - now) / 60_000;
    assert.ok(deltaMin >= 4 && deltaMin <= 6, `expected ~5min ±20%, got ${deltaMin}`);
  });

  test('schedule() trusts its caller to have already clamped — the backoff clamp itself (Math.min(MAX_BACKOFF_MIN, 2**failures)) lives at the call site, not here', () => {
    // MAX_BACKOFF_MIN is 60; confirm a value at that ceiling still produces
    // a sane, finite result (this is what the caller actually ever passes).
    const next = schedule(60);
    assert.ok(Number.isFinite(next));
    const deltaMin = (next - Date.now()) / 60_000;
    assert.ok(deltaMin >= 48 && deltaMin <= 72, `expected ~60min ±20%, got ${deltaMin}`);
  });
});

describe('inQuietHours — the actual production semantics', () => {
  test('disabled quiet hours never suppress anything', () => {
    assert.equal(inQuietHours({ quietHours: { enabled: false, from: 1, to: 8 } }), false);
  });

  test('a same-day window (from < to) is quiet only inside [from, to)', () => {
    const withHour = (h) => {
      const RealDate = global.Date;
      global.Date = class extends RealDate { getHours() { return h; } };
      try { return inQuietHours({ quietHours: { enabled: true, from: 1, to: 8 } }); }
      finally { global.Date = RealDate; }
    };
    assert.equal(withHour(0), false);
    assert.equal(withHour(1), true);
    assert.equal(withHour(7), true);
    assert.equal(withHour(8), false); // half-open — boundary hour is NOT quiet
    assert.equal(withHour(12), false);
  });

  test('a midnight-wraparound window (from > to) is quiet outside [to, from)', () => {
    const withHour = (h) => {
      const RealDate = global.Date;
      global.Date = class extends RealDate { getHours() { return h; } };
      try { return inQuietHours({ quietHours: { enabled: true, from: 22, to: 6 } }); }
      finally { global.Date = RealDate; }
    };
    assert.equal(withHour(21), false);
    assert.equal(withHour(22), true);
    assert.equal(withHour(23), true);
    assert.equal(withHour(0), true);
    assert.equal(withHour(5), true);
    assert.equal(withHour(6), false); // half-open boundary
    assert.equal(withHour(12), false);
  });

  test('from === to is a zero-width window: quiet hours effectively never trigger, not "always quiet"', () => {
    const withHour = (h) => {
      const RealDate = global.Date;
      global.Date = class extends RealDate { getHours() { return h; } };
      try { return inQuietHours({ quietHours: { enabled: true, from: 8, to: 8 } }); }
      finally { global.Date = RealDate; }
    };
    // Documenting the actual, intentional behaviour: from===to takes the
    // same-day branch (from <= to), which evaluates to `h >= 8 && h < 8` —
    // always false. A user who sets both fields to the same hour gets no
    // quiet hours rather than 24 hours of silence, which is the safer
    // failure mode for an alerting tool.
    assert.equal(withHour(8), false);
    assert.equal(withHour(0), false);
    assert.equal(withHour(23), false);
  });
});
