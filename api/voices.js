import handler from './index.js';

export default function voicesHandler(req, res) {
  req.url = '/api/voices';
  return handler(req, res);
}
