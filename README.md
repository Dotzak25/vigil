# VIGIL

Watches pages you'd otherwise refresh fifty times a day, and tells you the moment a seat, a size, or a price opens up.

Built from one specific problem — *the show is sold out, but people cancel, and whoever checks at the right minute gets the seat* — and generalised to the two other places the same problem lives: limited-edition drops, and resale prices.

**87 cinema chains across 59 countries. 37 marketplaces. 14 languages of "sold out".**

---

## Install

1. `chrome://extensions` → **Developer mode**
2. **Load unpacked** → select this folder
3. Pin VIGIL to the toolbar

---

## The one idea

Hard-coding "the Cineplex seat map endpoint" is a promise to break. Sites rotate paths, keys and payload shapes constantly, and there are hundreds of cinema chains.

So VIGIL splits every site into a **stable half** and a **volatile half**, and treats them completely differently.

| | Stable — ships in the catalogue | Volatile — learned per user |
|---|---|---|
| What | Which domains a chain owns, its country, currency, seat-numbering convention, premium formats, sensible default rules | Which request holds the data, and where the fields live inside it |
| Changes | Every few years | Every few months |
| Source | `src/catalog/` | Recorded from your own browser |

You open a seat map anywhere on earth. VIGIL recognises the operator and pre-fills every parameter. The only thing left is to press record once, and it watches the page call its own API.

```
IDENTIFY   domain → chain, country, currency, seat conventions, default rules
   ↓
RECORD     the page calls its own API; VIGIL observes (never blocks, never rewrites)
   ↓
REPLAY     that exact request, on a schedule, with your session
   ↓
DIFF       compare to last time — only transitions count
   ↓
SCORE      physical seat geometry, or price against a rolling median
   ↓
ALERT      notification with a picture of the room
```

Because everything normalises to one shape — `Item { id, label, available, status, price, meta }` — a cinema seat, a watch in your size, and a resale listing all run through the same engine.

---

## Three verticals, one engine

| | Cinema & events | Limited-edition drops | Resale |
|---|---|---|---|
| Example | ODEON, CGV, Ticketmaster | Swatch, SNKRS, POP MART | StockX, Chrono24, eBay |
| What you want | adjacent good seats, new IMAX screenings | your size, back in stock | a real price dip |
| Default rules | `seat_block`, `format_added` | `restock`, `new_item` | `price_drop`, `price_below` |
| Hard part | seat geometry | not alerting on presale | a baseline that means something |

Defaults are proposed from the site type, so setup is *adjust*, not *compose from nothing*.

---

## What "worldwide" actually required

Three things broke the moment this left English-speaking countries. All three are fixed and tested.

### 1. Seat numbering inverts across Europe

Anglophone cinemas number seats left to right. German-speaking, Nordic, French and Central/Eastern European cinemas number them **outward from the centre**:

```
physical layout:   15 13 11  9  7  5  3  1 │ 2  4  6  8 10 12 14 16
                                           ^ centre of house
```

Read those labels as coordinates and everything inverts. The old engine ranked **seats 8 and 9 as the best pair in the house** — two seats on *opposite sides of the auditorium*, not adjacent at all — while the genuine centre pair scored as the far-left wall.

Position is now resolved to a physical coordinate before anything is scored. Same house, correct answer: seats 1,2 score 96 and draw dead centre.

There is **no way to detect this from labels alone** — the label set `{1..20}` is identical under both conventions. It comes from a real coordinate in the payload if there is one, otherwise the chain profile, otherwise you glance at the minimap in setup and flip one dropdown. VIGIL asks rather than guessing and being confidently wrong.

### 2. "Sold out" is not an English string

A German seat map returns `besetzt`. Korean returns `예매완료`. The old engine returned `null` for every one of them, which meant a watch outside English **could never fire and would never say why**.

`src/catalog/vocab.js` now classifies availability across ~14 languages, accent- and case-insensitive, whole-token then substring. It's deliberately the most editable file in the project: new markets arrive as new words, not new code.

It also separates **`notyet`** (presale, not on sale yet) from **`unavailable`** (sold). Without that split, every scheduled presale opening fires as a "back in stock!" alert.

### 3. `1.234,56 €` is not 1.234

The old parser read that as **1.234**, and `Rp 55.000` as **55**. Both off by 1000×, and both would have fired "price dropped 99%!" on a price that never moved.

Money is now parsed by deciding which separator is decimal before parsing, and **every price carries its currency**. Prices in different currencies are never compared — a page switching from EUR to USD is a locale change, not a discount.

---

## Setting up a watch

1. Open the booking page and get to the **seat map for one specific showing**
2. VIGIL → **New watch** — the banner should name your cinema
3. **Start recording** → reload the seat map → **Stop**
4. VIGIL ranks the captured requests; the seat one is almost always first
5. **Look at the minimap.** Does that shape look like your cinema? If the seats bunch strangely, flip *Seat numbering*.
6. Adjust the pre-filled rule, name it, save, **Arm**

### Reading the seat score

0–100 from three things: how far back the row is, how centred the block is in *physical* space, and whether you're jammed against a wall. The row penalty is asymmetric on purpose — a few rows too far back barely costs you, a few rows too close ruins the night.

