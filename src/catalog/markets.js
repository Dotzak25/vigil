/**
 * markets.js — everything that isn't a cinema.
 *
 * Same rule as chains.js: domains and parameters here, never endpoints.
 *
 * Three kinds of site, and they want genuinely different default rules:
 *
 *   drop    primary retail, limited stock. You want RESTOCK and NEW ITEM.
 *           Price is fixed; availability is the whole game.
 *
 *   resale  secondary market. Stock is never the issue — price is. You want
 *           PRICE DROP against a rolling median, not against yesterday.
 *
 *   ticket  seated events. Same seat scoring as cinema, plus the fact that
 *           returns and released holds are the entire opportunity.
 *
 * `variantAxis` is what makes two listings different things rather than the
 * same thing at two prices — shoe size, watch reference, ticket tier. Diffing
 * on the wrong axis is how you get "back in stock!" for a size you don't wear.
 */

export const MARKETS = [
  // ---------- limited-edition drops ----------
  { id: 'swatch', name: 'Swatch', domains: ['swatch.com'], type: 'drop', countries: ['*'], variantAxis: 'model', notes: 'Collab models (MoonSwatch/Blancpain-style) sell out in minutes and restock irregularly.' },
  { id: 'snkrs', name: 'Nike / SNKRS', domains: ['nike.com'], type: 'drop', countries: ['*'], variantAxis: 'size' },
  { id: 'adidas', name: 'adidas / CONFIRMED', domains: ['adidas.com', 'adidas.co.uk', 'adidas.de'], type: 'drop', countries: ['*'], variantAxis: 'size' },
  { id: 'supreme', name: 'Supreme', domains: ['supremenewyork.com', 'supreme.com'], type: 'drop', countries: ['*'], variantAxis: 'size' },
  { id: 'popmart', name: 'POP MART', domains: ['popmart.com'], type: 'drop', countries: ['*'], variantAxis: 'model' },
  { id: 'lego', name: 'LEGO', domains: ['lego.com'], type: 'drop', countries: ['*'], variantAxis: 'model' },
  { id: 'nintendo', name: 'Nintendo Store', domains: ['nintendo.com', 'store.nintendo.co.uk'], type: 'drop', countries: ['*'], variantAxis: 'model' },
  { id: 'playstation', name: 'PlayStation Direct', domains: ['direct.playstation.com'], type: 'drop', countries: ['*'], variantAxis: 'model' },
  { id: 'pokemoncenter', name: 'Pokémon Center', domains: ['pokemoncenter.com'], type: 'drop', countries: ['*'], variantAxis: 'model' },
  { id: 'uniqlo', name: 'UNIQLO', domains: ['uniqlo.com'], type: 'drop', countries: ['*'], variantAxis: 'size' },
  { id: 'endclothing', name: 'END. Clothing', domains: ['endclothing.com'], type: 'drop', countries: ['*'], variantAxis: 'size' },
  { id: 'sneakersnstuff', name: 'SNS', domains: ['sneakersnstuff.com'], type: 'drop', countries: ['*'], variantAxis: 'size' },

  // ---------- resale / secondary ----------
  { id: 'stockx', name: 'StockX', domains: ['stockx.com'], type: 'resale', countries: ['*'], variantAxis: 'size', notes: 'Bid/ask structure — watch lowest ask, not last sale.' },
  { id: 'goat', name: 'GOAT', domains: ['goat.com'], type: 'resale', countries: ['*'], variantAxis: 'size' },
  { id: 'ebay', name: 'eBay', domains: ['ebay.com', 'ebay.co.uk', 'ebay.de', 'ebay.com.au', 'ebay.ca', 'ebay.fr', 'ebay.it', 'ebay.es'], type: 'resale', countries: ['*'], variantAxis: 'condition' },
  { id: 'grailed', name: 'Grailed', domains: ['grailed.com'], type: 'resale', countries: ['*'], variantAxis: 'size' },
  { id: 'vinted', name: 'Vinted', domains: ['vinted.com', 'vinted.co.uk', 'vinted.fr', 'vinted.de', 'vinted.pl'], type: 'resale', countries: ['*'], variantAxis: 'size' },
  { id: 'depop', name: 'Depop', domains: ['depop.com'], type: 'resale', countries: ['*'], variantAxis: 'size' },
  { id: 'mercari', name: 'Mercari', domains: ['mercari.com', 'jp.mercari.com'], type: 'resale', countries: ['US', 'JP'], variantAxis: 'condition' },
  { id: 'yahoo-auc', name: 'Yahoo! Auctions Japan', domains: ['auctions.yahoo.co.jp'], type: 'resale', countries: ['JP'], variantAxis: 'condition' },
  { id: 'chrono24', name: 'Chrono24', domains: ['chrono24.com', 'chrono24.co.uk', 'chrono24.de'], type: 'resale', countries: ['*'], variantAxis: 'reference', notes: 'Watches. Reference number is the identity; condition and box/papers move price 15–30%.' },
  { id: 'watchcharts', name: 'WatchCharts', domains: ['watchcharts.com'], type: 'resale', countries: ['*'], variantAxis: 'reference' },
  { id: 'bezel', name: 'Bezel', domains: ['getbezel.com'], type: 'resale', countries: ['US'], variantAxis: 'reference' },
  { id: 'vestiaire', name: 'Vestiaire Collective', domains: ['vestiairecollective.com'], type: 'resale', countries: ['*'], variantAxis: 'condition' },
  { id: 'therealreal', name: 'The RealReal', domains: ['therealreal.com'], type: 'resale', countries: ['US'], variantAxis: 'condition' },
  { id: 'rebag', name: 'Rebag', domains: ['rebag.com'], type: 'resale', countries: ['US'], variantAxis: 'condition' },
  { id: 'carousell', name: 'Carousell', domains: ['carousell.sg', 'carousell.com.my', 'carousell.ph'], type: 'resale', countries: ['SG', 'MY', 'PH'], variantAxis: 'condition' },
  { id: 'poshmark', name: 'Poshmark', domains: ['poshmark.com'], type: 'resale', countries: ['US', 'CA'], variantAxis: 'size' },

  // ---------- event ticketing ----------
  { id: 'ticketmaster', name: 'Ticketmaster', domains: ['ticketmaster.com', 'ticketmaster.co.uk', 'ticketmaster.ca', 'ticketmaster.com.au', 'ticketmaster.de'], type: 'ticket', countries: ['*'], variantAxis: 'tier', seated: true },
  { id: 'stubhub', name: 'StubHub', domains: ['stubhub.com', 'stubhub.co.uk'], type: 'ticket', countries: ['*'], variantAxis: 'tier', seated: true },
  { id: 'seatgeek', name: 'SeatGeek', domains: ['seatgeek.com'], type: 'ticket', countries: ['US'], variantAxis: 'tier', seated: true },
  { id: 'axs', name: 'AXS', domains: ['axs.com', 'axs.co.uk'], type: 'ticket', countries: ['US', 'GB'], variantAxis: 'tier', seated: true },
  { id: 'dice', name: 'DICE', domains: ['dice.fm'], type: 'ticket', countries: ['*'], variantAxis: 'tier' },
  { id: 'eventim', name: 'Eventim', domains: ['eventim.de', 'eventim.co.uk', 'eventim.nl'], type: 'ticket', countries: ['DE', 'GB', 'NL'], variantAxis: 'tier', seated: true },
  { id: 'ticketek', name: 'Ticketek', domains: ['premier.ticketek.com.au', 'ticketek.co.nz'], type: 'ticket', countries: ['AU', 'NZ'], variantAxis: 'tier', seated: true },
  { id: 'viagogo', name: 'viagogo', domains: ['viagogo.com'], type: 'ticket', countries: ['*'], variantAxis: 'tier', seated: true },
  { id: 'interpark', name: 'Interpark Ticket', domains: ['tickets.interpark.com'], type: 'ticket', countries: ['KR'], variantAxis: 'tier', seated: true },
];

/**
 * Default rule sets by site type. This is what makes onboarding one screen
 * instead of five — VIGIL proposes rules that fit the kind of site you're on,
 * and you adjust rather than compose from nothing.
 */
export const DEFAULT_RULES = {
  cinema: [{ type: 'seat_block', partySize: 2, minScore: 70, profile: 'standard' }],
  ticket: [
    { type: 'seat_block', partySize: 2, minScore: 65, profile: 'standard' },
    { type: 'new_item' },
  ],
  drop: [{ type: 'restock' }, { type: 'new_item' }],
  resale: [
    { type: 'price_drop', pct: 20, windowDays: 30 },
    { type: 'price_below', value: null },
  ],
};

export function matchMarket(url) {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
  for (const m of MARKETS) {
    if (m.domains.some((d) => host === d || host.endsWith(`.${d}`))) return m;
  }
  return null;
}

export const MARKET_COUNT = MARKETS.length;
