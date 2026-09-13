// client/vad-mic.js
// Robust SpeechRecognition wrapper with deterministic lifecycle management,
// instant barge-in reset, and non-blocking asynchronous auto-restart.

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
    this._isRunning = false;
    this._isStarting = false;
    this._restartTimer = null;
    this._interimText = '';

    if (!this.supported) return;

    this._initRecognizer();
  }

  _initRecognizer() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.recognition = new SR();
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = 'en-US';

    this.recognition.onstart = () => {
      this._isRunning = true;
      this._isStarting = false;
      if (this._restartTimer) {
        clearTimeout(this._restartTimer);
        this._restartTimer = null;
      }
    };

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

      if (interimText.trim()) {
        this._interimText = interimText.trim();
        this.onInterim(interimText.trim());
      }

      if (finalText.trim()) {
        this._heardThisTurn = false;
        this._interimText = '';
        this.onFinalResult(finalText.trim());
      }
    };

    this.recognition.onerror = (e) => {
      const err = e.error;
      // 'no-speech' and 'aborted' are normal lifecycle events in Web Speech API
      if (err === 'no-speech' || err === 'aborted') {
        return;
      }
      if (err === 'not-allowed' || err === 'service-not-allowed') {
        this._wantListening = false;
      }
      this.onError(err);
    };

    this.recognition.onend = () => {
      this._isRunning = false;
      this._isStarting = false;
      this._heardThisTurn = false;
      this.onEnd();

      if (this._wantListening) {
        this._scheduleRestart();
      }
    };
  }

  _scheduleRestart(delay = 40) {
    if (this._restartTimer) {
      clearTimeout(this._restartTimer);
    }
    this._restartTimer = setTimeout(() => {
      this._restartTimer = null;
      if (this._wantListening && !this._isRunning && !this._isStarting) {
        this._safeStart();
      }
    }, delay);
  }

  _safeStart() {
    if (!this.supported || !this._wantListening) return;
    if (this._isRunning || this._isStarting) return;

    this._isStarting = true;
    try {
      this.recognition.start();
    } catch (err) {
      this._isStarting = false;
      // If the browser audio track hasn't released yet, schedule retry
      if (this._wantListening && !this._isRunning) {
        this._scheduleRestart(60);
      }
    }
  }

  start() {
    if (!this.supported) return;
    this._wantListening = true;
    this._heardThisTurn = false;
    this._interimText = '';
    if (!this._isRunning && !this._isStarting) {
      this._safeStart();
    }
  }

  stop() {
    if (!this.supported) return;
    this._wantListening = false;
    this._heardThisTurn = false;
    this._interimText = '';
    if (this._restartTimer) {
      clearTimeout(this._restartTimer);
      this._restartTimer = null;
    }
    try {
      this.recognition.stop();
    } catch (_) {}
  }

  /**
   * Resets the speech recognition pipeline immediately on interruption:
   * 1. Purges any accumulated interim or partial transcripts.
   * 2. Resets the turn detection flag.
   * 3. Aborts in-flight recognition so stale audio is discarded by the browser.
   * 4. Seamlessly re-arms listening for the user's new voice command.
   */
  resetForNewCommand() {
    if (!this.supported) return;
    this._wantListening = true;
    this._heardThisTurn = false;
    this._interimText = '';

    if (this._restartTimer) {
      clearTimeout(this._restartTimer);
      this._restartTimer = null;
    }

    if (this._isRunning || this._isStarting) {
      try {
        // Aborting forces Web Speech API to flush its internal buffer without firing onresult
        this.recognition.abort();
      } catch (_) {
        this._scheduleRestart(30);
      }
    } else {
      this._scheduleRestart(20);
    }
  }

  get listening() {
    return this._wantListening;
  }
}

window.AuroraMic = AuroraMic;
