/**
 * recorder.js — runs in the page's own JavaScript world.
 *
 * Why this exists: hard-coding "the Cineplex seat map endpoint" is a promise
 * to break. Sites rotate paths, keys and payload shapes constantly. So VIGIL
 * doesn't guess — it watches the site call its own API once, while you're
 * looking at the seat map, and replays exactly that request on a schedule.
 *
 * Record once, replay forever. That's the whole trick, and it's why the same
 * engine works on a cinema, a sneaker drop and a resale listing.
 *
 * This file only observes. It never blocks, rewrites or delays a request.
 */

(() => {
  const TAG = '__VIGIL_CAPTURE__';
  const MAX_BODY = 600_000;
  const MIN_BODY = 40; // ignore pings and empty 204s

  const looksLikeData = (ct, url) =>
    /json|javascript/i.test(ct || '') || /\.json(\?|$)/i.test(url || '');

  function emit(rec) {
    try {
      window.postMessage({ source: TAG, payload: rec }, window.location.origin);
    } catch (_) {
      /* page CSP or cross-origin weirdness — never let this surface */
    }
  }

  /* ---------- fetch ---------- */

  const origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function (...args) {
      const p = origFetch.apply(this, args);
      try {
        const req = args[0];
        const init = args[1] || {};
        const url = typeof req === 'string' ? req : req?.url;
        const method = (init.method || (typeof req === 'object' && req?.method) || 'GET').toUpperCase();

        const headers = {};
        try {
          const h = init.headers || (typeof req === 'object' && req?.headers);
          if (h) {
            if (typeof h.forEach === 'function') h.forEach((v, k) => (headers[k] = v));
            else Object.assign(headers, h);
          }
        } catch (_) {}

        p.then((res) => {
          try {
            const ct = res.headers.get('content-type');
            if (!looksLikeData(ct, url)) return;
            res
              .clone()
              .text()
              .then((body) => {
                if (body.length < MIN_BODY) return;
                emit({
                  url: new URL(url, location.href).href,
                  method,
                  headers,
                  requestBody: typeof init.body === 'string' ? init.body.slice(0, 4000) : null,
                  status: res.status,
                  body: body.slice(0, MAX_BODY),
                  truncated: body.length > MAX_BODY,
                  via: 'fetch',
                  at: Date.now(),
                });
              })
              .catch(() => {});
          } catch (_) {}
        }).catch(() => {});
      } catch (_) {}
      return p;
    };
  }

  /* ---------- XMLHttpRequest ---------- */

  const XHR = window.XMLHttpRequest;
  if (XHR && XHR.prototype) {
    const open = XHR.prototype.open;
    const send = XHR.prototype.send;
    const setHeader = XHR.prototype.setRequestHeader;

    XHR.prototype.open = function (method, url, ...rest) {
      this.__vigil = { method: String(method || 'GET').toUpperCase(), url, headers: {} };
      return open.call(this, method, url, ...rest);
    };

    XHR.prototype.setRequestHeader = function (k, v) {
      if (this.__vigil) this.__vigil.headers[k] = v;
      return setHeader.call(this, k, v);
    };

    XHR.prototype.send = function (body) {
      try {
        const meta = this.__vigil;
        if (meta) {
          this.addEventListener('load', () => {
            try {
              const ct = this.getResponseHeader('content-type');
              if (!looksLikeData(ct, meta.url)) return;
              const text = this.responseType === '' || this.responseType === 'text'
                ? this.responseText
                : this.responseType === 'json'
                  ? JSON.stringify(this.response)
                  : null;
              if (!text || text.length < MIN_BODY) return;
              emit({
                url: new URL(meta.url, location.href).href,
                method: meta.method,
                headers: meta.headers,
                requestBody: typeof body === 'string' ? body.slice(0, 4000) : null,
                status: this.status,
                body: text.slice(0, MAX_BODY),
                truncated: text.length > MAX_BODY,
                via: 'xhr',
                at: Date.now(),
              });
            } catch (_) {}
          });
        }
      } catch (_) {}
      return send.call(this, body);
    };
  }
})();
