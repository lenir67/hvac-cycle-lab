/**
 * Refrigerant Thermophysical Property Database & Physics Library Bridge
 * Backed by CoolProp 8.0.0 parity tables in HVACPhysicsLib.Refrigerants.
 * Standard ASHRAE IP Reference Datum: h_f = 0.0 BTU/lb at -40°F
 * Pressures in PSIG (relative to 14.6959487752 psia standard atmosphere)
 */
(function (global) {
  'use strict';

  // Capture Physics Library namespace BEFORE js/physics.js overwrites global.HVACPhysics
  const Lib = global.HVACPhysicsLib =
    global.HVACPhysicsLib ||
    global.HVACPhysics ||
    (typeof require === 'function' ? require('./vendor/hvac-physics.hub.bundle.js') : null);

  if (!Lib || !Lib.Refrigerants) {
    throw new Error('HVACPhysicsLib must be loaded before js/refrigerants.js');
  }

  const R = Lib.Refrigerants;
  const ATM_PSIA = (Lib.Constants && Lib.Constants.kAtmPsia) || 14.6959487752;

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  const FLUID_DETAILS = {
    R410A: {
      name: 'R-410A (Puron / Genetron AZ-20)',
      shortName: 'R-410A',
      composition: '50% R-32 / 50% R-125 (Near-Azeotrope)',
      safetyLabel: 'A1 (Non-toxic, Non-flammable)',
      oilType: 'POE (Polyolester — Hygroscopic)',
      cylinderColorName: 'Rose / Pink',
      cylinderHex: '#ec4899',
      gamma: 1.18,
      notes: 'High-pressure residential A/C & heat pump standard (~1.6× R-22 pressure). Negligible glide (<0.3°F); charge as liquid.'
    },
    R454B: {
      name: 'R-454B (Opteon XL41 / Puron Advance)',
      shortName: 'R-454B',
      composition: '68.9% R-32 / 31.1% R-1234yf (Zeotropic Blend)',
      safetyLabel: 'A2L (Mildly Flammable — Leak Detection Req.)',
      oilType: 'POE (Polyolester)',
      cylinderColorName: 'Light Green-Gray w/ Red Band (A2L)',
      cylinderHex: '#f43f5e',
      gamma: 1.19,
      notes: 'Low-GWP (466) A2L replacement for R-410A. Exhibits ~2.7°F glide: use Bubble Pt for Subcooling & Dew Pt for Superheat.'
    },
    R32: {
      name: 'R-32 (Difluoromethane)',
      shortName: 'R-32',
      composition: 'Single-Component HFC (CH2F2 — Pure Fluid)',
      safetyLabel: 'A2L (Mildly Flammable — Leak Detection Req.)',
      oilType: 'POE (Polyolester) / PVE (Polyvinylether)',
      cylinderColorName: 'Light Blue-Gray w/ Red Band (A2L)',
      cylinderHex: '#14b8a6',
      gamma: 1.206,
      notes: 'Pure single-component A2L refrigerant (GWP 675) with zero glide (can be charged liquid or vapor). High latent heat & high γ produce ~15–25°F higher discharge temps than R-410A.'
    },
    R22: {
      name: 'R-22 (Chlorodifluoromethane)',
      shortName: 'R-22',
      composition: 'Single-Component HCFC (CHClF2)',
      safetyLabel: 'A1 (Non-toxic, Non-flammable)',
      oilType: 'Mineral Oil (MO) / Alkylbenzene',
      cylinderColorName: 'Light Green',
      cylinderHex: '#22c55e',
      gamma: 1.18,
      notes: 'Legacy residential A/C standard (phased out of new production). Zero glide; classic ~68.6 psig @ 40°F evap; Pc = 723.74 psia.'
    },
    R134A: {
      name: 'R-134a (Tetrafluoroethane)',
      shortName: 'R-134a',
      composition: 'Single-Component HFC (CF3CH2F)',
      safetyLabel: 'A1 (Non-toxic, Non-flammable)',
      oilType: 'POE (HVAC/R) or PAG (Auto)',
      cylinderColorName: 'Light Sky Blue',
      cylinderHex: '#38bdf8',
      gamma: 1.12,
      notes: 'Medium-temp commercial refrigeration, chillers & automotive A/C. Lower operating pressures (~35 psig @ 40°F); vacuum below -15°F.'
    },
    R404A: {
      name: 'R-404A (Suva HP62 / Genetron 404A)',
      shortName: 'R-404A',
      composition: '44% R-125 / 52% R-143a / 4% R-134a (Blend)',
      safetyLabel: 'A1 (Non-toxic, Non-flammable)',
      oilType: 'POE (Polyolester)',
      cylinderColorName: 'Orange',
      cylinderHex: '#f97316',
      gamma: 1.13,
      notes: 'Low & medium-temp commercial refrigeration (walk-in coolers/freezers). Slight ~0.9°F glide; higher pressure than R-22.'
    },
    R448A: {
      name: 'R-448A (Solstice N40)',
      shortName: 'R-448A',
      composition: '26% R-32 / 26% R-125 / 21% R-134a / 20% R-1234yf / 7% R-1234ze(E)',
      safetyLabel: 'A1 (Non-toxic, Non-flammable)',
      oilType: 'POE (Polyolester)',
      cylinderColorName: 'Light Gray',
      cylinderHex: '#94a3b8',
      gamma: 1.16,
      notes: 'Low-GWP (1387) HFO/HFC retrofit for R-404A/R-22 commercial refrigeration. Significant ~10.7°F temperature glide — always charge as liquid and match Bubble/Dew accurately!'
    },
    R290: {
      name: 'R-290 (Propane — Hydrocarbon)',
      shortName: 'R-290',
      composition: 'Single-Component Hydrocarbon (C3H8 — Pure Fluid)',
      safetyLabel: 'A3 (Higher Flammability — Strict Charge Limit)',
      oilType: 'POE / Mineral Oil / AB',
      cylinderColorName: 'White / Red Flammable Shoulder (A3)',
      cylinderHex: '#ef4444',
      gamma: 1.13,
      notes: 'Ultra-low GWP (3) natural hydrocarbon used in self-contained commercial reach-ins. Zero glide, high latent heat, and strict ASHRAE 15 / UL charge limits (~150g–500g).'
    },
    R744: {
      name: 'R-744 (Carbon Dioxide — CO₂)',
      shortName: 'R-744',
      composition: 'Single-Component Natural Fluid (CO2)',
      safetyLabel: 'A1 (Non-toxic, Non-flammable — High Pressure)',
      oilType: 'POE / PAG',
      cylinderColorName: 'Gray',
      cylinderHex: '#7e8894',
      gamma: 1.30,
      notes: 'Natural refrigerant (GWP 1) with critical point at 87.8°F / 1,070 psia. Operates transcritically above 87.8°F using a Gas Cooler (1,200–1,600+ psia) instead of a condenser!'
    }
  };

  const FLUID_CODES = ['R410A', 'R454B', 'R32', 'R22', 'R134A', 'R404A', 'R448A', 'R290', 'R744'];
  const REFRIGERANTS = {};

  for (const code of FLUID_CODES) {
    const fid = R.EFluidId[code] !== undefined ? R.EFluidId[code] : R.findFluidByCode(code);
    const meta = R.getFluidMeta(fid);
    const details = FLUID_DETAILS[code] || {};
    const sat40 = R.satAtTempF(fid, 40, false, ATM_PSIA);

    REFRIGERANTS[code] = {
      id: code,
      fid,
      meta,
      name: details.name || meta.name,
      shortName: details.shortName || meta.name,
      composition: details.composition || meta.composition,
      safetyClass: details.safetyLabel || meta.safetyClass,
      safetyCode: meta.safetyClass,
      oilType: details.oilType || meta.oilType,
      glideF: meta.nominalGlideF,
      cylinderColorName: details.cylinderColorName || meta.cylinderColor,
      cylinderHex: details.cylinderHex || meta.cylinderHex,
      Tc: meta.tcF,
      Pc_psia: meta.pcPsia,
      hc: meta.hcBtuLb,
      mw: meta.molarMassGmol,
      cpLiq: sat40.cpFLbF || 0.35,
      cpVap: sat40.cpGLbF || 0.24,
      gamma: details.gamma || 1.18,
      nominalTargetSH: meta.targetSH || 10.0,
      nominalTargetSC: meta.targetSC || 10.0,
      gwpAR4: meta.gwpAR4,
      gwpAR6: meta.gwpAR6,
      hpsPsig: meta.hpsPsig,
      dischWarnF: meta.dischWarnF,
      dischTripF: meta.dischTripF,
      lflKgM3: meta.lflKgM3,
      rclKgM3: meta.rclKgM3,
      smallChargeLimitLb: meta.smallChargeLimitLb,
      isFlammableA2LA3: meta.isFlammableA2LA3,
      hasSupercritical: meta.hasSupercritical,
      notes: details.notes || ''
    };
  }

  const domeCache = {};

  function lookupByTemp(refId, tempF) {
    const ref = REFRIGERANTS[refId] || REFRIGERANTS.R410A;
    const fid = ref.fid;
    const meta = ref.meta;

    if (tempF >= meta.tcF - 0.1) {
      const top = R.satAtPsia(fid, meta.pMaxPsia, ATM_PSIA);
      return {
        T: meta.tcF,
        tBubF: meta.tcF,
        tDewF: meta.tcF,
        P_bub_psig: meta.pcPsia - ATM_PSIA,
        P_dew_psig: meta.pcPsia - ATM_PSIA,
        P_bub_psia: meta.pcPsia,
        P_dew_psia: meta.pcPsia,
        hf: meta.hcBtuLb,
        hg: meta.hcBtuLb,
        rho_f: top.rhoFLbFt3,
        rho_g: top.rhoGLbFt3
      };
    }

    const tClamped = Math.max(meta.tMinF, tempF);
    const sBub = R.satAtTempF(fid, tClamped, false, ATM_PSIA);
    const sDew = R.satAtTempF(fid, tClamped, true, ATM_PSIA);

    return {
      T: tClamped,
      tBubF: sBub.tBubF,
      tDewF: sDew.tDewF,
      P_bub_psig: sBub.pPsig,
      P_dew_psig: sDew.pPsig,
      P_bub_psia: sBub.pPsia,
      P_dew_psia: sDew.pPsia,
      hf: sBub.hfBtuLb,
      hg: sDew.hgBtuLb,
      rho_f: sBub.rhoFLbFt3,
      rho_g: sDew.rhoGLbFt3
    };
  }

  /**
   * Inverse lookup: Given gauge pressure (psig), find Bubble Temp, Dew Temp, hf, hg, etc.
   * @param {string} refId
   * @param {number} psig
   * @param {'bubble'|'dew'} curve
   */
  function lookupByPressure(refId, psig, curve) {
    const ref = REFRIGERANTS[refId] || REFRIGERANTS.R410A;
    const s = R.satAtPsig(ref.fid, psig, ATM_PSIA);
    const T = curve === 'dew' ? s.tDewF : s.tBubF;
    return {
      T,
      tBubF: s.tBubF,
      tDewF: s.tDewF,
      P_bub_psig: s.pPsig,
      P_dew_psig: s.pPsig,
      P_bub_psia: s.pPsia,
      P_dew_psia: s.pPsia,
      hf: s.hfBtuLb,
      hg: s.hgBtuLb,
      rho_f: s.rhoFLbFt3,
      rho_g: s.rhoGLbFt3
    };
  }

  function formatPressure(psig) {
    if (psig < -0.1) {
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
   * Dense array of {T, P_psia, P_bub_psia, P_dew_psia, P_psig, hf, hg} for drawing the P-H saturation dome
   */
  function getSaturationDome(refId) {
    const ref = REFRIGERANTS[refId] || REFRIGERANTS.R410A;
    if (domeCache[ref.id]) return domeCache[ref.id];

    const raw = R.getSaturationDome(ref.fid);
    const pts = raw.map((pt) => ({
      T: pt.tBubF,
      tBubF: pt.tBubF,
      tDewF: pt.tDewF,
      P_psia: pt.pPsia,
      P_bub_psia: pt.pPsia,
      P_dew_psia: pt.pPsia,
      P_psig: pt.pPsig,
      hf: pt.hfBtuLb,
      hg: pt.hgBtuLb
    }));

    // Close the saturation dome smoothly at the critical point
    const meta = ref.meta;
    pts.push({
      T: meta.tcF,
      tBubF: meta.tcF,
      tDewF: meta.tcF,
      P_psia: meta.pcPsia,
      P_bub_psia: meta.pcPsia,
      P_dew_psia: meta.pcPsia,
      P_psig: meta.pcPsia - ATM_PSIA,
      hf: meta.hcBtuLb,
      hg: meta.hcBtuLb,
      isCritical: true
    });

    domeCache[ref.id] = pts;
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
