import handler from './index.js';

export default function diagnosticHandler(req, res) {
  const type = req.query?.type || 'serpapi';
  req.url = `/api/diagnostic/${type}`;
  return handler(req, res);
}
