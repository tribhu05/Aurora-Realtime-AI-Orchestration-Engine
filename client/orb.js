// client/orb.js
// High-performance canvas-based breathing orb for Aurora.
// Reacts organically to audio levels and smoothly transitions across states:
//   - idle:      Mystical Violet breathing aura
//   - listening: Radiant Cyan / Electric Blue with sound-wave ripples
//   - thinking:  Amber / Gold swirling energy vortex
//   - speaking:  Luminous Emerald Green reacting in real time to speech amplitude

const THEME_PALETTES = {
  aurora: {
    idle: { core: [140, 150, 255], outer: [99, 102, 241], aura: [192, 132, 252] }, // Bright Violet & Indigo
    listening: { core: [0, 229, 255], outer: [14, 165, 233], aura: [56, 189, 248] }, // Bright Laser Cyan
    thinking: { core: [255, 183, 3], outer: [245, 158, 11], aura: [251, 191, 36] }, // Bright Solar Amber
    speaking: { core: [0, 245, 155], outer: [16, 185, 129], aura: [52, 211, 153] }, // Bright Vivid Mint Green
  },
  titanium: {
    idle: { core: [245, 158, 11], outer: [217, 119, 6], aura: [251, 191, 36] }, // Champagne Gold
    listening: { core: [254, 240, 138], outer: [250, 204, 21], aura: [253, 224, 71] }, // Bright Canary
    thinking: { core: [251, 191, 36], outer: [217, 119, 6], aura: [254, 240, 138] }, // Solar Gold
    speaking: { core: [253, 230, 138], outer: [245, 158, 11], aura: [251, 191, 36] }, // Warm Bright Pearl
  },
  cyber: {
    idle: { core: [96, 165, 250], outer: [37, 99, 235], aura: [147, 197, 253] }, // Bright Ice Blue
    listening: { core: [0, 240, 255], outer: [6, 182, 212], aura: [103, 232, 249] }, // Laser Cyan
    thinking: { core: [216, 180, 254], outer: [168, 85, 247], aura: [233, 213, 255] }, // Bright Neon Violet
    speaking: { core: [52, 211, 153], outer: [16, 185, 129], aura: [110, 231, 183] }, // Electric Mint
  },
  emerald: {
    idle: { core: [16, 185, 129], outer: [5, 150, 105], aura: [52, 211, 153] }, // Bright Imperial Jade
    listening: { core: [45, 212, 191], outer: [20, 184, 166], aura: [94, 234, 212] }, // Bright Turquoise
    thinking: { core: [251, 191, 36], outer: [245, 158, 11], aura: [252, 211, 77] }, // Solar Amber
    speaking: { core: [74, 222, 128], outer: [34, 197, 94], aura: [134, 239, 172] }, // Bright Spring Mint
  },
};

class AuroraOrb {
  constructor(canvas, player) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.player = player;
    this.state = 'idle'; // idle | listening | thinking | speaking
    this.micLevel = 0; // 0..1 from mic energy
    this.targetState = 'idle';
    this.currentTheme = 'aurora';
    this.palette = THEME_PALETTES.aurora;

    // Current interpolated colors
    this.curCore = [...this.palette.idle.core];
    this.curOuter = [...this.palette.idle.outer];
    this.curAura = [...this.palette.idle.aura];

    this.t = 0;
    this.radius = 80;
    this.animId = null;

