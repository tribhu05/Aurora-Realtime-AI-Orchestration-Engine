import handler from './index.js';

export default function configHandler(req, res) {
  req.url = '/api/config';
  return handler(req, res);
}
