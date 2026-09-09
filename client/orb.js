// client/orb.js
// Bespoke 3D Holographic AI Sphere for Aurora.
// Embodying the Robin design aesthetic: obsidian glass core, true 3D gyroscopic
// orbital rings with depth occlusion, audio-reactive plasma turbulence, and
// silky-smooth interactive 3D pointer parallax.

const THEME_PALETTES = {
  aurora: {
    idle: { core: [140, 150, 255], outer: [99, 102, 241], aura: [192, 132, 252] },
    listening: { core: [0, 229, 255], outer: [14, 165, 233], aura: [56, 189, 248] },
    thinking: { core: [255, 183, 3], outer: [245, 158, 11], aura: [251, 191, 36] },
    speaking: { core: [0, 245, 155], outer: [16, 185, 129], aura: [52, 211, 153] },
  },
  titanium: {
    idle: { core: [245, 158, 11], outer: [217, 119, 6], aura: [251, 191, 36] },
    listening: { core: [254, 240, 138], outer: [250, 204, 21], aura: [253, 224, 71] },
    thinking: { core: [251, 191, 36], outer: [217, 119, 6], aura: [254, 240, 138] },
    speaking: { core: [253, 230, 138], outer: [245, 158, 11], aura: [251, 191, 36] },
  },
  cyber: {
    idle: { core: [96, 165, 250], outer: [37, 99, 235], aura: [147, 197, 253] },
    listening: { core: [0, 240, 255], outer: [6, 182, 212], aura: [103, 232, 249] },
    thinking: { core: [216, 180, 254], outer: [168, 85, 247], aura: [233, 213, 255] },
    speaking: { core: [52, 211, 153], outer: [16, 185, 129], aura: [110, 231, 183] },
  },
  emerald: {
    idle: { core: [16, 185, 129], outer: [5, 150, 105], aura: [52, 211, 153] },
    listening: { core: [45, 212, 191], outer: [20, 184, 166], aura: [94, 234, 212] },
    thinking: { core: [251, 191, 36], outer: [245, 158, 11], aura: [252, 211, 77] },
    speaking: { core: [74, 222, 128], outer: [34, 197, 94], aura: [134, 239, 172] },
  },
};

// 3D Spatial Vector & Matrix Utilities
function vecRotateX(x, y, z, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [x, y * c - z * s, y * s + z * c];
}

function vecRotateY(x, y, z, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [x * c + z * s, y, -x * s + z * c];
}

function vecRotateZ(x, y, z, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [x * c - y * s, x * s + y * c, z];
}

class AuroraOrb {
  constructor(canvas, player) {
    this.canvas = canvas;
    this.player = player;
    this.ctx = canvas ? canvas.getContext('2d') : null;
    this.state = 'idle'; // idle | listening | thinking | speaking
    this.micLevel = 0;
    this.currentTheme = 'aurora';
    this.palette = THEME_PALETTES.aurora;

    // Smooth color vector interpolation (RGB 0..255)
    this.curCore = [...this.palette.idle.core];
    this.curOuter = [...this.palette.idle.outer];
    this.curAura = [...this.palette.idle.aura];

    // Interactive 3D Cursor Parallax
    this.targetPitch = 0;
    this.targetYaw = 0;
    this.pitch = 0;
    this.yaw = 0;

    // Gyroscopic Ring Orbit Angles
    this.ringRot1 = 0;
    this.ringRot2 = 0;
    this.ringRot3 = 0;

    // Internal Simulation Time & Loop
    this.t = 0;
    this.animId = null;
    this.dpr = 1;
    this.width = 260;
    this.height = 260;
    this.cx = 130;
    this.cy = 130;
    this.baseRadius = 50;

    // Sonic shockwave particles for speech
    this.shockwaves = [];

    this._resize();
    this._bindEvents();
    this.start();
  }

  _bindEvents() {
    window.addEventListener('resize', () => this._resize());

    // Interactive 3D Pointer Parallax
    window.addEventListener(
      'mousemove',
      (e) => {
        const cx = window.innerWidth / 2;
        const cy = window.innerHeight / 2;
        // Natural tilt bounds (radians)
        this.targetYaw = Math.max(-0.45, Math.min(0.45, (e.clientX - cx) * 0.0006));
        this.targetPitch = Math.max(-0.35, Math.min(0.35, -(e.clientY - cy) * 0.0006));
      },
      { passive: true }
    );
  }

