// Client config. NO SECRETS HERE — the browser never holds the ARAG token or ElevenLabs key;
// all governed calls go through the bridge (SPEC §6.5, §10).
//
// Override the bridge URL without editing this file:
//   • append ?bridge=https://your-bridge.fly.dev to the page URL, or
//   • set localStorage.setItem('aragvoice.bridge', 'https://…')
(function () {
  const params = new URLSearchParams(location.search);
  const fromQuery = params.get("bridge");
  const fromStore = localStorage.getItem("aragvoice.bridge");
  // The bridge serves this page, so default to the same origin it was loaded from
  // (works on https://arag-voice-bridge.fly.dev and on localhost alike). Fall back to
  // localhost only when opened as a bare file:// with no http origin.
  const sameOrigin =
    location.origin && location.origin.startsWith("http")
      ? location.origin
      : "http://localhost:8080";
  window.ARAG_VOICE_CONFIG = {
    BRIDGE_URL: fromQuery || fromStore || sameOrigin,
    METRICS_POLL_MS: 4000,
  };
  if (fromQuery) localStorage.setItem("aragvoice.bridge", fromQuery);
})();
