import handler from './index.js';

export default function previewTtsHandler(req, res) {
  req.url = '/api/preview-tts';
  return handler(req, res);
}
