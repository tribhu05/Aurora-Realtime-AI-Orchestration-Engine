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

    // Automatic speech recognition language resolution
    this.speechLang = 'auto';

    // Device detection: Android, iPhone/iPad, mobile viewport with touch
    this.isMobile =
      typeof navigator !== 'undefined' &&
      (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
        (typeof window !== 'undefined' && window.innerWidth <= 900 && 'ontouchstart' in window));

    if (!this.supported) return;

    this._initRecognizer();
  }

  _resolveLang(langSetting = 'auto') {
    if (langSetting === 'hi-IN' || langSetting === 'hi') return 'hi-IN';
    if (langSetting === 'en-US' || langSetting === 'en') return 'en-US';
    if (langSetting === 'en-IN') return 'en-IN';

    // Automatic resolution: inspect browser locale
    if (typeof navigator !== 'undefined') {
      const dev = (
        navigator.language ||
        (navigator.languages && navigator.languages[0]) ||
        ''
      ).toLowerCase();
      if (dev.startsWith('hi')) return 'hi-IN';
      if (dev.startsWith('en')) return dev;
    }
    // Default to en-US for standard English speech recognition
    return 'en-US';
  }

  /** Dynamically updates speech recognition language */
  setLanguage(lang) {
    this.speechLang = lang || 'auto';
    if (this.recognition) {
      this.recognition.lang = this._resolveLang(this.speechLang);
    }
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
    // Continuous listening supported across desktop and modern mobile browsers
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.maxAlternatives = 1;

    // Set recognition language based on active preference
    this.recognition.lang = this._resolveLang(this.speechLang);

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
        this._accumulatedText =
          (this._accumulatedText ? this._accumulatedText + ' ' : '') + currentFinal;
      }
      this._interimText = currentInterim;

      const liveText = (
        this._accumulatedText + (this._interimText ? ' ' + this._interimText : '')
      ).trim();

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

      // On desktop & mobile: attempt resilient auto-restart whenever voice mode is active
      if (this._wantListening) {
        this._scheduleRestart(80);
      }
    };
  }

  _finalizeUtterance() {
    if (this._silenceTimer) {
      clearTimeout(this._silenceTimer);
      this._silenceTimer = null;
    }
    const fullText = (
      this._accumulatedText + (this._interimText ? ' ' + this._interimText : '')
    ).trim();
    this._accumulatedText = '';
    this._interimText = '';
    this._heardThisTurn = false;

    // Note: Do not disable _wantListening here. In conversational mode,
    // listening remains active across multiple turns until user explicitly toggles it off.
    if (fullText && fullText.length > 0) {
      this.onFinalResult(fullText);
    }
  }

  _scheduleRestart(delay = 80) {
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
      if (err && (err.name === 'NotAllowedError' || err.message?.includes('not-allowed'))) {
        this._wantListening = false;
        if (isDirectGesture) {
          this.onError('not-allowed');
        }
        return;
      }
      // Transient busy/stopping state: schedule resilient retry instead of dropping listening
      if (this._wantListening) {
        this._scheduleRestart(150);
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

  /**
   * Seamlessly re-arms / ensures microphone is listening for the next user turn.
   * Called when AI speech completes or when returning to voice mode.
   */
  ensureListening() {
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
      this._safeStart(false);
    }
  }

  /**
   * Cleanly pauses audio capture while AI speaks to prevent speaker echo
   * from bleeding into the microphone on mobile speakerphones.
   */
  pauseForSpeaking() {
    if (!this.supported) return;
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
        this.recognition.abort();
      } catch (_) {}
      this._isRunning = false;
      this._isStarting = false;
    }
  }

  get listening() {
    return this._wantListening;
  }
}

window.AuroraMic = AuroraMic;
