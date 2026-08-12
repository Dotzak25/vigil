# Screenshots

Chrome Web Store wants 1–5 screenshots, exactly **1280×800** or **640×400**,
PNG or JPEG. I generated composition previews from the test harness to check
layout (see the conversation), but didn't save those here — a downstream
tool downsamples them on the way back to me, so I can't hand you a
pixel-exact file, and a screenshot of your *real* loaded extension is a
better listing asset than one from a synthetic test harness anyway. This is
a genuinely manual step, not one I'm skipping out of laziness:
browser-automation tools can't script `chrome-extension://` pages at all
(same restriction that made the harness necessary in the first place), so
there's no way for me to drive your real extension's UI to capture this.

## What to capture (you already have VIGIL loaded unpacked)

1. **The popup**, with at least one saved watch and armed — resize your
   Chrome window or crop afterward to 1280×800 or 640×400.
2. **The watch builder** (Options page) mid-setup — ideally with a profile
   identified (e.g. the banner naming a recognised chain/site) and the
   minimap visible.

Mac: `Cmd+Shift+4` then drag, or `Cmd+Shift+5` for a windowed capture you can
resize precisely afterward. Save them into this folder.
