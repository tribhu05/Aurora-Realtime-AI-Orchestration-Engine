// client/vad-mic.js
// Robust SpeechRecognition wrapper with deterministic lifecycle management,
// speech accumulation, natural silence-debounced endpointing, instant barge-in reset,
// and resilient cross-platform auto-restart (desktop & mobile).

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
    this._isDirectGesture = false; // Tracks if start was from direct user action
    this._permissionUnlocked = false; // Tracks if getUserMedia permission was already granted
    this._restartTimer = null;
    this._silenceTimer = null;
    this._silenceTimeoutMs = 1000; // 1 second of natural silence on desktop
    this._mobileSilenceTimeoutMs = 650; // Snappier silence detection on mobile
    this._accumulatedText = '';
    this._interimText = '';

    // Device detection: Android, iPhone/iPad, mobile viewport with touch
    this.isMobile =
      typeof navigator !== 'undefined' &&
      (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
        (typeof window !== 'undefined' && window.innerWidth <= 900 && 'ontouchstart' in window));

    if (!this.supported) return;

    this._initRecognizer();
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
    // Desktop Chrome supports continuous listening; Mobile (Android Chrome & iOS Safari)
    // restricts or fails continuous recognition sessions. Use single-turn for mobile.
    this.recognition.continuous = !this.isMobile;
    this.recognition.interimResults = true;
    this.recognition.maxAlternatives = 1;

    // Use device locale if available, falling back to en-US
    const deviceLang =
      (typeof navigator !== 'undefined' && (navigator.language || (navigator.languages && navigator.languages[0]))) ||
      'en-US';
    this.recognition.lang = deviceLang;

    this.recognition.onstart = () => {
      this._isRunning = true;
      this._isStarting = false;
      this._isDirectGesture = false;
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
        const timeout = this.isMobile ? this._mobileSilenceTimeoutMs : this._silenceTimeoutMs;
        this._silenceTimer = setTimeout(() => {
          this._finalizeUtterance();
        }, timeout);
      }
    };

    this.recognition.onerror = (e) => {
      const err = e.error;
      this._isStarting = false;

      // 'no-speech' and 'aborted' are normal lifecycle events in Web Speech API
      if (err === 'no-speech' || err === 'aborted') {
        return;
      }

      if (err === 'not-allowed' || err === 'service-not-allowed') {
        const wasDirectGesture = this._isDirectGesture;
        this._wantListening = false;
        this._isDirectGesture = false;

        const isInsecure =
          window.isSecureContext === false ||
          (location.protocol !== 'https:' &&
            location.hostname !== 'localhost' &&
            location.hostname !== '127.0.0.1');

        if (isInsecure) {
          this.onError('insecure-context');
          return;
        }

        // If 'not-allowed' occurs during a background auto-restart (not a direct user click),
        // it means the browser requires a new gesture. Gracefully end without bricking the UI.
        if (!wasDirectGesture) {
          this._isRunning = false;
          this.onEnd();
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

      // On desktop with continuous mode enabled, attempt resilient restart.
      // On mobile, never auto-restart in background (requires direct user gesture).
      if (!this.isMobile && this._wantListening) {
        this._scheduleRestart();
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

    if (this.isMobile) {
      // On mobile, completing the sentence concludes the turn so mic does not record during AI speech
      this._wantListening = false;
      try {
        this.recognition.stop();
      } catch (_) {}
    }

    if (fullText && fullText.length > 0) {
      this.onFinalResult(fullText);
    }
  }

  _scheduleRestart(delay = 60) {
    if (this.isMobile) return; // Never restart on mobile without direct gesture
    if (this._restartTimer) {
      clearTimeout(this._restartTimer);
    }
    this._restartTimer = setTimeout(() => {
      this._restartTimer = null;
      if (this._wantListening && !this._isRunning && !this._isStarting) {
        this._safeStart(false);
      }
    }, delay);
  }

  _safeStart(isDirectGesture = false) {
    if (!this.supported || !this._wantListening) return;
    if (this._isRunning || this._isStarting) return;

    this._isStarting = true;
    this._isDirectGesture = isDirectGesture;

    try {
      this.recognition.start();
    } catch (err) {
      this._isStarting = false;
      if (err && (err.name === 'InvalidStateError' || err.message?.includes('already started'))) {
        this._isRunning = true;
        return;
      }
      if (isDirectGesture) {
        if (err && (err.name === 'NotAllowedError' || err.message?.includes('not-allowed'))) {
          this._wantListening = false;
          this.onError('not-allowed');
        }
      } else {
        this._wantListening = false;
      }
    }
  }

  /**
   * Starts listening inside a user gesture.
   * On mobile or first microphone request, pre-unlocks hardware permissions via getUserMedia.
   */
  async start() {
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

    // On mobile or first microphone activation, ensure hardware permissions are granted
    if (
      !this._permissionUnlocked &&
      typeof navigator !== 'undefined' &&
      navigator.mediaDevices &&
      typeof navigator.mediaDevices.getUserMedia === 'function'
    ) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        this._permissionUnlocked = true;
        // Release stream tracks immediately so SpeechRecognition has exclusive capture
        stream.getTracks().forEach((track) => {
          try {
            track.stop();
          } catch (_) {}
        });
      } catch (permErr) {
        if (permErr.name === 'NotAllowedError' || permErr.name === 'PermissionDeniedError') {
          this._wantListening = false;
          this.onError('not-allowed');
          return;
        }
      }
    }

    if (!this._isRunning && !this._isStarting) {
      this._safeStart(true);
    }
  }

  stop() {
    if (!this.supported) return;
    this._wantListening = false;
    this._isDirectGesture = false;
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

    if (this._isRunning || this._isStarting) {
      try {
        // Aborting forces Web Speech API to flush its internal buffer without firing onresult
        this.recognition.abort();
      } catch (_) {}
    }

    // Direct synchronous start for immediate user responsiveness
    this._safeStart(true);
  }

  get listening() {
    return this._wantListening;
  }
}

window.AuroraMic = AuroraMic;