  setTheme(themeName) {
    if (THEME_PALETTES[themeName]) {
      this.currentTheme = themeName;
      this.palette = THEME_PALETTES[themeName];
    }
  }

  setState(nextState) {
    if (this.palette[nextState]) {
      this.state = nextState;
    }
  }

  setMicLevel(val) {
    this.micLevel = Math.max(0, Math.min(1, val));
  }

  _resize() {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);

    const w = rect.width || 260;
    const h = rect.height || 260;
    this.width = w;
    this.height = h;

    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);

    if (this.ctx) {
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }
    this.cx = w / 2;
    this.cy = h / 2;
    this.baseRadius = Math.min(w, h) * 0.22;
  }

  resize() {
    this._resize();
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

  // Perspective 3D Point Projection onto 2D Canvas Plane
  _project(x, y, z, f = 360, zCam = 420) {
    const scale = f / (z + zCam);
    return {
      x: x * scale + this.cx,
      y: y * scale + this.cy,
      z: z,
      scale: scale,
    };
  }

  // Transform raw ring coordinates by gyroscope spin, tilt, and pointer parallax
  _transformPoint(x, y, z, tiltX, tiltZ, spinAngle) {
    // 1. Gyroscopic spin around ring's own polar axis
    let [rx, ry, rz] = vecRotateZ(x, y, z, spinAngle);
    // 2. Ring inclination angles in 3D space
    [rx, ry, rz] = vecRotateX(rx, ry, rz, tiltX);
    [rx, ry, rz] = vecRotateZ(rx, ry, rz, tiltZ);
    // 3. User pointer parallax tilt
    [rx, ry, rz] = vecRotateY(rx, ry, rz, this.yaw);
    [rx, ry, rz] = vecRotateX(rx, ry, rz, this.pitch);
    return [rx, ry, rz];
  }

  draw() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    this.t += 0.025;

    // Clear canvas frame
    ctx.clearRect(0, 0, this.width, this.height);

    // Smooth color interpolation
    const target = this.palette[this.state] || this.palette.idle;
    const lerpSpeed = 0.07;
    for (let i = 0; i < 3; i++) {
      this.curCore[i] += (target.core[i] - this.curCore[i]) * lerpSpeed;
      this.curOuter[i] += (target.outer[i] - this.curOuter[i]) * lerpSpeed;
      this.curAura[i] += (target.aura[i] - this.curAura[i]) * lerpSpeed;
    }

    // Smooth inertia spring for 3D cursor parallax
    this.pitch += (this.targetPitch - this.pitch) * 0.06;
    this.yaw += (this.targetYaw - this.yaw) * 0.06;

    // Audio reactivity amplitude (0..1)
    let audioAmp = 0;
    if (this.state === 'speaking' && this.player) {
      audioAmp = Math.max(0, Math.min(1, this.player.getLevel()));
    } else if (this.state === 'listening') {
      audioAmp = Math.max(
        0,
        Math.min(1, this.micLevel * 0.75 + Math.sin(this.t * 3.5) * 0.04 + 0.05)
      );
    } else if (this.state === 'thinking') {
      audioAmp = 0.18 + Math.sin(this.t * 5.0) * 0.08;
    }

    // Dynamic rotation speeds by state
    const speedMult =
      this.state === 'thinking'
        ? 2.6
        : this.state === 'listening'
          ? 1.35
          : this.state === 'speaking'
            ? 1.5 + audioAmp * 1.2
            : 1.0;

    this.ringRot1 += 0.012 * speedMult;
    this.ringRot2 -= 0.016 * speedMult;
    this.ringRot3 += 0.009 * speedMult;

    // Base Sphere Radius with dynamic breathing and sound wave expansion
    const breath = Math.sin(this.t * 1.6) * 2.2;
    const sphereRadius = this.baseRadius + breath + audioAmp * 14;

    // Build Gyroscopic Orbital Rings (3 distinct 3D planes)
    // Ring 1: Inner Gyroscope (Fast, inclined)
    // Ring 2: Equatorial / Tilted (Opposite direction, wide)
    // Ring 3: Outer Halo (High inclination, delicate)
    const ringSpecs = [
      {
        radius: sphereRadius * 1.42,
        tiltX: 0.62,
        tiltZ: 0.32,
        spin: this.ringRot1,
        width: 2.2,
        alpha: 0.85,
        nodePhase: this.t * 1.4,
      },
      {
        radius: sphereRadius * 1.68,
        tiltX: -0.74,
        tiltZ: -0.48,
        spin: this.ringRot2,
        width: 1.8,
        alpha: 0.75,
        nodePhase: -this.t * 1.8,
      },
      {
        radius: sphereRadius * 1.95,
        tiltX: 1.12,
        tiltZ: 0.82,
        spin: this.ringRot3,
        width: 1.3,
        alpha: 0.65,
        nodePhase: this.t * 0.9,
      },
    ];

    // Compute sampled 3D points for each ring
    const segments = 64;
    const computedRings = ringSpecs.map((spec) => {
      const pts = [];
      for (let i = 0; i <= segments; i++) {
        const theta = (i / segments) * Math.PI * 2;
        const x = Math.cos(theta) * spec.radius;
        const y = Math.sin(theta) * spec.radius;
        const z = 0;

        const [tx, ty, tz] = this._transformPoint(x, y, z, spec.tiltX, spec.tiltZ, spec.spin);
        const proj = this._project(tx, ty, tz);
        pts.push({
          rawX: tx,
          rawY: ty,
          rawZ: tz,
          projX: proj.x,
          projY: proj.y,
          scale: proj.scale,
          theta: theta,
        });
      }

      // Compute Traveling Photon Node position along ring
      const nodeX = Math.cos(spec.nodePhase) * spec.radius;
      const nodeY = Math.sin(spec.nodePhase) * spec.radius;
      const [nx, ny, nz] = this._transformPoint(nodeX, nodeY, 0, spec.tiltX, spec.tiltZ, spec.spin);
      const nodeProj = this._project(nx, ny, nz);

      return {
        spec,
        pts,
        node: {
          x: nodeProj.x,
          y: nodeProj.y,
          z: nz,
          scale: nodeProj.scale,
        },
      };
    });

    // =========================================================================
    // LAYER 1: BACK HALF OF RINGS (Z < 0) - Passing behind the sphere
    // =========================================================================
    this._drawRingsHalf(ctx, computedRings, true, sphereRadius);

    // =========================================================================
    // LAYER 2: 3D VOLUMETRIC OBSIDIAN GLASS SPHERE & AUDIO-REACTIVE PLASMA CORE
    // =========================================================================
    this._drawSphere(ctx, sphereRadius, audioAmp);

    // =========================================================================
    // LAYER 3: FRONT HALF OF RINGS (Z >= 0) - Passing in front of the sphere
    // =========================================================================
    this._drawRingsHalf(ctx, computedRings, false, sphereRadius);

    // =========================================================================
    // LAYER 4: SPEECH SOUND WAVE RIPPLES (When speaking)
    // =========================================================================
    if (this.state === 'speaking' && audioAmp > 0.08) {
      if (Math.random() < 0.35) {
        this.shockwaves.push({
          r: sphereRadius * 0.9,
          maxR: sphereRadius * 2.3,
          alpha: 0.65 + audioAmp * 0.35,
          speed: 2.2 + audioAmp * 3.0,
        });
      }
    }
    this._drawShockwaves(ctx);
  }

  // Draw either the back half (isBack=true) or front half (isBack=false) of the rings
  _drawRingsHalf(ctx, computedRings, isBack, sphereRadius) {
    const coreRgb = this.curCore.map((v) => Math.round(v)).join(', ');
    const auraRgb = this.curAura.map((v) => Math.round(v)).join(', ');

    computedRings.forEach(({ spec, pts, node }) => {
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // Draw segments that belong to this depth half
      for (let i = 0; i < pts.length - 1; i++) {
        const p1 = pts[i];
        const p2 = pts[i + 1];
        const avgZ = (p1.rawZ + p2.rawZ) * 0.5;

        // Check if segment is in back half (avgZ < 0) or front half (avgZ >= 0)
        if (isBack ? avgZ < 0 : avgZ >= 0) {
          // Calculate distance from sphere center to handle glass occlusion
          const distToCenter = Math.hypot(
            (p1.projX + p2.projX) * 0.5 - this.cx,
            (p1.projY + p2.projY) * 0.5 - this.cy
          );

          ctx.beginPath();
          ctx.moveTo(p1.projX, p1.projY);
          ctx.lineTo(p2.projX, p2.projY);

          if (isBack) {
            // If behind the sphere and within the sphere radius, simulate glass refraction/darkening
            if (distToCenter < sphereRadius * 0.95) {
              ctx.strokeStyle = `rgba(${auraRgb}, ${spec.alpha * 0.2})`;
              ctx.lineWidth = spec.width * p1.scale * 0.8;
            } else {
              ctx.strokeStyle = `rgba(${auraRgb}, ${spec.alpha * 0.55})`;
              ctx.lineWidth = spec.width * p1.scale;
            }
          } else {
            // Front segments: luminous, crisp, with full opacity and subtle bloom
            ctx.strokeStyle = `rgba(${auraRgb}, ${spec.alpha * 0.95})`;
            ctx.lineWidth = spec.width * p1.scale * 1.15;
            ctx.shadowColor = `rgba(${coreRgb}, 0.75)`;
            ctx.shadowBlur = 6 * p1.scale;
          }
          ctx.stroke();
        }
      }

      // Draw Traveling Photon Node if on the current depth layer
      if (isBack ? node.z < 0 : node.z >= 0) {
        const nodeDist = Math.hypot(node.x - this.cx, node.y - this.cy);
        const nodeAlpha = isBack && nodeDist < sphereRadius ? 0.3 : 0.95;
        const nodeRadius = (isBack ? 2.5 : 3.8) * node.scale;

        // Luminous outer flare
        const flareGrad = ctx.createRadialGradient(
          node.x,
          node.y,
          0,
          node.x,
          node.y,
          nodeRadius * 3.5
        );
        flareGrad.addColorStop(0, `rgba(255, 255, 255, ${nodeAlpha})`);
        flareGrad.addColorStop(0.35, `rgba(${auraRgb}, ${nodeAlpha * 0.85})`);
        flareGrad.addColorStop(1, `rgba(${coreRgb}, 0)`);

        ctx.fillStyle = flareGrad;
        ctx.beginPath();
        ctx.arc(node.x, node.y, nodeRadius * 3.5, 0, Math.PI * 2);
        ctx.fill();

        // High-energy white pinpoint center
        ctx.fillStyle = `rgba(255, 255, 255, ${nodeAlpha})`;
        ctx.beginPath();
        ctx.arc(node.x, node.y, nodeRadius * 0.7, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    });
  }

  // Draw the central 3D Holographic Sphere with glass body, Fresnel rim, and plasma core
  _drawSphere(ctx, r, audioAmp) {
    const cx = this.cx;
    const cy = this.cy;
    const coreRgb = this.curCore.map((v) => Math.round(v)).join(', ');
    const outerRgb = this.curOuter.map((v) => Math.round(v)).join(', ');
    const auraRgb = this.curAura.map((v) => Math.round(v)).join(', ');

    ctx.save();

    // 1. Ambient Volumetric Atmospheric Glow (behind sphere)
    const auraGrad = ctx.createRadialGradient(cx, cy, r * 0.5, cx, cy, r * 2.1);
    const auraIntensity = 0.28 + audioAmp * 0.45;
    auraGrad.addColorStop(0, `rgba(${coreRgb}, ${auraIntensity})`);
    auraGrad.addColorStop(0.45, `rgba(${outerRgb}, ${auraIntensity * 0.45})`);
    auraGrad.addColorStop(1, 'rgba(2, 5, 11, 0)');

    ctx.fillStyle = auraGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 2.1, 0, Math.PI * 2);
    ctx.fill();

    // 2. Deep Obsidian Glass Body (Base 3D sphere with light source)
    // Key light offset shifted dynamically by pointer parallax
    const lightOffsetX = -r * 0.28 + this.yaw * r * 0.45;
    const lightOffsetY = -r * 0.28 - this.pitch * r * 0.45;

    const glassGrad = ctx.createRadialGradient(
      cx + lightOffsetX,
      cy + lightOffsetY,
      r * 0.08,
      cx,
      cy,
      r
    );
    glassGrad.addColorStop(0, 'rgba(12, 28, 62, 0.94)');
    glassGrad.addColorStop(0.35, 'rgba(6, 16, 38, 0.96)');
    glassGrad.addColorStop(0.75, 'rgba(3, 8, 20, 0.98)');
    glassGrad.addColorStop(1, 'rgba(1, 3, 8, 1)');

    ctx.fillStyle = glassGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    // 3. Audio-Reactive Internal Plasma Core (Suspended inside the glass)
    const plasmaRadius = r * 0.52 + audioAmp * r * 0.32;
    const plasmaPulse = Math.sin(this.t * 3.2) * (r * 0.04);
    const effectivePlasmaR = Math.max(10, plasmaRadius + plasmaPulse);

    const plasmaGrad = ctx.createRadialGradient(
      cx + lightOffsetX * 0.5,
      cy + lightOffsetY * 0.5,
      effectivePlasmaR * 0.1,
      cx,
      cy,
      effectivePlasmaR
    );
    plasmaGrad.addColorStop(0, '#ffffff');
    plasmaGrad.addColorStop(0.22, `rgba(${coreRgb}, 0.95)`);
    plasmaGrad.addColorStop(0.65, `rgba(${outerRgb}, 0.55)`);
    plasmaGrad.addColorStop(1, `rgba(${auraRgb}, 0)`);

    ctx.fillStyle = plasmaGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, effectivePlasmaR, 0, Math.PI * 2);
    ctx.fill();

    // 4. Harmonic Turbulence Swirl (Subtle internal energy ripples)
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (let k = 0; k < 3; k++) {
      const rippleAngle = this.t * (1.2 + k * 0.5) * (this.state === 'thinking' ? 2.5 : 1.0);
      const rx = cx + Math.cos(rippleAngle) * (r * 0.22);
      const ry = cy + Math.sin(rippleAngle) * (r * 0.18);
      const rr = r * 0.28 + Math.sin(this.t * 2.0 + k) * (r * 0.08);

      const ripGrad = ctx.createRadialGradient(rx, ry, 0, rx, ry, rr);
      ripGrad.addColorStop(0, `rgba(${coreRgb}, 0.45)`);
      ripGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');

      ctx.fillStyle = ripGrad;
      ctx.beginPath();
      ctx.arc(rx, ry, rr, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // 5. Dynamic 3D Fresnel Rim Glow (Edge lighting on glass boundary)
    ctx.save();
    ctx.strokeStyle = `rgba(${auraRgb}, ${0.85 + audioAmp * 0.15})`;
    ctx.lineWidth = 1.8;
    ctx.shadowColor = `rgba(${coreRgb}, 0.9)`;
    ctx.shadowBlur = 12 + audioAmp * 14;
    ctx.beginPath();
    ctx.arc(cx, cy, r - 0.9, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // 6. Tactile Specular Glass Glint (High-fidelity light reflection)
    const specX = cx + lightOffsetX * 0.95;
    const specY = cy + lightOffsetY * 0.95;
    const specGrad = ctx.createRadialGradient(specX, specY, 0, specX, specY, r * 0.38);
    specGrad.addColorStop(0, 'rgba(255, 255, 255, 0.85)');
    specGrad.addColorStop(0.25, `rgba(${auraRgb}, 0.45)`);
    specGrad.addColorStop(0.7, 'rgba(255, 255, 255, 0)');

    ctx.fillStyle = specGrad;
    ctx.beginPath();
    ctx.ellipse(specX, specY, r * 0.35, r * 0.22, -Math.PI / 4 + this.yaw * 0.3, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  // Draw expanding acoustic ripples during speech
  _drawShockwaves(ctx) {
    if (this.shockwaves.length === 0) return;
    const auraRgb = this.curAura.map((v) => Math.round(v)).join(', ');

    ctx.save();
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const sw = this.shockwaves[i];
      sw.r += sw.speed;
      const progress = sw.r / sw.maxR;
      const alpha = sw.alpha * (1 - progress);

      if (progress >= 1 || alpha <= 0.01) {
        this.shockwaves.splice(i, 1);
        continue;
      }

      ctx.strokeStyle = `rgba(${auraRgb}, ${alpha})`;
      ctx.lineWidth = Math.max(0.8, (1 - progress) * 2.2);
      ctx.beginPath();
      // Elliptical shockwave oriented in 3D perspective
      ctx.ellipse(this.cx, this.cy, sw.r, sw.r * 0.42, this.yaw * 0.4, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
}

window.AuroraOrb = AuroraOrb;
