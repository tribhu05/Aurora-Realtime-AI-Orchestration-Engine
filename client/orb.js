// client/orb.js
// High-performance true 3D WebGL procedural raymarching & audio-reactive orb for Aurora.
// Reacts organically in 3D space to audio levels, pointer motion, and state transitions:
//   - idle:      Deep Cosmic Violet & Sapphire breathing aura
//   - listening: Radiant Laser Cyan with acoustic surface shockwaves
//   - thinking:  Solar Amber swirl with accelerated 3D core vorticity
//   - speaking:  Luminous Emerald & Mint plasma expanding to voice amplitude
// Gracefully falls back to optimized 2D canvas in non-WebGL environments.

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

const VERT_SHADER_SOURCE = `
  attribute vec2 position;
  varying vec2 vUv;
  void main() {
    vUv = position * 0.5 + 0.5;
    gl_Position = vec4(position, 0.0, 1.0);
  }
`;

const FRAG_SHADER_SOURCE = `
  precision highp float;
  varying vec2 vUv;
  uniform vec2 u_resolution;
  uniform float u_time;
  uniform vec3 u_coreColor;
  uniform vec3 u_outerColor;
  uniform vec3 u_auraColor;
  uniform float u_audioAmp;
  uniform vec2 u_rot;
  uniform int u_state; // 0=idle, 1=listening, 2=thinking, 3=speaking

  // 3D Simplex noise implementation
  vec4 permute(vec4 x){return mod(((x*34.0)+1.0)*x, 289.0);}
  vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314 * r;}

  float snoise(vec3 v){
    const vec2  C = vec2(1.0/6.0, 1.0/3.0);
    const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i  = floor(v + dot(v, C.yyy) );
    vec3 x0 = v - i + dot(i, C.xxx) ;
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min( g.xyz, l.zxy );
    vec3 i2 = max( g.xyz, l.zxy );
    vec3 x1 = x0 - i1 + 1.0 * C.xxx;
    vec3 x2 = x0 - i2 + 2.0 * C.xxx;
    vec3 x3 = x0 - 1.0 + 3.0 * C.xxx;
    i = mod(i, 289.0 );
    vec4 p = permute( permute( permute(
               i.z + vec4(0.0, i1.z, i2.z, 1.0 ))
             + i.y + vec4(0.0, i1.y, i2.y, 1.0 ))
             + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));
    float n_ = 0.142857142857;
    vec3  ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z *ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_ );
    vec4 x = x_ *ns.x + ns.yyyy;
    vec4 y = y_ *ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4( x.xy, y.xy );
    vec4 b1 = vec4( x.zw, y.zw );
    vec4 s0 = floor(b0)*2.0 + 1.0;
    vec4 s1 = floor(b1)*2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy ;
    vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww ;
    vec3 p0 = vec3(a0.xy,h.x);
    vec3 p1 = vec3(a0.zw,h.y);
    vec3 p2 = vec3(a1.xy,h.z);
    vec3 p3 = vec3(a1.zw,h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
    p0 *= norm.x;
    p1 *= norm.y;
    p2 *= norm.z;
    p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3) ) );
  }

  // 3D Rotation matrices
  mat3 rotateX(float theta) {
    float c = cos(theta);
    float s = sin(theta);
    return mat3(
      vec3(1.0, 0.0, 0.0),
      vec3(0.0, c, -s),
      vec3(0.0, s, c)
    );
  }

  mat3 rotateY(float theta) {
    float c = cos(theta);
    float s = sin(theta);
    return mat3(
      vec3(c, 0.0, s),
      vec3(0.0, 1.0, 0.0),
      vec3(-s, 0.0, c)
    );
  }

  mat3 rotateZ(float theta) {
    float c = cos(theta);
    float s = sin(theta);
    return mat3(
      vec3(c, -s, 0.0),
      vec3(s, c, 0.0),
      vec3(0.0, 0.0, 1.0)
    );
  }

  // 3D SDF for deformed sphere
  float mapSphere(vec3 p) {
    float breath = sin(u_time * 1.6) * 0.035;
    float baseRadius = 0.62 + breath;

    // Displacement frequency & speed based on state and audio
    float speed = u_time * (u_state == 2 ? 3.0 : 1.2);
    float noiseFreq = 2.4;
    float noiseAmp = 0.06 + u_audioAmp * 0.22;
    if (u_state == 1) { // listening
      noiseAmp += 0.05 * sin(u_time * 4.0);
      noiseFreq = 3.5;
    } else if (u_state == 2) { // thinking
      noiseAmp += 0.09;
      noiseFreq = 4.0;
    } else if (u_state == 3) { // speaking
      noiseAmp += u_audioAmp * 0.28;
    }

    float disp = snoise(p * noiseFreq + vec3(speed, speed * 0.5, speed * 0.8)) * noiseAmp;
    return length(p) - (baseRadius + disp);
  }

  // 3D Orbital Rings SDF
  float mapRings(vec3 p) {
    vec3 pR1 = rotateX(0.7) * rotateY(u_time * 0.9) * p;
    float r1 = length(vec2(length(pR1.xz) - 0.92, pR1.y)) - 0.012;

    vec3 pR2 = rotateZ(-0.55) * rotateX(u_time * -0.6) * p;
    float r2 = length(vec2(length(pR2.xz) - 1.05, pR2.y)) - 0.009;

    return min(r1, r2);
  }

  vec3 calcNormal(vec3 p) {
    vec2 e = vec2(0.002, 0.0);
    return normalize(vec3(
      mapSphere(p + e.xyy) - mapSphere(p - e.xyy),
      mapSphere(p + e.yxy) - mapSphere(p - e.yxy),
      mapSphere(p + e.yyx) - mapSphere(p - e.yyx)
    ));
  }

  void main() {
    vec2 uv = (gl_FragCoord.xy - u_resolution * 0.5) / min(u_resolution.x, u_resolution.y);

    // 3D Camera Setup
    vec3 ro = vec3(0.0, 0.0, 2.2);
    vec3 rd = normalize(vec3(uv, -1.2));

    // Interactive 3D Cursor Rotation
    mat3 rot = rotateY(u_rot.x + sin(u_time * 0.4) * 0.15) * rotateX(u_rot.y);
    ro = rot * ro;
    rd = rot * rd;

    vec4 finalColor = vec4(0.0);

    // Raymarching loop
    float t = 0.0;
    float hitSphere = -1.0;
    for (int i = 0; i < 48; i++) {
      vec3 p = ro + rd * t;
      float d = mapSphere(p);
      if (d < 0.002) {
        hitSphere = t;
        break;
      }
      t += d * 0.65;
      if (t > 4.5) break;
    }

    if (hitSphere > 0.0) {
      vec3 p = ro + rd * hitSphere;
      vec3 n = calcNormal(p);
      vec3 lightDir = normalize(vec3(0.8, 1.0, 1.2));
      vec3 viewDir = -rd;

      // 3D Diffuse & Specular
      float diff = max(dot(n, lightDir), 0.0);
      vec3 halfDir = normalize(lightDir + viewDir);
      float spec = pow(max(dot(n, halfDir), 0.0), 36.0);

      // Fresnel rim glow
      float fresnel = pow(1.0 - max(dot(n, viewDir), 0.0), 2.2);

      // Multi-layer volumetric shader coloration
      vec3 col = mix(u_outerColor, u_coreColor, diff * 0.8 + 0.2);
      col += u_auraColor * fresnel * 1.25;
      col += vec3(1.0) * spec * 0.95;

      // Internal light refraction
      float depthGlow = exp(-hitSphere * 0.5);
      col += u_coreColor * depthGlow * 0.4;

      finalColor = vec4(col, 0.96);
    } else {
      // Background glow around orb
      float dCenter = length(uv);
      float aura = exp(-dCenter * 3.4) * (0.35 + u_audioAmp * 0.55);
      finalColor = vec4(u_auraColor * aura, aura * 0.7);
    }

    // Trace 3D Rings
    float tRing = 0.0;
    for (int i = 0; i < 28; i++) {
      vec3 pR = ro + rd * tRing;
      float dR = mapRings(pR);
      if (dR < 0.005) {
        float ringGlow = 0.75 + 0.25 * sin(u_time * 2.0);
        finalColor.rgb += u_auraColor * ringGlow;
        finalColor.a = max(finalColor.a, 0.85);
        break;
      }
      tRing += dR * 0.8;
      if (tRing > 4.0) break;
    }

    gl_FragColor = finalColor;
  }
`;

