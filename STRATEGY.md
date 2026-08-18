# VIGIL — market position

Synthesis of competitive research across five adjacent markets (general page-monitoring, ticket/resale trackers, cinema seat alerts, sneaker/streetwear bots and monitor groups, Pokémon/TCG/collectibles restock services), conducted August 2026.

Everything here is grounded in products that were actually found and read. Where a claim comes from a vendor's own marketing rather than verification, it's marked. This is a strategy note, not a pitch — the uncomfortable findings are in here too.

---

## The one-sentence position

> Every competitor in this space sells you **speed**. VIGIL should sell you **not having to race at all.**

That distinction is not marketing garnish — it's the only framing nobody has taken, and it's the one that's actually true about how VIGIL works.

---

## What the research actually found

### 1. The problem is real, large, and currently solved badly

The demand signal is not in doubt:

- The BFI IMAX sold out **all 173** of its 70mm *Odyssey* screenings; new batches went in **under 30 minutes** against **40,000-deep** queues.
- One solo engineer's IMAX seat-watcher (imaxxing.io) reached **5,000+ registered users**, 1,300 in its first week.
- Pop Mart's own FAQ concedes it has no restock schedule and that items "may sell out within seconds."
- One SF engineer wired up **a talking robot** to announce seat openings, because nothing existed that did it.

People are building robots. That's what unmet demand looks like.

### 2. The incumbents structurally cannot fix it

Not one mainstream cinema chain or ticketing platform — AMC, Regal, Cinemark, Atom, Fandango, Odeon, Cineworld, Vue, Picturehouse, BFI IMAX, Letterboxd — offers a waitlist, standby, or cancellation-return alert for a sold-out showtime. The closest anyone gets is a film-level "tickets are on sale now" email.

This isn't an oversight. **Scarcity is the product** for a venue: a queue converts better than a waitlist, and surfacing "seats keep freeing up" undercuts the urgency that sells the first batch. Letterboxd is the tell — they built exactly this alerting pattern for *streaming* availability, and did not build it for cinemas.

**Implication:** the incumbents are not going to compete this away. That's a durable opening.

### 3. But VIGIL is NOT first, and pretending otherwise would be a mistake

This is the finding that most changes the plan.

| Competitor | What they already do |
|---|---|
| **SeatDrop** (US) | Seat-freed + group-block + new-showtime alerts across AMC/Cinemark/Alamo. Server-side, multi-device, push. **Free.** |
| **IMAX Tracker** (US) | IMAX 70mm specialist. Ticket drops, extra showtimes, seat reopenings, seat-preference and adjacency filters. **$24.99/yr.** |
| **imaxxing.io** (US) | 70mm nationwide, email alerts, 5,000+ users. |
| **Hype Hunt** (sneakers) | Self-describes as *"a bot-free sneaker intel platform"* — **VIGIL's exact positioning, already claimed.** Pre-launch, unpriced. |
| **PokeNotify** (TCG) | Bans bots and auto-checkout **by rule**, charges **$7.99/mo**, ~25,000 premium members. |

**"We watch and never buy" is not a differentiator on its own — PokeNotify and Visualping got there first.** What is still unclaimed is making that refusal *architectural and verifiable* rather than a policy line in a Discord rulebook.

### 4. The genuinely open ground

Four gaps survived scrutiny:

**a) Europe is unserved, and has the sharper pain.** Every cinema seat-alert tool found is US or Canada only. Zero coverage of Odeon, Cineworld, Vue, Picturehouse, Everyman, BFI IMAX — and there is a literal Odeon App Store review asking for this feature. VIGIL's catalogue already covers 87 chains across 59 countries, heavily European. **This is the single strongest wedge in the research.**

**b) The latency chasm.** Sneaker-native monitors claim milliseconds. Cook groups deliver 60–90 seconds. Generic change-detection tools floor at **2 minutes even at $99/mo** (PageCrawl's top tier; Visualping and Distill's cloud tiers are the same). There is an empty band between "commodity generic tool" and "$75/mo Discord group."

**c) Discord delivery, consumer-side.** Cook groups charge **$30–95/month** substantially for the service of *delivering alerts into Discord*. The only non-broker product found with a Discord webhook is aimed at ticket brokers. **This is now built** (see `src/core/webhook.js`) — free, client-fired, no server.

**d) Nobody has fused "it's available" with "it's worth it."** Restock alerting and price/value data live in entirely separate products across every vertical examined. VIGIL already stores rolling price history for its `price_drop` median.

### 5. The uncomfortable findings

