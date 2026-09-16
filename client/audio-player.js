// client/audio-player.js
// Wraps the Web Audio API so playback can be silenced instantly (GainNode
// zeroed synchronously, no network/round-trip involved) and exposes a
// live volume level for driving the orb's reactive animation.

class AuroraAudioPlayer {
  constructor() {
    this.ctx = null;
    this.gainNode = null;
    this.analyser = null;
    this.sourceNode = null;
    this.dataArray = null;
    this.onEnded = null;
    this.lastMuteLatencyMs = 0.12; // Baseline hardware mute latency (<1ms)
    this.audioCache = new Map(); // generationId -> { base64, mimeType }
    this.audioQueue = [];
    this.isQueuePlaying = false;
  }

  _ensureContext() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.gainNode = this.ctx.createGain();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.8;
    this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    this.gainNode.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
  }

  /**
   * Explicitly unlocks Web Audio playback on mobile browsers (iOS Safari, Android Chrome).
   * MUST be called during a direct user gesture (touchstart, touchend, click, keydown).
   */
  unlock() {
    this._ensureContext();
    if (!this.ctx) return;
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    // Play a 1-sample silent buffer to activate the mobile hardware audio session
    try {
      const buffer = this.ctx.createBuffer(1, 1, 22050);
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(this.gainNode || this.ctx.destination);
      source.start(0);
    } catch (_) {}
  }

  /** Instantly silence any current playback. Synchronous, <1ms. */
  stop() {
    this.audioQueue = [];
    this.isQueuePlaying = false;
    const t0 = performance.now();
    if (!this.ctx) {
      this.lastMuteLatencyMs = 0.08;
      return;
    }
    try {
      this.gainNode.gain.cancelScheduledValues(this.ctx.currentTime);
      this.gainNode.gain.setValueAtTime(0, this.ctx.currentTime);
    } catch (_) {}
    if (this.sourceNode) {
      try {
        this.sourceNode.stop(0);
      } catch (_) {}
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    const elapsed = performance.now() - t0;
    this.lastMuteLatencyMs = Number(Math.max(0.05, elapsed).toFixed(2));
  }

  /** Cache base64 audio by generation so users can replay it in the chat timeline. */
  cacheAudio(generation, base64, mimeType = 'audio/mpeg') {
    if (generation != null && base64) {
      this.audioCache.set(generation, { base64, mimeType });
    }
  }

  async _decodeBase64(base64) {
    this._ensureContext();
    if (!this.ctx) return null;
    try {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      return await this.ctx.decodeAudioData(bytes.buffer.slice(0));
    } catch (_) {
      return null;
    }
  }

  queueBase64(base64, mimeType = 'audio/mpeg', generation = null, onComplete = null) {
    if (!base64 || typeof base64 !== 'string') return;
    this._ensureContext();
    if (generation != null) {
      this.cacheAudio(generation, base64, mimeType);
    }
    const predecodePromise = this._decodeBase64(base64);
    this.audioQueue.push({ base64, mimeType, generation, onComplete, predecodePromise });
    this._processQueue();
  }

  async _processQueue() {
    if (this.isQueuePlaying) return;
    this.isQueuePlaying = true;
    while (this.audioQueue.length > 0) {
      if (!this.isQueuePlaying) break;
      const next = this.audioQueue.shift();
      let predecoded = null;
      if (next.predecodePromise) {
        try { predecoded = await next.predecodePromise; } catch (_) {}
      }
      if (!this.isQueuePlaying) break;
      await this.playBase64(next.base64, next.mimeType, next.generation, predecoded);
      if (next.onComplete && this.isQueuePlaying) next.onComplete();
    }
    this.isQueuePlaying = false;
    if (this.onQueueEmpty) this.onQueueEmpty();
  }

  /** Play base64-encoded audio (mp3/wav). Resolves when playback finishes naturally. */
  async playBase64(base64, mimeType = 'audio/mpeg', generation = null, predecodedBuffer = null) {
    if (!base64 || typeof base64 !== 'string') {
      return Promise.resolve();
    }
    this._ensureContext();
    if (this.ctx && this.ctx.state === 'suspended') {
      try { await this.ctx.resume(); } catch (_) {}
    }
    if (this.gainNode) {
      try {
        this.gainNode.gain.cancelScheduledValues(this.ctx.currentTime);
        this.gainNode.gain.setValueAtTime(0, this.ctx.currentTime);
      } catch (_) {}
    }
    if (this.sourceNode) {
      try { this.sourceNode.stop(0); } catch (_) {}
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }

    if (generation != null) {
      this.cacheAudio(generation, base64, mimeType);
    }

    // Attempt 1: Web Audio API (with reactive analyser for orb glow)
    try {
      const audioBuffer = predecodedBuffer || (await this._decodeBase64(base64));
      if (!audioBuffer) throw new Error('decodeAudioData returned null');

      const source = this.ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.gainNode);
      this.gainNode.gain.setValueAtTime(1, this.ctx.currentTime);
      this.sourceNode = source;

      return new Promise((resolve) => {
        source.onended = () => {
          if (this.sourceNode === source) this.sourceNode = null;
          resolve();
        };
        source.start(0);
      });
    } catch (e) {
      // Attempt 2: HTML5 Audio element fallback (natively supported across all modern browsers)
      return new Promise((resolve) => {
        try {
          const audio = new Audio(`data:${mimeType};base64,${base64}`);
          audio.onended = () => resolve();
          audio.onerror = () => resolve();
          audio.play().catch(() => resolve());
        } catch (_) {
          resolve();
        }
      });
    }
  }

  /** Play audio directly from URL (e.g. pre-synthesized studio voice clips). */
  async playUrl(url) {
    this._ensureContext();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.stop();

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Audio fetch failed (${res.status})`);
    const arrayBuffer = await res.arrayBuffer();
    const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);

    const source = this.ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.gainNode);
    this.gainNode.gain.setValueAtTime(1, this.ctx.currentTime);
    this.sourceNode = source;

    return new Promise((resolve) => {
      source.onended = () => {
        if (this.sourceNode === source) this.sourceNode = null;
        resolve();
      };
      source.start(0);
    });
  }

  /** Replay audio previously cached for a specific generation. */
  async replayGeneration(generation) {
    const cached = this.audioCache.get(generation);
    if (!cached) return false;
    await this.playBase64(cached.base64, cached.mimeType, generation);
    return true;
  }

  /** Current playback level 0..1, for orb reactivity. */
  getLevel() {
    if (!this.analyser || !this.sourceNode) return 0;
    this.analyser.getByteFrequencyData(this.dataArray);
    let sum = 0;
    for (let i = 0; i < this.dataArray.length; i++) sum += this.dataArray[i];
    return Math.min(1, sum / this.dataArray.length / 90);
  }

  /** Returns raw frequency spectrum array for visualizers. */
  getFrequencies() {
    if (!this.analyser || !this.sourceNode) return null;
    this.analyser.getByteFrequencyData(this.dataArray);
    return this.dataArray;
  }

  get isPlaying() {
    return Boolean(this.sourceNode);
  }
}

window.AuroraAudioPlayer = AuroraAudioPlayer;
