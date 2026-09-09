import handler from './index.js';

export default function healthHandler(req, res) {
  req.url = '/api/health';
  return handler(req, res);
}
