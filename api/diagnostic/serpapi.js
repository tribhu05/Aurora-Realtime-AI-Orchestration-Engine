import handler from '../index.js';

export default function serpapiDiagnosticHandler(req, res) {
  req.url = '/api/diagnostic/serpapi';
  return handler(req, res);
}