In a 12-row house: dead-centre row H ≈ 95, centre row G ≈ 83, row D off to one side ≈ 45, front corner ≈ 4.

**Set the threshold to 70 and expect roughly one alert a week.** Set it to 40 and you'll turn it off by Thursday.

### Every alert is a transition, never a level

The first poll of a new watch is always silent, or it would read you the entire seat map. If nothing changed, you hear nothing. Silence is the product working.

---

## Rules

| Rule | Fires when | For |
|---|---|---|
| `seat_block` | N physically adjacent seats go taken → free, above your score floor | the refund you're waiting for |
| `format_added` | a showtime appears matching IMAX 70mm, Dolby, 4DX… | *"tell me when they add IMAX 70mm for Dune"* |
| `restock` | a non-seat item flips unavailable → available | a size returning, a drop restocking |
| `new_item` | an id appears that's never been seen | a new screening, a new listing |
| `price_below` | price crosses a number, **in the same currency** | a hard budget |
| `price_drop` | price falls X% below its own rolling median | resale watchlist |

The median matters. Comparing to yesterday flags noise; comparing to the last 30 days flags an actual dip.

---

## What it honestly can't do yet

**It only runs while Chrome is running.** MV3 service workers are dead when the browser closes, so an overnight refund is missed unless the machine is awake. This is the real limitation, and it's what Phase 2 exists to fix.

**Some endpoints won't replay.** Nonce-signed or Cloudflare-gated requests return 403. VIGIL backs off exponentially and asks you to re-record after four failures.

**Server-rendered pages have no request to record.** If seats arrive as HTML with no XHR, there's nothing to capture yet.

**Arena seating is scored as a room, not a venue.** Sections are kept separate so blocks never span them, but "how good is section 112 vs 320" needs stage-distance modelling that isn't built.

**Chain profiles are unverified against live sites.** Domains, currencies and formats are from general knowledge; the seat-numbering values are *hints* that runtime detection and your own eyes override. Treat a fresh chain profile as a starting guess, not a fact.

**Minimum interval is 1 minute** — Chrome's alarm floor. 5 minutes is the default and already ~300× more attentive than a human checking five times a day.

---

## Ground rules built into the design

VIGIL **watches and notifies. It does not buy.** Keep that line where it is.

- Automated *purchasing* is where the real legal exposure lives. In the US the BOTS Act targets circumventing ticket limits and security measures; most sites' terms prohibit it outright.
- Monitoring a page you legitimately have access to, at a human-ish rate, in your own logged-in session, then clicking buy yourself, is a materially different activity.
- VIGIL never defeats a CAPTCHA, never joins a queue for you, never holds inventory, and never polls faster than once a minute with jitter.

Bolt auto-checkout onto this and you've built a different product with a different risk profile.

**Privacy.** Captured requests never leave your device — there is no server. Cookies are never stored at all: `credentials: 'include'` means the browser attaches them at replay time. Exported templates additionally strip bearer tokens, API keys, and session/order/customer parameters; the export button tells you so, and it's tested.

---

## Code

```
src/catalog/
  chains.js       87 cinema operators — domains, currency, formats, seat conventions
  markets.js      37 drop / resale / ticketing sites + default rule sets
  vocab.js        availability in ~14 languages, + premium format detection
src/core/
  registry.js     URL → profile; template creation, matching, anonymisation
  money.js        currency-aware parsing; never compares across currencies
  seats.js        physical geometry, centre-out numbering, sections, minimap
  extract.js      auto-detects the item array; normalises to Item
  diff.js         transitions + rolling-median baseline
  rules.js        changes → alert-worthy hits
  store.js        all persistent state
src/background/   scheduler, replay, backoff, notifications, alert tone
src/content/      MAIN-world recorder + gated bridge
src/ui/           popup (arm, hits, minimap) + watch builder
```

Core logic is dependency-free ES modules that run under plain Node — the seat, money, vocabulary and diff paths are all tested that way.

---

## Roadmap

**Phase 2 — make it not need you.** This is the paid tier.
- Backend worker running watches while Chrome is closed
- Push to phone (Telegram bot is faster to build than web push and people actually notice it)
- Tab-reload fallback for nonce-signed endpoints
- DOM watcher with a visual element picker, for server-rendered sites

**Phase 3 — make setup one click.**
- Ship the recorded templates. `registry.js` already anonymises, pattern-matches and health-checks them; what's missing is the CDN feed and a contribution path.
- The first person on a chain records it. The thousandth presses one button.
- **This is the moat.** The engine is copyable in a weekend. A maintained, self-healing catalogue of working site templates across 59 countries is not.

**Phase 4 — beyond tickets.**
- Resale watchlist as its own surface with charts — price history is already stored
- Drop calendar for known releases

---

## Before the Chrome Web Store

One thing decides the review, so do it first:

**Swap `host_permissions: ["<all_urls>"]` for `optional_host_permissions`,** requesting access per-site at the moment a watch is recorded. A monitoring extension asking for blanket access to every site is the most likely rejection, and per-site grants are a better story for users anyway. The record flow already knows which tab it's targeting, so it can call `chrome.permissions.request()` right there.

Also needed: a privacy policy stating captured data never leaves the device (currently true — there is no server), popup screenshots, and a listing that leads with *notify*, not *scrape*.
