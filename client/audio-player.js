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

  /** Instantly silence any current playback. Synchronous, <1ms. */
  stop() {
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

  /** Play base64-encoded audio (mp3/wav). Resolves when playback finishes naturally. */
  async playBase64(base64, mimeType = 'audio/mpeg', generation = null) {
    this._ensureContext();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.stop();

    if (generation != null) {
      this.cacheAudio(generation, base64, mimeType);
    }

    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const audioBuffer = await this.ctx.decodeAudioData(bytes.buffer.slice(0));

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
