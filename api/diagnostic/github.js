import handler from '../index.js';

export default function githubDiagnosticHandler(req, res) {
  req.url = '/api/diagnostic/github';
  return handler(req, res);
}
