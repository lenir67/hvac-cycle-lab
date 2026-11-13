/**
 * High-Detail Cutaway HVAC Schematic + 60fps Thermodynamic Particle & Mechanism Renderer
 * Layered SVG (1200x720) + Aligned HiDPI HTML5 Canvas
 */
(function (global) {
  'use strict';

  const RefDB = global.HVACRef;

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function smoothstep(edge0, edge1, x) {
    if (edge0 === edge1) return x < edge0 ? 0 : 1;
    const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
  }

  function parseHexRgb(hex) {
    const clean = hex.charAt(0) === '#' ? hex.slice(1) : hex;
    const num = parseInt(clean, 16);
    return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
  }

  function lerpColor(hexA, hexB, t) {
    const u = clamp(t, 0, 1);
    const a = parseHexRgb(hexA);
    const b = parseHexRgb(hexB);
    const r = Math.round(a[0] + (b[0] - a[0]) * u);
    const g = Math.round(a[1] + (b[1] - a[1]) * u);
    const bl = Math.round(a[2] + (b[2] - a[2]) * u);
    return `rgb(${r}, ${g}, ${bl})`;
  }

  function mixWithBg(colorStr, bgHex, fgWeight) {
    let r, g, b;
    if (colorStr.charAt(0) === '#') {
      [r, g, b] = parseHexRgb(colorStr);
    } else {
      const m = colorStr.match(/[\d.]+/g);
      if (!m || m.length < 3) return colorStr;
      r = Number(m[0]);
      g = Number(m[1]);
      b = Number(m[2]);
    }
    const bg = parseHexRgb(bgHex);
    const w = clamp(fgWeight, 0, 1);
    return `rgb(${Math.round(bg[0] + (r - bg[0]) * w)}, ${Math.round(bg[1] + (g - bg[1]) * w)}, ${Math.round(bg[2] + (b - bg[2]) * w)})`;
  }

  function roundPathCorners(points, radius = 16, steps = 6) {
    if (!points || points.length < 3) return points ? points.slice() : [];
    const out = [{ x: points[0].x, y: points[0].y }];
    for (let i = 1; i < points.length - 1; i++) {
      const A = points[i - 1];
      const B = points[i];
      const C = points[i + 1];
      const dx1 = A.x - B.x;
      const dy1 = A.y - B.y;
      const dx2 = C.x - B.x;
      const dy2 = C.y - B.y;
      const len1 = Math.hypot(dx1, dy1);
      const len2 = Math.hypot(dx2, dy2);
      if (len1 < 1e-3 || len2 < 1e-3) continue;
      const dot = (dx1 * dx2 + dy1 * dy2) / (len1 * len2);
      if (dot < -0.995) {
        out.push({ x: B.x, y: B.y });
        continue;
      }
      const r = Math.min(radius, len1 * 0.44, len2 * 0.44);
      const p0x = B.x + (dx1 / len1) * r;
      const p0y = B.y + (dy1 / len1) * r;
      const p2x = B.x + (dx2 / len2) * r;
      const p2y = B.y + (dy2 / len2) * r;
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const omt = 1 - t;
        out.push({
          x: omt * omt * p0x + 2 * omt * t * B.x + t * t * p2x,
          y: omt * omt * p0y + 2 * omt * t * B.y + t * t * p2y
        });
      }
    }
    const last = points[points.length - 1];
    out.push({ x: last.x, y: last.y });
    return out;
  }

  function appendUBendArc(pts, xEdge, yCurr, yNext, dirOutward, rx = 12, arcSteps = 18) {
    const cy = (yCurr + yNext) * 0.5;
    const rySigned = (yNext - yCurr) * 0.5;
    for (let s = 1; s < arcSteps; s++) {
      const theta = (-0.5 + s / arcSteps) * Math.PI;
      pts.push({
        x: xEdge + dirOutward * rx * Math.cos(theta),
        y: cy + rySigned * Math.sin(theta)
      });
    }
  }

  // Geometry constants in 1200x720 SVG viewBox coordinates
  const INDOOR_YS = [272, 304, 336, 368, 400, 432, 464, 496]; // 8 passes, x=92..278
  const OUTDOOR_YS = [248, 282, 316, 350, 384, 418, 452, 486]; // 8 passes, x=922..1108

  function buildSerpentinePoints(xsLeft, xsRight, ys, fromTopToBottom) {
    const pts = [];
    const orderedYs = fromTopToBottom ? ys : [...ys].reverse();
    // Meet indoor manifold stub cleanly at x = xsRight + 16 (294)
    pts.push({ x: xsRight + 16, y: orderedYs[0] });
    for (let i = 0; i < orderedYs.length; i++) {
      const y = orderedYs[i];
      if (i % 2 === 0) {
        pts.push({ x: xsRight, y });
        pts.push({ x: xsLeft, y });
        if (i + 1 < orderedYs.length) {
          appendUBendArc(pts, xsLeft, y, orderedYs[i + 1], -1, 12, 18);
        }
      } else {
        pts.push({ x: xsLeft, y });
        pts.push({ x: xsRight, y });
        if (i + 1 < orderedYs.length) {
          appendUBendArc(pts, xsRight, y, orderedYs[i + 1], 1, 12, 18);
        }
      }
    }
    pts.push({ x: xsRight + 16, y: orderedYs[orderedYs.length - 1] });
    return pts;
  }

  function buildOutdoorSerpentinePoints(xsLeft, xsRight, ys, fromTopToBottom) {
    const pts = [];
    const orderedYs = fromTopToBottom ? ys : [...ys].reverse();
    // Meet outdoor manifold stub cleanly at x = xsLeft - 10 (912)
    pts.push({ x: xsLeft - 10, y: orderedYs[0] });
    for (let i = 0; i < orderedYs.length; i++) {
      const y = orderedYs[i];
      if (i % 2 === 0) {
        pts.push({ x: xsLeft, y });
        pts.push({ x: xsRight, y });
        if (i + 1 < orderedYs.length) {
          appendUBendArc(pts, xsRight, y, orderedYs[i + 1], 1, 12, 18);
        }
      } else {
        pts.push({ x: xsRight, y });
        pts.push({ x: xsLeft, y });
        if (i + 1 < orderedYs.length) {
          appendUBendArc(pts, xsLeft, y, orderedYs[i + 1], -1, 12, 18);
        }
      }
    }
    pts.push({ x: xsLeft - 10, y: orderedYs[orderedYs.length - 1] });
    return pts;
  }

  /**
   * Polyline path helper: precomputes cumulative arc lengths & smooth vertex tangents
   */
  class PolyPath {
    constructor(points) {
      const clean = [];
      for (const pt of points) {
        if (clean.length === 0 || Math.hypot(pt.x - clean[clean.length - 1].x, pt.y - clean[clean.length - 1].y) > 0.05) {
          clean.push({ x: pt.x, y: pt.y });
        }
      }
      this.points = clean.length >= 2 ? clean : points;
      this.cumLen = [0];
      this.segDirs = [];
      let total = 0;
      for (let i = 1; i < this.points.length; i++) {
        const dx = this.points[i].x - this.points[i - 1].x;
        const dy = this.points[i].y - this.points[i - 1].y;
        const len = Math.hypot(dx, dy) || 1;
        this.segDirs.push({ tx: dx / len, ty: dy / len, len });
        total += len;
        this.cumLen.push(total);
      }
      this.totalLen = Math.max(1, total);

      this.vertexTangents = [];
      const n = this.points.length;
      for (let i = 0; i < n; i++) {
        if (i === 0) {
          const d = this.segDirs[0] || { tx: 1, ty: 0 };
          this.vertexTangents.push({ tx: d.tx, ty: d.ty });
        } else if (i === n - 1) {
          const d = this.segDirs[this.segDirs.length - 1] || { tx: 1, ty: 0 };
          this.vertexTangents.push({ tx: d.tx, ty: d.ty });
        } else {
          const d0 = this.segDirs[i - 1];
          const d1 = this.segDirs[i];
          const sx = d0.tx + d1.tx;
          const sy = d0.ty + d1.ty;
          const sl = Math.hypot(sx, sy);
          if (sl > 0.05) {
            this.vertexTangents.push({ tx: sx / sl, ty: sy / sl });
          } else {
            this.vertexTangents.push({ tx: d1.tx, ty: d1.ty });
          }
        }
      }
    }

    sample(tNorm) {
      const target = RefDB.clamp(tNorm, 0, 1) * this.totalLen;
      const cl = this.cumLen;
      let lo = 1;
      let hi = cl.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (cl[mid] < target) lo = mid + 1;
        else hi = mid;
      }
      const i = lo;
      const segLen = Math.max(0.0001, cl[i] - cl[i - 1]);
      const f = clamp((target - cl[i - 1]) / segLen, 0, 1);
      const p0 = this.points[i - 1];
      const p1 = this.points[i];
      const sd = this.segDirs[i - 1] || { tx: 1, ty: 0 };

      let tx = sd.tx;
      let ty = sd.ty;
      if (segLen <= 14) {
        const vt0 = this.vertexTangents[i - 1];
        const vt1 = this.vertexTangents[i];
        const mx = vt0.tx + (vt1.tx - vt0.tx) * f;
        const my = vt0.ty + (vt1.ty - vt0.ty) * f;
        const ml = Math.hypot(mx, my) || 1;
        tx = mx / ml;
        ty = my / ml;
      } else {
        const blendZone = 8;
        const distStart = f * segLen;
        const distEnd = (1 - f) * segLen;
        if (distStart < blendZone) {
          const u = 1 - distStart / blendZone;
          const vt0 = this.vertexTangents[i - 1];
          const mx = sd.tx + (vt0.tx - sd.tx) * u;
          const my = sd.ty + (vt0.ty - sd.ty) * u;
          const ml = Math.hypot(mx, my) || 1;
          tx = mx / ml;
          ty = my / ml;
        } else if (distEnd < blendZone) {
          const u = 1 - distEnd / blendZone;
          const vt1 = this.vertexTangents[i];
          const mx = sd.tx + (vt1.tx - sd.tx) * u;
          const my = sd.ty + (vt1.ty - sd.ty) * u;
          const ml = Math.hypot(mx, my) || 1;
          tx = mx / ml;
          ty = my / ml;
        }
      }

      return {
        x: p0.x + (p1.x - p0.x) * f,
        y: p0.y + (p1.y - p0.y) * f,
        tx,
        ty
      };
    }

    toSVGPath() {
      return this.points
        .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
        .join(' ');
    }
  }

  // Convert temperature (°F) to Thermal Camera IR palette (20°F -> 230°F)
  function tempToIRColor(tempF) {
    const t = RefDB.clamp((tempF - 20) / 200, 0, 1);
    if (t < 0.22) {
      // Deep icy blue -> cyan
      const k = t / 0.22;
      return `rgb(${Math.round(30 + 20 * k)}, ${Math.round(120 + 115 * k)}, 255)`;
    }
    if (t < 0.48) {
      // Cyan -> emerald -> yellow-green
      const k = (t - 0.22) / 0.26;
      return `rgb(${Math.round(50 + 185 * k)}, ${Math.round(235 - 20 * k)}, ${Math.round(255 - 200 * k)})`;
    }
    if (t < 0.74) {
      // Yellow -> orange-red
      const k = (t - 0.48) / 0.26;
      return `rgb(${Math.round(235 + 20 * k)}, ${Math.round(215 - 125 * k)}, ${Math.round(55 - 30 * k)})`;
    }
    // Hot red -> incandescent white-orange
    const k = (t - 0.74) / 0.26;
    return `rgb(255, ${Math.round(90 + 140 * k)}, ${Math.round(25 + 170 * k)})`;
  }

  class CycleRenderer {
    constructor(containerEl, options = {}) {
      this.container = containerEl;
      this.onSelectNode = options.onSelectNode || null;
      this.onHoverNode = options.onHoverNode || null;

      this.state = null;
      this.colorMode = 'hvac'; // 'hvac' | 'thermal'
      this.labelMode = 'tech'; // 'tech' | 'beginner' | 'quiz'
      this.theme = 'dark';
      this.selectedNodeId = null;
      this.highlightedNodeId = null;
      this.tourStep = null;

      this.animTime = 0;
      this.scrollAngle = 0;
      this.blowerAngle = 0;
      this.condFanAngle = 0;
      this.valveShuttlePos = 0;
      this.vis = null;
      this.lastVaporTransform = '';
      this.lastVaporOpacity = '';
      this.pathsByMode = {
        cooling: this._buildPaths('cooling'),
        heating: this._buildPaths('heating')
      }; // 0 = Cooling, 1 = Heating

      // Particle pools
      this.fluidParticles = [];
      this.airParticles = [];
      this.condensateDrops = [];
      this.sightBubbles = [];
      this._initParticles();

      this._buildDOM();
    }

    _initParticles() {
      for (let i = 0; i < 230; i++) {
        this.fluidParticles.push({
          seg: i % 5,
          t: Math.random(),
          offset: (Math.random() - 0.5) * 6.5,
          size: 1.5 + Math.random() * 2.1,
          phaseSeed: Math.random() * Math.PI * 2
        });
      }
      for (let i = 0; i < 56; i++) {
        this.airParticles.push({
          side: i < 28 ? 'indoor' : 'outdoor',
          p: Math.random(),
          lane: (Math.random() - 0.5),
          speed: 0.75 + Math.random() * 0.5
        });
      }
      for (let i = 0; i < 16; i++) {
        this.condensateDrops.push({
          xFrac: Math.random(),
          y: Math.random(),
          speed: 0.7 + Math.random() * 0.6
        });
      }
      for (let i = 0; i < 26; i++) {
        this.sightBubbles.push({
          x: (Math.random() - 0.5) * 26,
          y: (Math.random() - 0.5) * 14,
          r: 1.2 + Math.random() * 2.5,
          vx: (Math.random() - 0.5) * 18,
          vy: -15 - Math.random() * 25
        });
      }
    }

    _buildPaths(mode) {
      // Note: Coil serpentines reverse flow direction when Cooling vs Heating!
      const isCooling = mode === 'cooling';

      // True compressor discharge -> Reversing valve Port D -> active condenser coil top
      const dischToValve = [
        { x: 672, y: 264 },
        { x: 672, y: 224 },
        { x: 632, y: 224 },
        { x: 632, y: 192 }
      ];
      const valveToOutdoorTop = [
        { x: 660, y: 152 },
        { x: 842, y: 152 },
        { x: 862, y: 248 },
        { x: 912, y: 248 }
      ];
      const valveToIndoorTop = [
        { x: 540, y: 152 },
        { x: 345, y: 152 },
        { x: 325, y: 272 },
        { x: 294, y: 272 }
      ];

      const indoorBottomToLiquid = [
        { x: 294, y: 496 },
        { x: 325, y: 496 },
        { x: 345, y: 595 }
      ];
      const outdoorBottomToLiquid = [
        { x: 912, y: 486 },
        { x: 862, y: 486 },
        { x: 842, y: 595 }
      ];

      const indoorSerpTopDown = buildSerpentinePoints(96, 278, INDOOR_YS, true);
      const indoorSerpBotUp = buildSerpentinePoints(96, 278, INDOOR_YS, false);
      const outdoorSerpTopDown = buildOutdoorSerpentinePoints(922, 1104, OUTDOOR_YS, true);
      const outdoorSerpBotUp = buildOutdoorSerpentinePoints(922, 1104, OUTDOOR_YS, false);

      const accumToComp = [
        { x: 568, y: 192 },
        { x: 568, y: 224 },
        { x: 508, y: 224 },
        { x: 508, y: 288 },
        { x: 508, y: 422 },
        { x: 595, y: 422 }
      ];

      const rc = (pts, rad = 20) => roundPathCorners(pts, rad, 14);

      if (isCooling) {
        return {
          discharge: new PolyPath(rc([...dischToValve, { x: 632, y: 152 }, ...valveToOutdoorTop], 18)),
          condenser: new PolyPath(outdoorSerpTopDown),
          liquid: new PolyPath(rc([
            ...outdoorBottomToLiquid,
            { x: 604, y: 595 },
            { x: 510, y: 595 },
            { x: 392, y: 595 },
            ...[...indoorBottomToLiquid].reverse()
          ], 18)),
          evaporator: new PolyPath(indoorSerpBotUp),
          suction: new PolyPath(rc([
            ...[...valveToIndoorTop].reverse(),
            { x: 568, y: 152 },
            ...accumToComp
          ], 18)),
          // Static pipe segments for SVG background stroke
          indoorTopPipe: new PolyPath(rc(valveToIndoorTop, 18)),
          outdoorTopPipe: new PolyPath(rc(valveToOutdoorTop, 18)),
          indoorBotPipe: new PolyPath(rc(indoorBottomToLiquid, 18)),
          outdoorBotPipe: new PolyPath(rc(outdoorBottomToLiquid, 18)),
          liquidLineBase: new PolyPath([{ x: 345, y: 595 }, { x: 842, y: 595 }]),
          dischBase: new PolyPath(rc(dischToValve, 14)),
          suctBase: new PolyPath(rc(accumToComp, 18))
        };
      } else {
        // Heat Pump Heating Mode!
        return {
          discharge: new PolyPath(rc([...dischToValve, { x: 632, y: 152 }, ...valveToIndoorTop], 18)),
          condenser: new PolyPath(indoorSerpTopDown),
          liquid: new PolyPath(rc([
            ...indoorBottomToLiquid,
            { x: 510, y: 595 },
            { x: 604, y: 595 },
            { x: 782, y: 595 },
            ...[...outdoorBottomToLiquid].reverse()
          ], 18)),
          evaporator: new PolyPath(outdoorSerpBotUp),
          suction: new PolyPath(rc([
            ...[...valveToOutdoorTop].reverse(),
            { x: 568, y: 152 },
            ...accumToComp
          ], 18)),
          indoorTopPipe: new PolyPath(rc(valveToIndoorTop, 18)),
          outdoorTopPipe: new PolyPath(rc(valveToOutdoorTop, 18)),
          indoorBotPipe: new PolyPath(rc(indoorBottomToLiquid, 18)),
          outdoorBotPipe: new PolyPath(rc(outdoorBottomToLiquid, 18)),
          liquidLineBase: new PolyPath([{ x: 345, y: 595 }, { x: 842, y: 595 }]),
          dischBase: new PolyPath(rc(dischToValve, 14)),
          suctBase: new PolyPath(rc(accumToComp, 18))
        };
      }
    }

    _buildDOM() {
      const coolingPaths = (this.pathsByMode && this.pathsByMode.cooling) || this._buildPaths('cooling');

      this.container.innerHTML = `
        <div class="stage-canvas-wrap">
          <svg id="hvac-svg" viewBox="0 0 1200 720" xmlns="http://www.w3.org/2000/svg" class="hvac-svg">
            <defs>
              <linearGradient id="metalShell" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stop-color="#334155"/>
                <stop offset="50%" stop-color="#1e293b"/>
                <stop offset="100%" stop-color="#0f172a"/>
              </linearGradient>
              <linearGradient id="brassBody" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#fbbf24"/>
                <stop offset="45%" stop-color="#d97706"/>
                <stop offset="100%" stop-color="#92400e"/>
              </linearGradient>
              <linearGradient id="copperPipe" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#fdba74"/>
                <stop offset="50%" stop-color="#c2410c"/>
                <stop offset="100%" stop-color="#7c2d12"/>
              </linearGradient>
              <linearGradient id="oilGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#f59e0b" stop-opacity="0.75"/>
                <stop offset="100%" stop-color="#92400e" stop-opacity="0.92"/>
              </linearGradient>
              <filter id="softGlow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="3" result="blur"/>
                <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
              </filter>
            </defs>

            <!-- Subtle Engineering Blueprint Grid -->
            <g class="blueprint-grid" opacity="0.22">
              ${Array.from({ length: 24 }, (_, i) => `<line x1="${i * 50}" y1="0" x2="${i * 50}" y2="720" stroke="#475569" stroke-width="0.5"/>`).join('')}
              ${Array.from({ length: 15 }, (_, i) => `<line x1="0" y1="${i * 50}" x2="1200" y2="${i * 50}" stroke="#475569" stroke-width="0.5"/>`).join('')}
            </g>

            <!-- ============ LEFT: INDOOR AIR HANDLER UNIT ============ -->
            <g id="unit-indoor">
              <!-- Return Air Duct (Top) -->
              <path d="M 90 10 L 90 80 L 266 80 L 266 10" fill="rgba(51,65,85,0.22)" stroke="#64748b" stroke-width="2"/>
              <!-- Main Insulated Air Handler Cabinet -->
              <rect x="44" y="80" width="276" height="482" rx="10" fill="rgba(15,23,42,0.55)" stroke="#64748b" stroke-width="2.5"/>
              <rect x="52" y="88" width="260" height="466" rx="6" fill="none" stroke="#475569" stroke-width="1" stroke-dasharray="4 4"/>
              <!-- Supply Air Duct (Bottom) -->
              <path d="M 90 562 L 90 676 L 266 676 L 266 562" fill="rgba(30,41,59,0.25)" stroke="#64748b" stroke-width="2"/>

              <!-- Pleated Air Filter -->
              <g id="indoor-filter">
                <rect x="86" y="88" width="184" height="16" rx="3" fill="#1e293b" stroke="#94a3b8" stroke-width="1.5"/>
                <path d="M 90 102 L 98 90 L 106 102 L 114 90 L 122 102 L 130 90 L 138 102 L 146 90 L 154 102 L 162 90 L 170 102 L 178 90 L 186 102 L 194 90 L 202 102 L 210 90 L 218 102 L 226 90 L 234 102 L 242 90 L 250 102 L 258 90 L 266 102" fill="none" stroke="#e2e8f0" stroke-width="1.4"/>
                <rect id="filter-dust-overlay" x="86" y="88" width="184" height="16" rx="3" fill="#78716c" opacity="0"/>
              </g>

              <!-- Blower Scroll Housing -->
              <g id="indoor-blower">
                <circle cx="178" cy="172" r="46" fill="#0f172a" stroke="#64748b" stroke-width="2.5"/>
                <circle cx="178" cy="172" r="36" fill="#1e293b" stroke="#475569" stroke-width="1.2"/>
                <!-- Rotating Wheel rendered on Canvas at (178, 172) -->
              </g>

              <!-- Indoor Finned-Tube Coil Aluminum Fins Backing -->
              <g id="indoor-coil-fins">
                <rect x="84" y="252" width="206" height="264" rx="5" fill="rgba(148,163,184,0.08)" stroke="#475569" stroke-width="1.2"/>
                ${Array.from({ length: 18 }, (_, i) => `<line x1="${96 + i * 11}" y1="255" x2="${96 + i * 11}" y2="513" stroke="#64748b" stroke-width="0.8" opacity="0.45"/>`).join('')}
              </g>

              <!-- Condensate Drain Pan & Pipe -->
              <path d="M 68 524 L 296 524 L 288 544 L 76 544 Z" fill="#1e293b" stroke="#64748b" stroke-width="1.8"/>
              <path d="M 76 536 L 34 536 L 34 584" fill="none" stroke="#94a3b8" stroke-width="5" stroke-linecap="round"/>
              <path d="M 76 536 L 34 536 L 34 584" fill="none" stroke="#0284c7" stroke-width="2" stroke-linecap="round" opacity="0.5"/>
            </g>

            <!-- ============ RIGHT: OUTDOOR CONDENSER UNIT ============ -->
            <g id="unit-outdoor">
              <!-- Louvered Outdoor Cabinet -->
              <rect x="876" y="100" width="276" height="480" rx="10" fill="rgba(15,23,42,0.55)" stroke="#64748b" stroke-width="2.5"/>
              <!-- Top Fan Shroud & Grille -->
              <path d="M 920 100 L 946 66 L 1098 66 L 1124 100 Z" fill="#1e293b" stroke="#64748b" stroke-width="2"/>
              <ellipse cx="1022" cy="118" rx="68" ry="18" fill="#0f172a" stroke="#475569" stroke-width="1.5"/>
              <!-- Condenser Coil Fins -->
              <g id="outdoor-coil-fins">
                <rect x="910" y="226" width="206" height="284" rx="5" fill="rgba(148,163,184,0.08)" stroke="#475569" stroke-width="1.2"/>
                ${Array.from({ length: 18 }, (_, i) => `<line x1="${922 + i * 11}" y1="229" x2="${922 + i * 11}" y2="507" stroke="#64748b" stroke-width="0.8" opacity="0.45"/>`).join('')}
                <rect id="cond-dirt-overlay" x="910" y="226" width="206" height="284" rx="5" fill="#78716c" opacity="0"/>
              </g>
              <!-- Right Side Protective Louvers -->
              <g opacity="0.55">
                ${Array.from({ length: 11 }, (_, i) => `<line x1="1136" y1="${240 + i * 24}" x2="1150" y2="${248 + i * 24}" stroke="#94a3b8" stroke-width="2" stroke-linecap="round"/>`).join('')}
              </g>
              <!-- Base Pan -->
              <rect x="872" y="572" width="284" height="14" rx="4" fill="#334155" stroke="#64748b" stroke-width="1.5"/>
            </g>

            <!-- ============ COPPER PIPING WALLS (OUTER SHELL) ============ -->
            <g id="pipe-shells" fill="none" stroke-linecap="round" stroke-linejoin="round">
              <path d="${coolingPaths.indoorTopPipe.toSVGPath()}" stroke="#475569" stroke-width="18"/>
              <path d="${coolingPaths.outdoorTopPipe.toSVGPath()}" stroke="#475569" stroke-width="18"/>
              <path d="${coolingPaths.dischBase.toSVGPath()}" stroke="#475569" stroke-width="16"/>
              <path d="${coolingPaths.suctBase.toSVGPath()}" stroke="#475569" stroke-width="18"/>
              <path d="${coolingPaths.indoorBotPipe.toSVGPath()}" stroke="#475569" stroke-width="14"/>
              <path d="${coolingPaths.outdoorBotPipe.toSVGPath()}" stroke="#475569" stroke-width="14"/>
              <path d="${coolingPaths.liquidLineBase.toSVGPath()}" stroke="#475569" stroke-width="14"/>

              <!-- Serpentine Tube Outer Metallic Jackets -->
              <path d="${coolingPaths.evaporator.toSVGPath()}" stroke="#475569" stroke-width="14"/>
              <path d="${coolingPaths.condenser.toSVGPath()}" stroke="#475569" stroke-width="14"/>

              <!-- Armaflex Insulation Cutaway on Suction Line -->
              <path d="M 358 152 L 520 152" stroke="#0f172a" stroke-width="24" stroke-dasharray="140 24" opacity="0.72"/>
              <path d="M 358 152 L 520 152" stroke="#334155" stroke-width="24" stroke-dasharray="6 10" opacity="0.35"/>
            </g>

            <!-- Metallic Specular Copper Sheen along top pipe rim -->
            <g id="pipe-sheen" fill="none" stroke="rgba(255,237,213,0.18)" stroke-linecap="round" stroke-linejoin="round" transform="translate(0,-1.5)">
              <path d="${coolingPaths.indoorTopPipe.toSVGPath()}" stroke-width="11"/>
              <path d="${coolingPaths.outdoorTopPipe.toSVGPath()}" stroke-width="11"/>
              <path d="${coolingPaths.dischBase.toSVGPath()}" stroke-width="9"/>
              <path d="${coolingPaths.suctBase.toSVGPath()}" stroke-width="11"/>
              <path d="${coolingPaths.indoorBotPipe.toSVGPath()}" stroke-width="7.5"/>
              <path d="${coolingPaths.outdoorBotPipe.toSVGPath()}" stroke-width="7.5"/>
              <path d="${coolingPaths.liquidLineBase.toSVGPath()}" stroke-width="7.5"/>
              <path d="${coolingPaths.evaporator.toSVGPath()}" stroke-width="7.5"/>
              <path d="${coolingPaths.condenser.toSVGPath()}" stroke-width="7.5"/>
            </g>

            <!-- Pipe Inner Dark Bores (Fluid rendered on Canvas directly on top!) -->
            <g id="pipe-bores" fill="none" stroke="#090f1d" stroke-linecap="round" stroke-linejoin="round">
              <path d="${coolingPaths.indoorTopPipe.toSVGPath()}" stroke-width="12"/>
              <path d="${coolingPaths.outdoorTopPipe.toSVGPath()}" stroke-width="12"/>
              <path d="${coolingPaths.dischBase.toSVGPath()}" stroke-width="10"/>
              <path d="${coolingPaths.suctBase.toSVGPath()}" stroke-width="12"/>
              <path d="${coolingPaths.indoorBotPipe.toSVGPath()}" stroke-width="8.5"/>
              <path d="${coolingPaths.outdoorBotPipe.toSVGPath()}" stroke-width="8.5"/>
              <path d="${coolingPaths.liquidLineBase.toSVGPath()}" stroke-width="8.5"/>
              <path d="${coolingPaths.evaporator.toSVGPath()}" stroke-width="8.5"/>
              <path d="${coolingPaths.condenser.toSVGPath()}" stroke-width="8.5"/>
            </g>

            <!-- ============ CENTER: 4-WAY REVERSING VALVE CUTAWAY ============ -->
            <g id="reversing-valve-shell">
              <rect x="538" y="122" width="124" height="60" rx="22" fill="url(#brassBody)" stroke="#fcd34d" stroke-width="2"/>
              <rect x="544" y="128" width="112" height="48" rx="17" fill="#0f172a" stroke="#b45309" stroke-width="1.5"/>
              <!-- Solenoid Pilot Coil on Top -->
              <rect x="580" y="96" width="40" height="22" rx="4" fill="#1e293b" stroke="#94a3b8" stroke-width="1.5"/>
              <circle cx="600" cy="107" r="5" id="rv-solenoid-led" fill="#475569"/>
              <text x="600" y="90" text-anchor="middle" class="svg-sublabel" id="rv-mode-tag">4-WAY VALVE</text>
            </g>

            <!-- ============ SUCTION ACCUMULATOR CUTAWAY ============ -->
            <g id="suction-accumulator">
              <rect x="480" y="288" width="56" height="118" rx="20" fill="url(#metalShell)" stroke="#64748b" stroke-width="2"/>
              <rect x="487" y="295" width="42" height="104" rx="14" fill="#090f1d" stroke="#334155" stroke-width="1"/>
              <!-- Internal U-Tube -->
              <path d="M 498 302 L 498 378 Q 498 394 510 394 Q 522 394 522 378 L 522 308" fill="none" stroke="#94a3b8" stroke-width="4"/>
              <circle cx="514" cy="389" r="2" fill="#38bdf8"/>
            </g>

            <!-- ============ HERMETIC SCROLL COMPRESSOR CUTAWAY ============ -->
            <g id="compressor-shell">
              <!-- Outer Steel Dome & Shell -->
              <rect x="595" y="264" width="142" height="224" rx="44" fill="url(#metalShell)" stroke="#94a3b8" stroke-width="2.8"/>
              <!-- Cutaway Interior Cavity -->
              <rect x="604" y="274" width="124" height="204" rx="36" fill="#090f1d" stroke="#475569" stroke-width="1.4"/>
              <!-- High/Low Side Internal Pressure Divider Plate -->
              <line x1="606" y1="368" x2="726" y2="368" stroke="#64748b" stroke-width="3"/>
              <!-- Crankshaft -->
              <rect x="661" y="346" width="8" height="106" fill="#94a3b8" rx="2"/>
              <!-- Stator & Copper Motor Windings -->
              <rect x="620" y="388" width="24" height="48" rx="4" id="stator-left" fill="#d97706" stroke="#f59e0b" stroke-width="1.2"/>
              <rect x="686" y="388" width="24" height="48" rx="4" id="stator-right" fill="#d97706" stroke="#f59e0b" stroke-width="1.2"/>
              <rect x="646" y="392" width="38" height="40" rx="3" fill="#334155" stroke="#64748b" stroke-width="1"/>
              <!-- Oil Sump -->
              <path d="M 608 448 L 724 448 L 724 456 Q 724 475 666 475 Q 608 475 608 456 Z" fill="url(#oilGrad)" id="comp-oil-sump"/>
              <!-- Terminal Box on Side -->
              <rect x="735" y="394" width="16" height="34" rx="3" fill="#1e293b" stroke="#94a3b8" stroke-width="1.5"/>
            </g>

            <!-- ============ BOTTOM LIQUID LINE COMPONENTS ============ -->
            <!-- Bi-Flow Filter-Drier Cutaway -->
            <g id="filter-drier-cutaway">
              <rect x="476" y="575" width="70" height="40" rx="10" fill="url(#metalShell)" stroke="#94a3b8" stroke-width="2"/>
              <rect x="484" y="582" width="54" height="26" rx="5" fill="#1e293b" stroke="#475569" stroke-width="1"/>
              <!-- Desiccant Beads Texture -->
              <g fill="#a8a29e" opacity="0.65">
                <circle cx="494" cy="590" r="3"/><circle cx="503" cy="590" r="3"/><circle cx="512" cy="590" r="3"/><circle cx="521" cy="590" r="3"/><circle cx="530" cy="590" r="3"/>
                <circle cx="498" cy="599" r="3"/><circle cx="508" cy="599" r="3"/><circle cx="517" cy="599" r="3"/><circle cx="526" cy="599" r="3"/>
              </g>
            </g>

            <!-- Sight Glass Bezel -->
            <g id="sight-glass-cutaway">
              <rect x="582" y="581" width="44" height="28" rx="6" fill="url(#brassBody)" stroke="#fcd34d" stroke-width="1.5"/>
              <circle cx="604" cy="595" r="14" fill="#090f1d" stroke="#fde68a" stroke-width="2"/>
              <circle cx="604" cy="595" r="11" fill="none" stroke="#10b981" stroke-width="2" opacity="0.85"/>
            </g>

            <!-- Indoor Metering Device Housing (Left Liquid Line, Active in Cooling) -->
            <g id="indoor-metering-cutaway">
              <rect x="358" y="570" width="72" height="50" rx="8" fill="url(#brassBody)" stroke="#fcd34d" stroke-width="1.8"/>
              <rect x="364" y="576" width="60" height="38" rx="5" fill="#0f172a" stroke="#b45309" stroke-width="1.2"/>
              <!-- TXV Diaphragm Dome (Top of Valve) -->
              <path id="indoor-txv-dome" d="M 374 570 Q 394 544 414 570 Z" fill="#cbd5e1" stroke="#64748b" stroke-width="1.5"/>
              <!-- Capillary Tube to Suction Sensing Bulb -->
              <path id="txv-capillary-line" d="M 394 555 L 394 528 Q 394 510 408 510 L 408 162" fill="none" stroke="#f59e0b" stroke-width="2" stroke-dasharray="none"/>
              <!-- Sensing Bulb Strapped on Suction Pipe -->
              <rect id="txv-sensing-bulb" x="392" y="136" width="32" height="10" rx="5" fill="#fbbf24" stroke="#78350f" stroke-width="1.4"/>
              <line x1="398" y1="135" x2="398" y2="158" stroke="#cbd5e1" stroke-width="2"/>
              <line x1="418" y1="135" x2="418" y2="158" stroke="#cbd5e1" stroke-width="2"/>
            </g>

            <!-- Outdoor Metering Device Housing (Right Liquid Line, Active in Heating) -->
            <g id="outdoor-metering-cutaway">
              <rect x="746" y="570" width="72" height="50" rx="8" fill="url(#brassBody)" stroke="#fcd34d" stroke-width="1.8"/>
              <rect x="752" y="576" width="60" height="38" rx="5" fill="#0f172a" stroke="#b45309" stroke-width="1.2"/>
              <path id="outdoor-txv-dome" d="M 762 570 Q 782 544 802 570 Z" fill="#cbd5e1" stroke="#64748b" stroke-width="1.5"/>
            </g>

            <!-- Service Ports (Schrader Valves) + Manifold Gauge Tap Lines -->
            <g id="service-ports">
              <!-- Low-Side Blue Service Port on True Suction Line -->
              <rect x="526" y="213" width="12" height="14" rx="2" fill="#3b82f6" stroke="#eff6ff" stroke-width="1.4"/>
              <circle cx="532" cy="224" r="3" fill="#93c5fd"/>
              <!-- High-Side Red Service Port on Liquid Line -->
              <rect x="668" y="576" width="12" height="14" rx="2" fill="#ef4444" stroke="#fef2f2" stroke-width="1.4"/>
              <circle cx="674" cy="595" r="3" fill="#fca5a5"/>
            </g>
          </svg>

          <!-- 60fps HiDPI Canvas Layer for Fluid Streams, Particles, Scrolls, Fans, Air, Frost, Sight Glass -->
          <canvas id="hvac-canvas" class="hvac-canvas"></canvas>

          <!-- Top Interactive Vector Overlay Layer (Dynamic Labels, 100% Vapor Point, Temp Clamps, Hit Zones) -->
          <svg id="hvac-overlay-svg" viewBox="0 0 1200 720" xmlns="http://www.w3.org/2000/svg" class="hvac-overlay-svg">
            <!-- Dynamic 100% Vapor Point Badge (slides along Evaporator!) -->
            <g id="vapor-point-marker" style="pointer-events:none;">
              <rect x="-56" y="-12" width="112" height="22" rx="11" fill="rgba(14,165,233,0.92)" stroke="#e0f2fe" stroke-width="1.4"/>
              <text x="0" y="3" text-anchor="middle" fill="#ffffff" font-size="10" font-weight="700" font-family="system-ui, sans-serif">100% VAPOR PT</text>
            </g>

            <!-- Live Component Badges & Labels (Toggled by Tech / Beginner / Quiz Mode) -->
            <g id="dynamic-labels"></g>

            <!-- Pinned Live Clamp Thermometers & Pressure Callouts -->
            <g id="pinned-probes"></g>

            <!-- Interactive Click / Hover Hit Targets for Inspection -->
            <g id="hit-targets">
              <rect data-node="evaporator" x="62" y="242" width="244" height="282" rx="10" class="hit-zone"/>
              <rect data-node="condenser" x="896" y="218" width="234" height="302" rx="10" class="hit-zone"/>
              <rect data-node="compressor" x="590" y="260" width="154" height="234" rx="34" class="hit-zone"/>
              <rect data-node="discharge_line" x="625" y="138" width="220" height="84" rx="12" class="hit-zone"/>
              <rect data-node="suction_line" x="340" y="130" width="215" height="55" rx="12" class="hit-zone"/>
              <rect data-node="filter_drier" x="468" y="566" width="88" height="60" rx="10" class="hit-zone"/>
              <rect data-node="liquid_line" x="576" y="566" width="130" height="60" rx="10" class="hit-zone"/>
              <rect id="hit-valve-indoor" data-node="metering_device" x="346" y="544" width="94" height="84" rx="10" class="hit-zone"/>
              <rect id="hit-valve-outdoor" data-node="check_bypass" x="736" y="544" width="94" height="84" rx="10" class="hit-zone"/>
            </g>
          </svg>
        </div>
      `;

      this.svgEl = this.container.querySelector('#hvac-svg');
      this.canvasEl = this.container.querySelector('#hvac-canvas');
      this.ctx = this.canvasEl.getContext('2d');
      this.overlayEl = this.container.querySelector('#hvac-overlay-svg');

      this._bindInteractiveZones();
    }

    _bindInteractiveZones() {
      const zones = this.overlayEl.querySelectorAll('.hit-zone');
      zones.forEach((z) => {
        const nodeId = z.getAttribute('data-node');
        z.addEventListener('mouseenter', () => {
          this.highlightedNodeId = nodeId;
          if (this.onHoverNode) this.onHoverNode(nodeId);
        });
        z.addEventListener('mouseleave', () => {
          this.highlightedNodeId = null;
          if (this.onHoverNode) this.onHoverNode(null);
        });
        z.addEventListener('click', () => {
          this.selectedNodeId = this.selectedNodeId === nodeId ? null : nodeId;
          if (this.onSelectNode) this.onSelectNode(this.selectedNodeId);
        });
      });
    }

    setState(cycleState) {
      this.state = cycleState;
      this._updateSVGOverlays();
    }

    setColorMode(mode) {
      this.colorMode = mode;
    }

    setLabelMode(mode) {
      this.labelMode = mode;
      this._updateSVGOverlays();
    }

    setTheme(theme) {
      this.theme = theme;
      this._updateSVGOverlays();
    }

    setSelectedNode(nodeId) {
      this.selectedNodeId = nodeId;
      this._updateSVGOverlays();
    }

    setHighlightedNode(nodeId) {
      this.highlightedNodeId = nodeId;
      this._updateSVGOverlays();
    }

    setTourStep(stepObj) {
      this.tourStep = stepObj;
      this._updateSVGOverlays();
    }

    _getSegmentColor(segName, frac, vis = null) {
      const s = this.state;
      const g = s.gauges;
      const p = vis || s.performance;

      if (this.colorMode === 'thermal') {
        const dT = vis ? vis.dischargeTempF : g.dischargeTempF;
        const cSatT = vis ? vis.trueCondBubF : g.trueCondBubF;
        const lT = vis ? vis.liquidTempF : g.liquidTempF;
        const pdT = vis ? vis.postDrierTempF : g.postDrierTempF;
        const eSatT = vis ? vis.lowSatDewF : g.lowSatDewF;
        const sT = vis ? vis.suctionTempF : g.suctionTempF;
        if (segName === 'discharge') return tempToIRColor(dT);
        if (segName === 'condenser') {
          const desupEnd = clamp(p.desupFrac, 0.04, 0.45);
          const scStart = clamp(p.desupFrac + p.condensingFrac, desupEnd + 0.1, 0.96);
          let localT;
          if (frac < desupEnd) {
            localT = RefDB.lerp(dT, cSatT, smoothstep(0, desupEnd, frac));
          } else if (frac < scStart) {
            localT = cSatT;
          } else {
            localT = RefDB.lerp(cSatT, lT, smoothstep(scStart, 1, frac));
          }
          return tempToIRColor(localT);
        }
        if (segName === 'liquid') {
          const isCool = s.mode === 'cooling';
          const meterT = isCool ? 0.77 : 0.72;
          const tDrier = smoothstep(0.42, 0.62, frac);
          const preMeterT = RefDB.lerp(lT, pdT, tDrier);
          const tExp = smoothstep(meterT - 0.02, meterT + 0.02, frac);
          return tempToIRColor(RefDB.lerp(preMeterT, eSatT, tExp));
        }
        if (segName === 'evaporator') {
          const wetEnd = clamp(p.wetCoilFrac, 0.08, 0.96);
          const t = smoothstep(Math.max(0, wetEnd - 0.04), 1, frac);
          return tempToIRColor(RefDB.lerp(eSatT, sT, t));
        }
        return tempToIRColor(sT);
      }

      // Standard HVAC Thermophysical Phase & Pressure Palette (smooth transitions):
      if (segName === 'discharge') return '#ef4444';
      if (segName === 'condenser') {
        const desupEnd = clamp(p.desupFrac, 0.04, 0.45);
        const condEnd = clamp(desupEnd + p.condensingFrac, desupEnd + 0.1, 0.96);
        if (frac < desupEnd + 0.06) {
          return lerpColor('#ef4444', '#f97316', smoothstep(Math.max(0, desupEnd - 0.06), desupEnd + 0.06, frac));
        }
        if (frac < condEnd - 0.05) {
          const condMid = (frac - desupEnd) / Math.max(0.1, condEnd - desupEnd);
          return lerpColor('#f97316', '#fb7185', smoothstep(0.12, 0.92, condMid));
        }
        return lerpColor('#fb7185', '#db2777', smoothstep(condEnd - 0.05, Math.min(1, condEnd + 0.05), frac));
      }
      if (segName === 'liquid') {
        const isCool = s.mode === 'cooling';
        const meterT = isCool ? 0.77 : 0.72;
        const drierExitT = isCool ? 0.64 : 0.42;
        const expT = smoothstep(meterT - 0.018, meterT + 0.018, frac);
        if (p.sightGlassBubbles > 0.25 && frac > drierExitT - 0.05) {
          const sgMix = smoothstep(drierExitT - 0.05, drierExitT + 0.05, frac) * smoothstep(0.2, 0.55, p.sightGlassBubbles);
          const preColor = lerpColor('#db2777', '#f43f5e', sgMix);
          return lerpColor(preColor, '#22d3ee', expT);
        }
        return lerpColor('#db2777', '#22d3ee', expT);
      }
      if (segName === 'evaporator') {
        const wetEnd = clamp(p.wetCoilFrac, 0.08, 0.96);
        if (frac < wetEnd - 0.06) {
          return lerpColor('#06b6d4', '#22d3ee', smoothstep(0, wetEnd, frac));
        }
        return lerpColor('#22d3ee', '#3b82f6', smoothstep(wetEnd - 0.06, Math.min(1, wetEnd + 0.06), frac));
      }
      const fbMix = vis ? clamp((vis.floodbackAmt || 0), 0, 1) : (p.isFloodback ? 1 : 0);
      return lerpColor('#3b82f6', '#06b6d4', fbMix);
    }

    _updateSVGOverlays() {
      if (!this.state || !this.svgEl) return;
      const s = this.state;
      const g = s.gauges;
      const p = s.performance;
      const isCooling = s.mode === 'cooling';
      const isLight = this.theme === 'light';

      // Filter dust accumulation
      const dustOverlay = this.svgEl.querySelector('#filter-dust-overlay');
      if (dustOverlay) {
        const dustAlpha = RefDB.clamp((380 - s.inputs.indoorCFMPerTon) / 220, 0, 0.78);
        dustOverlay.setAttribute('opacity', dustAlpha.toFixed(2));
      }

      // Outdoor condenser dirt fouling
      const condOverlay = this.svgEl.querySelector('#cond-dirt-overlay');
      if (condOverlay) {
        const dirtAlpha = RefDB.clamp((92 - s.inputs.condAirflowPct) / 65, 0, 0.68);
        condOverlay.setAttribute('opacity', dirtAlpha.toFixed(2));
      }

      // Motor winding color based on motorWindingTemp
      const statorColor = p.motorWindingTemp > 200 ? '#ef4444' : p.motorWindingTemp > 165 ? '#f59e0b' : '#d97706';
      this.svgEl.querySelector('#stator-left')?.setAttribute('fill', statorColor);
      this.svgEl.querySelector('#stator-right')?.setAttribute('fill', statorColor);

      // Reversing valve solenoid LED
      const rvLed = this.svgEl.querySelector('#rv-solenoid-led');
      if (rvLed) {
        rvLed.setAttribute('fill', isCooling ? '#475569' : '#f97316');
      }
      const rvTag = this.svgEl.querySelector('#rv-mode-tag');
      if (rvTag) {
        rvTag.textContent = isCooling ? '4-WAY VALVE (COOLING)' : '4-WAY VALVE (HEATING)';
      }

      // Dynamically map indoor/outdoor valve hit zones to active metering_device vs check_bypass
      const hitIndoor = this.overlayEl.querySelector('#hit-valve-indoor');
      const hitOutdoor = this.overlayEl.querySelector('#hit-valve-outdoor');
      if (hitIndoor) hitIndoor.setAttribute('data-node', isCooling ? 'metering_device' : 'check_bypass');
      if (hitOutdoor) hitOutdoor.setAttribute('data-node', isCooling ? 'check_bypass' : 'metering_device');

      // TXV diaphragm dome & capillary routing visibility based on mode & metering
      const indoorDome = this.svgEl.querySelector('#indoor-txv-dome');
      const outdoorDome = this.svgEl.querySelector('#outdoor-txv-dome');
      if (indoorDome) indoorDome.setAttribute('opacity', s.metering === 'txv' && isCooling ? '1' : '0.18');
      if (outdoorDome) outdoorDome.setAttribute('opacity', s.metering === 'txv' && !isCooling ? '1' : '0.18');

      const capLine = this.svgEl.querySelector('#txv-capillary-line');
      const bulb = this.svgEl.querySelector('#txv-sensing-bulb');
      const showBulb = s.metering === 'txv' && isCooling;
      if (capLine) capLine.setAttribute('opacity', showBulb ? '1' : '0.18');
      if (bulb) {
        bulb.setAttribute('opacity', showBulb ? '1' : '0.25');
        // Physically unstrap bulb visually when fault === 'txv_unstrapped'!
        bulb.setAttribute('transform', s.fault === 'txv_unstrapped' ? 'translate(14, 24) rotate(28 408 141)' : '');
      }

      // Ensure visual smoothing state initialized; glides dynamically in render()
      if (!this.vis) this._initVis();
      const vpEl = this.overlayEl.querySelector('#vapor-point-marker');
      if (vpEl) {
        vpEl.style.display = this.labelMode === 'quiz' ? 'none' : 'block';
        if (!this.lastVaporTransform) {
          const paths = (this.pathsByMode && this.pathsByMode[s.mode]) || this._buildPaths(s.mode);
          const vpPt = paths.evaporator.sample(RefDB.clamp(this.vis.wetCoilFrac, 0.05, 0.96));
          this.lastVaporTransform = `translate(${vpPt.x.toFixed(1)}, ${(vpPt.y - 16).toFixed(1)})`;
          vpEl.setAttribute('transform', this.lastVaporTransform);
        }
      }

      // Render Dynamic Labels (Tech / Beginner / Quiz Blank)
      const labelsGroup = this.overlayEl.querySelector('#dynamic-labels');
      const probesGroup = this.overlayEl.querySelector('#pinned-probes');

      const labelBg = isLight ? 'rgba(255,255,255,0.92)' : 'rgba(15,23,42,0.9)';
      const labelFg = isLight ? '#0f172a' : '#f8fafc';
      const labelBorder = isLight ? '#94a3b8' : '#475569';

      const compLabels = {
        tech: {
          indoor: isCooling ? 'EVAPORATOR COIL (Indoor)' : 'CONDENSER COIL (Indoor)',
          outdoor: isCooling ? 'CONDENSER COIL (Outdoor)' : 'EVAPORATOR COIL (Outdoor)',
          comp: 'HERMETIC SCROLL COMPRESSOR',
          drier: 'FILTER-DRIER',
          sight: 'SIGHT GLASS',
          meterIn: isCooling ? `${s.metering.toUpperCase()} (ACTIVE)` : 'CHECK BYPASS',
          meterOut: isCooling ? 'CHECK BYPASS' : `${s.metering.toUpperCase()} (ACTIVE)`,
          accum: 'SUCTION ACCUMULATOR'
        },
        beginner: {
          indoor: isCooling ? 'INDOOR COOLING COIL (Absorbs Heat)' : 'INDOOR HEATING COIL (Releases Heat)',
          outdoor: isCooling ? 'OUTDOOR HEAT COIL (Dumps Heat)' : 'OUTDOOR COLD COIL (Pulls Heat)',
          comp: 'HEART OF SYSTEM (Vapor Pump)',
          drier: 'MOISTURE & DIRT FILTER',
          sight: 'LIQUID WINDOW',
          meterIn: isCooling ? 'PRESSURE DROP VALVE' : 'BYPASS OPEN',
          meterOut: isCooling ? 'BYPASS OPEN' : 'PRESSURE DROP VALVE',
          accum: 'LIQUID CATCH TANK'
        },
        quiz: {
          indoor: 'COMPONENT [ A ]',
          outdoor: 'COMPONENT [ C ]',
          comp: 'COMPONENT [ B ]',
          drier: '[ E ]',
          sight: '[ F ]',
          meterIn: isCooling ? 'COMPONENT [ D ]' : 'BYPASS',
          meterOut: isCooling ? 'BYPASS' : 'COMPONENT [ D ]',
          accum: '[ G ]'
        }
      }[this.labelMode];

      const badge = (x, y, text, accent = labelBorder) => `
        <g transform="translate(${x}, ${y})">
          <rect x="${-text.length * 3.45 - 10}" y="-11" width="${text.length * 6.9 + 20}" height="21" rx="5" fill="${labelBg}" stroke="${accent}" stroke-width="1.3"/>
          <text x="0" y="3" text-anchor="middle" fill="${labelFg}" font-size="10.2" font-weight="700" font-family="system-ui, sans-serif">${text}</text>
        </g>`;

      labelsGroup.innerHTML = `
        ${badge(182, 236, compLabels.indoor, isCooling ? '#38bdf8' : '#f43f5e')}
        ${badge(1018, 208, compLabels.outdoor, isCooling ? '#f43f5e' : '#38bdf8')}
        ${badge(666, 502, compLabels.comp, '#f97316')}
        ${badge(508, 634, compLabels.drier, g.drierDeltaP > 5 ? '#ef4444' : labelBorder)}
        ${badge(612, 634, compLabels.sight, p.sightGlassBubbles > 0.25 ? '#f59e0b' : '#10b981')}
        ${badge(384, 634, compLabels.meterIn, isCooling ? '#22d3ee' : labelBorder)}
        ${badge(784, 634, compLabels.meterOut, !isCooling ? '#22d3ee' : labelBorder)}
        ${badge(508, 444, compLabels.accum, labelBorder)}
      `;

      // Live Pinned Clamp Probes & Air Readouts
      const probePill = (x, y, title, val, sub, color) => `
        <g transform="translate(${x}, ${y})">
          <rect x="-56" y="-22" width="112" height="40" rx="6" fill="${labelBg}" stroke="${color}" stroke-width="1.5"/>
          <text x="0" y="-8" text-anchor="middle" fill="${color}" font-size="9" font-weight="800" font-family="system-ui, sans-serif">${title}</text>
          <text x="0" y="5" text-anchor="middle" fill="${labelFg}" font-size="11.5" font-weight="800" font-family="ui-monospace, monospace">${val}</text>
          <text x="0" y="15" text-anchor="middle" fill="${isLight ? '#475569' : '#94a3b8'}" font-size="8.5" font-weight="600" font-family="ui-monospace, monospace">${sub}</text>
        </g>`;

      const returnSub = `${s.inputs.indoorRH}% RH • ${Math.round(p.evapAir.cfm)} CFM`;
      const supplySub = isCooling
        ? `ΔT -${p.indoorDeltaT.toFixed(1)}°F • ${(p.tons).toFixed(2)} T`
        : `ΔT +${p.indoorDeltaT.toFixed(1)}°F • ${(p.tons).toFixed(2)} T`;

      probesGroup.innerHTML = `
        ${probePill(178, 42, 'RETURN AIR', `${s.inputs.indoorDB.toFixed(0)}°F DB`, returnSub, '#f59e0b')}
        ${probePill(178, 636, 'SUPPLY AIR', `${p.indoorSupplyDB.toFixed(1)}°F`, supplySub, isCooling ? '#38bdf8' : '#ef4444')}
        ${probePill(1022, 34, isCooling ? 'COND EXHAUST' : 'EVAP EXHAUST', `${p.outdoorExhaustDB.toFixed(1)}°F`, `${Math.round(p.condAir.cfm)} CFM`, isCooling ? '#ef4444' : '#38bdf8')}
        ${probePill(1094, 542, 'OUTDOOR AIR', `${s.inputs.outdoorDB.toFixed(0)}°F`, `${s.inputs.condAirflowPct}% Airflow`, '#94a3b8')}
        ${probePill(452, 114, 'SUCTION LINE', `${g.suctionTempF.toFixed(1)}°F`, `SH ${g.superheatF.toFixed(1)}°F | ${RefDB.formatPressureShort(g.lowPsig)} psi`, '#3b82f6')}
        ${probePill(740, 232, 'DISCHARGE GAS', `${g.dischargeTempF.toFixed(0)}°F`, `CR ${p.compressionRatio.toFixed(2)}:1`, p.isOverheating ? '#ef4444' : '#f97316')}
        ${probePill(698, 545, 'LIQUID LINE', `${g.liquidTempF.toFixed(1)}°F`, `SC ${g.subcoolingF.toFixed(1)}°F | ${RefDB.formatPressureShort(g.highPsig)} psi`, '#db2777')}
      `;

      // Highlight selected / hovered / tour-focused hit zone
      const focusNode = this.highlightedNodeId || this.selectedNodeId || (this.tourStep ? this.tourStep.nodeId : null);
      this.overlayEl.querySelectorAll('.hit-zone').forEach((z) => {
        const nid = z.getAttribute('data-node');
        z.classList.toggle('active', nid === focusNode);
      });
    }

    _initVis() {
      const s = this.state;
      if (!s) return;
      const g = s.gauges;
      const p = s.performance;
      this.vis = {
        wetCoilFrac: p.wetCoilFrac,
        desupFrac: p.desupFrac,
        condensingFrac: p.condensingFrac,
        subcoolFrac: p.subcoolFrac,
        frostLevel: p.frostLevel,
        valveOpenPct: p.valveOpenPct,
        flashGasQuality: p.flashGasQuality,
        sightGlassBubbles: p.sightGlassBubbles,
        massFlowLbMin: p.massFlowLbMin,
        condensateGPH: p.condensateGPH,
        drierDeltaP: g.drierDeltaP,
        floodbackAmt: p.isFloodback ? 1 : 0,
        dischargeTempF: g.dischargeTempF,
        trueCondBubF: g.trueCondBubF,
        liquidTempF: g.liquidTempF,
        postDrierTempF: g.postDrierTempF,
        lowSatDewF: g.lowSatDewF,
        suctionTempF: g.suctionTempF
      };
    }

    _updateVis(dt) {
      if (!this.state) return;
      if (!this.vis) {
        this._initVis();
        return;
      }
      const g = this.state.gauges;
      const p = this.state.performance;
      const k = 1 - Math.exp(-9 * Math.max(0.004, dt));
      const lerpField = (field, target) => {
        this.vis[field] += (target - this.vis[field]) * k;
      };
      lerpField('wetCoilFrac', p.wetCoilFrac);
      lerpField('desupFrac', p.desupFrac);
      lerpField('condensingFrac', p.condensingFrac);
      lerpField('subcoolFrac', p.subcoolFrac);
      lerpField('frostLevel', p.frostLevel);
      lerpField('valveOpenPct', p.valveOpenPct);
      lerpField('flashGasQuality', p.flashGasQuality);
      lerpField('sightGlassBubbles', p.sightGlassBubbles);
      lerpField('massFlowLbMin', p.massFlowLbMin);
      lerpField('condensateGPH', p.condensateGPH);
      lerpField('drierDeltaP', g.drierDeltaP);
      lerpField('floodbackAmt', p.isFloodback ? 1 : 0);
      lerpField('dischargeTempF', g.dischargeTempF);
      lerpField('trueCondBubF', g.trueCondBubF);
      lerpField('liquidTempF', g.liquidTempF);
      lerpField('postDrierTempF', g.postDrierTempF);
      lerpField('lowSatDewF', g.lowSatDewF);
      lerpField('suctionTempF', g.suctionTempF);
    }

    render(dt = 0.016, animSpeed = 1, paused = false) {
      if (!this.state) return;
      const s = this.state;
      const p = s.performance;
      const g = s.gauges;
      const isCooling = s.mode === 'cooling';

      this._updateVis(dt);
      const vis = this.vis;

      // Always allow smooth mode shuttle glide even if playback is paused
      const targetShuttle = isCooling ? 0 : 1;
      const shuttleDamp = 1 - Math.exp(-10 * Math.max(0.004, dt));
      this.valveShuttlePos += (targetShuttle - this.valveShuttlePos) * shuttleDamp;

      const effDt = paused ? 0 : dt * animSpeed;
      if (!paused) {
        this.animTime += effDt;
        // Orbiting scroll angle (~11 rad/s * stage speed)
        this.scrollAngle = (this.scrollAngle + effDt * 11 * s.inputs.stageSpeed) % (Math.PI * 2);
        // Blower angle proportional to indoor CFM
        this.blowerAngle = (this.blowerAngle + effDt * 9.5 * (s.inputs.indoorCFMPerTon / 400)) % (Math.PI * 2);
        // Condenser fan proportional to condAirflowPct
        this.condFanAngle = (this.condFanAngle + effDt * 8.5 * (s.inputs.condAirflowPct / 100)) % (Math.PI * 2);
      }

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cssW = this.canvasEl.clientWidth || 1200;
      const cssH = this.canvasEl.clientHeight || 720;
      if (this.canvasEl.width !== Math.round(cssW * dpr) || this.canvasEl.height !== Math.round(cssH * dpr)) {
        this.canvasEl.width = Math.round(cssW * dpr);
        this.canvasEl.height = Math.round(cssH * dpr);
      }

      const ctx = this.ctx;
      ctx.save();
      ctx.scale((cssW / 1200) * dpr, (cssH / 720) * dpr);
      ctx.clearRect(0, 0, 1200, 720);

      const paths = (this.pathsByMode && this.pathsByMode[s.mode]) || this._buildPaths(s.mode);

      // Smoothly glide 100% Vapor Point badge along the curved evaporator tube
      if (this.overlayEl && this.labelMode !== 'quiz') {
        const vpEl = this.overlayEl.querySelector('#vapor-point-marker');
        if (vpEl) {
          const vpPt = paths.evaporator.sample(RefDB.clamp(vis.wetCoilFrac, 0.04, 0.96));
          const tfm = `translate(${vpPt.x.toFixed(1)}, ${(vpPt.y - 16).toFixed(1)})`;
          if (tfm !== this.lastVaporTransform) {
            this.lastVaporTransform = tfm;
            vpEl.setAttribute('transform', tfm);
          }
        }
      }

      // 1. Draw colored refrigerant fluid columns inside every pipe bore (seam-free)
      this._drawPipeFluid(ctx, paths.discharge, 'discharge', 9);
      this._drawPipeFluid(ctx, paths.condenser, 'condenser', 7.5);
      this._drawPipeFluid(ctx, paths.liquid, 'liquid', 7.5);
      this._drawPipeFluid(ctx, paths.evaporator, 'evaporator', 7.5);
      this._drawPipeFluid(ctx, paths.suction, 'suction', 10.5);

      // 2. Update & draw animated physical fluid particles along exact segments
      this._renderFluidParticles(ctx, paths, effDt);

      // 3. Draw Cutaway Mechanical Animations
      this._draw4WayShuttle(ctx);
      this._drawOrbitingScroll(ctx);
      this._drawBlowerWheel(ctx);
      this._drawCondenserFan(ctx);
      this._drawMeteringNeedle(ctx, isCooling);
      this._drawSightGlass(ctx, effDt);

      // 4. Frost / Ice Crystals & Condensate Droplets & Sweating/Frosting Drier
      this._drawFrostAndCondensate(ctx, effDt);

      // 5. Airside Flowing Streamlines
      this._renderAirParticles(ctx, effDt);

      // 6. Hazard Alerts directly on schematic (Floodback / Overheating)
      if (p.isFloodback) {
        ctx.save();
        ctx.fillStyle = 'rgba(239, 68, 68, 0.9)';
        ctx.strokeStyle = '#fecaca';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.roundRect(574, 428, 184, 24, 6);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#ffffff';
        ctx.font = '800 10.5px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('⚠ LIQUID FLOODBACK / SLUGGING', 666, 444);
        ctx.restore();
      } else if (p.isOverheating) {
        ctx.save();
        ctx.fillStyle = 'rgba(234, 88, 12, 0.92)';
        ctx.strokeStyle = '#fed7aa';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.roundRect(584, 268, 164, 22, 6);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#ffffff';
        ctx.font = '800 10px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`⚠ THERMAL OVERHEAT (${g.dischargeTempF.toFixed(0)}°F)`, 666, 283);
        ctx.restore();
      }

      ctx.restore();
    }

    _drawPipeFluid(ctx, polyPath, segName, width) {
      const pts = polyPath.points;
      if (pts.length < 2) return;
      const cl = polyPath.cumLen;
      const totalLen = polyPath.totalLen;

      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = width;

      // Trace EVERY curve vertex (U-bends & filleted elbows) without corner cutting,
      // subdividing only long straight runs (>14px) for smooth phase/thermal gradients.
      for (let i = 1; i < pts.length; i++) {
        const p0 = pts[i - 1];
        const p1 = pts[i];
        const s0 = cl[i - 1];
        const s1 = cl[i];
        const segLen = s1 - s0;
        const subSteps = segLen > 14 ? Math.ceil(segLen / 14) : 1;

        for (let k = 0; k < subSteps; k++) {
          const u0 = k / subSteps;
          const u1 = (k + 1) / subSteps;
          const ax = p0.x + (p1.x - p0.x) * u0;
          const ay = p0.y + (p1.y - p0.y) * u0;
          const bx = p0.x + (p1.x - p0.x) * u1;
          const by = p0.y + (p1.y - p0.y) * u1;
          const midFrac = (s0 + segLen * (u0 + u1) * 0.5) / totalLen;
          const rawColor = this._getSegmentColor(segName, midFrac, this.vis);
          ctx.strokeStyle = mixWithBg(rawColor, '#090f1d', 0.48);
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.lineTo(bx, by);
          ctx.stroke();
        }
      }

      // Continuous soft glossy stream highlight down the center of the bore
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.lineWidth = width * 0.25;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i].x, pts[i].y);
      }
      ctx.stroke();
      ctx.restore();
    }

    _renderFluidParticles(ctx, paths, dt) {
      const s = this.state;
      const p = s.performance;
      const vis = this.vis || p;
      const flowMul = RefDB.clamp(vis.massFlowLbMin / 8.0, 0.35, 1.35);

      const segList = [
        { name: 'discharge', path: paths.discharge, baseSpeed: 0.34 * flowMul },
        { name: 'condenser', path: paths.condenser, baseSpeed: 0.14 * flowMul },
        { name: 'liquid', path: paths.liquid, baseSpeed: 0.24 * flowMul },
        { name: 'evaporator', path: paths.evaporator, baseSpeed: 0.16 * flowMul },
        { name: 'suction', path: paths.suction, baseSpeed: 0.30 * flowMul }
      ];

      const desupFrac = vis.desupFrac;
      const condEndFrac = vis.desupFrac + vis.condensingFrac;
      const wetFrac = vis.wetCoilFrac;
      const flashQ = vis.flashGasQuality;
      const sgBubbles = vis.sightGlassBubbles;
      const drierDP = vis.drierDeltaP;

      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const pt of this.fluidParticles) {
        const seg = segList[pt.seg];
        // Velocity accelerates as vapor expands in evaporator
        let localSpeed = seg.baseSpeed;
        if (seg.name === 'evaporator') localSpeed *= 0.7 + pt.t * 0.85;
        if (seg.name === 'condenser') localSpeed *= 1.25 - pt.t * 0.55;

        pt.t = (pt.t + dt * localSpeed) % 1;
        const pos = seg.path.sample(pt.t);
        const nx = -pos.ty;
        const ny = pos.tx;

        // Smooth boundary fade-in & fade-out so particles never pop at component ports
        const edgeFade = Math.min(1, pt.t / 0.065, (1 - pt.t) / 0.065);
        if (edgeFade <= 0.01) continue;

        const color = this._getSegmentColor(seg.name, pt.t, vis);
        let isVapor = true;
        let isBubble = false;
        let jitter = 0;
        const calmWave = Math.sin(pt.phaseSeed * 5 + this.animTime * 2.8);

        if (seg.name === 'discharge') {
          isVapor = true;
          jitter = calmWave * 1.4;
        } else if (seg.name === 'condenser') {
          if (pt.t < desupFrac) {
            isVapor = true;
            jitter = calmWave * 0.9;
          } else if (pt.t < condEndFrac) {
            const condProg = (pt.t - desupFrac) / Math.max(0.05, vis.condensingFrac);
            isVapor = Math.sin(pt.phaseSeed * 7) > condProg * 1.6 - 0.8;
            jitter = isVapor ? calmWave * 0.6 : 0;
          } else {
            isVapor = false; // Subcooled liquid
          }
        } else if (seg.name === 'liquid') {
          const isCool = s.mode === 'cooling';
          const meterT = isCool ? 0.77 : 0.72;
          const drierExitT = isCool ? 0.64 : 0.42;
          const afterMeter = pt.t > meterT;
          const drierFlash = drierDP > 5 && pt.t > drierExitT;
          const lowSCFlash = sgBubbles > 0.18 && (pt.phaseSeed % 1) < sgBubbles * 0.45;
          if (afterMeter) {
            isBubble = (pt.phaseSeed % 1) < flashQ;
            isVapor = false;
          } else if (drierFlash || lowSCFlash) {
            isBubble = true;
            isVapor = false;
          } else {
            isVapor = false;
          }
        } else if (seg.name === 'evaporator') {
          if (pt.t < wetFrac) {
            const localQuality = flashQ + (1 - flashQ) * (pt.t / Math.max(0.05, wetFrac));
            isBubble = (pt.phaseSeed % 1) < localQuality;
            isVapor = false;
          } else {
            isVapor = true;
            jitter = calmWave * 0.85;
          }
        } else if (seg.name === 'suction') {
          if (p.isFloodback && (pt.phaseSeed % 1) < 0.25) {
            isVapor = false;
          } else {
            isVapor = true;
            jitter = calmWave * 1.1;
          }
        }

        // Keep particles centered cleanly inside pipe bore even on tight U-bends
        const maxLane = seg.name === 'discharge' || seg.name === 'suction' ? 2.3 : 1.45;
        const laneOff = clamp((pt.offset / 3.25) * (maxLane * 0.7) + jitter * 0.6, -maxLane, maxLane);
        const px = pos.x + nx * laneOff;
        const py = pos.y + ny * laneOff;

        if (isBubble) {
          ctx.globalAlpha = edgeFade * 0.9;
          ctx.fillStyle = 'rgba(255, 255, 255, 0.78)';
          ctx.strokeStyle = color;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(px, py, Math.min(2.6, pt.size * 0.9), 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        } else if (!isVapor) {
          // Dense glossy liquid droplet hugging the curved bore tangent
          const ang = Math.atan2(pos.ty, pos.tx);
          const rMaj = Math.min(3.5, pt.size * 1.25);
          const rMin = Math.min(2.0, pt.size * 0.76);
          ctx.globalAlpha = edgeFade * 0.94;
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.ellipse(px, py, rMaj, rMin, ang, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = edgeFade * 0.42;
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(px - pos.ty * 0.35, py + pos.tx * 0.35, Math.max(0.65, pt.size * 0.3), 0, Math.PI * 2);
          ctx.fill();
        } else {
          // Energetic gas particle with halo & curve-hugging trailing streak around bends
          const trailDt = 6.5 / seg.path.totalLen;
          const trailT = Math.max(0, pt.t - trailDt);
          const midT = (pt.t + trailT) * 0.5;
          const tailP = seg.path.sample(trailT);
          const midP = seg.path.sample(midT);
          const tailX = tailP.x + (-tailP.ty) * laneOff;
          const tailY = tailP.y + tailP.tx * laneOff;
          const midX = midP.x + (-midP.ty) * laneOff;
          const midY = midP.y + midP.tx * laneOff;

          ctx.globalAlpha = edgeFade * 0.25;
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(px, py, Math.min(4.2, pt.size * 1.65), 0, Math.PI * 2);
          ctx.fill();

          ctx.globalAlpha = edgeFade * 0.38;
          ctx.strokeStyle = color;
          ctx.lineWidth = Math.min(2.6, pt.size * 1.0);
          ctx.beginPath();
          ctx.moveTo(tailX, tailY);
          ctx.lineTo(midX, midY);
          ctx.lineTo(px, py);
          ctx.stroke();

          ctx.globalAlpha = edgeFade * 0.94;
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(px, py, Math.min(2.2, pt.size * 0.7), 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    }

    _draw4WayShuttle(ctx) {
      // Valve box interior x: 544..656, y: 128..176
      // Ports: I=(544, 152), S=(568, 176), D=(632, 176), O=(656, 152)
      const shift = this.valveShuttlePos; // 0 = Cooling (connects I-S & D->O), 1 = Heating (connects O-S & D->I)
      ctx.save();
      // Pilot slide cavity connecting left or right pair to S
      const slideX = RefDB.lerp(548, 604, shift);
      ctx.fillStyle = '#475569';
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.roundRect(slideX, 146, 52, 26, 10);
      ctx.fill();
      ctx.stroke();

      // Arrow showing active shuttle connection inside valve
      ctx.strokeStyle = shift < 0.5 ? '#38bdf8' : '#ef4444';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      if (shift < 0.5) {
        // Cooling: I->S curved dome, D->O open path
        ctx.moveTo(552, 154);
        ctx.quadraticCurveTo(568, 154, 568, 172);
        ctx.stroke();
        ctx.strokeStyle = '#ef4444';
        ctx.beginPath();
        ctx.moveTo(632, 172);
        ctx.quadraticCurveTo(632, 144, 650, 152);
        ctx.stroke();
      } else {
        // Heating: O->S curved dome, D->I open path
        ctx.strokeStyle = '#38bdf8';
        ctx.moveTo(648, 154);
        ctx.quadraticCurveTo(615, 154, 568, 172);
        ctx.stroke();
        ctx.strokeStyle = '#ef4444';
        ctx.beginPath();
        ctx.moveTo(632, 172);
        ctx.quadraticCurveTo(605, 134, 548, 152);
        ctx.stroke();
      }
      ctx.restore();
    }

    _drawOrbitingScroll(ctx) {
      const cx = 666;
      const cy = 316;
      const orbitR = 5.2;
      const ox = cx + Math.cos(this.scrollAngle) * orbitR;
      const oy = cy + Math.sin(this.scrollAngle) * orbitR;

      ctx.save();
      // Chamber backdrop
      ctx.fillStyle = '#0b1324';
      ctx.strokeStyle = '#475569';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, 42, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Compression gas glow inside scroll pockets
      const gasGrad = ctx.createRadialGradient(cx, cy, 4, cx, cy, 38);
      gasGrad.addColorStop(0, 'rgba(239, 68, 68, 0.78)');
      gasGrad.addColorStop(0.55, 'rgba(249, 115, 22, 0.35)');
      gasGrad.addColorStop(1, 'rgba(59, 130, 246, 0.25)');
      ctx.fillStyle = gasGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, 38, 0, Math.PI * 2);
      ctx.fill();

      const drawSpiral = (x0, y0, stroke, phaseOffset) => {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 3.2;
        ctx.lineCap = 'round';
        ctx.beginPath();
        const maxTheta = Math.PI * 3.4;
        for (let a = 0.2; a <= maxTheta; a += 0.14) {
          const r = 3.5 + a * 2.9;
          const x = x0 + Math.cos(a + phaseOffset) * r;
          const y = y0 + Math.sin(a + phaseOffset) * r;
          if (a === 0.2) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      };

      // Fixed scroll (Steel Slate)
      drawSpiral(cx, cy, '#94a3b8', 0);
      // Orbiting scroll (Bright Machined Silver-Cyan, orbits without rotating!)
      drawSpiral(ox, oy, '#38bdf8', Math.PI);

      // Center high-pressure discharge port
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.arc(cx, cy, 4.5, 0, Math.PI * 2);
      ctx.fill();

      // Oil sump foaming indicator if liquid floodback!
      if (this.state.performance.isFloodback) {
        ctx.fillStyle = 'rgba(248, 250, 252, 0.72)';
        for (let i = 0; i < 9; i++) {
          const bx = 616 + ((i * 13 + Math.sin(this.scrollAngle + i) * 4) % 98);
          const by = 452 + Math.cos(this.scrollAngle * 2 + i) * 4;
          ctx.beginPath();
          ctx.arc(bx, by, 2.5 + (i % 3), 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    }

    _drawBlowerWheel(ctx) {
      const cx = 178;
      const cy = 172;
      const r = 31;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(this.blowerAngle);
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 2;
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * 10, Math.sin(a) * 10);
        ctx.lineTo(Math.cos(a + 0.35) * r, Math.sin(a + 0.35) * r);
        ctx.stroke();
      }
      ctx.fillStyle = '#38bdf8';
      ctx.beginPath();
      ctx.arc(0, 0, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    _drawCondenserFan(ctx) {
      const cx = 1022;
      const cy = 118;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(1, 0.32); // Isometric ellipse perspective for top fan!
      ctx.rotate(this.condFanAngle);
      ctx.fillStyle = '#cbd5e1';
      for (let i = 0; i < 4; i++) {
        ctx.rotate(Math.PI / 2);
        ctx.beginPath();
        ctx.ellipse(30, 0, 28, 12, 0.25, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#475569';
      ctx.beginPath();
      ctx.arc(0, 0, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    _drawMeteringNeedle(ctx, isCooling) {
      const s = this.state;
      const openPct = this.vis ? this.vis.valveOpenPct : s.performance.valveOpenPct;
      const activeX = isCooling ? 394 : 782;
      const bypassX = isCooling ? 782 : 394;

      ctx.save();
      // Active metering cutaway: needle lifts proportional to openPct
      const lift = (openPct / 100) * 11;
      // Throat seat
      ctx.fillStyle = '#b45309';
      ctx.fillRect(activeX - 18, 591, 12, 8);
      ctx.fillRect(activeX + 6, 591, 12, 8);

      // Moving valve pin / needle
      ctx.fillStyle = '#e2e8f0';
      ctx.beginPath();
      ctx.moveTo(activeX - 5, 578 - lift * 0.4);
      ctx.lineTo(activeX + 5, 578 - lift * 0.4);
      ctx.lineTo(activeX, 596 - lift * 0.7);
      ctx.closePath();
      ctx.fill();

      // Open percentage readout inside valve window
      ctx.fillStyle = '#22d3ee';
      ctx.font = '700 8.5px ui-monospace, monospace';
      ctx.textAlign = 'center';
      const txt = s.metering === 'fxo' ? 'ORIFICE' : s.metering === 'eev' ? `S:${Math.round(openPct * 4.8)}` : `${Math.round(openPct)}%`;
      ctx.fillText(txt, activeX, 611);

      // Bypassed valve check symbol + directional flow arrow
      const dir = isCooling ? -1 : 1; // Cooling flows left (-1), Heating flows right (+1)
      ctx.strokeStyle = '#10b981';
      ctx.fillStyle = '#10b981';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(bypassX - 16, 591);
      ctx.lineTo(bypassX + 16, 591);
      ctx.moveTo(bypassX + dir * 10, 586);
      ctx.lineTo(bypassX + dir * 16, 591);
      ctx.lineTo(bypassX + dir * 10, 596);
      ctx.stroke();
      ctx.font = '700 7.5px system-ui, sans-serif';
      ctx.fillText('BYPASS', bypassX, 609);
      ctx.restore();
    }

    _drawSightGlass(ctx, dt) {
      const cx = 604;
      const cy = 595;
      const r = 10.5;
      const vis = this.vis || this.state.performance;
      const bubLevel = vis.sightGlassBubbles;
      const liqT = this.vis ? this.vis.liquidTempF : this.state.gauges.liquidTempF;

      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.clip();

      ctx.fillStyle = this.colorMode === 'thermal'
        ? tempToIRColor(liqT)
        : '#db2777';
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);

      // Swirling flash gas bubbles when subcooling collapses or drier restricted
      if (bubLevel > 0.03) {
        const activeCount = Math.ceil(clamp(bubLevel, 0, 1) * this.sightBubbles.length);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.88)';
        for (let i = 0; i < activeCount; i++) {
          const b = this.sightBubbles[i];
          b.x += b.vx * dt;
          b.y += b.vy * dt;
          if (b.y < -r) b.y = r;
          if (b.x < -r) b.x = r;
          if (b.x > r) b.x = -r;
          const bx = b.x * 0.7;
          const by = b.y * 0.8;
          const rimFade = Math.max(0, 1 - (bx * bx + by * by) / (r * r));
          ctx.globalAlpha = rimFade * clamp(bubLevel * 1.4, 0, 1);
          ctx.beginPath();
          ctx.arc(cx + bx, cy + by, b.r * 0.7, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Soft curved glass specular sheen
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
      ctx.lineWidth = 1.6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(cx, cy, r - 2.2, -Math.PI * 0.82, -Math.PI * 0.25);
      ctx.stroke();
      ctx.restore();
    }

    _drawFrostAndCondensate(ctx, dt) {
      const s = this.state;
      const p = s.performance;
      const g = s.gauges;
      const vis = this.vis || p;
      const frost = vis.frostLevel;
      const condGPH = vis.condensateGPH;
      const drierDP = this.vis ? this.vis.drierDeltaP : g.drierDeltaP;
      const isCooling = s.mode === 'cooling';

      ctx.save();
      // Condensate droplets falling from Indoor Coil into Drain Pan (Cooling mode)
      if (isCooling && condGPH > 0.02 && frost < 0.78) {
        const numDrops = Math.min(16, Math.ceil(condGPH * 12));
        const freezeFade = clamp(1 - (frost - 0.5) / 0.28, 0, 1);
        ctx.fillStyle = '#38bdf8';
        for (let i = 0; i < numDrops; i++) {
          const d = this.condensateDrops[i];
          d.y = (d.y + dt * d.speed) % 1;
          const dx = 92 + d.xFrac * 182;
          const dy = 502 + d.y * 28;
          ctx.globalAlpha = Math.sin(Math.PI * d.y) * freezeFade * 0.88;
          ctx.beginPath();
          ctx.ellipse(dx, dy, 1.7, 2.7, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      ctx.globalAlpha = 1;
      // Ice / Frost buildup on whichever coil is acting as Evaporator
      if (frost > 0.02) {
        const fx = isCooling ? 84 : 910;
        const fy = isCooling ? 252 : 226;
        const fw = 206;
        const fh = isCooling ? 264 : 284;
        const frostH = fh * RefDB.clamp(frost * 1.1, 0.15, 1.0);
        const startY = fy + fh - frostH;

        const frostGrad = ctx.createLinearGradient(fx, fy + fh, fx, startY);
        frostGrad.addColorStop(0, `rgba(224, 242, 254, ${(0.56 * frost).toFixed(3)})`);
        frostGrad.addColorStop(1, `rgba(186, 230, 253, ${(0.06 * frost).toFixed(3)})`);
        ctx.fillStyle = frostGrad;
        ctx.beginPath();
        ctx.roundRect(fx, startY, fw, frostH, 5);
        ctx.fill();

        // Crisp crystalline frost glint crosses
        ctx.strokeStyle = `rgba(255, 255, 255, ${(0.72 * frost).toFixed(3)})`;
        ctx.lineWidth = 1.2;
        ctx.lineCap = 'round';
        for (let i = 0; i < 14; i++) {
          const cx = fx + 18 + ((i * 47) % (fw - 36));
          const cy = startY + 12 + ((i * 53) % Math.max(20, frostH - 24));
          ctx.beginPath();
          ctx.moveTo(cx - 4, cy);
          ctx.lineTo(cx + 4, cy);
          ctx.moveTo(cx, cy - 4);
          ctx.lineTo(cx, cy + 4);
          ctx.stroke();
        }
      }

      // Frost/Sweat ring right on outlet of clogged Filter-Drier
      if (drierDP > 3) {
        const exitX = isCooling ? 472 : 550;
        const ringAlpha = clamp((drierDP - 3) / 6, 0, 1);
        const frostHalo = ctx.createRadialGradient(exitX, 595, 2, exitX, 595, 13);
        frostHalo.addColorStop(0, `rgba(224, 242, 254, ${(0.82 * ringAlpha).toFixed(3)})`);
        frostHalo.addColorStop(1, 'rgba(224, 242, 254, 0)');
        ctx.fillStyle = frostHalo;
        ctx.beginPath();
        ctx.arc(exitX, 595, 13, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    _renderAirParticles(ctx, dt) {
      const s = this.state;
      const p = s.performance;
      const isCooling = s.mode === 'cooling';
      const indSpeed = RefDB.clamp(s.inputs.indoorCFMPerTon / 400, 0.3, 1.3);
      const outSpeed = RefDB.clamp(s.inputs.condAirflowPct / 100, 0.2, 1.2);

      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 2;

      for (const ap of this.airParticles) {
        if (ap.side === 'indoor') {
          ap.p = (ap.p + dt * 0.34 * ap.speed * indSpeed) % 1;
          const x = 178 + ap.lane * 145;
          const y = 30 + ap.p * 635;
          const edgeAlpha = Math.sin(Math.PI * ap.p);
          if (edgeAlpha <= 0.02) continue;

          // Smooth color transition across indoor coil (y = 260..510)
          const across = smoothstep(0.24, 0.80, (y - 250) / 260);
          const airT = RefDB.lerp(s.inputs.indoorDB, p.indoorSupplyDB, across);
          ctx.strokeStyle = this.colorMode === 'thermal'
            ? tempToIRColor(airT)
            : (isCooling ? lerpColor('#fbbf24', '#38bdf8', across) : lerpColor('#60a5fa', '#f97316', across));
          ctx.globalAlpha = 0.62 * edgeAlpha;
          ctx.beginPath();
          ctx.moveTo(x, y - 13);
          ctx.lineTo(x, y + 4);
          ctx.lineTo(x - 3.2, y - 0.5);
          ctx.moveTo(x, y + 4);
          ctx.lineTo(x + 3.2, y - 0.5);
          ctx.stroke();
        } else {
          ap.p = (ap.p + dt * 0.36 * ap.speed * outSpeed) % 1;
          const u = ap.p;
          const edgeAlpha = Math.sin(Math.PI * u);
          if (edgeAlpha <= 0.02) continue;

          // Smooth quadratic Bezier streamline curving cleanly through condenser intake -> top fan
          const yIn = 248 + (ap.lane + 0.5) * 230;
          const p0x = 1178, p0y = yIn;
          const p1x = 1022 + ap.lane * 84, p1y = yIn;
          const p2x = 1022 + ap.lane * 76, p2y = 36;

          const evalQ = (tVal) => {
            const omt = 1 - tVal;
            return {
              x: omt * omt * p0x + 2 * omt * tVal * p1x + tVal * tVal * p2x,
              y: omt * omt * p0y + 2 * omt * tVal * p1y + tVal * tVal * p2y
            };
          };

          const head = evalQ(u);
          const tail = evalQ(Math.max(0, u - 0.032));
          // Exact tangent at u
          const dqx = 2 * (1 - u) * (p1x - p0x) + 2 * u * (p2x - p1x);
          const dqy = 2 * (1 - u) * (p1y - p0y) + 2 * u * (p2y - p1y);
          const dLen = Math.hypot(dqx, dqy) || 1;
          const tx = dqx / dLen;
          const ty = dqy / dLen;
          const nx = -ty;
          const ny = tx;

          const heatT = smoothstep(0.20, 0.72, u);
          const exhaustHex = isCooling ? '#ef4444' : '#38bdf8';
          const outT = RefDB.lerp(s.inputs.outdoorDB, p.outdoorExhaustDB, heatT);
          ctx.strokeStyle = this.colorMode === 'thermal'
            ? tempToIRColor(outT)
            : lerpColor('#94a3b8', exhaustHex, heatT);
          ctx.globalAlpha = 0.62 * edgeAlpha;

          ctx.beginPath();
          ctx.moveTo(tail.x, tail.y);
          ctx.lineTo(head.x, head.y);
          ctx.lineTo(head.x - tx * 4.5 + nx * 3.0, head.y - ty * 4.5 + ny * 3.0);
          ctx.moveTo(head.x, head.y);
          ctx.lineTo(head.x - tx * 4.5 - nx * 3.0, head.y - ty * 4.5 - ny * 3.0);
          ctx.stroke();
        }
      }
      ctx.restore();
    }
  }

  global.HVACRenderer = CycleRenderer;
})(typeof window !== 'undefined' ? window : globalThis);
