/**
 * Interactive Pressure-Enthalpy (P-H) Mollier Diagram Renderer
 * Plots real refrigerant saturation dome, constant quality lines, isotherms,
 * and the live 1-2-3-4 vapor-compression cycle with Flash Gas & NRE readouts.
 */
(function (global) {
  'use strict';

  const RefDB = global.HVACRef;

  class PHDiagram {
    constructor(canvas, options = {}) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.onHoverPoint = options.onHoverPoint || null;
      this.onSelectNode = options.onSelectNode || null;
      this.state = null;
      this.hoverIdx = null; // 'p1' | 'p2' | 'p3' | 'p4' | null
      this.phasePulse = 0;
      this.theme = 'dark';
      this.screenPoints = {};
      this.smoothPh = null;
      this.lastRefId = null;
      this.visHMax = null;

      this._bindEvents();
    }

    setTheme(theme) {
      this.theme = theme;
    }

    setState(cycleState) {
      this.state = cycleState;
      if (cycleState && cycleState.ref && this.lastRefId !== cycleState.ref.id) {
        this.smoothPh = null;
        this.visHMax = null;
      }
    }

    _bindEvents() {
      this.canvas.addEventListener('mousemove', (e) => {
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        let closest = null;
        let minDist = 24;
        for (const [key, pt] of Object.entries(this.screenPoints)) {
          const d = Math.hypot(x - pt.x, y - pt.y);
          if (d < minDist) {
            minDist = d;
            closest = key;
          }
        }
        if (closest !== this.hoverIdx) {
          this.hoverIdx = closest;
          this.canvas.style.cursor = closest ? 'pointer' : 'default';
          if (this.onHoverPoint) this.onHoverPoint(closest);
        }
      });

      this.canvas.addEventListener('mouseleave', () => {
        if (this.hoverIdx !== null) {
          this.hoverIdx = null;
          this.canvas.style.cursor = 'default';
          if (this.onHoverPoint) this.onHoverPoint(null);
        }
      });

      this.canvas.addEventListener('click', () => {
        if (this.hoverIdx && this.onSelectNode) {
          const map = { p1: 'suction_line', p2: 'discharge_line', p3: 'liquid_line', p4: 'metering_device' };
          this.onSelectNode(map[this.hoverIdx]);
        }
      });
    }

    render(dt = 0.016, animSpeed = 1, paused = false) {
      if (!this.state) return;
      if (!paused && dt > 0) {
        this.phasePulse = (((this.phasePulse + dt * 0.42 * animSpeed) % 4) + 4) % 4;
      }

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cssW = this.canvas.clientWidth || 380;
      const cssH = this.canvas.clientHeight || 300;
      if (this.canvas.width !== Math.round(cssW * dpr) || this.canvas.height !== Math.round(cssH * dpr)) {
        this.canvas.width = Math.round(cssW * dpr);
        this.canvas.height = Math.round(cssH * dpr);
      }

      const ctx = this.ctx;
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, cssW, cssH);

      const isLight = this.theme === 'light';
      const bg = isLight ? '#ffffff' : '#0b1324';
      const gridColor = isLight ? 'rgba(15, 23, 42, 0.08)' : 'rgba(148, 163, 184, 0.11)';
      const axisText = isLight ? '#475569' : '#94a3b8';
      const titleText = isLight ? '#0f172a' : '#e2e8f0';
      const domeFill = isLight ? 'rgba(14, 165, 233, 0.08)' : 'rgba(56, 189, 248, 0.08)';
      const domeStroke = isLight ? '#0284c7' : '#38bdf8';

      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, cssW, cssH);

      const pad = { l: 48, r: 16, t: 24, b: 38 };
      const plotW = Math.max(120, cssW - pad.l - pad.r);
      const plotH = Math.max(100, cssH - pad.t - pad.b);

      const ref = this.state.ref;
      const ph = this.state.phPoints;
      const dome = RefDB.getSaturationDome(ref.id);
      const damp = 1 - Math.exp(-10 * Math.max(0.004, dt));

      if (!this.smoothPh || this.lastRefId !== ref.id) {
        this.lastRefId = ref.id;
        this.smoothPh = {
          p1: { h: ph.p1.h, P_psia: ph.p1.P_psia },
          p2: { h: ph.p2.h, P_psia: ph.p2.P_psia },
          p3: { h: ph.p3.h, P_psia: ph.p3.P_psia },
          p4: { h: ph.p4.h, P_psia: ph.p4.P_psia },
          nre: ph.nre,
          flashGasQuality: this.state.performance.flashGasQuality
        };
      } else {
        for (const key of ['p1', 'p2', 'p3', 'p4']) {
          this.smoothPh[key].h += (ph[key].h - this.smoothPh[key].h) * damp;
          this.smoothPh[key].P_psia += (ph[key].P_psia - this.smoothPh[key].P_psia) * damp;
        }
        this.smoothPh.nre += (ph.nre - this.smoothPh.nre) * damp;
        this.smoothPh.flashGasQuality += (this.state.performance.flashGasQuality - this.smoothPh.flashGasQuality) * damp;
      }
      const visPh = this.smoothPh;

      // Axis domains tailored cleanly to current refrigerant
      const hMin = -10;
      const targetHMax = Math.max(165, Math.ceil((Math.max(ph.p2.h, visPh.p2.h) + 18) / 20) * 20);
      this.visHMax = this.visHMax === null ? targetHMax : this.visHMax + (targetHMax - this.visHMax) * damp;
      const hMax = this.visHMax;
      const pMin = Math.max(4, Math.floor(dome[0].P_dew_psia * 0.75));
      const pMax = Math.ceil(ref.Pc_psia * 1.12);
      const logPMin = Math.log10(pMin);
      const logPMax = Math.log10(pMax);

      const xOf = (h) => pad.l + ((h - hMin) / (hMax - hMin)) * plotW;
      const yOf = (pPsia) => {
        const lp = Math.log10(Math.max(pMin, pPsia));
        return pad.t + plotH - ((lp - logPMin) / (logPMax - logPMin)) * plotH;
      };

      // Grid lines (Enthalpy)
      ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.lineWidth = 1;
      for (let h = 0; h <= hMax; h += 25) {
        const x = xOf(h);
        ctx.strokeStyle = gridColor;
        ctx.beginPath();
        ctx.moveTo(x, pad.t);
        ctx.lineTo(x, pad.t + plotH);
        ctx.stroke();

        ctx.fillStyle = axisText;
        ctx.textAlign = 'center';
        ctx.fillText(`${h}`, x, pad.t + plotH + 13);
      }

      // Grid lines (Log Pressure in psia)
      const pTicks = [10, 20, 40, 60, 100, 150, 200, 300, 400, 600, 800];
      for (const p of pTicks) {
        if (p < pMin || p > pMax) continue;
        const y = yOf(p);
        ctx.strokeStyle = gridColor;
        ctx.beginPath();
        ctx.moveTo(pad.l, y);
        ctx.lineTo(pad.l + plotW, y);
        ctx.stroke();

        ctx.fillStyle = axisText;
        ctx.textAlign = 'right';
        ctx.fillText(`${p}`, pad.l - 5, y + 3);
      }

      // Plot frame
      ctx.strokeStyle = isLight ? '#cbd5e1' : '#334155';
      ctx.strokeRect(pad.l, pad.t, plotW, plotH);

      // Axis titles
      ctx.fillStyle = axisText;
      ctx.textAlign = 'center';
      ctx.font = '600 10px system-ui, -apple-system, sans-serif';
      ctx.fillText('Enthalpy h (BTU/lb)', pad.l + plotW / 2, cssH - 6);

      ctx.save();
      ctx.translate(12, pad.t + plotH / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText('Pressure (psia, log)', 0, 0);
      ctx.restore();

      // Draw Saturation Dome fill & curves
      ctx.beginPath();
      for (let i = 0; i < dome.length; i++) {
        const x = xOf(dome[i].hf);
        const y = yOf(dome[i].P_bub_psia);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      for (let i = dome.length - 1; i >= 0; i--) {
        const x = xOf(dome[i].hg);
        const y = yOf(dome[i].P_dew_psia);
        ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fillStyle = domeFill;
      ctx.fill();

      // Constant Quality Contours inside dome (20%, 40%, 60%, 80%)
      ctx.save();
      ctx.setLineDash([2, 3]);
      ctx.strokeStyle = isLight ? 'rgba(2, 132, 199, 0.25)' : 'rgba(56, 189, 248, 0.22)';
      ctx.lineWidth = 1;
      for (const q of [0.2, 0.4, 0.6, 0.8]) {
        ctx.beginPath();
        for (let i = 0; i < dome.length; i++) {
          const d = dome[i];
          const hq = d.hf + q * (d.hg - d.hf);
          const pq = d.P_bub_psia + q * (d.P_dew_psia - d.P_bub_psia);
          const x = xOf(hq);
          const y = yOf(pq);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.restore();

      // Constant Temperature Isotherms (40°F, 100°F) subtle reference
      ctx.save();
      ctx.strokeStyle = isLight ? 'rgba(100,116,139,0.22)' : 'rgba(148,163,184,0.16)';
      ctx.lineWidth = 1;
      for (const isoT of [40, 100]) {
        const st = RefDB.lookupByTemp(ref.id, isoT);
        const xL = xOf(st.hf);
        const yL = yOf(st.P_bub_psia);
        const xR = xOf(st.hg);
        const yR = yOf(st.P_dew_psia);
        ctx.beginPath();
        // Steep liquid subcool line
        ctx.moveTo(xL - 3, pad.t + 6);
        ctx.lineTo(xL, yL);
        // Phase-change tie line (slanted slightly on blends!)
        ctx.lineTo(xR, yR);
        // Gentle downward superheat isotherm
        ctx.lineTo(Math.min(pad.l + plotW - 4, xR + 28), Math.min(pad.t + plotH - 4, yR + 55));
        ctx.stroke();

        ctx.fillStyle = axisText;
        ctx.font = '9px ui-monospace, monospace';
        ctx.textAlign = 'left';
        ctx.fillText(`${isoT}°F`, xL + 4, yL - 3);
      }
      ctx.restore();

      // Saturated Liquid & Saturated Vapor Dome Outlines
      ctx.strokeStyle = domeStroke;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      for (let i = 0; i < dome.length; i++) {
        const x = xOf(dome[i].hf);
        const y = yOf(dome[i].P_bub_psia);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      ctx.beginPath();
      for (let i = 0; i < dome.length; i++) {
        const x = xOf(dome[i].hg);
        const y = yOf(dome[i].P_dew_psia);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Critical Point Marker
      const crit = dome[dome.length - 1];
      const critX = xOf(crit.hf);
      const critY = yOf(crit.P_bub_psia);
      ctx.fillStyle = domeStroke;
      ctx.beginPath();
      ctx.arc(critX, critY, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = '600 9px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = domeStroke;
      ctx.fillText(`Crit (${ref.Tc.toFixed(0)}°F)`, critX, Math.max(pad.t + 10, critY - 6));

      // Compute smoothed cycle corner screen coordinates
      const p1 = { x: xOf(visPh.p1.h), y: yOf(visPh.p1.P_psia), raw: ph.p1 };
      const p2 = { x: xOf(visPh.p2.h), y: yOf(visPh.p2.P_psia), raw: ph.p2 };
      const p3 = { x: xOf(visPh.p3.h), y: yOf(visPh.p3.P_psia), raw: ph.p3 };
      const p4 = { x: xOf(visPh.p4.h), y: yOf(visPh.p4.P_psia), raw: ph.p4 };
      this.screenPoints = { p1, p2, p3, p4 };

      // Subtle translucent cycle area fill
      ctx.fillStyle = isLight ? 'rgba(14, 165, 233, 0.05)' : 'rgba(56, 189, 248, 0.055)';
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.lineTo(p3.x, p3.y);
      ctx.lineTo(p4.x, p4.y);
      ctx.closePath();
      ctx.fill();

      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // 1 -> 2 Compression (Red-Orange)
      ctx.lineWidth = 2.8;
      const g12 = ctx.createLinearGradient(p1.x, p1.y, p2.x, p2.y);
      g12.addColorStop(0, '#3b82f6');
      g12.addColorStop(0.55, '#f97316');
      g12.addColorStop(1, '#ef4444');
      ctx.strokeStyle = g12;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();

      // 2 -> 3 Condensing + Subcooling (Red -> Deep Magenta/Ruby)
      const g23 = ctx.createLinearGradient(p2.x, p2.y, p3.x, p3.y);
      g23.addColorStop(0, '#ef4444');
      g23.addColorStop(0.75, '#f43f5e');
      g23.addColorStop(1, '#db2777');
      ctx.strokeStyle = g23;
      ctx.beginPath();
      ctx.moveTo(p2.x, p2.y);
      ctx.lineTo(p3.x, p3.y);
      ctx.stroke();

      // 3 -> 4 Isenthalpic Expansion (Magenta -> Cyan)
      const g34 = ctx.createLinearGradient(p3.x, p3.y, p4.x, p4.y);
      g34.addColorStop(0, '#db2777');
      g34.addColorStop(1, '#06b6d4');
      ctx.strokeStyle = g34;
      ctx.beginPath();
      ctx.moveTo(p3.x, p3.y);
      ctx.lineTo(p4.x, p4.y);
      ctx.stroke();

      // 4 -> 1 Evaporation + Superheating (Cyan -> Blue)
      const g41 = ctx.createLinearGradient(p4.x, p4.y, p1.x, p1.y);
      g41.addColorStop(0, '#06b6d4');
      g41.addColorStop(0.85, '#38bdf8');
      g41.addColorStop(1, '#3b82f6');
      ctx.strokeStyle = g41;
      ctx.beginPath();
      ctx.moveTo(p4.x, p4.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();

      // NRE Bracket below 4 -> 1
      const bracketY = Math.min(pad.t + plotH - 6, Math.max(p4.y, p1.y) + 13);
      ctx.strokeStyle = isLight ? '#0369a1' : '#38bdf8';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(p4.x, bracketY - 3);
      ctx.lineTo(p4.x, bracketY);
      ctx.lineTo(p1.x, bracketY);
      ctx.lineTo(p1.x, bracketY - 3);
      ctx.stroke();
      ctx.fillStyle = isLight ? '#0369a1' : '#7dd3fc';
      ctx.font = '600 9px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`NRE ${visPh.nre.toFixed(1)} BTU/lb`, (p4.x + p1.x) / 2, bracketY + 10);

      // Flash Gas % callout next to Point 4
      const fgPct = (visPh.flashGasQuality * 100).toFixed(0);
      ctx.fillStyle = isLight ? '#0e7490' : '#22d3ee';
      ctx.textAlign = 'right';
      ctx.fillText(`Flash ${fgPct}%`, p4.x - 6, p4.y + 3);

      // Traveling animated cycle bead with smooth halo tail
      const segs = [
        [p1, p2],
        [p2, p3],
        [p3, p4],
        [p4, p1]
      ];
      for (let tStep = 3; tStep >= 0; tStep--) {
        const tp = (((this.phasePulse - tStep * 0.045) % 4) + 4) % 4;
        const tIdx = Math.floor(tp) % 4;
        const tFrac = tp - Math.floor(tp);
        const seg = segs[tIdx];
        if (!seg) continue;
        const [a, b] = seg;
        const bx = a.x + (b.x - a.x) * tFrac;
        const by = a.y + (b.y - a.y) * tFrac;
        if (tStep === 0) {
          ctx.fillStyle = 'rgba(56, 189, 248, 0.32)';
          ctx.beginPath();
          ctx.arc(bx, by, 7.2, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(bx, by, 3.6, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillStyle = `rgba(125, 211, 252, ${(0.38 - tStep * 0.1).toFixed(2)})`;
          ctx.beginPath();
          ctx.arc(bx, by, 3.1 - tStep * 0.55, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Draw State Points 1, 2, 3, 4
      const ptStyles = [
        { key: 'p1', color: '#3b82f6', ox: 10, oy: 10 },
        { key: 'p2', color: '#ef4444', ox: 10, oy: -8 },
        { key: 'p3', color: '#db2777', ox: -12, oy: -8 },
        { key: 'p4', color: '#06b6d4', ox: -11, oy: 11 }
      ];
      for (const ps of ptStyles) {
        const pt = this.screenPoints[ps.key];
        const isHov = this.hoverIdx === ps.key;
        ctx.fillStyle = ps.color;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = isHov ? 2.5 : 1.5;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, isHov ? 6.5 : 4.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = titleText;
        ctx.font = '700 11px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(pt.raw.label, pt.x + ps.ox, pt.y + ps.oy);
      }

      // Header inside chart
      ctx.fillStyle = titleText;
      ctx.font = '700 11px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`${ref.shortName} P-H Diagram`, pad.l + 6, pad.t + 14);

      // Hover readout pill
      if (this.hoverIdx && this.screenPoints[this.hoverIdx]) {
        const pt = this.screenPoints[this.hoverIdx].raw;
        const txt = `Pt ${pt.label}: ${pt.name} • ${RefDB.formatPressure(pt.P_psig)} • ${pt.T.toFixed(1)}°F • h=${pt.h.toFixed(1)} BTU/lb`;
        ctx.font = '600 10px ui-monospace, monospace';
        const tw = ctx.measureText(txt).width + 14;
        const bxPos = Math.min(cssW - tw - 6, pad.l + 4);
        ctx.fillStyle = isLight ? 'rgba(15,23,42,0.92)' : 'rgba(15,23,42,0.95)';
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(bxPos, 3, tw, 18, 4);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#f8fafc';
        ctx.textAlign = 'left';
        ctx.fillText(txt, bxPos + 7, 15);
      }

      ctx.restore();
    }
  }

  global.HVACPHDiagram = PHDiagram;
})(typeof window !== 'undefined' ? window : globalThis);
