/**
 * bridge.js — isolated world. The only path from page to extension.
 *
 * The recorder shouts about every JSON response the page fetches. Almost all
 * of it is analytics. This gate keeps captures off disk unless you've pressed
 * Record, so normal browsing costs nothing but a discarded postMessage.
 */

let recording = false;

chrome.runtime
  .sendMessage({ type: 'vigil:isRecording' })
  .then((r) => (recording = !!r?.recording))
  .catch(() => {});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'vigil:setRecording') {
    recording = !!msg.recording;
    sendResponse({ ok: true });
  }
  return true;
});

window.addEventListener('message', (ev) => {
  // Defense in depth: recorder.js only ever posts to this exact document at
  // this exact origin (window.postMessage(data, window.location.origin)).
  // ev.source narrows to "this window, not an embedded iframe" but says
  // nothing about origin on its own — check both before trusting anything
  // claiming to be a capture.
  if (ev.source !== window) return;
  if (ev.origin !== location.origin) return;
  if (ev.data?.source !== '__VIGIL_CAPTURE__') return;
  if (!recording) return;

  chrome.runtime
    .sendMessage({ type: 'vigil:capture', capture: { ...ev.data.payload, pageUrl: location.href, title: document.title } })
    .catch(() => {});
});
