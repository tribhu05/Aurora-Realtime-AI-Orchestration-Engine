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
    'Content-Type, Authorization, x-matched-path, x-forwarded-uri, x-original-url, x-session-id, x-rime-api-key, x-gemini-api-key, x-llm-api-key, x-llm-provider, x-llm-model, x-serpapi-key, x-serpapi-api-key, x-github-token'
  );

  if (req.method === 'OPTIONS') {
    res.statusCode = 200;
    return res.end();
  }

  // Normalize path if rewritten by Vercel serverless functions
  if (
    typeof req.url === 'string' &&
    !req.url.includes('index.js') &&
    (req.url.startsWith('/api/') ||
      req.url === '/health' ||
      req.url === '/config' ||
      req.url === '/turn')
  ) {
    // Already cleanly normalized
  } else {
    const queryMatch = (req.url || '').match(/[?&](?:path|1)=([^&]+)/);
    if (queryMatch) {
      const sub = decodeURIComponent(queryMatch[1]).replace(/^\/+/, '');
      req.url = `/api/${sub}`;
    } else {
      const matchedPath =
        req.headers['x-matched-path'] ||
        req.headers['x-forwarded-uri'] ||
        req.headers['x-original-url'];

      if (matchedPath && typeof matchedPath === 'string') {
        if (!matchedPath.includes('index.js') && matchedPath.startsWith('/')) {
          req.url = matchedPath;
        } else {
          const headerMatch = matchedPath.match(/[?&](?:path|1)=([^&]+)/);
          if (headerMatch) {
            const sub = decodeURIComponent(headerMatch[1]).replace(/^\/+/, '');
            req.url = `/api/${sub}`;
          }
        }
      }
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
