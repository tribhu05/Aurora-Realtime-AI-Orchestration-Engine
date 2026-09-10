// client/orb.js
// Production 10/10 WebGL Shader Aurora Orb Visualizer
// Real-time GPU Volumetric Fluid Plasma Ribbon & Celestial Dotted Orbits
// Crafted to match the reference Robin UI design:
// - Deep midnight obsidian glass sphere with 3D ray-sphere geometry
// - Volumetric fluid aurora plasma ribbon with smooth S-curve flow (electric blue, cyan, vibrant purple/violet)
// - ACES filmic tonemapping for rich, cinematic light blending without clipping
// - Razor-sharp 3D Fresnel refraction & cursor-driven specular highlight
// - Dual inclined 3D celestial dotted orbital rings with smooth depth occlusion
// - Inertia-damped 3D pointer parallax (pitch & yaw)
// - State-driven reactivity (Idle, Listening, Thinking, Speaking, Error, Offline)
// - Smooth Canvas2D fallback if WebGL is unavailable

const THEME_PALETTES = {
  aurora: {
    idle: {
      core: [0.005, 0.012, 0.03],     // Deep Midnight Obsidian Base
      ribbonA: [0.50, 0.72, 1.0],      // Light variant #7fb8ff
      ribbonB: [0.31, 0.55, 1.0],      // Accent Blue #4f8bff
      ribbonC: [0.655, 0.545, 0.98],   // Accent Violet #a78bfa
      rim: [0.50, 0.72, 1.0],          // Crisp Glint #7fb8ff
      aura: [0.31, 0.55, 1.0],         // Ambient Aura #4f8bff
    },
    listening: {
      core: [0.004, 0.018, 0.04],
      ribbonA: [0.29, 0.87, 0.50],     // Success Green #4ade80
      ribbonB: [0.31, 0.55, 1.0],      // Accent Blue #4f8bff
      ribbonC: [0.655, 0.545, 0.98],   // Accent Violet #a78bfa
      rim: [0.29, 0.87, 0.50],
      aura: [0.20, 0.75, 0.60],
    },
    thinking: {
      core: [0.02, 0.01, 0.04],
      ribbonA: [0.85, 0.45, 0.98],     // Shimmer Violet
      ribbonB: [0.655, 0.545, 0.98],   // Accent Violet #a78bfa
      ribbonC: [0.45, 0.65, 1.0],      // Soft Electric Blue
      rim: [0.85, 0.60, 1.0],
      aura: [0.55, 0.35, 0.90],
    },
    speaking: {
      core: [0.005, 0.015, 0.04],
      ribbonA: [0.31, 0.55, 1.0],      // Accent Blue #4f8bff
      ribbonB: [0.50, 0.72, 1.0],      // Light variant #7fb8ff
      ribbonC: [0.655, 0.545, 0.98],   // Accent Violet #a78bfa
      rim: [0.50, 0.72, 1.0],
      aura: [0.31, 0.55, 1.0],
    },
    error: {
      core: [0.08, 0.02, 0.03],
      ribbonA: [1.0, 0.35, 0.35],
      ribbonB: [0.95, 0.18, 0.22],
      ribbonC: [1.0, 0.55, 0.25],
      rim: [1.0, 0.65, 0.65],
      aura: [0.75, 0.12, 0.12],
    },
    offline: {
      core: [0.02, 0.03, 0.05],
      ribbonA: [0.35, 0.42, 0.52],
      ribbonB: [0.22, 0.3, 0.38],
      ribbonC: [0.48, 0.55, 0.65],
      rim: [0.45, 0.52, 0.62],
      aura: [0.14, 0.18, 0.25],
    },
  },
};

// WebGL Vertex Shader (Full-screen render quad)
const VS_SOURCE = `
attribute vec2 a_position;
varying vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

// WebGL Fragment Shader (Raymarched Volumetric Fluid Ribbon + Dual Celestial Dotted Orbits + ACES Tonemapping)
const FS_SOURCE = `
precision highp float;
varying vec2 v_uv;

