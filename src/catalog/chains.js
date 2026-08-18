/**
 * chains.js — cinema operators worldwide.
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT CONTAIN: API endpoints.
 *
 * That's not laziness, it's the core design decision. A booking endpoint is
 * the most volatile thing about a cinema site — paths, keys and payload shapes
 * change without notice, and a shipped URL is a shipped bug with a fuse on it.
 * Endpoints are learned per-user by recording, which always reflects reality.
 *
 * What IS stable, for years at a time, is everything else: which domains a
 * chain owns, what currency and country it bills in, which premium formats it
 * runs, and how its seat maps are conventionally numbered. That's this file.
 * Together they mean a user opens a seat map anywhere on earth, VIGIL
 * recognises the chain, pre-fills every parameter, and the only thing left to
 * do is press record once.
 *
 * Seat-numbering values are HINTS. Runtime detection in seats.js always wins,
 * because a chain can and does vary between individual auditoriums.
 */

/**
 * Seat numbering conventions:
 *   'sequential' — 1,2,3… across the row. Anglophone default.
 *   'centerout'  — odd numbers left of centre descending, even right ascending
 *                  (…7,5,3,1 | 2,4,6,8…). Widespread in German-speaking,
 *                  Nordic and Central/Eastern European markets. Breaks naive
 *                  adjacency logic completely, which is why it's tracked.
 *   'auto'       — no reliable convention; detect at runtime.
 */
const EU_CENTEROUT = { numbering: 'centerout', rowOrder: 'front-first' };
const SEQ = { numbering: 'sequential', rowOrder: 'front-first' };
const AUTO = { numbering: 'auto', rowOrder: 'auto' };

/**
 * @type {Array} id, name, domains, countries, currency, formats, seat
 *
 * A chain's `currency` (and `seat`) is a single flat value, but several
 * chains genuinely operate across multiple currencies/conventions — one
 * per country, not one for the whole chain. Where `domains` and
 * `countries` line up positionally (domains[i] belongs to countries[i],
 * which is true for every multi-country chain below except the ones noted),
 * an optional `currencies`/`seats` array — same length, same order as
 * `domains` — lets identify() (registry.js) pick the value for whichever
 * domain actually matched, instead of always reporting the first country's
 * currency for every country the chain serves. Without this, e.g. a
 * Hungarian Cinema City user was told their currency was Polish złoty —
 * displayed directly in the profile banner meant to build confidence, and
 * a price_below/price_drop threshold set against the DISPLAYED currency
 * would then never evaluate against the ACTUAL one.
 */
