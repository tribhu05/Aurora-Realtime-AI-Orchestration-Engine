import { createAuroraServer } from '../server/server.js';

const { app } = createAuroraServer({ quiet: true });

export default function handler(req, res) {
  // Normalize path if rewritten by Vercel serverless functions
  const matchedPath =
    req.headers['x-matched-path'] ||
    req.headers['x-forwarded-uri'] ||
    req.headers['x-original-url'];

  if (
    matchedPath &&
    (req.url.includes('index.js') || req.url === '/api' || req.url === '/api/index')
  ) {
    req.url = matchedPath;
  } else if (req.url.includes('index.js')) {
    const match = req.url.match(/[?&](?:path|1)=([^&]+)/);
    if (match) {
      req.url = `/api/${decodeURIComponent(match[1])}`;
    }
  }

  return app(req, res);
}
