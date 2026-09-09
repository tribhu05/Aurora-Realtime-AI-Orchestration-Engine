import handler from './index.js';

export default function keysHandler(req, res) {
  req.url = '/api/keys';
  return handler(req, res);
}