uniform vec2 u_resolution;
uniform float u_time;
uniform vec2 u_mouse;
uniform float u_audioAmp;
uniform float u_stateSpeed;
uniform vec3 u_core;
uniform vec3 u_ribbonA;
uniform vec3 u_ribbonB;
uniform vec3 u_ribbonC;
uniform vec3 u_rim;
uniform vec3 u_aura;

// ACES Filmic Tonemapping for smooth color gradients without blown-out clipping
vec3 aces(vec3 x) {
  const float a = 2.51;
  const float b = 0.03;
  const float c = 2.43;
  const float d = 0.59;
  const float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

// 2D Rotation Matrix
mat2 rot2D(float a) {
  float c = cos(a);
  float s = sin(a);
  return mat2(c, -s, s, c);
}

// 3D Simplex Gradient Noise for subtle organic fluid micro-undulations
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);

  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);

  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;

  i = mod289(i);
  vec4 p = permute(permute(permute(
             i.z + vec4(0.0, i1.z, i2.z, 1.0))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0));

  vec3 ns = 0.142857142857 * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);

  vec4 x = x_ *ns.x + ns.yyyy;
  vec4 y = y_ *ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);

  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);

  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));

  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;

  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);

  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;

  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}

// Ray-Sphere intersection
bool intersectSphere(vec3 ro, vec3 rd, float r, out float t0, out float t1) {
  float b = dot(ro, rd);
  float c = dot(ro, ro) - r * r;
  float h = b * b - c;
  if (h < 0.0) return false;
  h = sqrt(h);
  t0 = -b - h;
  t1 = -b + h;
  return true;
}