export const CHAINS = [
  // ---------- North America ----------
  { id: 'amc', name: 'AMC Theatres', domains: ['amctheatres.com'], countries: ['US'], currency: 'USD', formats: ['imax', 'imax70', 'imaxlaser', 'dolby', 'prime'], seat: SEQ },
  { id: 'regal', name: 'Regal Cinemas', domains: ['regmovies.com'], countries: ['US'], currency: 'USD', formats: ['imax', 'rpx', '4dx', 'screenx'], seat: SEQ },
  { id: 'cinemark', name: 'Cinemark', domains: ['cinemark.com'], countries: ['US'], currency: 'USD', formats: ['imax', 'xd', 'dolby'], seat: SEQ },
  { id: 'cineplex', name: 'Cineplex', domains: ['cineplex.com'], countries: ['CA'], currency: 'CAD', formats: ['imax', 'imax70', 'icon', '4dx', 'screenx', 'prime'], seat: SEQ },
  { id: 'landmark-ca', name: 'Landmark Cinemas', domains: ['landmarkcinemas.com'], countries: ['CA'], currency: 'CAD', formats: ['prime'], seat: SEQ },
  { id: 'landmark-us', name: 'Landmark Theatres', domains: ['landmarktheatres.com'], countries: ['US'], currency: 'USD', formats: [], seat: SEQ },
  { id: 'alamo', name: 'Alamo Drafthouse', domains: ['drafthouse.com'], countries: ['US'], currency: 'USD', formats: ['film70', 'film35'], seat: SEQ },
  { id: 'marcus', name: 'Marcus Theatres', domains: ['marcustheatres.com'], countries: ['US'], currency: 'USD', formats: ['imax', 'dolby'], seat: SEQ },
  { id: 'harkins', name: 'Harkins Theatres', domains: ['harkins.com'], countries: ['US'], currency: 'USD', formats: ['imax'], seat: SEQ },
  { id: 'showcase-us', name: 'Showcase Cinemas', domains: ['showcasecinemas.com'], countries: ['US'], currency: 'USD', formats: ['imax', 'dolby'], seat: SEQ },
  { id: 'bb', name: 'B&B Theatres', domains: ['bbtheatres.com'], countries: ['US'], currency: 'USD', formats: ['dolby'], seat: SEQ },
  { id: 'smg', name: 'Studio Movie Grill', domains: ['studiomoviegrill.com'], countries: ['US'], currency: 'USD', formats: [], seat: SEQ },
  { id: 'ipic', name: 'iPic Theaters', domains: ['ipic.com'], countries: ['US'], currency: 'USD', formats: ['prime'], seat: SEQ },
  { id: 'fandango', name: 'Fandango (aggregator)', domains: ['fandango.com'], countries: ['US'], currency: 'USD', formats: ['imax', 'dolby', 'xd', 'rpx'], seat: SEQ, aggregator: true },
  { id: 'atom', name: 'Atom Tickets (aggregator)', domains: ['atomtickets.com'], countries: ['US'], currency: 'USD', formats: ['imax', 'dolby'], seat: SEQ, aggregator: true },

  // ---------- UK & Ireland ----------
  { id: 'odeon', name: 'ODEON', domains: ['odeon.co.uk', 'odeon.ie'], countries: ['GB', 'IE'], currency: 'GBP', currencies: ['GBP', 'EUR'], formats: ['imax', 'imax70', 'dolby', 'icon'], seat: SEQ },
  { id: 'cineworld', name: 'Cineworld', domains: ['cineworld.co.uk', 'cineworld.ie'], countries: ['GB', 'IE'], currency: 'GBP', currencies: ['GBP', 'EUR'], formats: ['imax', 'imax70', '4dx', 'screenx', 'icon'], seat: SEQ },
  { id: 'vue', name: 'Vue Cinemas', domains: ['myvue.com'], countries: ['GB', 'IE'], currency: 'GBP', formats: ['imax', 'icon'], seat: SEQ },
  { id: 'everyman', name: 'Everyman', domains: ['everymancinema.com'], countries: ['GB'], currency: 'GBP', formats: [], seat: SEQ },
  { id: 'picturehouse', name: 'Picturehouse', domains: ['picturehouses.com'], countries: ['GB'], currency: 'GBP', formats: ['film70'], seat: SEQ },
  { id: 'curzon', name: 'Curzon', domains: ['curzon.com'], countries: ['GB'], currency: 'GBP', formats: ['film35'], seat: SEQ },
  { id: 'showcase-uk', name: 'Showcase UK', domains: ['showcasecinemas.co.uk'], countries: ['GB'], currency: 'GBP', formats: ['imax'], seat: SEQ },
  { id: 'bfi', name: 'BFI IMAX', domains: ['bfi.org.uk'], countries: ['GB'], currency: 'GBP', formats: ['imax', 'imax70', 'film70'], seat: SEQ },

  // ---------- Western Europe ----------
  { id: 'pathe-fr', name: 'Pathé France', domains: ['pathe.fr', 'cinemaspathegaumont.com'], countries: ['FR'], currency: 'EUR', formats: ['imax', 'dolby', '4dx', 'screenx'], seat: EU_CENTEROUT },
  // NL/ES/IT/PT cinemas conventionally number sequentially, not centre-out —
  // this file's own README-quoted scope for EU_CENTEROUT is German-speaking,
  // Nordic, French and Central/Eastern European markets specifically, which
  // doesn't include these four. They were previously tagged EU_CENTEROUT
  // anyway, contradicting the project's own stated claim; seat.js's runtime
  // detection and the minimap check catch a wrong hint, but a first-timer
  // has no reason to doubt a hint that's simply wrong from the start.
  { id: 'pathe-nl', name: 'Pathé Nederland', domains: ['pathe.nl'], countries: ['NL'], currency: 'EUR', formats: ['imax', 'dolby', '4dx'], seat: SEQ },
  { id: 'ugc', name: 'UGC', domains: ['ugc.fr', 'ugc.be'], countries: ['FR', 'BE'], currency: 'EUR', formats: ['imax', 'dolby'], seat: EU_CENTEROUT },
  { id: 'cgr', name: 'CGR Cinémas', domains: ['cgrcinemas.fr'], countries: ['FR'], currency: 'EUR', formats: ['icon'], seat: EU_CENTEROUT },
  // ES/NL differ in seat convention from BE/FR within this SAME chain — see
  // the `seats` array note above the CHAINS declaration.
  { id: 'kinepolis', name: 'Kinepolis', domains: ['kinepolis.be', 'kinepolis.fr', 'kinepolis.es', 'kinepolis.nl', 'kinepolis.lu'], countries: ['BE', 'FR', 'ES', 'NL', 'LU'], currency: 'EUR', formats: ['imax', '4dx', 'icon'], seat: EU_CENTEROUT, seats: [EU_CENTEROUT, EU_CENTEROUT, SEQ, SEQ, EU_CENTEROUT] },
  { id: 'cinestar-de', name: 'CineStar', domains: ['cinestar.de'], countries: ['DE'], currency: 'EUR', formats: ['imax', '4dx'], seat: EU_CENTEROUT },
  { id: 'cinemaxx', name: 'CinemaxX', domains: ['cinemaxx.de'], countries: ['DE'], currency: 'EUR', formats: ['dolby'], seat: EU_CENTEROUT },
  { id: 'uci-de', name: 'UCI Kinowelt', domains: ['uci-kinowelt.de'], countries: ['DE'], currency: 'EUR', formats: ['imax', 'dolby'], seat: EU_CENTEROUT },
  { id: 'cineplexx', name: 'Cineplexx', domains: ['cineplexx.at', 'cineplexx.si', 'cineplexx.rs'], countries: ['AT', 'SI', 'RS'], currency: 'EUR', currencies: ['EUR', 'EUR', 'RSD'], formats: ['imax', 'dolby', '4dx'], seat: EU_CENTEROUT },
  { id: 'arena-ch', name: 'Arena / Blue Cinema', domains: ['arena.ch', 'bluecinema.ch'], countries: ['CH'], currency: 'CHF', formats: ['imax', '4dx'], seat: EU_CENTEROUT },
  { id: 'cinesa', name: 'Cinesa', domains: ['cinesa.es'], countries: ['ES'], currency: 'EUR', formats: ['imax', 'dolby', '4dx'], seat: SEQ },
  { id: 'yelmo', name: 'Yelmo Cines', domains: ['yelmocines.es'], countries: ['ES'], currency: 'EUR', formats: ['imax', '4dx'], seat: SEQ },
  { id: 'uci-it', name: 'UCI Cinemas Italia', domains: ['ucicinemas.it'], countries: ['IT'], currency: 'EUR', formats: ['imax', '4dx'], seat: SEQ },
  { id: 'thespace', name: 'The Space Cinema', domains: ['thespacecinema.it'], countries: ['IT'], currency: 'EUR', formats: ['imax', '4dx'], seat: SEQ },
  { id: 'nos-pt', name: 'NOS Cinemas', domains: ['cinemas.nos.pt'], countries: ['PT'], currency: 'EUR', formats: ['imax', '4dx'], seat: SEQ },

  // ---------- Nordics ----------
  { id: 'filmstaden', name: 'Filmstaden', domains: ['filmstaden.se'], countries: ['SE'], currency: 'SEK', formats: ['imax', '4dx'], seat: EU_CENTEROUT },
  { id: 'nfbio', name: 'Nordisk Film Biografer', domains: ['nfbio.dk'], countries: ['DK'], currency: 'DKK', formats: ['imax', '4dx'], seat: EU_CENTEROUT },
  { id: 'finnkino', name: 'Finnkino', domains: ['finnkino.fi'], countries: ['FI'], currency: 'EUR', formats: ['imax', '4dx'], seat: EU_CENTEROUT },
  { id: 'odeon-no', name: 'ODEON Norge', domains: ['odeonkino.no'], countries: ['NO'], currency: 'NOK', formats: ['imax'], seat: EU_CENTEROUT },

  // ---------- Central & Eastern Europe ----------
  { id: 'cinemacity', name: 'Cinema City', domains: ['cinema-city.pl', 'cinemacity.cz', 'cinemacity.hu', 'cinemacity.ro', 'cinemacity.bg', 'cinemacity.sk'], countries: ['PL', 'CZ', 'HU', 'RO', 'BG', 'SK'], currency: 'PLN', currencies: ['PLN', 'CZK', 'HUF', 'RON', 'BGN', 'EUR'], formats: ['imax', '4dx', 'screenx', 'icon'], seat: EU_CENTEROUT },
  { id: 'multikino', name: 'Multikino', domains: ['multikino.pl'], countries: ['PL'], currency: 'PLN', formats: ['imax'], seat: EU_CENTEROUT },
  { id: 'helios-pl', name: 'Helios', domains: ['helios.pl'], countries: ['PL'], currency: 'PLN', formats: ['dolby'], seat: EU_CENTEROUT },
  { id: 'cinamon', name: 'Cinamon / Forum Cinemas', domains: ['cinamonkino.com', 'forumcinemas.lv', 'forumcinemas.lt'], countries: ['EE', 'LV', 'LT'], currency: 'EUR', formats: ['4dx'], seat: EU_CENTEROUT },
  { id: 'village-gr', name: 'Village Cinemas Greece', domains: ['villagecinemas.gr'], countries: ['GR'], currency: 'EUR', formats: ['imax'], seat: EU_CENTEROUT },

  // ---------- East Asia ----------
  { id: 'cgv-kr', name: 'CGV', domains: ['cgv.co.kr'], countries: ['KR'], currency: 'KRW', formats: ['imax', 'imaxlaser', '4dx', 'screenx', 'prime'], seat: AUTO },
  { id: 'lotte-kr', name: 'Lotte Cinema', domains: ['lottecinema.co.kr'], countries: ['KR'], currency: 'KRW', formats: ['imax', 'dolby', 'prime'], seat: AUTO },
  { id: 'megabox', name: 'Megabox', domains: ['megabox.co.kr'], countries: ['KR'], currency: 'KRW', formats: ['dolby', 'prime'], seat: AUTO },
  { id: 'toho', name: 'TOHO Cinemas', domains: ['tohotheater.jp', 'hlo.tohotheater.jp'], countries: ['JP'], currency: 'JPY', formats: ['imax', 'imaxlaser', 'dolby', '4dx', 'screenx'], seat: AUTO },
  { id: 'aeon-jp', name: 'AEON Cinema', domains: ['aeoncinema.com'], countries: ['JP'], currency: 'JPY', formats: ['imax', '4dx'], seat: AUTO },
  { id: '109-jp', name: '109 Cinemas', domains: ['109cinemas.net'], countries: ['JP'], currency: 'JPY', formats: ['imax', 'imax70'], seat: AUTO },
  { id: 'united-jp', name: 'United Cinemas', domains: ['unitedcinemas.jp'], countries: ['JP'], currency: 'JPY', formats: ['imax', '4dx'], seat: AUTO },
  { id: 'vieshow', name: 'Vieshow Cinemas', domains: ['vscinemas.com.tw'], countries: ['TW'], currency: 'TWD', formats: ['imax', '4dx'], seat: AUTO },
  { id: 'mcl-hk', name: 'MCL Cinemas', domains: ['mclcinema.com'], countries: ['HK'], currency: 'HKD', formats: ['imax', 'dolby'], seat: AUTO },
  { id: 'broadway-hk', name: 'Broadway Circuit', domains: ['cinema.com.hk'], countries: ['HK'], currency: 'HKD', formats: ['imax'], seat: AUTO },

  // ---------- South & Southeast Asia ----------
  { id: 'pvrinox', name: 'PVR INOX', domains: ['pvrcinemas.com', 'pvrinox.com'], countries: ['IN'], currency: 'INR', formats: ['imax', 'imaxlaser', '4dx', 'screenx', 'prime'], seat: AUTO },
  { id: 'bookmyshow', name: 'BookMyShow (aggregator)', domains: ['bookmyshow.com'], countries: ['IN'], currency: 'INR', formats: ['imax', '4dx', 'dolby'], seat: AUTO, aggregator: true },
  { id: 'gv-sg', name: 'Golden Village', domains: ['gv.com.sg'], countries: ['SG'], currency: 'SGD', formats: ['imax', 'dolby', '4dx'], seat: AUTO },
  { id: 'shaw-sg', name: 'Shaw Theatres', domains: ['shaw.sg'], countries: ['SG'], currency: 'SGD', formats: ['imax', 'dolby'], seat: AUTO },
  { id: 'gsc-my', name: 'Golden Screen Cinemas', domains: ['gsc.com.my'], countries: ['MY'], currency: 'MYR', formats: ['imax', 'dolby', '4dx'], seat: AUTO },
  { id: 'tgv-my', name: 'TGV Cinemas', domains: ['tgv.com.my'], countries: ['MY'], currency: 'MYR', formats: ['imax', 'dolby'], seat: AUTO },
  { id: 'major-th', name: 'Major Cineplex', domains: ['majorcineplex.com'], countries: ['TH'], currency: 'THB', formats: ['imax', '4dx', 'screenx'], seat: AUTO },
  { id: 'sf-th', name: 'SF Cinema', domains: ['sfcinemacity.com'], countries: ['TH'], currency: 'THB', formats: ['imax', '4dx'], seat: AUTO },
  { id: 'cgv-vn', name: 'CGV Vietnam', domains: ['cgv.vn'], countries: ['VN'], currency: 'VND', formats: ['imax', '4dx', 'screenx'], seat: AUTO },
  { id: 'xxi-id', name: 'Cinema XXI', domains: ['21cineplex.com', 'm.21cineplex.com'], countries: ['ID'], currency: 'IDR', formats: ['imax', 'dolby'], seat: AUTO },
  { id: 'cgv-id', name: 'CGV Indonesia', domains: ['cgv.id'], countries: ['ID'], currency: 'IDR', formats: ['imax', '4dx', 'screenx'], seat: AUTO },
  { id: 'sm-ph', name: 'SM Cinema', domains: ['smcinema.com'], countries: ['PH'], currency: 'PHP', formats: ['imax', 'dolby'], seat: AUTO },

  // ---------- Oceania ----------
  { id: 'event-au', name: 'Event Cinemas', domains: ['eventcinemas.com.au', 'eventcinemas.co.nz'], countries: ['AU', 'NZ'], currency: 'AUD', currencies: ['AUD', 'NZD'], formats: ['imax', 'imax70', '4dx', 'prime'], seat: SEQ },
  { id: 'hoyts-au', name: 'HOYTS', domains: ['hoyts.com.au', 'hoyts.co.nz'], countries: ['AU', 'NZ'], currency: 'AUD', currencies: ['AUD', 'NZD'], formats: ['dolby', 'xd', 'prime'], seat: SEQ },
  { id: 'village-au', name: 'Village Cinemas', domains: ['villagecinemas.com.au'], countries: ['AU'], currency: 'AUD', formats: ['imax', '4dx', 'prime'], seat: SEQ },
  { id: 'reading-au', name: 'Reading Cinemas', domains: ['readingcinemas.com.au', 'readingcinemas.co.nz'], countries: ['AU', 'NZ'], currency: 'AUD', currencies: ['AUD', 'NZD'], formats: ['prime'], seat: SEQ },
  { id: 'palace-au', name: 'Palace Cinemas', domains: ['palacecinemas.com.au'], countries: ['AU'], currency: 'AUD', formats: [], seat: SEQ },

  // ---------- Latin America ----------
  // Only 4 domains for 7 countries — CO/PE/CL have no distinct Cinépolis
  // domain in this catalogue at all, so they can never be the one that
  // matches anyway; the currencies array below only needs to (and can only)
  // cover the 4 domains that actually exist.
  { id: 'cinepolis', name: 'Cinépolis', domains: ['cinepolis.com', 'cinepolis.com.br', 'cinepolis.com.ar', 'cinepolis.es'], countries: ['MX', 'BR', 'AR', 'ES', 'CO', 'PE', 'CL'], currency: 'MXN', currencies: ['MXN', 'BRL', 'ARS', 'EUR'], formats: ['imax', '4dx', 'screenx', 'prime'], seat: AUTO },
  { id: 'cinemex', name: 'Cinemex', domains: ['cinemex.com'], countries: ['MX'], currency: 'MXN', formats: ['imax', 'prime'], seat: AUTO },
  { id: 'cinemark-br', name: 'Cinemark Brasil', domains: ['cinemark.com.br'], countries: ['BR'], currency: 'BRL', formats: ['imax', 'xd', 'prime'], seat: AUTO },
  { id: 'kinoplex', name: 'Kinoplex', domains: ['kinoplex.com.br'], countries: ['BR'], currency: 'BRL', formats: ['imax'], seat: AUTO },
  { id: 'cinecolombia', name: 'Cine Colombia', domains: ['cinecolombia.com'], countries: ['CO'], currency: 'COP', formats: ['imax', '4dx'], seat: AUTO },
  { id: 'cinemark-latam', name: 'Cinemark LatAm', domains: ['cinemark.com.ar', 'cinemark.cl', 'cinemark.com.pe', 'cinemark.com.co'], countries: ['AR', 'CL', 'PE', 'CO'], currency: 'ARS', currencies: ['ARS', 'CLP', 'PEN', 'COP'], formats: ['imax', 'xd'], seat: AUTO },

  // ---------- Middle East & Africa ----------
  // vox/novo: a SINGLE domain covers every listed country (likely
  // country-specific subpaths under one hostname, e.g. /uae/, /ksa/), so
  // there's no domain-per-country signal to key a currency lookup off —
  // unlike every chain above, this one can't be fixed by the currencies
  // array mechanism. Left as a known, documented limitation rather than a
  // silently-wrong per-country guess.
  { id: 'vox', name: 'VOX Cinemas', domains: ['voxcinemas.com'], countries: ['AE', 'SA', 'QA', 'BH', 'KW', 'OM', 'EG', 'LB'], currency: 'AED', formats: ['imax', '4dx', 'screenx', 'prime'], seat: AUTO, rtl: true },
  { id: 'reel', name: 'Reel Cinemas', domains: ['reelcinemas.ae'], countries: ['AE'], currency: 'AED', formats: ['dolby', 'prime'], seat: AUTO, rtl: true },
  { id: 'novo', name: 'Novo Cinemas', domains: ['novocinemas.com'], countries: ['AE', 'QA', 'BH'], currency: 'AED', formats: ['imax', '4dx'], seat: AUTO, rtl: true },
  { id: 'muvi', name: 'Muvi Cinemas', domains: ['muvicinemas.com'], countries: ['SA'], currency: 'SAR', formats: ['imax', '4dx', 'screenx'], seat: AUTO, rtl: true },
  { id: 'yesplanet', name: 'Yes Planet / Cinema City IL', domains: ['yesplanet.co.il', 'cinema-city.co.il'], countries: ['IL'], currency: 'ILS', formats: ['imax', '4dx'], seat: AUTO, rtl: true },
  { id: 'sterkinekor', name: 'Ster-Kinekor', domains: ['sterkinekor.com'], countries: ['ZA'], currency: 'ZAR', formats: ['imax', 'dolby', '4dx'], seat: AUTO },
  { id: 'numetro', name: 'Nu Metro', domains: ['numetro.co.za'], countries: ['ZA'], currency: 'ZAR', formats: ['imax'], seat: AUTO },
];

