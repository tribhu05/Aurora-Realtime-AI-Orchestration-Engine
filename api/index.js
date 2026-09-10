import { createAuroraServer } from '../server/server.js';

let appInstance = null;
function getApp() {
  if (!appInstance) {
    const server = createAuroraServer({ quiet: true });
    appInstance = server.app;
  }
  return appInstance;
}

export default function handler(req, res) {
  // Always attach CORS headers for Vercel serverless functions
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, x-matched-path, x-forwarded-uri, x-original-url, x-session-id, x-rime-api-key, x-gemini-api-key'
  );

  if (req.method === 'OPTIONS') {
    res.statusCode = 200;
    return res.end();
  }

  // Normalize path if rewritten by Vercel serverless functions
  const matchedPath =
    req.headers['x-matched-path'] ||
    req.headers['x-forwarded-uri'] ||
    req.headers['x-original-url'];

  if (matchedPath && !matchedPath.includes('index.js') && matchedPath.startsWith('/')) {
    req.url = matchedPath;
  } else {
    const match = (req.url || '').match(/[?&](?:path|1)=([^&]+)/);
    if (match) {
      const sub = decodeURIComponent(match[1]).replace(/^\/+/, '');
      req.url = `/api/${sub}`;
    } else if (matchedPath && matchedPath.startsWith('/')) {
      req.url = matchedPath;
    }
  }

  try {
    const app = getApp();
    return app(req, res);
  } catch (err) {
    console.error('[Vercel Serverless Error]:', err);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: err.message || 'Server error', ok: false }));
  }
}