void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * u_resolution.xy) / min(u_resolution.x, u_resolution.y);

  // Camera Setup & Inertia-damped Pointer Parallax
  vec3 ro = vec3(0.0, 0.0, 3.2);
  vec3 rd = normalize(vec3(p, -2.0));

  ro.yz = rot2D(-u_mouse.y * 0.35) * ro.yz;
  rd.yz = rot2D(-u_mouse.y * 0.35) * rd.yz;
  ro.xz = rot2D(u_mouse.x * 0.35) * ro.xz;
  rd.xz = rot2D(u_mouse.x * 0.35) * rd.xz;

  // Sphere Geometry & Living Pulse
  float breath = sin(u_time * 1.5) * 0.012;
  float sphereR = 0.58 + breath + u_audioAmp * 0.05;

  float t0 = 0.0, t1 = 0.0;
  bool hitSphere = intersectSphere(ro, rd, sphereR, t0, t1);

  // 1. Atmospheric Diffuse Nebula Glow (seamlessly disperses into the midnight dark canvas)
  float dScreen = length(p);
  float bgGlow = 0.034 / (dScreen * dScreen * 4.6 + 0.11);
  vec3 finalColor = u_aura * bgGlow * (0.85 + u_audioAmp * 0.4);

  // 2. CELESTIAL DOTTED ORBITAL RINGS (Evaluated in 3D Space)
  // Orbit 1: Tilted downward from upper-left to bottom-right (Cyan Stardust)
  vec3 ringFront1 = vec3(0.0);
  vec3 ringBehind1 = vec3(0.0);
  vec3 n1 = normalize(vec3(0.55, 0.78, 0.30));
  float denom1 = dot(rd, n1);
  if (abs(denom1) > 0.0001) {
    float tP1 = -dot(ro, n1) / denom1;
    if (tP1 > 0.0) {
      vec3 hit1 = ro + tP1 * rd;
      vec3 uAxis1 = normalize(cross(n1, vec3(0.0, 1.0, 0.0)));
      vec3 vAxis1 = cross(n1, uAxis1);
      vec2 planeP1 = vec2(dot(hit1, uAxis1), dot(hit1, vAxis1));
      float ringR1 = sphereR * 1.56;
      float dRing1 = abs(length(planeP1) - ringR1);

      if (dRing1 < 0.065) {
        float angle1 = atan(planeP1.y, planeP1.x) + u_time * 0.22 * u_stateSpeed;
        float numDots1 = 46.0;
        float sector1 = 6.2831853 / numDots1;
        float nearest1 = floor(angle1 / sector1 + 0.5) * sector1;
        vec2 dotCenter1 = ringR1 * vec2(cos(nearest1), sin(nearest1));
        float distDot1 = length(planeP1 - dotCenter1);

        // Stardust bead size & intensity
        float dotSz1 = 0.0075 + 0.003 * sin(nearest1 * 4.0 + u_time * 2.0);
        float dotCore1 = smoothstep(dotSz1, dotSz1 * 0.15, distDot1);
        float dotHalo1 = 0.00012 / (distDot1 * distDot1 + 0.00006);
        float dotLum1 = dotCore1 * 1.4 + dotHalo1 * 0.4;

        // Traveling starlight pulse node
        float beaconAng1 = u_time * 0.65 * u_stateSpeed;
        vec2 beaconP1 = ringR1 * vec2(cos(beaconAng1), sin(beaconAng1));
        float distBeacon1 = length(planeP1 - beaconP1);
        float beaconHalo1 = 0.0008 / (distBeacon1 * distBeacon1 + 0.00025);

        vec3 dotCol1 = mix(u_ribbonA, vec3(1.0), 0.65);
        vec3 light1 = dotCol1 * dotLum1 + vec3(0.85, 0.95, 1.0) * beaconHalo1 * 1.2;

        if (hitSphere && tP1 > t0) {
          ringBehind1 = light1 * 0.14; // Dimmed behind obsidian glass
        } else {
          ringFront1 = light1;
        }
      }
    }
  }

  // Orbit 2: Opposing Inclination (Violet Stardust)
  vec3 ringFront2 = vec3(0.0);
  vec3 ringBehind2 = vec3(0.0);
  vec3 n2 = normalize(vec3(-0.62, 0.74, -0.32));
  float denom2 = dot(rd, n2);
  if (abs(denom2) > 0.0001) {
    float tP2 = -dot(ro, n2) / denom2;
    if (tP2 > 0.0) {
      vec3 hit2 = ro + tP2 * rd;
      vec3 uAxis2 = normalize(cross(n2, vec3(0.0, 1.0, 0.0)));
      vec3 vAxis2 = cross(n2, uAxis2);
      vec2 planeP2 = vec2(dot(hit2, uAxis2), dot(hit2, vAxis2));
      float ringR2 = sphereR * 1.68;
      float dRing2 = abs(length(planeP2) - ringR2);

      if (dRing2 < 0.065) {
        float angle2 = atan(planeP2.y, planeP2.x) - u_time * 0.25 * u_stateSpeed;
        float numDots2 = 50.0;
        float sector2 = 6.2831853 / numDots2;
        float nearest2 = floor(angle2 / sector2 + 0.5) * sector2;
        vec2 dotCenter2 = ringR2 * vec2(cos(nearest2), sin(nearest2));
        float distDot2 = length(planeP2 - dotCenter2);

        float dotSz2 = 0.007 + 0.003 * cos(nearest2 * 3.0 - u_time * 1.8);
        float dotCore2 = smoothstep(dotSz2, dotSz2 * 0.15, distDot2);
        float dotHalo2 = 0.0001 / (distDot2 * distDot2 + 0.00006);
        float dotLum2 = dotCore2 * 1.3 + dotHalo2 * 0.35;

        float beaconAng2 = -u_time * 0.72 * u_stateSpeed;
        vec2 beaconP2 = ringR2 * vec2(cos(beaconAng2), sin(beaconAng2));
        float distBeacon2 = length(planeP2 - beaconP2);
        float beaconHalo2 = 0.0007 / (distBeacon2 * distBeacon2 + 0.00025);

        vec3 dotCol2 = mix(u_ribbonC, vec3(1.0), 0.65);
        vec3 light2 = dotCol2 * dotLum2 + vec3(0.95, 0.85, 1.0) * beaconHalo2 * 1.1;

        if (hitSphere && tP2 > t0) {
          ringBehind2 = light2 * 0.14; // Dimmed behind obsidian glass
        } else {
          ringFront2 = light2;
        }
      }
    }
  }

  // Add behind-sphere starlight into background accumulation
  finalColor += ringBehind1 + ringBehind2;

  // 3. 3D VOLUMETRIC SPHERE & SILKY FLUID AURORA PLASMA RIBBON
  if (hitSphere) {
    vec3 pEntry = ro + t0 * rd;
    vec3 norm = normalize(pEntry);

    // Glass Fresnel Rim Reflection (Cyan on bottom-left, Violet on top-right)
    float rimAngle = dot(norm.xy, normalize(vec2(1.0, 0.9)));
    vec3 rimTone = mix(u_ribbonA, u_ribbonC, rimAngle * 0.5 + 0.5);
    float fresnel = pow(1.0 - max(0.0, dot(norm, -rd)), 3.5);
    vec3 rimGlow = rimTone * fresnel * 2.2;

    // Glass Specular Sheen (Curved highlight along upper glass curvature)
    vec3 lightDir = normalize(vec3(-0.35 + u_mouse.x * 0.25, 0.65 - u_mouse.y * 0.25, 0.85));
    vec3 halfVec = normalize(lightDir - rd);
    float specCurved = pow(max(0.0, dot(norm, halfVec)), 32.0) * 0.45;
    float specGlint = pow(max(0.0, dot(norm, halfVec)), 110.0) * 0.85;
    vec3 specularGlint = vec3(1.0) * (specCurved + specGlint);

    // Volumetric Raymarching of the Silk Plasma Ribbon (34 steps)
    const int STEPS = 34;
    float stepSize = (t1 - t0) / float(STEPS);
    vec3 accumColor = vec3(0.0);
    float accumAlpha = 0.0;

    float fluidTime = u_time * 0.45 * u_stateSpeed;

    for (int i = 0; i < STEPS; i++) {
      float tCurrent = t0 + (float(i) + 0.5) * stepSize;
      vec3 pos = ro + tCurrent * rd;

      // Cosmic rotation of the fluid ribbon
      vec3 pRot = pos;
      pRot.xz = rot2D(fluidTime * 0.8) * pRot.xz;
      pRot.yz = rot2D(fluidTime * 0.3) * pRot.yz;

      // Smooth Elegant S-Curve Fluid Ribbon Equation
      float wave = sin(pRot.x * 2.2 + pRot.z * 1.5 + fluidTime) * 0.26 +
                   cos(pRot.x * 1.3 - pRot.z * 1.9 - fluidTime * 0.7) * 0.14;
      float noiseWave = snoise(pRot * 2.0 + vec3(0.0, fluidTime * 0.35, 0.0)) * 0.07;
      float dRibbon = abs(pRot.y - wave - noiseWave);

      // Soft silk volume density
      float density = exp(-dRibbon * dRibbon * 55.0);

      // Hot luminous central filament/spine
      float spine = exp(-dRibbon * dRibbon * 320.0);

      // Radial confinement within sphere
      float rPos = length(pos);
      float radialFade = smoothstep(sphereR * 0.96, sphereR * 0.65, rPos);

      // Color Gradient along the ribbon:
      // Electric Blue & Cyan (bottom-left) -> Royal Indigo -> Amethyst & Lavender (top-right)
      float colorPos = clamp((pRot.x + pRot.y * 0.7) * 1.1 + 0.5, 0.0, 1.0);
      vec3 colCyanBlue = mix(u_ribbonB, u_ribbonA, smoothstep(0.0, 0.5, colorPos));
      vec3 colViolet = mix(u_ribbonA, u_ribbonC, smoothstep(0.4, 1.0, colorPos));
      vec3 ribbonCol = mix(colCyanBlue, colViolet, colorPos);

      // Add hot celestial white core to filament
      vec3 spineColor = mix(vec3(0.85, 0.96, 1.0), vec3(1.0, 0.92, 1.0), colorPos);
      ribbonCol += spineColor * spine * 0.95;

      float stepDensity = (density * 0.6 + spine * 0.4) * radialFade * (0.95 + u_audioAmp * 0.55);
      float stepAlpha = clamp(stepDensity * stepSize * 7.2, 0.0, 1.0);

      accumColor += (1.0 - accumAlpha) * ribbonCol * stepAlpha;
      accumAlpha += (1.0 - accumAlpha) * stepAlpha;
      if (accumAlpha >= 0.95) break;
    }

    // Deep Obsidian Core Base: translucent, dark cavernous interior
    vec3 obsidianBase = u_core * 0.4;
    vec3 sphereColor = obsidianBase + accumColor + rimGlow + specularGlint;

    // Subpixel Anti-Aliased Edge Blending
    float dRay = length(cross(ro, rd));
    float edgeAA = smoothstep(sphereR + 0.003, sphereR - 0.003, dRay);

    finalColor = mix(finalColor, sphereColor, edgeAA);
  }

  // 4. Composite In-Front Celestial Orbital Rings
  finalColor += ringFront1 + ringFront2;

  // 5. ACES Filmic Tonemapping for smooth cinematic gradients
  finalColor = aces(finalColor);

  gl_FragColor = vec4(finalColor, 1.0);
}
`;

class AuroraOrb {
  constructor(canvas, player) {
    this.canvas = canvas;
    this.player = player;
    this.state = 'idle'; // idle | listening | thinking | speaking | error | offline
    this.micLevel = 0;
    this.palette = THEME_PALETTES.aurora;

    // Smooth Color Interpolation State
    const initColors = this.palette.idle;
    this.colors = {
      core: [...initColors.core],
      ribbonA: [...initColors.ribbonA],
      ribbonB: [...initColors.ribbonB],
      ribbonC: [...initColors.ribbonC],
      rim: [...initColors.rim],
      aura: [...initColors.aura],
    };

    // Inertia Dynamics
    this.targetPitch = 0;
    this.targetYaw = 0;
    this.pitch = 0;
    this.yaw = 0;

    // Simulation Timing
    this.t = 0;
    this.animId = null;
    this.dpr = 1;

    // Try WebGL Initialization
    this.isWebGL = this._initWebGL();
    if (!this.isWebGL) {
      console.warn('AuroraOrb: WebGL unavailable, falling back to 2D canvas.');
      this.ctx = canvas ? canvas.getContext('2d') : null;
    }

    this._resize();
    this._bindEvents();
    this.start();
  }

  _initWebGL() {
    if (!this.canvas) return false;
    const gl =
      this.canvas.getContext('webgl2', { alpha: true, antialias: true, premultipliedAlpha: false }) ||
      this.canvas.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: false });

    if (!gl) return false;
    this.gl = gl;

    // Compile Shaders
    const vs = this._compileShader(gl.VERTEX_SHADER, VS_SOURCE);
    const fs = this._compileShader(gl.FRAGMENT_SHADER, FS_SOURCE);
    if (!vs || !fs) return false;

    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);

    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error('Shader link error:', gl.getProgramInfoLog(prog));
      return false;
    }

    this.program = prog;
    gl.useProgram(prog);

    // Full-screen Quad Geometry
    const quadVertices = new Float32Array([
      -1, -1,
       1, -1,
      -1,  1,
      -1,  1,
       1, -1,
       1,  1,
    ]);

    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, quadVertices, gl.STATIC_DRAW);

    const aPos = gl.getAttribLocation(prog, 'a_position');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    // Cache Uniform Locations
    this.uRes = gl.getUniformLocation(prog, 'u_resolution');
    this.uTime = gl.getUniformLocation(prog, 'u_time');
    this.uMouse = gl.getUniformLocation(prog, 'u_mouse');
    this.uAudioAmp = gl.getUniformLocation(prog, 'u_audioAmp');
    this.uStateSpeed = gl.getUniformLocation(prog, 'u_stateSpeed');
    this.uCore = gl.getUniformLocation(prog, 'u_core');
    this.uRibbonA = gl.getUniformLocation(prog, 'u_ribbonA');
    this.uRibbonB = gl.getUniformLocation(prog, 'u_ribbonB');
    this.uRibbonC = gl.getUniformLocation(prog, 'u_ribbonC');
    this.uRim = gl.getUniformLocation(prog, 'u_rim');
    this.uAura = gl.getUniformLocation(prog, 'u_aura');

    return true;
  }

  _compileShader(type, src) {
    const gl = this.gl;
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error('GLSL compile error:', gl.getShaderInfoLog(s));
      gl.deleteShader(s);
      return null;
    }
    return s;
  }

  _bindEvents() {
    window.addEventListener('resize', () => this._resize(), { passive: true });

    window.addEventListener(
      'mousemove',
      (e) => {
        const cx = window.innerWidth / 2;
        const cy = window.innerHeight / 2;
        this.targetYaw = Math.max(-0.6, Math.min(0.6, (e.clientX - cx) * 0.0007));
        this.targetPitch = Math.max(-0.45, Math.min(0.45, -(e.clientY - cy) * 0.0007));
      },
      { passive: true }
    );
  }

  setState(nextState) {
    if (this.palette[nextState]) {
      this.state = nextState;
    } else {
      this.state = 'idle';
    }
  }

  setMicLevel(val) {
    this.micLevel = Math.max(0, Math.min(1, val));
  }

  setTheme() {
    // Retain API compatibility
  }

  _resize() {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);

    const w = rect.width || 380;
    const h = rect.height || 380;
    this.width = w;
    this.height = h;

    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);

    if (this.isWebGL && this.gl) {
      this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    } else if (this.ctx) {
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
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
    const isReduced = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.t += isReduced ? 0.002 : 0.022;

    // Smooth Color Transition
    const targetTheme = this.palette[this.state] || this.palette.idle;
    const lerpSpeed = 0.065;
    for (const key of ['core', 'ribbonA', 'ribbonB', 'ribbonC', 'rim', 'aura']) {
      const cur = this.colors[key];
      const tgt = targetTheme[key];
      if (cur && tgt) {
        for (let i = 0; i < 3; i++) {
          cur[i] += (tgt[i] - cur[i]) * lerpSpeed;
        }
      }
    }

    // Inertia spring damping on parallax
    this.pitch += (this.targetPitch - this.pitch) * 0.06;
    this.yaw += (this.targetYaw - this.yaw) * 0.06;

    // Audio Reactivity
    let audioAmp = 0;
    if (this.state === 'speaking' && this.player) {
      audioAmp = Math.max(0, Math.min(1, this.player.getLevel() * 1.4));
    } else if (this.state === 'listening') {
      audioAmp = Math.max(0, Math.min(1, this.micLevel * 0.85 + Math.sin(this.t * 3.5) * 0.05 + 0.04));
    } else if (this.state === 'thinking') {
      audioAmp = 0.25 + Math.sin(this.t * 5.2) * 0.14;
    }

    // State Speed Multiplier
    const speedMult =
      this.state === 'thinking'
        ? 2.6
        : this.state === 'listening'
          ? 1.4
          : this.state === 'speaking'
            ? 1.6 + audioAmp * 1.2
            : 1.0;

    if (this.isWebGL && this.gl && this.program) {
      this._drawWebGL(audioAmp, speedMult);
    } else if (this.ctx) {
      this._draw2DFallback(audioAmp, speedMult);
    }
  }

  _drawWebGL(audioAmp, speedMult) {
    const gl = this.gl;
    gl.useProgram(this.program);

    gl.uniform2f(this.uRes, this.canvas.width, this.canvas.height);
    gl.uniform1f(this.uTime, this.t);
    gl.uniform2f(this.uMouse, this.yaw, this.pitch);
    gl.uniform1f(this.uAudioAmp, audioAmp);
    gl.uniform1f(this.uStateSpeed, speedMult);

    gl.uniform3fv(this.uCore, this.colors.core);
    gl.uniform3fv(this.uRibbonA, this.colors.ribbonA);
    gl.uniform3fv(this.uRibbonB, this.colors.ribbonB);
    gl.uniform3fv(this.uRibbonC, this.colors.ribbonC);
    gl.uniform3fv(this.uRim, this.colors.rim);
    gl.uniform3fv(this.uAura, this.colors.aura);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  // Graceful 2D Canvas Fallback
  _draw2DFallback(audioAmp, speedMult) {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    const cx = w / 2;
    const cy = h / 2;
    const r = Math.min(w, h) * 0.28 + audioAmp * 10;

    ctx.clearRect(0, 0, w, h);

    // Deep Atmospheric Nebula Glow
    const auraGrad = ctx.createRadialGradient(cx, cy, r * 0.3, cx, cy, r * 2.3);
    auraGrad.addColorStop(0, 'rgba(18, 70, 180, 0.28)');
    auraGrad.addColorStop(0.6, 'rgba(7, 24, 72, 0.12)');
    auraGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = auraGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 2.3, 0, Math.PI * 2);
    ctx.fill();

    // Dotted Ring 1 (2D)
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(0.38 + this.yaw * 0.2);
    ctx.scale(1, 0.42);
    ctx.strokeStyle = 'rgba(0, 217, 255, 0.45)';
    ctx.setLineDash([3, 7]);
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.55, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // Dotted Ring 2 (2D)
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-0.45 - this.pitch * 0.2);
    ctx.scale(1, 0.38);
    ctx.strokeStyle = 'rgba(199, 89, 255, 0.45)';
    ctx.setLineDash([3, 8]);
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.68, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // Dark Obsidian Sphere Body
    const bodyGrad = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r);
    bodyGrad.addColorStop(0, 'rgba(12, 28, 64, 0.95)');
    bodyGrad.addColorStop(0.7, 'rgba(4, 9, 22, 0.98)');
    bodyGrad.addColorStop(1, 'rgba(2, 5, 14, 1.0)');
    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    // Fluid S-Curve Ribbon (2D approximation)
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.95, 0, Math.PI * 2);
    ctx.clip();

    ctx.lineWidth = 16 + audioAmp * 8;
    const ribbonGrad = ctx.createLinearGradient(cx - r * 0.7, cy + r * 0.5, cx + r * 0.7, cy - r * 0.5);
    ribbonGrad.addColorStop(0, '#00d9ff');
    ribbonGrad.addColorStop(0.45, '#1461fa');
    ribbonGrad.addColorStop(1, '#c759ff');
    ctx.strokeStyle = ribbonGrad;
    ctx.lineCap = 'round';

    ctx.beginPath();
    const t = this.t * speedMult;
    const x0 = cx - r * 0.75, y0 = cy + r * 0.35 + Math.sin(t) * 8;
    const cp1x = cx - r * 0.2, cp1y = cy - r * 0.55 + Math.cos(t * 1.2) * 12;
    const cp2x = cx + r * 0.2, cp2y = cy + r * 0.45 + Math.sin(t * 1.1) * 12;
    const x1 = cx + r * 0.75, y1 = cy - r * 0.35 + Math.cos(t) * 8;
    ctx.moveTo(x0, y0);
    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x1, y1);
    ctx.stroke();

    // Luminous White Core Spine
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.stroke();
    ctx.restore();

    // Glass Rim Fresnel Glint
    ctx.strokeStyle = 'rgba(0, 217, 255, 0.85)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }
}

window.AuroraOrb = AuroraOrb;