/** Country → sensible defaults when a domain isn't a known chain. */
export const COUNTRY_DEFAULTS = {
  US: { currency: 'USD', seat: SEQ }, CA: { currency: 'CAD', seat: SEQ },
  GB: { currency: 'GBP', seat: SEQ }, IE: { currency: 'EUR', seat: SEQ },
  AU: { currency: 'AUD', seat: SEQ }, NZ: { currency: 'NZD', seat: SEQ },
  DE: { currency: 'EUR', seat: EU_CENTEROUT }, AT: { currency: 'EUR', seat: EU_CENTEROUT },
  CH: { currency: 'CHF', seat: EU_CENTEROUT }, FR: { currency: 'EUR', seat: EU_CENTEROUT },
  // NL/ES/IT/PT: sequential, not centre-out — see the note by the chain
  // entries above; these four are outside this project's own stated scope
  // for EU_CENTEROUT (German-speaking, Nordic, French, Central/Eastern
  // European).
  NL: { currency: 'EUR', seat: SEQ }, BE: { currency: 'EUR', seat: EU_CENTEROUT },
  ES: { currency: 'EUR', seat: SEQ }, IT: { currency: 'EUR', seat: SEQ },
  PT: { currency: 'EUR', seat: SEQ }, PL: { currency: 'PLN', seat: EU_CENTEROUT },
  CZ: { currency: 'CZK', seat: EU_CENTEROUT }, SE: { currency: 'SEK', seat: EU_CENTEROUT },
  NO: { currency: 'NOK', seat: EU_CENTEROUT }, DK: { currency: 'DKK', seat: EU_CENTEROUT },
  FI: { currency: 'EUR', seat: EU_CENTEROUT }, JP: { currency: 'JPY', seat: AUTO },
  KR: { currency: 'KRW', seat: AUTO }, IN: { currency: 'INR', seat: AUTO },
  BR: { currency: 'BRL', seat: AUTO }, MX: { currency: 'MXN', seat: AUTO },
  AE: { currency: 'AED', seat: AUTO }, SA: { currency: 'SAR', seat: AUTO },
  ZA: { currency: 'ZAR', seat: AUTO }, SG: { currency: 'SGD', seat: AUTO },
};

/**
 * Registrable-domain match, so `www.` and regional subdomains all resolve.
 * Returns the matched chain augmented with `matchedDomain` — which entry in
 * its own `domains` array actually matched. registry.js uses that to look
 * up the right entry in a chain's optional `currencies`/`seats` arrays
 * (parallel to `domains`) for chains that genuinely vary by country, rather
 * than always reporting the chain's single flat `currency`/`seat` value.
 */
export function matchChain(url) {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
  for (const c of CHAINS) {
    const domain = c.domains.find((d) => host === d || host.endsWith(`.${d}`));
    if (domain) return { ...c, matchedDomain: domain };
  }
  return null;
}

export function chainById(id) {
  return CHAINS.find((c) => c.id === id) || null;
}

export const CHAIN_COUNT = CHAINS.length;
export const COUNTRY_COUNT = new Set(CHAINS.flatMap((c) => c.countries)).size;
