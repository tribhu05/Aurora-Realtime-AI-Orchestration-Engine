// client/viewer-3d.js
// Interactive 3D object visualizer for Aurora assistant cards.
// Supports rotating procedural 3D geometric meshes (Torus Knot, Icosahedron, Wave Surface, DNA Double Helix, Hypercube).

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Aurora3DViewer = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function escapeHtml(s) {
    return String(s).replace(
      /[&<>"']/g,
      (c) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[c]
    );
  }

  // Procedural 3D Mesh Generators
  const MESH_GENERATORS = {
    torusKnot: function (p = 2, q = 3, tubeRadius = 0.35, segmentsR = 80, segmentsT = 16) {
      const vertices = [];
      const faces = [];
      for (let i = 0; i <= segmentsR; i++) {
        const u = (i / segmentsR) * Math.PI * 2 * p;
        const r = 1.2 + 0.6 * Math.cos((q / p) * u);
        const x = r * Math.cos(u);
        const y = r * Math.sin(u);
        const z = -0.7 * Math.sin((q / p) * u);

        // Next point for tangent
        const uNext = u + 0.01;
        const rNext = 1.2 + 0.6 * Math.cos((q / p) * uNext);
        const tx = rNext * Math.cos(uNext) - x;
        const ty = rNext * Math.sin(uNext) - y;
        const tz = -0.7 * Math.sin((q / p) * uNext) - z;
        const tLen = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1;
        const T = [tx / tLen, ty / tLen, tz / tLen];

        // Normal and Binormal
        const N = [-T[1], T[0], 0];
        const nLen = Math.sqrt(N[0] * N[0] + N[1] * N[1]) || 1;
        N[0] /= nLen;
        N[1] /= nLen;
        const B = [T[1] * N[2] - T[2] * N[1], T[2] * N[0] - T[0] * N[2], T[0] * N[1] - T[1] * N[0]];

        for (let j = 0; j < segmentsT; j++) {
          const v = (j / segmentsT) * Math.PI * 2;
          const cx = Math.cos(v) * tubeRadius;
          const cy = Math.sin(v) * tubeRadius;
          vertices.push([
            x + cx * N[0] + cy * B[0],
            y + cx * N[1] + cy * B[1],
            z + cx * N[2] + cy * B[2],
          ]);
        }
      }

      for (let i = 0; i < segmentsR; i++) {
        for (let j = 0; j < segmentsT; j++) {
          const a = i * segmentsT + j;
          const b = (i + 1) * segmentsT + j;
          const c = (i + 1) * segmentsT + ((j + 1) % segmentsT);
          const d = i * segmentsT + ((j + 1) % segmentsT);
          faces.push([a, b, c]);
          faces.push([a, c, d]);
        }
      }
      return { vertices, faces, title: 'Torus Knot (p=2, q=3)' };
    },

    dnaHelix: function (strands = 24, radius = 1.0, height = 3.2) {
      const vertices = [];
      const lines = [];
      const turns = 2.5;

      for (let i = 0; i <= strands; i++) {
        const t = i / strands;
        const angle = t * Math.PI * 2 * turns;
        const y = (t - 0.5) * height;
        const x1 = Math.cos(angle) * radius;
        const z1 = Math.sin(angle) * radius;
        const x2 = Math.cos(angle + Math.PI) * radius;
        const z2 = Math.sin(angle + Math.PI) * radius;

        const idx1 = vertices.length;
        vertices.push([x1, y, z1]);
        const idx2 = vertices.length;
        vertices.push([x2, y, z2]);

        // Base-pair rung
        lines.push([idx1, idx2]);
        if (i > 0) {
          lines.push([idx1 - 2, idx1]);
          lines.push([idx2 - 2, idx2]);
        }
      }
      return { vertices, lines, title: 'DNA Double Helix' };
    },

    waveSurface: function (grid = 18, size = 2.4) {
      const vertices = [];
      const faces = [];
      const step = size / grid;
      const offset = size / 2;

      for (let i = 0; i <= grid; i++) {
        for (let j = 0; j <= grid; j++) {
          const x = i * step - offset;
          const z = j * step - offset;
          const dist = Math.sqrt(x * x + z * z);
          const y = Math.sin(dist * 3.5) * 0.45 * Math.exp(-dist * 0.6);
          vertices.push([x, y, z]);
        }
      }

      const rowLen = grid + 1;
      for (let i = 0; i < grid; i++) {
        for (let j = 0; j < grid; j++) {
          const a = i * rowLen + j;
          const b = (i + 1) * rowLen + j;
          const c = (i + 1) * rowLen + (j + 1);
          const d = i * rowLen + (j + 1);
          faces.push([a, b, c]);
          faces.push([a, c, d]);
        }
      }
      return { vertices, faces, title: 'Quantum Wave Surface' };
    },

    icosahedron: function (radius = 1.4) {
      const t = (1.0 + Math.sqrt(5.0)) / 2.0;
      const rawVerts = [
        [-1, t, 0],
        [1, t, 0],
        [-1, -t, 0],
        [1, -t, 0],
        [0, -1, t],
        [0, 1, t],
        [0, -1, -t],
        [0, 1, -t],
        [t, 0, -1],
        [t, 0, 1],
        [-t, 0, -1],
        [-t, 0, 1],
      ];

      const vertices = rawVerts.map((v) => {
        const len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
        return [(v[0] / len) * radius, (v[1] / len) * radius, (v[2] / len) * radius];
      });

      const faces = [
        [0, 11, 5],
        [0, 5, 1],
        [0, 1, 7],
        [0, 7, 10],
        [0, 10, 11],
        [1, 5, 9],
        [5, 11, 4],
        [11, 10, 2],
        [10, 7, 6],
        [7, 1, 8],
        [3, 9, 4],
        [3, 4, 2],
        [3, 2, 6],
        [3, 6, 8],
        [3, 8, 9],
        [4, 9, 5],
        [2, 4, 11],
        [6, 2, 10],
        [8, 6, 7],
        [9, 8, 1],
      ];
      return { vertices, faces, title: 'Geodesic Icosahedron' };
    },
  };

  class Interactive3DInstance {
    constructor(canvas, type = 'torusKnot') {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.type = type;
      this.mesh = (MESH_GENERATORS[type] || MESH_GENERATORS.torusKnot)();

      this.rotX = 0.3;
      this.rotY = 0.5;
      this.rotZ = 0;
      this.zoom = 120;
      this.autoRotate = true;
      this.isWireframe = false;

      this.isDragging = false;
      this.lastMouseX = 0;
      this.lastMouseY = 0;
      this.animId = null;

      this._resize();
      this._bind();
      this.start();
    }

    _resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = this.canvas.getBoundingClientRect();
      const w = rect.width || 420;
      const h = rect.height || 260;
      this.canvas.width = w * dpr;
      this.canvas.height = h * dpr;
      this.width = w;
      this.height = h;
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.zoom = Math.min(w, h) * 0.38;
    }

    _bind() {
      const c = this.canvas;
      c.addEventListener('mousedown', (e) => {
        this.isDragging = true;
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
      });

      window.addEventListener('mousemove', (e) => {
        if (!this.isDragging) return;
        const dx = e.clientX - this.lastMouseX;
        const dy = e.clientY - this.lastMouseY;
        this.rotY += dx * 0.012;
        this.rotX += dy * 0.012;
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
      });

      window.addEventListener('mouseup', () => {
        this.isDragging = false;
      });

      c.addEventListener(
        'wheel',
        (e) => {
          e.preventDefault();
          this.zoom *= e.deltaY > 0 ? 0.94 : 1.06;
          this.zoom = Math.max(40, Math.min(300, this.zoom));
        },
        { passive: false }
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
      const ctx = this.ctx;
      ctx.clearRect(0, 0, this.width, this.height);

      if (this.autoRotate && !this.isDragging) {
        this.rotY += 0.015;
        this.rotX += 0.006;
      }

      const cx = this.width / 2;
      const cy = this.height / 2;

      // Rotation matrix precomputations
      const cosX = Math.cos(this.rotX);
      const sinX = Math.sin(this.rotX);
      const cosY = Math.cos(this.rotY);
      const sinY = Math.sin(this.rotY);

      const transformed = this.mesh.vertices.map((v) => {
        // Yaw (Y)
        const x1 = v[0] * cosY + v[2] * sinY;
        const y1 = v[1];
        const z1 = -v[0] * sinY + v[2] * cosY;

        // Pitch (X)
        const x2 = x1;
        const y2 = y1 * cosX - z1 * sinX;
        const z2 = y1 * sinX + z1 * cosX;

        // Perspective
        const dist = 4.2;
        const sz = z2 + dist;
        const k = (this.zoom * dist) / Math.max(0.2, sz);

        return {
          sx: cx + x2 * k,
          sy: cy + y2 * k,
          z: z2,
        };
      });

      // Render faces (if mesh has faces)
      if (this.mesh.faces && !this.isWireframe) {
        // Sort faces by depth
        const sortedFaces = this.mesh.faces
          .map((f) => {
            const zAvg = (transformed[f[0]].z + transformed[f[1]].z + transformed[f[2]].z) / 3;
            return { face: f, z: zAvg };
          })
          .sort((a, b) => b.z - a.z);

        sortedFaces.forEach(({ face }) => {
          const p0 = transformed[face[0]];
          const p1 = transformed[face[1]];
          const p2 = transformed[face[2]];

          // Normal & lighting
          const ux = p1.sx - p0.sx;
          const uy = p1.sy - p0.sy;
          const vx = p2.sx - p0.sx;
          const vy = p2.sy - p0.sy;
          const normalZ = ux * vy - uy * vx;

          // Backface cull
          if (normalZ <= 0) return;

          const light = Math.min(1, Math.max(0.15, normalZ / 8000 + 0.3));
          const r = Math.round(20 + light * 70);
          const g = Math.round(90 + light * 120);
          const b = Math.round(180 + light * 75);

          ctx.beginPath();
          ctx.moveTo(p0.sx, p0.sy);
          ctx.lineTo(p1.sx, p1.sy);
          ctx.lineTo(p2.sx, p2.sy);
          ctx.closePath();

          ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.82)`;
          ctx.fill();

          ctx.strokeStyle = `rgba(130, 210, 255, 0.2)`;
          ctx.lineWidth = 0.6;
          ctx.stroke();
        });
      } else if (this.mesh.faces && this.isWireframe) {
        ctx.strokeStyle = '#58bfff';
        ctx.lineWidth = 1;
        this.mesh.faces.forEach((face) => {
          const p0 = transformed[face[0]];
          const p1 = transformed[face[1]];
          const p2 = transformed[face[2]];
          ctx.beginPath();
          ctx.moveTo(p0.sx, p0.sy);
          ctx.lineTo(p1.sx, p1.sy);
          ctx.lineTo(p2.sx, p2.sy);
          ctx.closePath();
          ctx.stroke();
        });
      }

      // Render lines (e.g. DNA helix)
      if (this.mesh.lines) {
        ctx.lineWidth = 1.8;
        this.mesh.lines.forEach((line) => {
          const p0 = transformed[line[0]];
          const p1 = transformed[line[1]];
          const alpha = Math.min(1, Math.max(0.2, (p0.z + p1.z) * 0.2 + 0.6));
          ctx.strokeStyle = `rgba(88, 191, 255, ${alpha})`;
          ctx.beginPath();
          ctx.moveTo(p0.sx, p0.sy);
          ctx.lineTo(p1.sx, p1.sy);
          ctx.stroke();
        });

        // Draw nodes
        transformed.forEach((p) => {
          const radius = Math.max(1.5, 3 + p.z * 1.2);
          ctx.fillStyle = '#67e8f9';
          ctx.beginPath();
          ctx.arc(p.sx, p.sy, radius, 0, Math.PI * 2);
          ctx.fill();
        });
      }
    }
  }

  const Aurora3DViewer = {
    instances: new Map(),

    render3DCard: function ({ type = 'torusKnot', title = null } = {}) {
      const validTypes = ['torusKnot', 'dnaHelix', 'waveSurface', 'icosahedron'];
      const activeType = validTypes.includes(type) ? type : 'torusKnot';
      const meta = MESH_GENERATORS[activeType]();
      const displayTitle = title || meta.title;
      const cardId = 'viewer3d_' + Math.random().toString(36).slice(2, 9);

      return `
        <div class="aurora-3d-card" id="${cardId}" data-mesh-type="${activeType}">
          <div class="aurora-3d-header">
            <div class="aurora-3d-title">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#58bfff" stroke-width="2">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
                <line x1="12" y1="22.08" x2="12" y2="12"></line>
              </svg>
              <span>${escapeHtml(displayTitle)}</span>
            </div>
            <div class="aurora-3d-controls">
              <button class="btn-3d-ctrl btn-toggle-wireframe" title="Toggle Wireframe">Wireframe</button>
              <button class="btn-3d-ctrl btn-toggle-spin" title="Toggle Spin">Pause</button>
              <button class="btn-3d-ctrl btn-reset-cam" title="Reset View">Reset</button>
            </div>
          </div>
          <div class="aurora-3d-stage">
            <canvas class="canvas-3d-viewport"></canvas>
            <div class="stage-hint">Click & drag to rotate 3D view · Scroll to zoom</div>
          </div>
        </div>
      `;
    },

    attachHandlers: function (container = document) {
      const cards = container.querySelectorAll('.aurora-3d-card:not([data-initialized="true"])');
      cards.forEach((card) => {
        card.dataset.initialized = 'true';
        const canvas = card.querySelector('.canvas-3d-viewport');
        const meshType = card.dataset.meshType || 'torusKnot';
        if (!canvas) return;

        const instance = new Interactive3DInstance(canvas, meshType);
        Aurora3DViewer.instances.set(card.id, instance);

        const btnWireframe = card.querySelector('.btn-toggle-wireframe');
        if (btnWireframe) {
          btnWireframe.addEventListener('click', () => {
            instance.isWireframe = !instance.isWireframe;
            btnWireframe.classList.toggle('active', instance.isWireframe);
          });
        }

        const btnSpin = card.querySelector('.btn-toggle-spin');
        if (btnSpin) {
          btnSpin.addEventListener('click', () => {
            instance.autoRotate = !instance.autoRotate;
            btnSpin.textContent = instance.autoRotate ? 'Pause' : 'Play';
          });
        }

        const btnReset = card.querySelector('.btn-reset-cam');
        if (btnReset) {
          btnReset.addEventListener('click', () => {
            instance.rotX = 0.3;
            instance.rotY = 0.5;
            instance._resize();
          });
        }
      });
    },
  };

  return Aurora3DViewer;
});
