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
  window.ARAG_VOICE_CONFIG = {
    BRIDGE_URL: fromQuery || fromStore || "http://localhost:8080",
    METRICS_POLL_MS: 4000,
  };
  if (fromQuery) localStorage.setItem("aragvoice.bridge", fromQuery);
})();