class AuroraOrb {
  constructor(canvas, player) {
    this.canvas = canvas;
    this.player = player;
    this.state = 'idle'; // idle | listening | thinking | speaking
    this.micLevel = 0;
    this.currentTheme = 'aurora';
    this.palette = THEME_PALETTES.aurora;

    // Color vector interpolation (RGB 0..1)
    this.curCore = this.palette.idle.core.map((v) => v / 255);
    this.curOuter = this.palette.idle.outer.map((v) => v / 255);
    this.curAura = this.palette.idle.aura.map((v) => v / 255);

    // Interactive 3D Cursor Tracking
    this.targetRotX = 0;
    this.targetRotY = 0;
    this.rotX = 0;
    this.rotY = 0;

    this.t = 0;
    this.animId = null;

    // Try WebGL initialization
    this.isWebGL = this._initWebGL();
    if (!this.isWebGL) {
      this.ctx = canvas ? canvas.getContext('2d') : null;
    }

    this._resize();
    this._bindEvents();
    this.start();
  }

  _initWebGL() {
    if (!this.canvas) return false;
    try {
      const gl =
        this.canvas.getContext('webgl', {
          alpha: true,
          antialias: true,
          premultipliedAlpha: false,
        }) || this.canvas.getContext('experimental-webgl');
      if (!gl) return false;

      const vertShader = this._compileShader(gl, gl.VERTEX_SHADER, VERT_SHADER_SOURCE);
      const fragShader = this._compileShader(gl, gl.FRAGMENT_SHADER, FRAG_SHADER_SOURCE);
      if (!vertShader || !fragShader) return false;

      const program = gl.createProgram();
      gl.attachShader(program, vertShader);
      gl.attachShader(program, fragShader);
      gl.linkProgram(program);

      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.warn('WebGL link failed:', gl.getProgramInfoLog(program));
        return false;
      }

      this.gl = gl;
      this.program = program;

      // Fullscreen quad buffer
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
        gl.STATIC_DRAW
      );

