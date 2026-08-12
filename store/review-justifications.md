# Chrome Web Store review — justification text

Copy-paste reference for the Developer Dashboard's permission justification
fields and privacy practices tab. Matches exactly what's declared in
`manifest.json` and what the code actually does — nothing aspirational.

## Single purpose

> VIGIL notifies the user when a specific, user-selected page's availability
> or price changes — a cinema seat map, a product page, a resale listing.
> The user records the watch themselves, on a page they already chose to
> visit; VIGIL then periodically re-checks that one thing and alerts on a
> change. It does not automate purchasing, checkout, queueing, or any
> action beyond recording and re-checking.

## Permission justifications

**`storage`**
> Saves the user's configured watches, alert history, and settings locally
> via `chrome.storage.local`. Nothing is transmitted anywhere — there is no
> backend server.

**`alarms`**
> Schedules the periodic re-check of each watch at the interval the user
> sets (minimum 1 minute, Chrome's own floor), replacing manually refreshing
> a page.

**`notifications`**
> Shows a system notification when a watched page's availability or price
> changes — the entire visible output of the extension.

**`scripting`**
> Dynamically registers the page-observer content script (see host
> permission justification below) only for a specific site once the user
> has explicitly granted access to it. No content script is registered for
> any site the user hasn't individually approved.

**`offscreen`**
> Plays a short two-tone alert sound via the Web Audio API on an urgent hit,
> which a Manifest V3 service worker cannot access directly and requires an
> offscreen document for.

**`tabs`**
> Lists open tabs so the user can pick which one to record a watch from
> (tab title and URL only), and opens the relevant page when the user clicks
> a notification or a result in the popup. Does not read page content.

## Host permission justification (optional_host_permissions: `<all_urls>`)

> VIGIL is a general-purpose page-monitoring tool — the whole point is that
> it works on cinema booking sites, e-commerce drops, and resale
> marketplaces across dozens of countries, none of which are known in
> advance. `<all_urls>` is declared as **optional**, not granted at install:
> the extension starts with zero site access. It requests permission for
> one specific site at a time, only when the user actively chooses to
> record a watch on that site (`chrome.permissions.request()`, called from
> that exact button-click handler) — and again for the specific API host a
> watch needs to periodically re-check, if that differs from the page
> itself (e.g. `api.example.com` vs. `www.example.com`). A user who watches
> one cinema chain and one resale site ends up with permission for exactly
> those two domains, not the wildcard the manifest lists as available to
> request.

## Remote code

> No. All code ships in the extension package. The one network request
> made without direct user action is a periodic fetch of a static, public
> JSON file (a catalogue of previously-recorded site request shapes,
> hosted at `dotzak25.github.io/vigil`) — data, not code; it is never
> evaluated or executed, only read as JSON and used to pre-fill setup
> fields.

## Data usage / privacy practices tab

- **Personally identifiable information:** Not collected.
- **Health information:** Not collected.
- **Financial and payment information:** Not collected.
- **Authentication information:** Not collected. (Session cookies are never
  read or stored by VIGIL — a replayed request rides along with whatever
  Chrome already has in the browser's own cookie jar via
  `credentials: 'include'`.)
- **Personal communications:** Not collected.
- **Location:** Not collected.
- **Web history:** Not collected. VIGIL only ever sees the one URL the user
  explicitly recorded, never general browsing activity.
- **User activity:** Not collected.
- **Website content:** Only from the one specific page/request the user
  explicitly recorded, and only stored locally on-device — never
  transmitted off the device.
- **Certify data usage compliance:** Yes — all of the above is accurate,
  and none of the collected/stored data is sold or transferred to any
  third party (there is no third party; there is no server).
