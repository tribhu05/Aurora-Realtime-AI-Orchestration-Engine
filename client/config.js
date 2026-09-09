// client/config.js
// Production runtime configuration for Aurora.
//
// Architecture:
// - Frontend: Hosted on Vercel (or any static host)
// - Backend: Persistent Node.js/Express/WebSocket server (e.g. on Render, Railway, Fly.io)
//
// The client automatically resolves the backend URL using the following priority:
// 1. URL parameter override: ?backend=https://... or ?api=https://...
// 2. LocalStorage user override: configured via the "Telemetry & HUD" Settings panel
// 3. window.AURORA_BACKEND_URL or window.AURORA_CONFIG.productionBackendUrl (set below)
// 4. Localhost auto-detection: when loaded on localhost/127.0.0.1, defaults to http://localhost:3000
// 5. Same-origin fallback: window.location.origin

window.AURORA_CONFIG = Object.assign(
  {
    // Persistent production backend web service (leave empty to use same-origin serverless backend by default)
    productionBackendUrl: '',
    // Local development backend host
    developmentBackendUrl: 'http://localhost:3000',
  },
  window.AURORA_CONFIG || {}
);
