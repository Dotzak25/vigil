/**
 * offscreen.js — MV3 service workers can't touch the audio API, so the alert
 * tone lives here. Synthesised rather than shipped as a file: two short
 * ascending tones, quiet enough to sit next to a keyboard at 1am.
 */
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== 'vigil:chime') return;
  try {
    const ctx = new AudioContext();
    const now = ctx.currentTime;
    [880, 1320].forEach((f, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0.0001, now + i * 0.14);
      gain.gain.exponentialRampToValueAtTime(0.16, now + i * 0.14 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.14 + 0.22);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + i * 0.14);
      osc.stop(now + i * 0.14 + 0.24);
    });
    setTimeout(() => ctx.close(), 1200);
  } catch (_) {}
});
