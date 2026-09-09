import { createAuroraServer } from '../server/server.js';

const { app } = createAuroraServer({ quiet: true });

export default function handler(req, res) {
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

  return app(req, res);
}
