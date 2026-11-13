/**
 * Refrigerant Thermophysical Property Database & Interpolation Engine
 * Standard ASHRAE IP Reference Datum: h_f = 0.0 BTU/lb at -40°F
 * Pressures in PSIG (relative to 14.696 psia standard atmosphere)
 */
(function (global) {
  'use strict';

  const ATM_PSIA = 14.696;

  // Table row schema: [T_F, P_bub_psig, P_dew_psig, hf_btu_lb, hg_btu_lb, rho_f_lb_ft3, rho_g_lb_ft3]
  const REFRIGERANTS = {
    R410A: {
      id: 'R410A',
      name: 'R-410A (Puron / Genetron AZ-20)',
      shortName: 'R-410A',
      composition: '50% R-32 / 50% R-125 (Near-Azeotrope)',
      safetyClass: 'A1 (Non-toxic, Non-flammable)',
      oilType: 'POE (Polyolester — Hygroscopic)',
      glideF: 0.2,
      cylinderColorName: 'Rose / Pink',
      cylinderHex: '#ec4899',
      Tc: 161.8,
      Pc_psia: 714.5,
      hc: 103.8,
      mw: 72.58,
      cpLiq: 0.39,
      cpVap: 0.255,
      gamma: 1.18,
      nominalTargetSH: 10.0,
      nominalTargetSC: 10.0,
      notes: 'High-pressure residential A/C & heat pump standard (~1.6× R-22 pressure). Negligible glide (<0.3°F); charge as liquid.',
      table: [
        [-40, 11.6, 11.4, 0.00, 112.50, 82.0, 0.118],
        [-20, 26.9, 26.6, 6.64, 114.80, 79.9, 0.183],
        [0, 48.6, 48.2, 13.52, 117.10, 77.7, 0.273],
        [20, 78.3, 77.7, 20.69, 119.30, 75.3, 0.398],
        [30, 96.8, 96.1, 24.39, 120.40, 74.1, 0.417],
        [40, 118.0, 117.2, 28.16, 121.40, 72.8, 0.436],
        [50, 142.0, 141.1, 32.02, 122.40, 71.4, 0.565],
        [60, 170.0, 169.0, 35.97, 123.30, 69.9, 0.715],
        [70, 201.0, 199.9, 40.02, 124.10, 68.3, 0.892],
        [80, 235.0, 233.8, 44.18, 124.90, 66.7, 1.102],
        [90, 274.0, 272.7, 48.46, 125.60, 64.9, 1.352],
        [100, 317.0, 315.6, 52.88, 126.20, 63.0, 1.652],
        [110, 365.0, 363.5, 57.47, 126.60, 60.9, 2.015],
        [120, 418.0, 416.4, 62.24, 126.90, 58.6, 2.460],
        [130, 476.0, 474.3, 67.25, 127.00, 56.0, 3.015],
        [140, 539.0, 537.3, 72.58, 126.80, 52.9, 3.740],
        [150, 608.0, 606.4, 79.10, 125.10, 48.6, 4.820],
        [161.8, 699.8, 699.8, 103.80, 103.80, 30.5, 30.50]
      ]
    },

    R454B: {
      id: 'R454B',
      name: 'R-454B (Opteon XL41 / Puron Advance)',
      shortName: 'R-454B',
      composition: '68.9% R-32 / 31.1% R-1234yf (Zeotropic Blend)',
      safetyClass: 'A2L (Mildly Flammable — Leak Detection Req.)',
      oilType: 'POE (Polyolester)',
      glideF: 2.2,
      cylinderColorName: 'Light Green-Gray w/ Red Band (A2L)',
      cylinderHex: '#f43f5e',
      Tc: 172.6,
      Pc_psia: 763.9,
      hc: 112.5,
      mw: 62.61,
      cpLiq: 0.365,
      cpVap: 0.245,
      gamma: 1.19,
      nominalTargetSH: 10.0,
      nominalTargetSC: 10.0,
      notes: 'Low-GWP (466) A2L replacement for R-410A. Exhibits ~2.2°F glide: use Bubble Pt for Subcooling & Dew Pt for Superheat.',
      table: [
        [-40, 9.5, 8.1, 0.00, 131.50, 74.2, 0.088],
        [-20, 24.3, 22.3, 5.80, 133.60, 72.4, 0.139],
        [0, 45.3, 42.6, 11.90, 135.70, 70.5, 0.212],
        [20, 73.9, 70.4, 18.20, 137.80, 68.4, 0.312],
        [30, 91.6, 87.6, 21.45, 138.80, 67.3, 0.326],
        [40, 112.0, 107.6, 24.80, 139.70, 66.2, 0.341],
        [50, 135.0, 130.1, 28.25, 140.60, 65.0, 0.440],
        [60, 161.1, 155.6, 31.80, 141.40, 63.7, 0.562],
        [70, 190.4, 184.4, 35.45, 142.20, 62.4, 0.708],
        [80, 223.4, 216.9, 39.20, 143.00, 61.0, 0.884],
        [90, 260.4, 253.4, 43.10, 143.60, 59.5, 1.095],
        [100, 300.8, 293.3, 47.10, 144.10, 57.9, 1.350],
        [110, 346.2, 338.2, 51.30, 144.40, 56.1, 1.655],
        [120, 395.7, 387.3, 55.70, 144.50, 54.2, 2.025],
        [130, 450.5, 441.7, 60.40, 144.20, 52.0, 2.480],
        [140, 510.8, 501.8, 65.50, 143.40, 49.4, 3.060],
        [155, 611.0, 602.5, 74.80, 140.20, 44.5, 4.250],
        [172.6, 749.2, 749.2, 112.50, 112.50, 27.5, 27.50]
      ]
    },

    R32: {
      id: 'R32',
      name: 'R-32 (Difluoromethane)',
      shortName: 'R-32',
      composition: 'Single-Component HFC (CH2F2 — Pure Fluid)',
      safetyClass: 'A2L (Mildly Flammable — Leak Detection Req.)',
      oilType: 'POE (Polyolester) / PVE (Polyvinylether)',
      glideF: 0.0,
      cylinderColorName: 'Light Green-Gray w/ Red Band (A2L)',
      cylinderHex: '#14b8a6',
      Tc: 172.6,
      Pc_psia: 838.6,
      hc: 136.0,
      mw: 52.02,
      cpLiq: 0.435,
      cpVap: 0.285,
      gamma: 1.206,
      nominalTargetSH: 10.0,
      nominalTargetSC: 10.0,
      notes: 'Pure single-component A2L refrigerant (GWP 675) with zero glide (can be charged liquid or vapor). High latent heat & high γ produce ~15–25°F higher discharge temps than R-410A.',
      table: [
        [-40, 12.1, 12.1, 0.00, 163.50, 73.1, 0.081],
        [-20, 27.9, 27.9, 7.45, 165.60, 71.1, 0.126],
        [0, 50.4, 50.4, 15.15, 167.50, 69.0, 0.189],
        [20, 81.1, 81.1, 23.15, 169.10, 66.8, 0.276],
        [30, 100.2, 100.2, 27.28, 169.80, 65.6, 0.330],
        [40, 122.1, 122.1, 31.52, 170.40, 64.4, 0.393],
        [50, 146.9, 146.9, 35.88, 170.85, 63.1, 0.466],
        [60, 175.1, 175.1, 40.38, 171.15, 61.7, 0.551],
        [70, 206.9, 206.9, 45.02, 171.30, 60.3, 0.650],
        [80, 242.6, 242.6, 49.82, 171.25, 58.8, 0.765],
        [90, 282.5, 282.5, 54.80, 171.00, 57.1, 0.900],
        [100, 327.0, 327.0, 59.98, 170.50, 55.4, 1.058],
        [110, 376.5, 376.5, 65.40, 169.70, 53.5, 1.246],
        [120, 431.4, 431.4, 71.12, 168.50, 51.4, 1.472],
        [130, 492.2, 492.2, 77.22, 166.80, 49.0, 1.750],
        [140, 559.4, 559.4, 83.85, 164.30, 46.3, 2.105],
        [155, 673.8, 673.8, 95.60, 158.00, 41.2, 2.860],
        [172.6, 823.9, 823.9, 136.00, 136.00, 26.5, 26.50]
      ]
    },

    R22: {
      id: 'R22',
      name: 'R-22 (Chlorodifluoromethane)',
      shortName: 'R-22',
      composition: 'Single-Component HCFC (CHClF2)',
      safetyClass: 'A1 (Non-toxic, Non-flammable)',
      oilType: 'Mineral Oil (MO) / Alkylbenzene',
      glideF: 0.0,
      cylinderColorName: 'Light Green',
      cylinderHex: '#22c55e',
      Tc: 205.1,
      Pc_psia: 499.0,
      hc: 92.4,
      mw: 86.47,
      cpLiq: 0.285,
      cpVap: 0.195,
      gamma: 1.18,
      nominalTargetSH: 12.0,
      nominalTargetSC: 10.0,
      notes: 'Legacy residential A/C standard (phased out of new production). Zero glide; classic ~68.5 psig @ 40°F evap.',
      table: [
        [-40, 0.5, 0.5, 0.00, 100.30, 88.0, 0.086],
        [-20, 10.2, 10.2, 5.20, 102.50, 86.1, 0.130],
        [0, 24.0, 24.0, 10.61, 104.60, 84.1, 0.191],
        [20, 43.1, 43.1, 16.08, 106.50, 82.0, 0.268],
        [30, 55.0, 55.0, 18.85, 107.40, 80.9, 0.290],
        [40, 68.5, 68.5, 21.66, 108.30, 79.8, 0.312],
        [50, 84.0, 84.0, 24.48, 109.10, 78.6, 0.402],
        [60, 102.0, 102.0, 27.32, 109.90, 77.4, 0.506],
        [70, 122.0, 122.0, 30.20, 110.50, 76.1, 0.628],
        [80, 144.0, 144.0, 33.11, 111.10, 74.8, 0.770],
        [90, 168.0, 168.0, 36.15, 111.80, 73.4, 0.938],
        [100, 196.0, 196.0, 39.27, 112.40, 71.9, 1.132],
        [110, 226.0, 226.0, 42.52, 112.70, 70.3, 1.360],
        [120, 260.0, 260.0, 45.95, 112.90, 68.6, 1.628],
        [130, 297.0, 297.0, 49.55, 112.80, 66.8, 1.945],
        [140, 338.0, 338.0, 53.30, 112.40, 64.8, 2.330],
        [160, 430.0, 430.0, 61.60, 110.50, 60.1, 3.380],
        [205.1, 484.3, 484.3, 92.40, 92.40, 32.7, 32.70]
      ]
    },

    R134A: {
      id: 'R134A',
      name: 'R-134a (Tetrafluoroethane)',
      shortName: 'R-134a',
      composition: 'Single-Component HFC (CF3CH2F)',
      safetyClass: 'A1 (Non-toxic, Non-flammable)',
      oilType: 'POE (HVAC/R) or PAG (Auto)',
      glideF: 0.0,
      cylinderColorName: 'Light Sky Blue',
      cylinderHex: '#38bdf8',
      Tc: 213.9,
      Pc_psia: 588.9,
      hc: 101.8,
      mw: 102.03,
      cpLiq: 0.325,
      cpVap: 0.215,
      gamma: 1.12,
      nominalTargetSH: 10.0,
      nominalTargetSC: 10.0,
      notes: 'Medium-temp commercial refrigeration, chillers & automotive A/C. Lower operating pressures (~35 psig @ 40°F); vacuum below -15°F.',
      table: [
        [-40, -9.2, -9.2, 0.00, 94.25, 88.2, 0.032],
        [-20, -2.5, -2.5, 5.95, 97.60, 86.3, 0.056],
        [0, 6.5, 6.5, 12.10, 101.00, 84.3, 0.092],
        [20, 18.4, 18.4, 18.35, 104.40, 82.2, 0.146],
        [30, 26.1, 26.1, 21.52, 106.10, 81.1, 0.195],
        [40, 35.0, 35.0, 24.76, 107.82, 79.9, 0.251],
        [50, 45.4, 45.4, 28.05, 109.40, 78.7, 0.312],
        [60, 57.4, 57.4, 31.40, 110.90, 77.4, 0.388],
        [70, 71.1, 71.1, 34.80, 112.20, 76.1, 0.478],
        [80, 86.8, 86.8, 38.25, 113.40, 74.7, 0.586],
        [90, 104.3, 104.3, 41.30, 114.20, 73.2, 0.714],
        [100, 124.2, 124.2, 44.39, 114.78, 71.7, 0.865],
        [110, 146.4, 146.4, 47.95, 115.20, 70.1, 1.045],
        [120, 171.1, 171.1, 51.86, 115.40, 68.3, 1.258],
        [130, 198.6, 198.6, 55.90, 115.40, 66.4, 1.512],
        [140, 229.1, 229.1, 60.15, 115.10, 64.4, 1.815],
        [170, 340.5, 340.5, 74.20, 112.10, 56.8, 3.120],
        [213.9, 574.2, 574.2, 101.80, 101.80, 32.0, 32.00]
      ]
    },

    R404A: {
      id: 'R404A',
      name: 'R-404A (Suva HP62 / Genetron 404A)',
      shortName: 'R-404A',
      composition: '44% R-125 / 52% R-143a / 4% R-134a (Blend)',
      safetyClass: 'A1 (Non-toxic, Non-flammable)',
      oilType: 'POE (Polyolester)',
      glideF: 1.3,
      cylinderColorName: 'Orange',
      cylinderHex: '#f97316',
      Tc: 161.7,
      Pc_psia: 541.2,
      hc: 102.0,
      mw: 97.60,
      cpLiq: 0.355,
      cpVap: 0.245,
      gamma: 1.13,
      nominalTargetSH: 8.0,
      nominalTargetSC: 8.0,
      notes: 'Low & medium-temp commercial refrigeration (walk-in coolers/freezers). Slight ~1.3°F glide; higher pressure than R-22.',
      table: [
        [-40, 4.9, 4.3, 0.00, 93.20, 81.2, 0.105],
        [-20, 16.5, 15.6, 6.20, 96.40, 78.8, 0.162],
        [0, 33.7, 32.6, 12.60, 99.60, 76.2, 0.238],
        [20, 56.6, 55.3, 19.20, 102.70, 73.5, 0.288],
        [30, 70.6, 69.2, 22.65, 104.20, 72.1, 0.314],
        [40, 86.9, 85.4, 26.20, 105.70, 70.6, 0.342],
        [50, 105.5, 103.9, 29.90, 107.10, 69.0, 0.452],
        [60, 126.4, 124.7, 33.75, 108.40, 67.3, 0.592],
        [70, 149.7, 147.9, 37.75, 109.60, 65.5, 0.768],
        [80, 175.4, 173.4, 41.95, 110.60, 63.6, 0.988],
        [90, 204.4, 202.3, 46.35, 111.40, 61.5, 1.262],
        [100, 236.8, 234.6, 50.95, 112.00, 59.3, 1.605],
        [110, 272.7, 270.5, 55.85, 112.30, 56.8, 2.040],
        [120, 312.1, 309.9, 61.10, 112.20, 54.0, 2.605],
        [130, 355.5, 353.3, 66.85, 111.50, 50.8, 3.360],
        [140, 403.5, 401.4, 73.40, 109.90, 46.8, 4.420],
        [150, 456.8, 454.8, 81.40, 106.80, 41.4, 6.050],
        [161.7, 526.5, 526.5, 102.00, 102.00, 30.3, 30.30]
      ]
    }
  };

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function calcVaporDensity(ref, tempF, pDewPsia) {
    const tR = Math.max(300, tempF + 459.67);
    const tcR = ref.Tc + 459.67;
    const Tr = tR / tcR;
    const Pr = Math.max(0.005, pDewPsia / ref.Pc_psia);
    const Z = Math.max(0.28, 1.0 - 0.52 * Pr / Math.pow(Tr, 2.3));
    return Math.max(0.02, (pDewPsia * ref.mw) / (Z * 10.7316 * tR));
  }

  /**
   * Monotone cubic Hermite-like or smooth piecewise linear lookup on table by temperature.
   * For thermodynamic smoothness on P-H curves and solver convergence, Catmull-Rom clamped
   * or piecewise linear with dense table is super reliable; linear on 10°F intervals is
   * monotonic and guarantees zero overshoot near the critical point.
   */
  function lookupByTemp(refId, tempF) {
    const ref = REFRIGERANTS[refId] || REFRIGERANTS.R410A;
    const tbl = ref.table;
    const n = tbl.length;

    if (tempF <= tbl[0][0]) {
      const dt = tempF - tbl[0][0];
      const slopeP = (tbl[1][1] - tbl[0][1]) / (tbl[1][0] - tbl[0][0]);
      const pBub = Math.max(-14.5, tbl[0][1] + slopeP * dt);
      const pDew = Math.max(-14.5, tbl[0][2] + slopeP * dt);
      const pDewPsia = Math.max(0.2, pDew + ATM_PSIA);
      return {
        T: tempF,
        P_bub_psig: pBub,
        P_dew_psig: pDew,
        P_bub_psia: pBub + ATM_PSIA,
        P_dew_psia: pDewPsia,
        hf: tbl[0][3] + ref.cpLiq * dt,
        hg: tbl[0][4] + 0.11 * dt,
        rho_f: tbl[0][5],
        rho_g: calcVaporDensity(ref, tempF, pDewPsia)
      };
    }

    if (tempF >= tbl[n - 1][0]) {
      const top = tbl[n - 1];
      return {
        T: top[0],
        P_bub_psig: top[1],
        P_dew_psig: top[2],
        P_bub_psia: top[1] + ATM_PSIA,
        P_dew_psia: top[2] + ATM_PSIA,
        hf: top[3],
        hg: top[4],
        rho_f: top[5],
        rho_g: top[6]
      };
    }

    for (let i = 0; i < n - 1; i++) {
      const r0 = tbl[i];
      const r1 = tbl[i + 1];
      if (tempF >= r0[0] && tempF <= r1[0]) {
        const f = (tempF - r0[0]) / (r1[0] - r0[0]);
        const fEnth = (i === n - 2) ? Math.pow(f, 0.72) : f;
        const pBub = lerp(r0[1], r1[1], f);
        const pDew = lerp(r0[2], r1[2], f);
        const pDewPsia = pDew + ATM_PSIA;
        return {
          T: tempF,
          P_bub_psig: pBub,
          P_dew_psig: pDew,
          P_bub_psia: pBub + ATM_PSIA,
          P_dew_psia: pDewPsia,
          hf: lerp(r0[3], r1[3], fEnth),
          hg: lerp(r0[4], r1[4], fEnth),
          rho_f: lerp(r0[5], r1[5], f),
          rho_g: calcVaporDensity(ref, tempF, pDewPsia)
        };
      }
    }
    return lookupByTemp(refId, 40);
  }

  /**
   * Inverse lookup: Given gauge pressure (psig), find Bubble Temp, Dew Temp, hf, hg, etc.
   * @param {string} refId
   * @param {number} psig
   * @param {'bubble'|'dew'} curve
   */
  function lookupByPressure(refId, psig, curve) {
    const ref = REFRIGERANTS[refId] || REFRIGERANTS.R410A;
    const tbl = ref.table;
    const n = tbl.length;
    const col = curve === 'dew' ? 2 : 1;

    if (psig <= tbl[0][col]) {
      const slope = (tbl[1][0] - tbl[0][0]) / (tbl[1][col] - tbl[0][col]);
      const T = clamp(tbl[0][0] + (psig - tbl[0][col]) * slope, -70, ref.Tc);
      return lookupByTemp(refId, T);
    }

    if (psig >= tbl[n - 1][col]) {
      return lookupByTemp(refId, tbl[n - 1][0]);
    }

    for (let i = 0; i < n - 1; i++) {
      const p0 = tbl[i][col];
      const p1 = tbl[i + 1][col];
      if (psig >= p0 && psig <= p1) {
        const f = (psig - p0) / (p1 - p0);
        const T = lerp(tbl[i][0], tbl[i + 1][0], f);
        return lookupByTemp(refId, T);
      }
    }
    return lookupByTemp(refId, 40);
  }

  function formatPressure(psig) {
    if (psig < -0.1) {
      // Inches of Mercury vacuum (29.92 inHg = 14.696 psi)
      const inHg = clamp(-psig * 2.036, 0, 29.9);
      return `${inHg.toFixed(1)}" Hg`;
    }
    return `${psig.toFixed(1)} psig`;
  }

  function formatPressureShort(psig) {
    if (psig < -0.1) {
      const inHg = clamp(-psig * 2.036, 0, 29.9);
      return `${inHg.toFixed(0)}"Hg`;
    }
    return `${Math.round(psig)}`;
  }

  /**
   * Dense array of {T, P_psia, P_psig, hf, hg} for drawing the P-H saturation dome
   */
  function getSaturationDome(refId) {
    const ref = REFRIGERANTS[refId] || REFRIGERANTS.R410A;
    const pts = [];
    for (let T = -40; T <= ref.Tc - 1; T += 2) {
      const st = lookupByTemp(refId, T);
      pts.push({
        T,
        P_bub_psia: st.P_bub_psia,
        P_dew_psia: st.P_dew_psia,
        P_psig: st.P_bub_psig,
        hf: st.hf,
        hg: st.hg
      });
    }
    const crit = lookupByTemp(refId, ref.Tc);
    pts.push({
      T: ref.Tc,
      P_bub_psia: crit.P_bub_psia,
      P_dew_psia: crit.P_dew_psia,
      P_psig: crit.P_bub_psig,
      hf: crit.hf,
      hg: crit.hg
    });
    return pts;
  }

  global.HVACRef = {
    ATM_PSIA,
    REFRIGERANTS,
    lookupByTemp,
    lookupByPressure,
    formatPressure,
    formatPressureShort,
    getSaturationDome,
    clamp,
    lerp
  };
})(typeof window !== 'undefined' ? window : globalThis);