      this.posAttr = gl.getAttribLocation(program, 'position');
      gl.enableVertexAttribArray(this.posAttr);
      gl.vertexAttribPointer(this.posAttr, 2, gl.FLOAT, false, 0, 0);

      // Uniform locations
      this.uResolution = gl.getUniformLocation(program, 'u_resolution');
      this.uTime = gl.getUniformLocation(program, 'u_time');
      this.uCoreColor = gl.getUniformLocation(program, 'u_coreColor');
      this.uOuterColor = gl.getUniformLocation(program, 'u_outerColor');
      this.uAuraColor = gl.getUniformLocation(program, 'u_auraColor');
      this.uAudioAmp = gl.getUniformLocation(program, 'u_audioAmp');
      this.uRot = gl.getUniformLocation(program, 'u_rot');
      this.uState = gl.getUniformLocation(program, 'u_state');

      return true;
    } catch (e) {
      console.warn('WebGL initialization error, falling back to 2D:', e);
      return false;
    }
  }

  _compileShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.warn('Shader compile failed:', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  _bindEvents() {
    window.addEventListener('resize', () => this._resize());

    // 3D Pointer Tracking
    window.addEventListener(
      'mousemove',
      (e) => {
        const cx = window.innerWidth / 2;
        const cy = window.innerHeight / 2;
        this.targetRotX = (e.clientX - cx) * 0.0018;
        this.targetRotY = (e.clientY - cy) * 0.0018;
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
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = rect.width || 220;
    const h = rect.height || 220;

    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.width = w;
    this.height = h;

    if (this.isWebGL && this.gl) {
      this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    } else if (this.ctx) {
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.centerX = w / 2;
      this.centerY = h / 2;
      this.baseRadius = Math.min(w, h) * 0.28;
    }
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

  draw() {
    this.t += 0.03;

    // Smooth color interpolation
    const target = this.palette[this.state] || this.palette.idle;
    const speed = 0.08;
    for (let i = 0; i < 3; i++) {
      const tc = target.core[i] / 255;
      const to = target.outer[i] / 255;
      const ta = target.aura[i] / 255;
      this.curCore[i] += (tc - this.curCore[i]) * speed;
      this.curOuter[i] += (to - this.curOuter[i]) * speed;
      this.curAura[i] += (ta - this.curAura[i]) * speed;
    }

    // Cursor inertia damping
    this.rotX += (this.targetRotX - this.rotX) * 0.06;
    this.rotY += (this.targetRotY - this.rotY) * 0.06;

    // Audio reactivity
    let audioAmp = 0;
    if (this.state === 'speaking' && this.player) {
      audioAmp = this.player.getLevel(); // 0..1
    } else if (this.state === 'listening') {
      audioAmp = this.micLevel * 0.6 + Math.sin(this.t * 2) * 0.05 + 0.05;
    }

    if (this.isWebGL && this.gl) {
      this._drawWebGL(audioAmp);
    } else if (this.ctx) {
      this._draw2DFallback(audioAmp);
    }
  }

  _drawWebGL(audioAmp) {
    const gl = this.gl;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(this.program);
    gl.uniform2f(this.uResolution, this.canvas.width, this.canvas.height);
    gl.uniform1f(this.uTime, this.t);
    gl.uniform3fv(this.uCoreColor, this.curCore);
    gl.uniform3fv(this.uOuterColor, this.curOuter);
    gl.uniform3fv(this.uAuraColor, this.curAura);
    gl.uniform1f(this.uAudioAmp, audioAmp);
    gl.uniform2f(this.uRot, this.rotX, this.rotY);

    const stateMap = { idle: 0, listening: 1, thinking: 2, speaking: 3 };
    gl.uniform1i(this.uState, stateMap[this.state] || 0);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  _draw2DFallback(audioAmp) {
    const ctx = this.ctx;
    const cx = this.centerX;
    const cy = this.centerY;
    ctx.clearRect(0, 0, this.width, this.height);

    const breath = Math.sin(this.t * 1.5) * 4;
    const currentRadius = this.baseRadius + breath + audioAmp * 32;

    const coreColor = `rgba(${Math.round(this.curCore[0] * 255)}, ${Math.round(this.curCore[1] * 255)}, ${Math.round(this.curCore[2] * 255)}, 0.95)`;
    const outerColor = `rgba(${Math.round(this.curOuter[0] * 255)}, ${Math.round(this.curOuter[1] * 255)}, ${Math.round(this.curOuter[2] * 255)}, 0.65)`;

    // Radial gradient pseudo-3D
    const sphereGrad = ctx.createRadialGradient(
      cx - currentRadius * 0.3,
      cy - currentRadius * 0.35,
      currentRadius * 0.08,
      cx,
      cy,
      currentRadius * 1.15
    );
    sphereGrad.addColorStop(0, '#ffffff');
    sphereGrad.addColorStop(0.25, coreColor);
    sphereGrad.addColorStop(0.7, outerColor);
    sphereGrad.addColorStop(1, 'rgba(0,0,0,0.9)');

    ctx.fillStyle = sphereGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, currentRadius, 0, Math.PI * 2);
    ctx.fill();
  }
}

window.AuroraOrb = AuroraOrb;
