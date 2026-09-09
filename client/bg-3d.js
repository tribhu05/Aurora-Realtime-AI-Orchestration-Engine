// client/bg-3d.js
// Ambient 3D starfield and celestial depth particle field for Aurora.
// Provides spatial depth and interactive cursor parallax to the dark canvas.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AuroraBg3D = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  class AuroraBg3D {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas ? canvas.getContext('2d') : null;
      this.stars = [];
      this.numStars = 140;
      this.maxDepth = 1200;
      this.speed = 0.45;
      this.animId = null;

      // Mouse parallax
      this.targetMouseX = 0;
      this.targetMouseY = 0;
      this.mouseX = 0;
      this.mouseY = 0;

      if (!this.canvas || !this.ctx) return;

      this._resize();
      this._initStars();
      this._bindEvents();
      this.start();
    }

    _resize() {
      if (!this.canvas) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = window.innerWidth;
      const h = window.innerHeight;
      this.canvas.width = w * dpr;
      this.canvas.height = h * dpr;
      this.width = w;
      this.height = h;
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.centerX = w / 2;
      this.centerY = h / 2;
    }

    _initStars() {
      this.stars = [];
      const colors = [
        [88, 191, 255], // Cyan
        [147, 197, 253], // Ice blue
        [192, 132, 252], // Violet
        [224, 231, 255], // White-blue
      ];

      for (let i = 0; i < this.numStars; i++) {
        const color = colors[Math.floor(Math.random() * colors.length)];
        this.stars.push({
          x: (Math.random() - 0.5) * this.width * 2.2,
          y: (Math.random() - 0.5) * this.height * 2.2,
          z: Math.random() * this.maxDepth,
          color,
          size: Math.random() * 1.6 + 0.6,
          twinkleSpeed: Math.random() * 0.03 + 0.01,
          twinklePhase: Math.random() * Math.PI * 2,
        });
      }
    }

    _bindEvents() {
      window.addEventListener('resize', () => this._resize());
      window.addEventListener(
        'mousemove',
        (e) => {
          this.targetMouseX = (e.clientX - this.centerX) * 0.08;
          this.targetMouseY = (e.clientY - this.centerY) * 0.08;
        },
        { passive: true }
      );
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
      if (!this.ctx) return;
      const ctx = this.ctx;
      ctx.clearRect(0, 0, this.width, this.height);

      // Smooth mouse interpolation
      this.mouseX += (this.targetMouseX - this.mouseX) * 0.05;
      this.mouseY += (this.targetMouseY - this.mouseY) * 0.05;

      const fov = 400;
      const cx = this.centerX + this.mouseX;
      const cy = this.centerY + this.mouseY;

      const now = Date.now() * 0.001;

      for (let i = 0; i < this.stars.length; i++) {
        const s = this.stars[i];

        // Slowly advance toward camera
        s.z -= this.speed;
        if (s.z <= 1) {
          s.z = this.maxDepth;
          s.x = (Math.random() - 0.5) * this.width * 2.2;
          s.y = (Math.random() - 0.5) * this.height * 2.2;
        }

        // 3D Perspective projection
        const k = fov / s.z;
        const px = cx + s.x * k;
        const py = cy + s.y * k;

        // Skip if outside viewport
        if (px < -10 || px > this.width + 10 || py < -10 || py > this.height + 10) {
          continue;
        }

        // Depth-based size and opacity
        const depthRatio = 1 - s.z / this.maxDepth;
        const radius = Math.max(0.4, s.size * k * 0.4);
        const twinkle = Math.sin(now * s.twinkleSpeed * 100 + s.twinklePhase) * 0.25 + 0.75;
        const alpha = Math.min(0.85, depthRatio * 0.75 * twinkle);

        ctx.fillStyle = `rgba(${s.color[0]}, ${s.color[1]}, ${s.color[2]}, ${alpha})`;
        ctx.beginPath();
        ctx.arc(px, py, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  return AuroraBg3D;
});
