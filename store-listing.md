# Chrome Web Store listing copy

Reference copy for the Developer Dashboard's store listing form. Not
deployed anywhere — just tracked here so it's versioned with the code it
describes.

## Name

VIGIL

## Summary (single line, ≤132 characters)

Watches a seat map, a size, or a resale price — tells you the moment it changes. Notifies. Never buys.

## Category

Productivity

## Detailed description

```
VIGIL watches the page you'd otherwise refresh fifty times a day, and tells
you the moment a seat, a size, or a price opens up.

Built from one problem — a show is sold out, but people cancel, and whoever
checks at the right minute gets the seat — and generalised to two others:
limited-edition drops, and resale prices.

HOW IT WORKS
Open the page you want to watch — a seat map, a product page, a listing —
and record it once. VIGIL watches the page load its own data, then replays
that exact request on a schedule, using your own logged-in session. When
something changes, you get a notification with the details: which seats,
which size, how much the price moved.

WHAT IT WATCHES FOR
• Adjacent seats opening up, scored by actual physical position — not just
  label numbers, which read backwards on cinemas across German-speaking,
  Nordic, French and Central/Eastern European markets
• A size or item coming back in stock
• A new listing or showtime appearing
• A specific format being added (IMAX 70mm, Dolby, 4DX...)
• A price crossing a number you set, or dropping against its own rolling
  median rather than yesterday's noise

WORLDWIDE, FOR REAL
Availability is read in about a dozen languages, not just English — a German
"besetzt" or a Korean "예매완료" reads exactly like an English "sold out".
Prices are parsed by figuring out which separator is the decimal one, so
"1.234,56 €" and "Rp 55.000" are never misread by a factor of a thousand.
Seat numbering conventions are read as physical coordinates, not label
order, because several major markets number seats outward from the centre.

NOTIFIES. NEVER BUYS.
VIGIL watches and tells you. It does not join a queue, defeat a CAPTCHA,
hold inventory, or complete a purchase on your own behalf — you still click
buy yourself, in your own browser, at a human pace. This is a monitoring
tool, not an automated checkout.

PRIVATE BY DESIGN
There is no server. Everything VIGIL knows lives in your own browser
storage and nowhere else. Your cookies are never read or stored — a
replayed request just rides along with whatever's already in your browser's
cookie jar. VIGIL only asks for access to a site once you choose to record
a watch on it; it has no access to anything else.

SETTING UP A WATCH
1. Open the page — get to the specific seat map, size selector, or listing
2. New watch → Start recording → reload the page → Stop
3. VIGIL ranks what it captured; the right one is almost always first
4. Check the picture it draws of the seat map — does it look right?
5. Adjust the pre-filled rule, name it, save, and arm

Minimum check interval is 1 minute (Chrome's own limit); 5 minutes is the
default, already far more attentive than checking by hand.
```

## Notes for whoever fills the form

- **Privacy policy URL:** `https://dotzak25.github.io/vigil/privacy.html`
- **Single purpose:** state it as "notify the user when a specific, user-selected page's data changes" — this maps directly to the optional per-site host permission, which the review process checks against the stated purpose.
- Screenshots: see `store/screenshots/`.
