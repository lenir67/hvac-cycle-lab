/**
 * Interactive Pressure-Enthalpy (P-H) Mollier Diagram Renderer
 * Backed by HVACPhysicsLib.Refrigerants for true quality contours, curved isotherms,
 * polytropic compression curve (1->2), drier/expansion step (3->3b->4), and CO2 transcritical support.
 */
(function (global) {
  'use strict';

  const RefDB = global.HVACRef;
  const Lib = global.HVACPhysicsLib;
  const NODE_MAP = {
    p1: 'suction_line',
    p2: 'discharge_line',
    p3: 'liquid_line',
    p4: 'metering_device'
  };

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

    /** Return the closest state point key ('p1'..'p4') within maxDist CSS px. */
    _findClosestPoint(clientX, clientY, maxDist) {
      const rect = this.canvas.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      let closest = null;
      let minDist = maxDist;
      for (const [key, pt] of Object.entries(this.screenPoints)) {
        const d = Math.hypot(x - pt.x, y - pt.y);
        if (d < minDist) {
          minDist = d;
          closest = key;
        }
      }
      return closest;
    }

    /** Update hover state, cursor, and hover callback when the active point changes. */
    _updateHoverPoint(closest) {
      if (closest !== this.hoverIdx) {
        this.hoverIdx = closest;
        this.canvas.style.cursor = closest ? 'pointer' : 'default';
        if (this.onHoverPoint) this.onHoverPoint(closest);
      }
    }

    /** Notify node selection callback for a P-H state point key ('p1'..'p4'). */
    _selectPoint(key) {
      if (key && this.onSelectNode && NODE_MAP[key]) {
        this.onSelectNode(NODE_MAP[key]);
      }
    }

    _bindEvents() {
      const handleTouch = (e, select) => {
        const touch = e.touches && e.touches[0];
        if (!touch) return;
        const closest = this._findClosestPoint(touch.clientX, touch.clientY, 30);
        this._updateHoverPoint(closest);
        if (select) {
          this._selectPoint(closest);
        }
      };

      this.canvas.addEventListener('mousemove', (e) => {
        this._updateHoverPoint(this._findClosestPoint(e.clientX, e.clientY, 24));
      });

      this.canvas.addEventListener('mouseleave', () => {
        this._updateHoverPoint(null);
      });

      this.canvas.addEventListener('click', () => {
        this._selectPoint(this.hoverIdx);
      });

      this.canvas.addEventListener('touchstart', (e) => handleTouch(e, true), { passive: true });
      this.canvas.addEventListener('touchmove', (e) => handleTouch(e, false), { passive: true });
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
      const fid = ref.fid;
      const ph = this.state.phPoints;
      const p3bSrc = ph.p3b || ph.p3;
      const dome = RefDB.getSaturationDome(ref.id);
      const damp = 1 - Math.exp(-10 * Math.max(0.004, dt));

      if (!this.smoothPh || this.lastRefId !== ref.id) {
        this.lastRefId = ref.id;
        this.smoothPh = {
          p1: { h: ph.p1.h, P_psia: ph.p1.P_psia },
          p2: { h: ph.p2.h, P_psia: ph.p2.P_psia },
          p3: { h: ph.p3.h, P_psia: ph.p3.P_psia },
          p3b: { h: p3bSrc.h, P_psia: p3bSrc.P_psia },
          p4: { h: ph.p4.h, P_psia: ph.p4.P_psia },
          nre: ph.nre,
          flashGasQuality: this.state.performance.flashGasQuality
        };
      } else {
        for (const key of ['p1', 'p2', 'p3', 'p4']) {
          this.smoothPh[key].h += (ph[key].h - this.smoothPh[key].h) * damp;
          this.smoothPh[key].P_psia += (ph[key].P_psia - this.smoothPh[key].P_psia) * damp;
        }
        this.smoothPh.p3b.h += (p3bSrc.h - this.smoothPh.p3b.h) * damp;
        this.smoothPh.p3b.P_psia += (p3bSrc.P_psia - this.smoothPh.p3b.P_psia) * damp;
        this.smoothPh.nre += (ph.nre - this.smoothPh.nre) * damp;
        this.smoothPh.flashGasQuality += (this.state.performance.flashGasQuality - this.smoothPh.flashGasQuality) * damp;
      }
      const visPh = this.smoothPh;

      // Axis domains tailored cleanly to current refrigerant (including R-290 high enthalpy & R-744 transcritical pressure)
      const hMin = Math.min(-10, Math.floor((dome[0].hf - 10) / 10) * 10);
      let domeMaxH = 150;
      for (let i = 0; i < dome.length; i++) {
        if (dome[i].hg > domeMaxH) domeMaxH = dome[i].hg;
      }
      const targetHMax = Math.max(165, Math.ceil((Math.max(ph.p2.h, visPh.p2.h, domeMaxH) + 20) / 20) * 20);
      this.visHMax = this.visHMax === null ? targetHMax : this.visHMax + (targetHMax - this.visHMax) * damp;
      const hMax = this.visHMax;
      const pMin = Math.max(4, Math.floor(dome[0].P_dew_psia * 0.75));
      const pMax = Math.ceil(Math.max(ref.Pc_psia * 1.12, ph.p2.P_psia * 1.08, visPh.p2.P_psia * 1.08));
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
      const hStep = (hMax - hMin) > 250 ? 50 : 25;
      const hStart = Math.ceil(hMin / hStep) * hStep;
      for (let h = hStart; h <= hMax; h += hStep) {
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

      // Grid lines (Log Pressure in psia — extended dynamically up to 2000 psia for R-744)
      const pTicks = [10, 20, 40, 60, 100, 150, 200, 300, 400, 600, 800, 1000, 1200, 1500, 2000];
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

      // Clip interior curves cleanly to plot box
      ctx.save();
      ctx.beginPath();
      ctx.rect(pad.l, pad.t, plotW, plotH);
      ctx.clip();

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

      // Constant Quality Contours inside dome (20%, 40%, 60%, 80%) via Lib.Refrigerants.stateAtPQ
      ctx.save();
      ctx.setLineDash([2, 3]);
      ctx.strokeStyle = isLight ? 'rgba(2, 132, 199, 0.25)' : 'rgba(56, 189, 248, 0.22)';
      ctx.lineWidth = 1;
      const crit = dome[dome.length - 1];
      for (const q of [0.2, 0.4, 0.6, 0.8]) {
        ctx.beginPath();
        let started = false;
        for (let i = 0; i < dome.length - 1; i += 2) {
          const stQ = Lib.Refrigerants.stateAtPQ(fid, dome[i].P_bub_psia, q);
          const x = xOf(stQ.hBtuLb);
          const y = yOf(stQ.pPsia);
          if (!started) {
            ctx.moveTo(x, y);
            started = true;
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.lineTo(xOf(crit.hf), yOf(crit.P_bub_psia));
        ctx.stroke();
      }
      ctx.restore();

      // True Curved Constant Temperature Isotherms via Lib.Refrigerants.getIsotherm
      ctx.save();
      ctx.strokeStyle = isLight ? 'rgba(100,116,139,0.24)' : 'rgba(148,163,184,0.18)';
      ctx.lineWidth = 1;
      const isoTemps = ref.hasSupercritical ? [40, 80, 100, 120] : [40, 100];
      const pMinIso = Math.max(pMin, ref.meta ? ref.meta.pMinPsia : pMin);
      const pMaxIso = Math.min(pMax, ref.hasSupercritical ? pMax : (ref.meta ? ref.meta.pMaxPsia : pMax));
      for (const isoT of isoTemps) {
        const ptsIso = Lib.Refrigerants.getIsotherm(fid, isoT, pMinIso, pMaxIso, 34);
        if (!ptsIso || ptsIso.length < 2) continue;
        ctx.beginPath();
        for (let i = 0; i < ptsIso.length; i++) {
          const x = xOf(ptsIso[i].hBtuLb);
          const y = yOf(ptsIso[i].pPsia);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // Label isotherm near its upper-right / vapor knee
        const labelPt = ptsIso[Math.min(ptsIso.length - 1, Math.floor(ptsIso.length * 0.45))];
        ctx.fillStyle = axisText;
        ctx.font = '9px ui-monospace, monospace';
        ctx.textAlign = 'left';
        const lx = Math.min(pad.l + plotW - 32, Math.max(pad.l + 4, xOf(labelPt.hBtuLb) + 3));
        const ly = Math.max(pad.t + 12, Math.min(pad.t + plotH - 6, yOf(labelPt.pPsia) - 3));
        ctx.fillText(`${isoT}°F`, lx, ly);
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
      const p3b = { x: xOf(visPh.p3b.h), y: yOf(visPh.p3b.P_psia), raw: p3bSrc };
      const p4 = { x: xOf(visPh.p4.h), y: yOf(visPh.p4.P_psia), raw: ph.p4 };
      this.screenPoints = { p1, p2, p3, p4 };

      // Build curved 1 -> 2 thermodynamic compression path along constant-efficiency polytrope
      const compCurvePts = [];
      const compSteps = 14;
      const pLowVal = Math.max(pMin, visPh.p1.P_psia);
      const pHighVal = Math.max(pLowVal + 1, visPh.p2.P_psia);
      const s1State = Lib.Refrigerants.stateAtPH(fid, pLowVal, visPh.p1.h);
      const s2IsenState = Lib.Refrigerants.stateAtPS(fid, pHighVal, s1State.sBtuLbR);
      const dhActualTotal = visPh.p2.h - visPh.p1.h;
      const dhIsenTotal = s2IsenState.hBtuLb - visPh.p1.h;

      for (let k = 0; k <= compSteps; k++) {
        const frac = k / compSteps;
        if (k === 0) {
          compCurvePts.push({ x: p1.x, y: p1.y });
        } else if (k === compSteps) {
          compCurvePts.push({ x: p2.x, y: p2.y });
        } else {
          const pk = pLowVal * Math.pow(pHighVal / pLowVal, frac);
          const sk = Lib.Refrigerants.stateAtPS(fid, pk, s1State.sBtuLbR);
          const hk =
            Math.abs(dhIsenTotal) > 0.5
              ? visPh.p1.h + (sk.hBtuLb - visPh.p1.h) * (dhActualTotal / dhIsenTotal)
              : visPh.p1.h + frac * dhActualTotal;
          compCurvePts.push({ x: xOf(hk), y: yOf(pk) });
        }
      }

      // Subtle translucent cycle area fill
      ctx.fillStyle = isLight ? 'rgba(14, 165, 233, 0.05)' : 'rgba(56, 189, 248, 0.055)';
      ctx.beginPath();
      ctx.moveTo(compCurvePts[0].x, compCurvePts[0].y);
      for (let k = 1; k < compCurvePts.length; k++) {
        ctx.lineTo(compCurvePts[k].x, compCurvePts[k].y);
      }
      ctx.lineTo(p3.x, p3.y);
      ctx.lineTo(p3b.x, p3b.y);
      ctx.lineTo(p4.x, p4.y);
      ctx.closePath();
      ctx.fill();

      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // 1 -> 2 Curved Compression (Blue -> Red-Orange)
      ctx.lineWidth = 2.8;
      const g12 = ctx.createLinearGradient(p1.x, p1.y, p2.x, p2.y);
      g12.addColorStop(0, '#3b82f6');
      g12.addColorStop(0.55, '#f97316');
      g12.addColorStop(1, '#ef4444');
      ctx.strokeStyle = g12;
      ctx.beginPath();
      ctx.moveTo(compCurvePts[0].x, compCurvePts[0].y);
      for (let k = 1; k < compCurvePts.length; k++) {
        ctx.lineTo(compCurvePts[k].x, compCurvePts[k].y);
      }
      ctx.stroke();

      // 2 -> 3 Condensing + Subcooling (or Transcritical Gas Cooling) (Red -> Deep Magenta/Ruby)
      const g23 = ctx.createLinearGradient(p2.x, p2.y, p3.x, p3.y);
      g23.addColorStop(0, '#ef4444');
      g23.addColorStop(0.75, '#f43f5e');
      g23.addColorStop(1, '#db2777');
      ctx.strokeStyle = g23;
      ctx.beginPath();
      ctx.moveTo(p2.x, p2.y);
      ctx.lineTo(p3.x, p3.y);
      ctx.stroke();

      // 3 -> 3b -> 4 Drier Drop & Isenthalpic Expansion (Magenta -> Amber -> Cyan)
      const g34 = ctx.createLinearGradient(p3.x, p3.y, p4.x, p4.y);
      g34.addColorStop(0, '#db2777');
      g34.addColorStop(0.5, '#f59e0b');
      g34.addColorStop(1, '#06b6d4');
      ctx.strokeStyle = g34;
      ctx.beginPath();
      ctx.moveTo(p3.x, p3.y);
      ctx.lineTo(p3b.x, p3b.y);
      ctx.lineTo(p4.x, p4.y);
      ctx.stroke();

      // Highlight 3b post-drier step when restriction ΔP is significant
      if (this.state.gauges && this.state.gauges.drierDeltaP > 5) {
        ctx.fillStyle = '#f59e0b';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(p3b.x, p3b.y, 3.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#fbbf24';
        ctx.font = '700 9px ui-monospace, monospace';
        ctx.textAlign = 'right';
        ctx.fillText('3b (Drier)', p3b.x - 6, p3b.y + 3);
      }

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

      // Traveling animated cycle bead following curved 1->2, 2->3, 3->3b->4, 4->1
      const samplePoly = (pts, frac) => {
        if (pts.length < 2) return pts[0] || p1;
        const idxFloat = Math.max(0, Math.min(pts.length - 1, frac * (pts.length - 1)));
        const i0 = Math.floor(idxFloat);
        const i1 = Math.min(pts.length - 1, i0 + 1);
        const f = idxFloat - i0;
        return {
          x: pts[i0].x + (pts[i1].x - pts[i0].x) * f,
          y: pts[i0].y + (pts[i1].y - pts[i0].y) * f
        };
      };
      const segPolys = [
        compCurvePts,
        [p2, p3],
        [p3, p3b, p4],
        [p4, p1]
      ];
      for (let tStep = 3; tStep >= 0; tStep--) {
        const tp = (((this.phasePulse - tStep * 0.045) % 4) + 4) % 4;
        const tIdx = Math.floor(tp) % 4;
        const tFrac = tp - Math.floor(tp);
        const pos = samplePoly(segPolys[tIdx], tFrac);
        if (tStep === 0) {
          ctx.fillStyle = 'rgba(56, 189, 248, 0.32)';
          ctx.beginPath();
          ctx.arc(pos.x, pos.y, 7.2, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(pos.x, pos.y, 3.6, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillStyle = `rgba(125, 211, 252, ${(0.38 - tStep * 0.1).toFixed(2)})`;
          ctx.beginPath();
          ctx.arc(pos.x, pos.y, 3.1 - tStep * 0.55, 0, Math.PI * 2);
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
      ctx.fillText(
        this.state.isTranscritical ? `${ref.shortName} Transcritical P-H` : `${ref.shortName} P-H Diagram`,
        pad.l + 6,
        pad.t + 14
      );

      ctx.restore(); // end plot clip

      // Hover readout pill (outside clip so it renders cleanly at top)
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