    this._resize();
    window.addEventListener('resize', () => this._resize());
    this.start();
  }

  setTheme(themeName) {
    if (THEME_PALETTES[themeName]) {
      this.currentTheme = themeName;
      this.palette = THEME_PALETTES[themeName];
    }
  }

  _resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = rect.width || 340;
    const h = rect.height || 340;
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.width = w;
    this.height = h;
    this.centerX = this.width / 2;
    this.centerY = this.height / 2;
    this.baseRadius = Math.min(this.width, this.height) * 0.28;
  }

  setState(nextState) {
    if (this.palette[nextState]) {
      this.state = nextState;
    }
  }

  setMicLevel(val) {
    this.micLevel = Math.max(0, Math.min(1, val));
  }

  start() {
    if (this.animId) return;
    const render = () => {
      this.draw();
      this.animId = requestAnimationFrame(render);
    };
    this.animId = requestAnimationFrame(render);
  }

  stop() {
    if (this.animId) {
      cancelAnimationFrame(this.animId);
      this.animId = null;
    }
  }

  draw() {
    this.t += 0.03;
    const ctx = this.ctx;
    const cx = this.centerX;
    const cy = this.centerY;

    ctx.clearRect(0, 0, this.width, this.height);

    // Smoothly interpolate towards current state colors
    const target = this.palette[this.state] || this.palette.idle;
    const speed = 0.08;
    for (let i = 0; i < 3; i++) {
      this.curCore[i] += (target.core[i] - this.curCore[i]) * speed;
      this.curOuter[i] += (target.outer[i] - this.curOuter[i]) * speed;
      this.curAura[i] += (target.aura[i] - this.curAura[i]) * speed;
    }

    const coreColor = `rgba(${Math.round(this.curCore[0])}, ${Math.round(this.curCore[1])}, ${Math.round(this.curCore[2])}, 0.95)`;
    const outerColor = `rgba(${Math.round(this.curOuter[0])}, ${Math.round(this.curOuter[1])}, ${Math.round(this.curOuter[2])}, 0.65)`;

    // Audio reactivity
    let audioAmp = 0;
    if (this.state === 'speaking' && this.player) {
      audioAmp = this.player.getLevel(); // 0..1
    } else if (this.state === 'listening') {
      audioAmp = this.micLevel * 0.5 + Math.sin(this.t * 2) * 0.05 + 0.05;
    }

    // Breathing pulse
    const breath = Math.sin(this.t * 1.5) * 4;
    const currentRadius = this.baseRadius + breath + audioAmp * 32;

    // 1. Crisp Rim Glow (Subtle, non-diffuse)
    const auraGrad = ctx.createRadialGradient(
      cx,
      cy,
      currentRadius * 0.95,
      cx,
      cy,
      currentRadius * 1.3
    );
    auraGrad.addColorStop(
      0,
      `rgba(${Math.round(this.curAura[0])}, ${Math.round(this.curAura[1])}, ${Math.round(this.curAura[2])}, 0.12)`
    );
    auraGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = auraGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, currentRadius * 1.3, 0, Math.PI * 2);
    ctx.fill();

    // 2. Ripple Rings (when listening or speaking)
    if (this.state === 'speaking' || this.state === 'listening') {
      const ringCount = 3;
      for (let r = 0; r < ringCount; r++) {
        const ringProgress = (this.t * 0.8 + r * (1 / ringCount)) % 1;
        const ringRadius = currentRadius + ringProgress * 50 * (audioAmp + 0.6);
        const ringAlpha = (1 - ringProgress) * 0.45 * (audioAmp + 0.3);
        ctx.strokeStyle = `rgba(${Math.round(this.curOuter[0])}, ${Math.round(this.curOuter[1])}, ${Math.round(this.curOuter[2])}, ${ringAlpha})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(cx, cy, ringRadius, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // 3. Swirling Orb Core with Deform
    ctx.save();
    ctx.beginPath();
    const points = 32;
    for (let i = 0; i <= points; i++) {
      const angle = (i / points) * Math.PI * 2;
      // Multi-frequency wave deformation
      let deform = 0;
      if (this.state === 'speaking') {
        deform =
          Math.sin(angle * 5 + this.t * 4) * (audioAmp * 12) +
          Math.cos(angle * 3 - this.t * 3) * (audioAmp * 8);
      } else if (this.state === 'thinking') {
        deform = Math.sin(angle * 4 + this.t * 6) * 5;
      } else if (this.state === 'listening') {
        deform = Math.sin(angle * 6 + this.t * 3) * 4;
      }
      const r = currentRadius + deform;
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();

    // Orb Internal Radial Gradient (simulates 3D sphere depth)
    const lightOffsetX = cx - currentRadius * 0.3;
    const lightOffsetY = cy - currentRadius * 0.35;
    const sphereGrad = ctx.createRadialGradient(
      lightOffsetX,
      lightOffsetY,
      currentRadius * 0.08,
      cx,
      cy,
      currentRadius * 1.15
    );
    sphereGrad.addColorStop(0, '#ffffff');
    sphereGrad.addColorStop(0.25, coreColor);
    sphereGrad.addColorStop(0.7, outerColor);
    sphereGrad.addColorStop(
      1,
      `rgba(${Math.round(this.curOuter[0] * 0.4)}, ${Math.round(this.curOuter[1] * 0.4)}, ${Math.round(this.curOuter[2] * 0.4)}, 0.98)`
    );

    ctx.fillStyle = sphereGrad;
    // Crisp edge definition without fuzzy blur
    ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
    ctx.shadowBlur = 6;
    ctx.fill();
    ctx.restore();

    // 4. Inner Crisp Highlight Arc (Clean specular glint)
    ctx.save();
    ctx.beginPath();
    ctx.arc(
      cx - currentRadius * 0.15,
      cy - currentRadius * 0.2,
      currentRadius * 0.55,
      -Math.PI * 0.8,
      -Math.PI * 0.2
    );
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.restore();
  }
}

window.AuroraOrb = AuroraOrb;
