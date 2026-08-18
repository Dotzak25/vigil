/**
 * webhook.js — an optional second delivery channel, straight from the
 * browser, no server involved.
 *
 * Competitive research across ticket, sneaker/TCG, and general restock-alert
 * tools turned up the same gap repeatedly: paid Discord "cook groups" charge
 * $30-95/month largely to deliver alerts into Discord, while almost no
 * consumer-facing monitoring tool ships a Discord webhook at all — the one
 * that does (TicketsData) is priced at brokers. A pasted webhook URL closes
 * that gap for free, using infrastructure VIGIL already has: the background
 * service worker just POSTs to it, exactly like it replays a watched
 * request. No account, no server, nothing new to trust.
 */

/**
 * Formats a hit for a webhook without knowing which service it's headed
 * to. Discord's incoming-webhook format reads `content`; Slack's reads
 * `text`. Both ignore fields they don't recognise, so sending both covers
 * the two overwhelmingly common targets for a URL pasted into a single
 * "webhook URL" field, with no separate "which service?" setting needed.
 */
export function formatWebhookPayload(hit) {
  const line = [
    `**${hit.watcherName}** — ${hit.title}`,
    hit.body,
    hit.url || null,
  ].filter(Boolean).join('\n');

  return { content: line, text: line };
}

/** A pasted URL should at least look like an https webhook before it's saved. */
export function isPlausibleWebhookUrl(url) {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'https:';
  } catch {
    return false;
  }
}
