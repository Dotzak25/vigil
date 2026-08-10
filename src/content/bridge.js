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
  if (msg?.type === 'vigil:readDom') {
    try {
      const nodes = [...document.querySelectorAll(msg.selector)].slice(0, 500);
      sendResponse({
        ok: true,
        html: nodes.map((n) => n.outerHTML.slice(0, 2000)),
        text: nodes.map((n) => n.innerText.trim().slice(0, 400)),
      });
    } catch (e) {
      sendResponse({ ok: false, error: String(e) });
    }
  }
  return true;
});

window.addEventListener('message', (ev) => {
  if (ev.source !== window) return;
  if (ev.data?.source !== '__VIGIL_CAPTURE__') return;
  if (!recording) return;

  chrome.runtime
    .sendMessage({ type: 'vigil:capture', capture: { ...ev.data.payload, pageUrl: location.href, title: document.title } })
    .catch(() => {});
});
