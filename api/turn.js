import handler from './index.js';

export default function turnHandler(req, res) {
  req.url = '/api/turn';
  return handler(req, res);
}