Worth stating plainly rather than burying:

- **The AIO bot market is contracting, not booming.** Wrath's domain is parked for sale; BotBroker (the key-resale marketplace) returns a server error; Cybersole — once thousands on resale — rents for **$8/day**. Bot keys are no longer appreciating assets.
- **But the *information* tier is thriving.** Divine has ~56,000 members at $74.99/mo. The market moved from checkout to intel — which is VIGIL's half.
- **Basic polling is worth $0.** Maintained open-source Discord monitors for Shopify, Nike SNKRS (42 countries), Supreme and Footsites are free on GitHub; Fiverr freelancers build custom ones for ~$30. Defensibility cannot come from "we poll a URL."
- **Anti-bot is the binding constraint.** SeatDrop is publicly running with its AMC ticket-drop alerts *disabled* due to data unavailability. An open-source Ticketmaster monitor is dead in the water from Imperva tokens. This will happen to VIGIL too; plan for it.
- **ML drop-prediction is unclaimed by everyone credible** — and the search results for it are polluted with AI-generated fake products. It may be unclaimed because it doesn't work. Claiming it would put VIGIL alongside slop.

---

## How to talk about the problem

Every landing page in this market runs the same hook: *"Never miss a drop." "Before it sells out." "Never overpay."* All of them frame the problem as **you being too slow**.

Not one frames it as **the race itself being the problem**.

That's the gap VIGIL's onboarding now occupies (`src/ui/onboarding.html`):

> **The seat wasn't gone. You just weren't looking at the right second.**
>
> That was never a "sold out" problem. It's a *timing* problem — and a computer that never gets bored is better at timing than you are.

Why this framing is the right one:

1. **It names a problem the user didn't know they had.** They think they were unlucky, or that it was sold out. It wasn't — a seat came back at 11:04pm and nobody was looking. Naming that is the whole conversion moment.
2. **It doesn't require the user to feel like a scalper.** "Beat everyone else" attracts resellers and repels the person who just wants to see a film. VIGIL's actual audience is the second person.
3. **It is true.** VIGIL polls at human rates with jitter. It genuinely cannot win a millisecond race, and shouldn't claim to. The honest claim is *attention*, not *speed*: it's watching at 3am, and you aren't.

**Supporting data worth using:** SeatDrop's published analysis of 5,600+ tracked seat openings found a **median cancellation lead time of 11.7 hours**, with 68% inside 24h and ~1 in 9 in the final hour. That is the empirical case for the whole product: cancellations cluster in exactly the window a human cannot cover.

---

## Recommendations, ranked

### Do now
1. **Lead with Europe.** It's unserved, the pain is documented, and the catalogue already covers it. Do not open by competing with a free US incumbent.
2. **Make the "never buys" refusal architectural, not just stated.** No stored credentials, no cart integration, no checkout step, verifiable in open source. The rhetorical foil writes itself: one competing service has members submit shipping, billing and payment details to a Discord server so staff can check out on their behalf. That is where "just a little automation" ends up.
3. **Ship the cost argument.** An auto-checkout stack runs $50–150/mo for the bot, $30–100/mo for proxies, $30–65/mo for captcha tooling, plus a VPS. Monitoring-only skips nearly all of it.

### Build next
4. **Price-range alerts** ("$180–$220"), not just a single threshold — SeatGeek's most-copied feature, a small extension of existing rules.
5. **Inline price sparkline in the popup** — the data is already stored for `price_drop` medians; this is presentation, not new plumbing.
6. **Format-targeted "new showtime added at this venue"** — the least-served trigger found anywhere, and technically tractable (AMC structures format in its showtime data; Cinema City exposes `attr=70-mm` as a query param).

### Deliberately don't
7. **No auto-checkout, in any partial form** — not pre-filled carts, not "assisted" checkout, not auto-opening the listing. The line is worth more intact than any conversion it would buy.
8. **No ML drop-prediction claims** until there's something real behind them.
9. **Think hard about "early links."** It's the strongest advertised feature in the cook-group tier and genuinely valuable — but surfacing pre-announcement backend state sits in the same adversarial-to-retailer territory the no-auto-checkout stance exists to stay out of. This deserves an explicit decision, not a default.

### Pricing, when it comes
The consumer band for this category is **$5.99–$9.99/mo**. Above that, buyers expect either auto-checkout or reseller profit intel — neither of which VIGIL will offer. The honest paid tier is the one already on the roadmap: **running while the browser is closed.**

One competitor deliberately delays free users' alerts to upsell speed. VIGIL shouldn't, and should say so.
