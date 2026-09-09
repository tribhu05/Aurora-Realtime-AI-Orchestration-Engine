// client/vad-mic.js
// Wraps the browser's SpeechRecognition API to provide:
//  - onSpeechStart: fires the instant the mic detects the user has begun
//    talking (first interim result) — this is what drives barge-in.
//  - onFinalResult: fires with the finalized transcript once the user pauses.
//  - Auto-restart while "listening mode" stays on, so it behaves like an
//    always-on assistant rather than a single-shot recognizer.

class AuroraMic {
  constructor({ onSpeechStart, onInterim, onFinalResult, onEnd, onError } = {}) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.supported = Boolean(SR);
    this.onSpeechStart = onSpeechStart || (() => {});
    this.onInterim = onInterim || (() => {});
    this.onFinalResult = onFinalResult || (() => {});
    this.onEnd = onEnd || (() => {});
    this.onError = onError || (() => {});
    this._wantListening = false;
    this._heardThisTurn = false;

    if (!this.supported) return;

    this.recognition = new SR();
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = 'en-US';

    this.recognition.onresult = (event) => {
      let finalText = '';
      let interimText = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        if (res.isFinal) finalText += res[0].transcript;
        else interimText += res[0].transcript;
      }

      if (!this._heardThisTurn && (finalText || interimText).trim()) {
        this._heardThisTurn = true;
        this.onSpeechStart();
      }

      if (interimText.trim()) this.onInterim(interimText.trim());

      if (finalText.trim()) {
        this._heardThisTurn = false;
        this.onFinalResult(finalText.trim());
      }
    };

    this.recognition.onerror = (e) => {
      this.onError(e.error);
    };

    this.recognition.onend = () => {
      this._heardThisTurn = false;
      this.onEnd();
      if (this._wantListening) {
        // Browsers auto-stop the recognizer periodically; restart seamlessly.
        try {
          this.recognition.start();
        } catch (_) {}
      }
    };
  }

  start() {
    if (!this.supported) return;
    this._wantListening = true;
    try {
      this.recognition.start();
    } catch (_) {}
  }

  stop() {
    if (!this.supported) return;
    this._wantListening = false;
    try {
      this.recognition.stop();
    } catch (_) {}
  }

  get listening() {
    return this._wantListening;
  }
}

window.AuroraMic = AuroraMic;
