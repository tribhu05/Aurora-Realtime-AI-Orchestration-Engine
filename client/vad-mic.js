// client/vad-mic.js
// Robust SpeechRecognition wrapper with deterministic lifecycle management,
// speech accumulation, natural silence-debounced endpointing, instant barge-in reset,
// and non-blocking asynchronous auto-restart.

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
    this._silenceTimer = null;
    this._silenceTimeoutMs = 1000; // 1 second of natural silence before finalizing
    this._accumulatedText = '';
    this._interimText = '';

    if (!this.supported) return;

    this._initRecognizer();
  }

  _isMobile() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent
    );
  }

  _initRecognizer() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    if (this.recognition) {
      try {
        this.recognition.onstart = null;
        this.recognition.onresult = null;
        this.recognition.onerror = null;
        this.recognition.onend = null;
        this.recognition.abort();
      } catch (_) {}
    }
    this.recognition = new SR();
    const isMobile = this._isMobile();
    // On Android/Mobile, continuous MUST be false.
    // Setting continuous=true on Android Chrome causes immediate failure with 'not-allowed'.
    this.recognition.continuous = !isMobile;
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
      let currentFinal = '';
      let currentInterim = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        if (res.isFinal) {
          currentFinal += ' ' + res[0].transcript;
        } else {
          currentInterim += ' ' + res[0].transcript;
        }
      }

      currentFinal = currentFinal.trim();
      currentInterim = currentInterim.trim();

      if (currentFinal) {
        this._accumulatedText = (this._accumulatedText ? this._accumulatedText + ' ' : '') + currentFinal;
      }
      this._interimText = currentInterim;

      const liveText = (this._accumulatedText + (this._interimText ? ' ' + this._interimText : '')).trim();

      if (!this._heardThisTurn && liveText) {
        this._heardThisTurn = true;
        this.onSpeechStart();
      }

      if (liveText) {
        this.onInterim(liveText);

        // Reset silence detection timer on every incoming speech event
        if (this._silenceTimer) {
          clearTimeout(this._silenceTimer);
          this._silenceTimer = null;
        }

        // Wait for natural pause before finalizing complete sentence
        this._silenceTimer = setTimeout(() => {
          this._finalizeUtterance();
        }, this._silenceTimeoutMs);
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
        const isInsecure =
          window.isSecureContext === false ||
          (location.protocol !== 'https:' &&
            location.hostname !== 'localhost' &&
            location.hostname !== '127.0.0.1');
        if (isInsecure) {
          this.onError('insecure-context');
          return;
        }
      }
      this.onError(err);
    };

    this.recognition.onend = () => {
      this._isRunning = false;
      this._isStarting = false;

      // If speech was in-flight when recognizer ended, finalize it
      if (this._accumulatedText.trim() || this._interimText.trim()) {
        this._finalizeUtterance();
      }

      this.onEnd();

      const isMobileDevice = this._isMobile();
      // On desktop, auto-restart to keep continuous full-duplex session active.
      // On mobile (Android & iOS), do NOT loop restart from a timer!
      // Mobile OS blocks background SpeechRecognition calls without direct user gesture.
      if (this._wantListening && !isMobileDevice) {
        this._scheduleRestart();
      } else if (isMobileDevice) {
        this._wantListening = false;
      }
    };
  }

  _finalizeUtterance() {
    if (this._silenceTimer) {
      clearTimeout(this._silenceTimer);
      this._silenceTimer = null;
    }
    const fullText = (this._accumulatedText + (this._interimText ? ' ' + this._interimText : '')).trim();
    this._accumulatedText = '';
    this._interimText = '';
    this._heardThisTurn = false;

    if (fullText && fullText.length > 0) {
      this.onFinalResult(fullText);
    }
  }

  _scheduleRestart(delay = 40) {
    if (this._isMobile()) return; // Never restart from a timer on mobile devices
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

    const isMobile = this._isMobile();

    // On mobile, re-initialize fresh instance to prevent OS recognizer busy state
    if (isMobile) {
      try {
        this._initRecognizer();
      } catch (_) {}
    }

    this._isStarting = true;
    try {
      this.recognition.start();
    } catch (err) {
      this._isStarting = false;
      if (this._wantListening && !this._isRunning && !isMobile) {
        this._scheduleRestart(60);
      } else if (isMobile) {
        this._wantListening = false;
        if (err && (err.name === 'NotAllowedError' || err.message?.includes('not-allowed'))) {
          this.onError('not-allowed');
        }
      }
    }
  }

  start() {
    if (!this.supported) return;
    this._wantListening = true;
    this._heardThisTurn = false;
    this._accumulatedText = '';
    this._interimText = '';
    if (this._silenceTimer) {
      clearTimeout(this._silenceTimer);
      this._silenceTimer = null;
    }
    if (this._restartTimer) {
      clearTimeout(this._restartTimer);
      this._restartTimer = null;
    }

    if (!this._isRunning && !this._isStarting) {
      this._safeStart();
    }
  }

  stop() {
    if (!this.supported) return;
    this._wantListening = false;
    this._heardThisTurn = false;
    this._accumulatedText = '';
    this._interimText = '';
    if (this._silenceTimer) {
      clearTimeout(this._silenceTimer);
      this._silenceTimer = null;
    }
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
   * 2. Cancels silence timer.
   * 3. Aborts in-flight recognition so stale audio is discarded by the browser.
   * 4. Seamlessly re-arms listening for the user's complete new thought.
   */
  resetForNewCommand() {
    if (!this.supported) return;
    this._wantListening = true;
    this._heardThisTurn = false;
    this._accumulatedText = '';
    this._interimText = '';

    if (this._silenceTimer) {
      clearTimeout(this._silenceTimer);
      this._silenceTimer = null;
    }

    if (this._restartTimer) {
      clearTimeout(this._restartTimer);
      this._restartTimer = null;
    }

    const isMobile = this._isMobile();

    if (this._isRunning || this._isStarting) {
      try {
        // Aborting forces Web Speech API to flush its internal buffer without firing onresult
        this.recognition.abort();
      } catch (_) {}
    }

    if (isMobile) {
      // Must start synchronously on mobile within user gesture
      this._safeStart();
    } else {
      this._scheduleRestart(20);
    }
  }

  get listening() {
    return this._wantListening;
  }
}

window.AuroraMic = AuroraMic;
