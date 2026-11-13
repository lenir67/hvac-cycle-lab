/**
 * Coupled Steady-State Vapor-Compression Cycle Physics Solver
 * Enforces exact mass conservation (mDot_comp == mDot_valve) and 1st-Law Energy Balance
 * (Q_cond == Q_evap + W_comp_fluid) across Cooling, Heat Pump Heating, TXV/FXO/EEV, and 9 fault states.
 */
(function (global) {
  'use strict';

  const RefDB = global.HVACRef;

  const FAULTS = {
    none: {
      id: 'none',
      name: 'Normal Operation',
      shortName: 'Normal',
      category: 'Baseline',
      description: 'Clean coils, proper airflow (400 CFM/ton), nominal refrigerant charge, and calibrated metering device.',
      clues: [
        'Superheat near target (8–14°F)',
        'Subcooling near target (8–12°F)',
        'Clear sight glass with solid subcooled liquid',
        'Supply air ΔT ~18–22°F (Cooling) or ~25–35°F (Heating)'
      ]
    },
    undercharge: {
      id: 'undercharge',
      name: 'Low Refrigerant Charge (Leak)',
      shortName: 'Undercharge',
      category: 'Charge',
      description: 'System has lost ~35% of its refrigerant charge due to a slow leak.',
      clues: [
        'Low suction pressure & below-normal head pressure',
        'HIGH Superheat (>22°F) + LOW Subcooling (0–2°F)',
        'Continuous flash-gas bubbles in the sight glass',
        'Evaporator coil starved (early 100% vapor point); frost near inlet; high discharge temp'
      ]
    },
    overcharge: {
      id: 'overcharge',
      name: 'Overcharged System',
      shortName: 'Overcharge',
      category: 'Charge',
      description: 'System contains ~128% nominal charge, backing excess liquid refrigerant into the condenser.',
      clues: [
        'Elevated head pressure & high compressor amps',
        'HIGH Subcooling (>18°F) as liquid stacks up in condenser',
        'TXV holds Superheat near target; Fixed Orifice drives Superheat dangerously low',
        'Clear sight glass; elevated compression ratio'
      ]
    },
    dirty_evap: {
      id: 'dirty_evap',
      name: 'Dirty Evaporator / Clogged Filter (Low Airflow)',
      shortName: 'Low Airflow',
      category: 'Airflow',
      description: 'Blocked air filter or fouled blower wheel cuts indoor airflow to ~52% of nominal (~210 CFM/ton).',
      clues: [
        'Low suction pressure & evaporator coil temperature drops below 32°F (icing/frosting)',
        'LOW Superheat (TXV throttles down to protect compressor; Fixed Orifice floods suction line)',
        'Abnormally HIGH indoor air ΔT across coil (>23°F) with low total CFM',
        'Subcooling stays near normal or slightly elevated'
      ]
    },
    dirty_cond: {
      id: 'dirty_cond',
      name: 'Dirty Condenser Coil / Weak Fan',
      shortName: 'Dirty Condenser',
      category: 'Airflow',
      description: 'Debris matting on condenser fins reduces outdoor heat rejection airflow to ~48%.',
      clues: [
        'Very HIGH head pressure & elevated suction pressure',
        'HIGH compressor amp draw & high discharge temperature (>215°F)',
        'Reduced cooling capacity & EER; hot condenser exhaust air',
        'Subcooling drops slightly as condensing approach tightens'
      ]
    },
    restriction: {
      id: 'restriction',
      name: 'Liquid Line Restriction (Clogged Filter-Drier)',
      shortName: 'LL Restriction',
      category: 'Flow',
      description: 'Debris/wax clogs the liquid line filter-drier, creating a sharp ~85 psi drop and starving downstream flow.',
      clues: [
        'HIGH Superheat (>22°F) AND HIGH Subcooling (>16°F) — classic restriction signature!',
        'Low suction pressure; starved evaporator coil with frosting near inlet',
        'Temperature drop & condensation/frost directly on the OUTLET of the filter-drier',
        'Heavy flash-gas bubbling in the sight glass downstream of drier'
      ]
    },
    txv_unstrapped: {
      id: 'txv_unstrapped',
      name: 'Metering Overfeed / Unstrapped Sensing Bulb',
      shortName: 'Bulb Unstrapped',
      category: 'Metering',
      description: 'TXV sensing bulb fell off suction line into warm cabinet air, forcing the valve 100% wide open.',
      clues: [
        'Higher than normal suction pressure & slightly lower head pressure',
        'NEAR-ZERO Superheat (0–2°F) with dangerous LIQUID FLOODBACK into compressor!',
        'Low Subcooling (<4°F) because condenser drains rapidly through wide-open valve',
        'Sweating/frosting suction line and foaming oil sump in compressor'
      ]
    },
    bad_valves: {
      id: 'bad_valves',
      name: 'Inefficient Compressor (Leaking Scrolls / Valves)',
      shortName: 'Bad Compressor',
      category: 'Mechanical',
      description: 'Worn scroll seals/reed valves allow high-pressure discharge gas to leak internally back to suction.',
      clues: [
        'HIGH suction pressure + LOW head pressure (pressures try to equalize!)',
        'Very low Compression Ratio (<2.2:1) and LOW compressor amp draw',
        'Poor indoor ΔT (weak cooling/heating capacity)',
        'High compressor shell & discharge temperature from internal re-compression'
      ]
    },
    non_condensables: {
      id: 'non_condensables',
      name: 'Non-Condensables (Air / N₂ in System)',
      shortName: 'Non-Condensables',
      category: 'Contamination',
      description: 'Air/nitrogen left in system due to incomplete evacuation adds partial pressure in the condenser.',
      clues: [
        'Excessively HIGH head pressure (Dalton’s Law: P_total = P_ref + P_air)',
        'High-side gauge needle fluctuates/chatters; high discharge temperature',
        'Artificially HIGH apparent Subcooling (false high T_sat from total gauge pressure)',
        'Slightly elevated suction pressure & degraded efficiency'
      ]
    }
  };

  function calcDewPointF(tempF, rhPct) {
    const tc = (tempF - 32) * (5 / 9);
    const rh = RefDB.clamp(rhPct, 5, 100) / 100;
    const a = 17.625;
    const b = 243.04;
    const alpha = Math.log(rh) + (a * tc) / (b + tc);
    const dpC = (b * alpha) / (a - alpha);
    return dpC * (9 / 5) + 32;
  }

  function calcWetBulbF(tempF, rhPct) {
    const tc = (tempF - 32) * (5 / 9);
    const rh = RefDB.clamp(rhPct, 5, 100);
    const twc =
      tc * Math.atan(0.151977 * Math.sqrt(rh + 8.313659)) +
      Math.atan(tc + rh) -
      Math.atan(rh - 1.676331) +
      0.00391838 * Math.pow(rh, 1.5) * Math.atan(0.023101 * rh) -
      4.686035;
    return twc * (9 / 5) + 32;
  }

  function solveCycle(params) {
    const refId = params.refrigerant || 'R410A';
    const ref = RefDB.REFRIGERANTS[refId] || RefDB.REFRIGERANTS.R410A;
    const mode = params.mode === 'heating' ? 'heating' : 'cooling';
    const metering = params.metering || 'txv';
    const stageSpeed = RefDB.clamp(params.compressorSpeed ?? 1.0, 0.4, 1.2);
    const fault = params.fault || 'none';

    let indoorDB = RefDB.clamp(params.indoorDB ?? 75, 50, 95);
    let indoorRH = RefDB.clamp(params.indoorRH ?? 50, 15, 85);
    let indoorCFMPerTon = RefDB.clamp(params.indoorCFM ?? 400, 120, 520);
    let outdoorDB = RefDB.clamp(params.outdoorDB ?? (mode === 'heating' ? 42 : 95), 10, 122);
    let outdoorRH = RefDB.clamp(params.outdoorRH ?? 55, 15, 95);
    let condAirflowPct = RefDB.clamp(params.condAirflowPct ?? 100, 20, 110);
    let chargePct = RefDB.clamp(params.chargePct ?? 100, 45, 135);

    let drierDeltaP = 0.8;
    let restrictionFlowScale = 1.0;
    let valveLeakFactor = 0.0;
    let nonCondensablePsi = 0.0;
    let evapFoulingFactor = 1.0;
    let condFoulingFactor = 1.0;
    let bulbUnstrapped = false;

    if (fault === 'undercharge') {
      chargePct = Math.min(chargePct, 65);
    } else if (fault === 'overcharge') {
      chargePct = Math.max(chargePct, 128);
    } else if (fault === 'dirty_evap') {
      indoorCFMPerTon = Math.min(indoorCFMPerTon, 210);
      evapFoulingFactor = 0.72;
    } else if (fault === 'dirty_cond') {
      condAirflowPct = Math.min(condAirflowPct, 48);
      condFoulingFactor = 0.76;
    } else if (fault === 'restriction') {
      drierDeltaP = 85.0;
      restrictionFlowScale = 0.68;
    } else if (fault === 'txv_unstrapped') {
      bulbUnstrapped = true;
    } else if (fault === 'bad_valves') {
      valveLeakFactor = 0.58;
    } else if (fault === 'non_condensables') {
      nonCondensablePsi = 55.0;
      condFoulingFactor = 0.86;
    }

    const indoorAir = {
      db: indoorDB,
      rh: indoorRH,
      wb: calcWetBulbF(indoorDB, indoorRH),
      dp: calcDewPointF(indoorDB, indoorRH),
      cfm: indoorCFMPerTon * 3.0
    };
    const outdoorAir = {
      db: outdoorDB,
      rh: outdoorRH,
      wb: calcWetBulbF(outdoorDB, outdoorRH),
      dp: calcDewPointF(outdoorDB, outdoorRH),
      cfm: 2800 * (condAirflowPct / 100)
    };

    const evapAir = mode === 'cooling' ? indoorAir : outdoorAir;
    const condAir = mode === 'cooling' ? outdoorAir : indoorAir;

    // Calibrate nominal 3-ton compressor displacement at AHRI 40°F evap / 112°F cond
    const stNomEvap = RefDB.lookupByTemp(refId, 40);
    const stNomCond = RefDB.lookupByTemp(refId, 112);
    const nomH1 = stNomEvap.hg + ref.cpVap * 10;
    const nomH3 = stNomCond.hf - ref.cpLiq * 10;
    const nomNRE = Math.max(35, nomH1 - nomH3);
    const nomMassFlowLbMin = 36000 / (nomNRE * 60);
    const nomSuctionDensity = stNomEvap.rho_g * ((40 + 459.67) / (50 + 459.67));
    const nomRp = stNomCond.P_bub_psia / stNomEvap.P_dew_psia;
    const nomEtaV = Math.max(0.55, 0.94 - 0.036 * (Math.pow(nomRp, 1 / ref.gamma) - 1));
    const compDispCFM = nomMassFlowLbMin / (nomSuctionDensity * nomEtaV);
    const nomDeltaP = Math.max(50, stNomCond.P_bub_psig - stNomEvap.P_dew_psig);

    const indoorFlowFactor = Math.pow(RefDB.clamp(indoorCFMPerTon / 400, 0.25, 1.4), 0.62) * evapFoulingFactor;
    const outdoorFlowFactor = Math.pow(RefDB.clamp(condAirflowPct / 100, 0.22, 1.2), 0.64) * condFoulingFactor;

    const baseEvapUA = mode === 'cooling' ? 1150 * indoorFlowFactor : 2300 * outdoorFlowFactor;
    const baseCondUA = mode === 'cooling' ? 2750 * outdoorFlowFactor : 1650 * indoorFlowFactor;

    const evapAirFactorCur = mode === 'cooling' ? indoorFlowFactor : outdoorFlowFactor;
    const controllerTargetSH = metering === 'eev' ? 8.0 : ref.nominalTargetSH;

    /**
     * Evaluate cycle state at candidate (tEvap, tCond)
     * Returns net mass imbalance (mDot_comp - mDot_valve) AND thermal imbalance (qEvap_ref - qEvap_air)
     */
    function evalState(tEvapGuess, tCondGuess, prevSH, prevSC) {
      const tEvap = RefDB.clamp(tEvapGuess, -35, Math.min(evapAir.db - 1.5, ref.Tc - 25));
      const tCond = RefDB.clamp(tCondGuess, condAir.db + 4, ref.Tc - 4);

      const stEvap = RefDB.lookupByTemp(refId, tEvap);
      const stCond = RefDB.lookupByTemp(refId, tCond);

      const P_low_psig = stEvap.P_dew_psig;
      const P_high_ref_psig = stCond.P_bub_psig;
      const P_high_gauge_psig = P_high_ref_psig + nonCondensablePsi;

      const P_low_psia = Math.max(4.0, P_low_psig + RefDB.ATM_PSIA);
      const P_high_psia = P_high_gauge_psig + RefDB.ATM_PSIA;
      const r_p = Math.max(1.15, P_high_psia / P_low_psia);

      const chargeExcess = chargePct - 100;
      const condActiveCondensingFrac =
        chargeExcess > 0 ? RefDB.clamp(1.0 - chargeExcess * 0.0095, 0.52, 1.0) : 1.0;

      const restrictionBackupSC = drierDeltaP > 5 ? 14.5 : 0;
      const unstrappedDrainSC = bulbUnstrapped ? -6.8 : 0;

      let targetSC =
        10.2 +
        chargeExcess * 0.34 +
        restrictionBackupSC +
        unstrappedDrainSC -
        (nonCondensablePsi > 5 ? 2.5 : 0);

      if (metering === 'fxo') {
        targetSC -= (r_p - nomRp) * 1.3;
      }

      const maxApproachSC = Math.max(0.5, (tCond - condAir.db) * 0.94);
      const sc = prevSC !== undefined
        ? 0.55 * prevSC + 0.45 * RefDB.clamp(targetSC, 0.0, maxApproachSC)
        : RefDB.clamp(targetSC, 0.0, maxApproachSC);

      const tLiq = tCond - sc;
      const P_postDrier_psig = Math.max(P_low_psig + 2, P_high_ref_psig - drierDeltaP);
      const stPostDrier = RefDB.lookupByPressure(refId, P_postDrier_psig, 'bubble');

      const h3 = stCond.hf - ref.cpLiq * sc;
      const h3b = h3;
      let tPostDrier = tLiq;
      let postDrierQuality = 0;
      if (tLiq > stPostDrier.T) {
        tPostDrier = stPostDrier.T;
        const hfgPost = Math.max(10, stPostDrier.hg - stPostDrier.hf);
        postDrierQuality = RefDB.clamp((h3b - stPostDrier.hf) / hfgPost, 0, 0.85);
      }

      let preMeterVaporFrac = postDrierQuality;
      if (chargePct < 90 && sc < 2.0) {
        preMeterVaporFrac = Math.max(preMeterVaporFrac, RefDB.clamp((90 - chargePct) * 0.009, 0, 0.40));
      }

      const deltaP = Math.max(10, P_postDrier_psig - P_low_psig);
      const twoPhaseFlowFactor = 1.0 / (1.0 + 2.8 * preMeterVaporFrac);

      // Compressor volumetric capacity (Note: bad_valves drops net pumped flow sharply)
      const etaV = RefDB.clamp(
        (0.94 - 0.036 * (Math.pow(r_p, 1 / ref.gamma) - 1)) * (1 - valveLeakFactor),
        0.22,
        0.96
      );

      // Metering device max/actual flow rate
      const chargeScale = chargePct < 90 ? RefDB.clamp(0.52 + 0.48 * ((chargePct - 45) / 45), 0.44, 1.0) : 1.0;
      let mDot_valve_max;
      if (metering === 'txv' || metering === 'eev') {
        mDot_valve_max =
          nomMassFlowLbMin *
          (metering === 'eev' ? 1.45 : 1.38) *
          stageSpeed *
          Math.sqrt(deltaP / nomDeltaP) *
          twoPhaseFlowFactor *
          chargeScale *
          restrictionFlowScale;
      } else {
        const scBoost = 1 + (sc - 10) * 0.012;
        mDot_valve_max =
          nomMassFlowLbMin *
          Math.sqrt(deltaP / nomDeltaP) *
          scBoost *
          twoPhaseFlowFactor *
          chargeScale *
          restrictionFlowScale;
      }

      // Compute SH and compressor flow iteratively at this tEvap
      let sh = prevSH ?? controllerTargetSH;
      let mDot_comp = nomMassFlowLbMin;
      let mDot_valve = mDot_valve_max;
      let rhoSuct = stEvap.rho_g;
      let valveOpenPct = 55;
      let isStarved = false;

      for (let k = 0; k < 5; k++) {
        const tSuct = tEvap + sh;
        rhoSuct = stEvap.rho_g * ((tEvap + 459.67) / (tSuct + 459.67));
        mDot_comp = compDispCFM * stageSpeed * etaV * rhoSuct;

        if (bulbUnstrapped) {
          valveOpenPct = 100;
          mDot_valve = nomMassFlowLbMin * 1.48 * Math.sqrt(deltaP / nomDeltaP) * twoPhaseFlowFactor;
        } else if (metering === 'txv' || metering === 'eev') {
          if (mDot_valve_max >= mDot_comp) {
            valveOpenPct = RefDB.clamp(55 * (mDot_comp / Math.max(0.2, mDot_valve_max)) * 1.65, 18, 98);
            mDot_valve = mDot_comp;
            isStarved = false;
          } else {
            valveOpenPct = 100;
            mDot_valve = mDot_valve_max;
            isStarved = true;
          }
        } else {
          valveOpenPct = 50;
          mDot_valve = mDot_valve_max;
          isStarved = mDot_valve_max < mDot_comp * 0.96;
        }

        // Determine Superheat
        let nextSH;
        if (bulbUnstrapped) {
          nextSH = 0.6;
        } else if (metering === 'txv' || metering === 'eev') {
          if (!isStarved) {
            // Normal modulation; drops slightly if airflow is critically low
            const airStarveDrop = evapAirFactorCur < 0.72 ? (0.72 - evapAirFactorCur) * 14 : 0;
            nextSH = RefDB.clamp(controllerTargetSH - airStarveDrop, 3.5, 14.0);
          } else {
            // Starved! Evaporator boils dry early; SH approaches return air temp!
            const starveRatio = 1.0 - mDot_valve / Math.max(0.2, nomMassFlowLbMin);
            const maxPossibleSH = Math.max(controllerTargetSH, evapAir.db - tEvap - 6);
            nextSH = RefDB.clamp(controllerTargetSH + starveRatio * 48.0, controllerTargetSH, maxPossibleSH);
          }
        } else {
          // Fixed orifice: SH floats with air load, valve starvation, and overfeed!
          const flowRatio = mDot_valve / Math.max(0.2, mDot_comp);
          const nomRatio = mDot_valve / Math.max(0.2, nomMassFlowLbMin * stageSpeed);
          const starveBonus = nomRatio < 0.88 ? (0.88 - nomRatio) * 52.0 : 0;
          const loadBias = (evapAir.db - 75) * 0.22 + (evapAirFactorCur - 1.0) * 18.0;
          const maxPossibleSH = Math.max(12, evapAir.db - tEvap - 4);
          nextSH = RefDB.clamp(10.5 + loadBias + starveBonus + (1.0 - flowRatio) * 44.0, 0.0, maxPossibleSH);
        }
        sh = 0.5 * sh + 0.5 * nextSH;
      }

      const tSuct = tEvap + sh;
      const wetCoilFrac = RefDB.clamp(0.98 - sh * 0.0155, 0.30, 1.0);
      const h4 = h3b;
      const hEvapOut = stEvap.hg + ref.cpVap * sh;
      const h1 = hEvapOut;

      const moistureDiff = Math.max(0, evapAir.dp - tEvap);
      const frostLevel =
        tEvap < 32.0
          ? RefDB.clamp(((32.0 - tEvap) / 18.0) * RefDB.clamp(moistureDiff / 10 + 0.35, 0.35, 1.0), 0, 1)
          : 0;
      const frostUAPenalty = 1.0 - frostLevel * 0.22;

      const effEvapUA = baseEvapUA * frostUAPenalty * (0.35 + 0.65 * wetCoilFrac);
      const latentBoost =
        evapAir.dp > tEvap
          ? 1.0 + RefDB.clamp((evapAir.rh - 35) * 0.0052, 0, 0.26)
          : 0.88;
      const lmTdEvap = Math.max(1.5, evapAir.db - tEvap);
      const qEvap_airside = effEvapUA * latentBoost * lmTdEvap;

      const activeFlow = Math.min(mDot_comp, mDot_valve);
      const nre = Math.max(18.0, hEvapOut - h4);
      const qEvap_refside = activeFlow * 60 * nre;

      // Also check mass balance: mDot_comp must not exceed mDot_valve when starved!
      // Both thermal balance (when valve can feed) AND mass balance (when valve is starved) determine operating tEvap:
      // Specifically, steady-state flow is mDot = min(mDot_comp, mDot_valve_max) and qEvap = mDot*NRE = qEvap_airside,
      // PLUS when starved, compressor pumps down until mDot_comp(tEvap) == mDot_valve_max!
      const massResidual = mDot_comp - mDot_valve_max; // positive => compressor pulling harder than valve -> pull tEvap DOWN!
      const thermalResidual = qEvap_refside - qEvap_airside; // positive => ref capacity exceeds air load -> pull tEvap DOWN!

      // Combined steady-state driving residual:
      // If valve is starved (isStarved or mDot_valve_max < mDot_comp), compressor mass pump-down sets suction pressure!
      const starvedMode = mDot_valve_max < mDot_comp * 0.995 && !bulbUnstrapped;

      const t1R = tSuct + 459.67;
      const t2IsenR = t1R * Math.pow(r_p, (ref.gamma - 1) / ref.gamma);
      const t2IsenF = t2IsenR - 459.67;
      const etaIsen = RefDB.clamp(0.73 - 0.024 * Math.abs(r_p - 3.0) - valveLeakFactor * 0.28, 0.36, 0.76);

      const coolingFlowRatio = RefDB.clamp(nomMassFlowLbMin / Math.max(1.2, activeFlow), 0.75, 2.1);
      const motorTempRise = 14.0 * coolingFlowRatio * (0.5 + 0.5 * stageSpeed);
      const valveLeakTempRise = valveLeakFactor * 42.0;
      const tDisch = Math.max(
        tCond + 18,
        tSuct + (t2IsenF - tSuct) / etaIsen + motorTempRise + valveLeakTempRise
      );

      const highSideCp = ref.cpVap * 1.32;
      const h2 = Math.max(h1 + 8, stCond.hg + highSideCp * (tDisch - stCond.T));

      const qEvap = qEvap_refside;
      const wCompFluid = activeFlow * 60 * (h2 - h1);
      const qCond = activeFlow * 60 * (h2 - h3); // Exact 1st-Law: Q_cond = Q_evap + W_comp_fluid
      const effCondUA = baseCondUA * condActiveCondensingFrac;
      const targetCondT = condAir.db + qCond / Math.max(350, effCondUA);
      const wCompElec = (wCompFluid / 3.412) / 0.88;

      return {
        tEvap,
        tCond,
        stEvap,
        stCond,
        P_low_psig,
        P_high_ref_psig,
        P_high_gauge_psig,
        P_low_psia,
        P_high_psia,
        r_p,
        sc,
        sh,
        tLiq,
        P_postDrier_psig,
        stPostDrier,
        tPostDrier,
        postDrierQuality,
        h1,
        h2,
        h3,
        h3b,
        h4,
        hEvapOut,
        tSuct,
        tDisch,
        rhoSuct,
        etaV,
        activeFlow,
        mDot_comp,
        mDot_valve_max,
        valveOpenPct,
        wetCoilFrac,
        frostLevel,
        qEvap_airside,
        qEvap_refside,
        starvedMode,
        massResidual,
        thermalResidual,
        qEvap,
        qCond,
        wCompFluid,
        wCompElec,
        targetCondT
      };
    }

    let tCond = condAir.db + 17;
    let prevSH = 10.0;
    let prevSC = 10.0;
    let solved = null;

    for (let outer = 0; outer < 12; outer++) {
      let lo = -34;
      let hi = Math.min(evapAir.db - 2.0, ref.Tc - 26);
      if (hi <= lo + 1) hi = lo + 2;

      for (let b = 0; b < 20; b++) {
        const mid = 0.5 * (lo + hi);
        const sMid = evalState(mid, tCond, prevSH, prevSC);
        // Monotonic residual: when starved, compressor mass balance mDot_comp(tEvap) == mDot_valve_max governs suction P!
        // Otherwise thermal load balance qEvap_ref == qEvap_air governs suction P!
        const goLower = sMid.starvedMode
          ? sMid.massResidual > 0
          : sMid.thermalResidual > 0;

        if (goLower) {
          hi = mid;
        } else {
          lo = mid;
        }
        solved = sMid;
      }
      prevSH = solved.sh;
      prevSC = solved.sc;
      tCond = 0.4 * tCond + 0.6 * RefDB.clamp(solved.targetCondT, condAir.db + 4, ref.Tc - 5);
    }

    solved = evalState(solved.tEvap, tCond, solved.sh, solved.sc);

    const {
      tEvap,
      stEvap,
      stCond,
      P_low_psig,
      P_high_ref_psig,
      P_high_gauge_psig,
      P_low_psia,
      P_high_psia,
      r_p,
      sc,
      sh,
      tLiq,
      P_postDrier_psig,
      stPostDrier,
      tPostDrier,
      postDrierQuality,
      h1,
      h2,
      h3,
      h4,
      tSuct,
      tDisch,
      rhoSuct,
      etaV,
      activeFlow,
      valveOpenPct,
      wetCoilFrac,
      frostLevel,
      qEvap,
      qCond,
      wCompFluid,
      wCompElec
    } = solved;

    const stCondGaugeApparent = RefDB.lookupByPressure(refId, P_high_gauge_psig, 'bubble');
    const apparentSC = Math.max(0, stCondGaugeApparent.T - tLiq);

    const hfgEvap = Math.max(10, stEvap.hg - stEvap.hf);
    const flashGasQuality = RefDB.clamp((h4 - stEvap.hf) / hfgEvap, 0.02, 0.88);
    const liquidPctPostMeter = (1 - flashGasQuality) * 100;

    let sightGlassBubbles = 0;
    if (drierDeltaP > 5 && tLiq >= stPostDrier.T - 0.5) {
      sightGlassBubbles = 0.92;
    } else if (sc < 3.5) {
      sightGlassBubbles = RefDB.clamp((3.5 - sc) / 3.5, 0.14, 0.95);
    }

    const windingCoolingFactor = RefDB.clamp(nomMassFlowLbMin / Math.max(1.5, activeFlow), 0.75, 2.0);
    const motorWindingTemp =
      tSuct + 48 * windingCoolingFactor + (r_p - 2.5) * 12 + valveLeakFactor * 42;
    const dischOverheatLimitF = refId === 'R32' ? 225 : 215;
    const isOverheating = tDisch > dischOverheatLimitF || motorWindingTemp > 205;
    const isFloodback = sh <= 1.5;

    const fanWatts = 340 * (indoorCFMPerTon / 400) + 210 * (condAirflowPct / 100);
    const totalWatts = wCompElec + fanWatts;
    const compAmps = (wCompElec / (240 * 0.9)) * (1 + (r_p - 3.0) * 0.03);

    let indoorSupplyDB, indoorSupplyRH, indoorDeltaT, sensibleBTUHr, latentBTUHr, condensateGPH;
    if (mode === 'cooling') {
      const coilSurf = tEvap + 3.5;
      let shr = 1.0;
      if (coilSurf < indoorAir.dp) {
        const dewDep = indoorAir.dp - coilSurf;
        shr = RefDB.clamp(0.95 - dewDep * 0.014, 0.58, 0.98);
      }
      sensibleBTUHr = qEvap * shr;
      latentBTUHr = qEvap - sensibleBTUHr;
      indoorDeltaT = sensibleBTUHr / Math.max(100, 1.08 * indoorAir.cfm);
      indoorSupplyDB = indoorAir.db - indoorDeltaT;
      condensateGPH = latentBTUHr / (1060 * 8.34);
      indoorSupplyRH = RefDB.clamp(indoorAir.rh + (1 - shr) * 18 + 14, 42, 95);
    } else {
      sensibleBTUHr = qCond;
      latentBTUHr = 0;
      indoorDeltaT = qCond / Math.max(100, 1.08 * indoorAir.cfm);
      indoorSupplyDB = indoorAir.db + indoorDeltaT;
      condensateGPH =
        outdoorAir.dp > tEvap + 2 ? Math.max(0, (outdoorAir.dp - tEvap) * 0.06) : 0;
      indoorSupplyRH = RefDB.clamp(indoorAir.rh * 0.45, 18, 55);
    }

    const outdoorExhaustDB =
      mode === 'cooling'
        ? outdoorAir.db + qCond / Math.max(300, 1.08 * outdoorAir.cfm)
        : outdoorAir.db - qEvap / Math.max(300, 1.08 * outdoorAir.cfm);

    const tons = (mode === 'cooling' ? qEvap : qCond) / 12000;
    const eer = (mode === 'cooling' ? qEvap : qCond) / Math.max(200, totalWatts);
    const cop = (mode === 'cooling' ? qEvap : qCond) / Math.max(500, totalWatts * 3.412);

    const shDelta = sh - ref.nominalTargetSH;
    const scDelta = apparentSC - ref.nominalTargetSC;
    const shStatus = isFloodback ? 'danger' : Math.abs(shDelta) <= 4.5 ? 'good' : 'warn';
    const scStatus = apparentSC < 3.0 ? 'danger' : Math.abs(scDelta) <= 4.5 ? 'good' : 'warn';

    const condTotalDh = Math.max(20, h2 - h3);
    const desupFrac = RefDB.clamp((h2 - stCond.hg) / condTotalDh, 0.08, 0.35);
    const subcoolFrac = RefDB.clamp((stCond.hf - h3) / condTotalDh, 0.01, 0.25);
    const condensingFrac = Math.max(0.45, 1.0 - desupFrac - subcoolFrac);

    const nodes = {
      suction_line: {
        id: 'suction_line',
        title: '1. Suction Line (Low-Pressure Vapor)',
        short: 'Suction Line',
        P_psig: P_low_psig,
        P_psia: P_low_psia,
        T: tSuct,
        T_sat: stEvap.T,
        phase: isFloodback ? '2-Phase Wet Vapor (FLOODBACK RISK!)' : 'Superheated Vapor (100% Gas)',
        quality: isFloodback ? 0.94 : 1.0,
        h: h1,
        rho: rhoSuct,
        sh,
        description: isFloodback
          ? 'Danger! Liquid droplets are escaping the evaporator and entering the suction line toward the compressor!'
          : `Cool, low-pressure vapor carries absorbed heat back to the compressor. Superheat is ${sh.toFixed(1)}°F above dew point (${stEvap.T.toFixed(1)}°F), guaranteeing 100% vapor.`
      },
      compressor: {
        id: 'compressor',
        title: '2. Hermetic Scroll Compressor',
        short: 'Compressor',
        P_psig: P_high_gauge_psig,
        P_psia: P_high_psia,
        T: tDisch,
        T_sat: stCondGaugeApparent.T,
        phase: 'High-Pressure Superheated Vapor',
        quality: 1.0,
        h: h2,
        rho: stCond.rho_g * ((stCond.T + 459.67) / (tDisch + 459.67)),
        description: `Orbiting scroll compresses ${activeFlow.toFixed(2)} lb/min of vapor across a ${r_p.toFixed(2)}:1 pressure ratio (${P_low_psig.toFixed(0)} → ${P_high_gauge_psig.toFixed(0)} psig). Suction gas cools motor windings (${motorWindingTemp.toFixed(0)}°F) before compression raises discharge temp to ${tDisch.toFixed(0)}°F.`
      },
      discharge_line: {
        id: 'discharge_line',
        title: '2b. Hot Gas Discharge Line',
        short: 'Discharge Line',
        P_psig: P_high_gauge_psig,
        P_psia: P_high_psia,
        T: tDisch,
        T_sat: stCondGaugeApparent.T,
        phase: 'High-Pressure Superheated Vapor',
        quality: 1.0,
        h: h2,
        rho: stCond.rho_g * ((stCond.T + 459.67) / (tDisch + 459.67)),
        description: `Hottest point in the cycle (${tDisch.toFixed(1)}°F). Carries both evaporator heat (${Math.round(qEvap).toLocaleString()} BTU/hr) and heat of compression (${Math.round(wCompFluid).toLocaleString()} BTU/hr) toward the condenser.`
      },
      condenser: {
        id: 'condenser',
        title: mode === 'cooling' ? '3. Outdoor Condenser Coil (Heat Rejection)' : '3. Indoor Condenser Coil (Heating Mode)',
        short: 'Condenser Coil',
        P_psig: P_high_gauge_psig,
        P_psia: P_high_psia,
        T: stCond.T,
        T_sat: stCondGaugeApparent.T,
        phase: `3 Zones: ${(desupFrac * 100).toFixed(0)}% Desuperheat → ${(condensingFrac * 100).toFixed(0)}% Condensing → ${(subcoolFrac * 100).toFixed(0)}% Subcool`,
        quality: 0.5,
        h: (h2 + h3) / 2,
        rho: (stCond.rho_f + stCond.rho_g) / 2,
        description: `Rejects ${Math.round(qCond).toLocaleString()} BTU/hr to ${condAir.db.toFixed(0)}°F air. Vapor first desuperheats from ${tDisch.toFixed(0)}°F to ${stCond.T.toFixed(0)}°F, condenses at constant temp, then subcools ${sc.toFixed(1)}°F into pure liquid.`
      },
      liquid_line: {
        id: 'liquid_line',
        title: '3b. Liquid Line & Sight Glass',
        short: 'Liquid Line',
        P_psig: P_high_gauge_psig,
        P_psia: P_high_psia,
        T: tLiq,
        T_sat: stCondGaugeApparent.T,
        phase: sc > 2.5 ? 'Subcooled Liquid (100% Liquid)' : 'Saturated / Flashing Liquid',
        quality: sc > 2.5 ? 0.0 : 0.08,
        h: h3,
        rho: stCond.rho_f,
        sc: apparentSC,
        description: `Solid liquid feeding the metering device at ${tLiq.toFixed(1)}°F. Subcooling is ${apparentSC.toFixed(1)}°F below bubble temp (${stCondGaugeApparent.T.toFixed(1)}°F) to prevent flash gas before expansion.`
      },
      filter_drier: {
        id: 'filter_drier',
        title: 'Bi-Flow Filter-Drier',
        short: 'Filter-Drier',
        P_psig: P_postDrier_psig,
        P_psia: P_postDrier_psig + RefDB.ATM_PSIA,
        T: tPostDrier,
        T_sat: stPostDrier.T,
        phase: postDrierQuality > 0.01 ? `RESTRICTED! Flashing (${(postDrierQuality * 100).toFixed(0)}% vapor)` : 'Subcooled Liquid (ΔP < 1 psi)',
        quality: postDrierQuality,
        h: h3,
        rho: stCond.rho_f,
        description: drierDeltaP > 5
          ? `CLOGGED FILTER-DRIER! Pressure drops ${drierDeltaP.toFixed(0)} psi across the drier (${P_high_ref_psig.toFixed(0)} → ${P_postDrier_psig.toFixed(0)} psig), causing immediate flash-gas boiling and frost/sweat on the outlet!`
          : `Captures moisture, acid, and particulate debris. Normal pressure drop is under 1 psi (${drierDeltaP.toFixed(1)} psi).`
      },
      metering_device: {
        id: 'metering_device',
        title: `4. Metering Device (${metering.toUpperCase()})`,
        short: metering.toUpperCase(),
        P_psig: P_low_psig,
        P_psia: P_low_psia,
        T: stEvap.T,
        T_sat: stEvap.T,
        phase: `Adiabatic Expansion → ${(flashGasQuality * 100).toFixed(1)}% Flash Gas / ${liquidPctPostMeter.toFixed(1)}% Cold Liquid`,
        quality: flashGasQuality,
        h: h4,
        rho: 1 / (flashGasQuality / stEvap.rho_g + (1 - flashGasQuality) / stEvap.rho_f),
        description: `Drops pressure instantaneously from ${P_postDrier_psig.toFixed(0)} to ${P_low_psig.toFixed(0)} psig at constant enthalpy (${h4.toFixed(1)} BTU/lb). ${(flashGasQuality * 100).toFixed(1)}% flashes to vapor, self-cooling the remaining ${liquidPctPostMeter.toFixed(1)}% liquid down to ${stEvap.T.toFixed(1)}°F.`
      },
      check_bypass: {
        id: 'check_bypass',
        title: mode === 'cooling'
          ? 'Outdoor Check-Valve Bypass (Open in Cooling)'
          : 'Indoor Check-Valve Bypass (Open in Heating)',
        short: 'Check Bypass',
        P_psig: P_high_gauge_psig,
        P_psia: P_high_psia,
        T: tLiq,
        T_sat: stCondGaugeApparent.T,
        phase: sc > 2.5 ? 'Subcooled Liquid (Free Bypass Flow — ΔP ≈ 0 psi)' : 'Saturated Liquid (Free Bypass Flow)',
        quality: 0.0,
        h: h3,
        rho: stCond.rho_f,
        description: mode === 'cooling'
          ? `In Cooling mode, subcooled liquid (${tLiq.toFixed(1)}°F, ${P_high_gauge_psig.toFixed(0)} psig) leaving the outdoor condenser pushes this internal check valve open to bypass the outdoor heat-pump metering device without dropping pressure.`
          : `In Heating mode, subcooled liquid (${tLiq.toFixed(1)}°F, ${P_high_gauge_psig.toFixed(0)} psig) leaving the indoor condenser pushes this internal check valve open to bypass the indoor cooling metering device without dropping pressure.`
      },
      evaporator: {
        id: 'evaporator',
        title: mode === 'cooling' ? '4b. Indoor Evaporator Coil (Heat Absorption)' : '4b. Outdoor Evaporator Coil (Heating Mode)',
        short: 'Evaporator Coil',
        P_psig: P_low_psig,
        P_psia: P_low_psia,
        T: stEvap.T,
        T_sat: stEvap.T,
        phase: `Boiling Zone (0–${(wetCoilFrac * 100).toFixed(0)}%) → Superheat Zone (${(wetCoilFrac * 100).toFixed(0)}–100%)`,
        quality: 0.65,
        h: (h4 + solved.hEvapOut) / 2,
        rho: stEvap.rho_g * 2.2,
        description: `Absorbs ${Math.round(qEvap).toLocaleString()} BTU/hr from ${evapAir.db.toFixed(0)}°F air. Liquid boils to 100% vapor at ${(wetCoilFrac * 100).toFixed(0)}% coil travel, then picks up ${sh.toFixed(1)}°F of superheat in the remaining passes.`
      }
    };

    return {
      ref,
      mode,
      metering,
      fault,
      inputs: {
        indoorDB,
        indoorRH,
        indoorCFMPerTon,
        outdoorDB,
        outdoorRH,
        condAirflowPct,
        chargePct,
        stageSpeed
      },
      gauges: {
        lowPsig: P_low_psig,
        lowPsia: P_low_psia,
        lowSatDewF: stEvap.T,
        lowSatBubF: RefDB.lookupByPressure(refId, P_low_psig, 'bubble').T,
        highPsig: P_high_gauge_psig,
        highRefPsig: P_high_ref_psig,
        highPsia: P_high_psia,
        highSatBubF: stCondGaugeApparent.T,
        highSatDewF: RefDB.lookupByPressure(refId, P_high_gauge_psig, 'dew').T,
        trueCondBubF: stCond.T,
        suctionTempF: tSuct,
        liquidTempF: tLiq,
        postDrierTempF: tPostDrier,
        dischargeTempF: tDisch,
        superheatF: sh,
        subcoolingF: apparentSC,
        trueSubcoolingF: sc,
        targetSH: ref.nominalTargetSH,
        targetSC: ref.nominalTargetSC,
        shStatus,
        scStatus,
        nonCondensablePsi,
        drierDeltaP
      },
      performance: {
        massFlowLbMin: activeFlow,
        compDispCFM,
        etaV,
        compressionRatio: r_p,
        qEvapBTUHr: qEvap,
        qCondBTUHr: qCond,
        wCompBTUHr: wCompFluid,
        sensibleBTUHr,
        latentBTUHr,
        condensateGPH,
        tons,
        compWatts: wCompElec,
        fanWatts,
        totalWatts,
        compAmps,
        eer,
        cop,
        motorWindingTemp,
        isOverheating,
        isFloodback,
        valveOpenPct,
        wetCoilFrac,
        desupFrac,
        condensingFrac,
        subcoolFrac,
        flashGasQuality,
        frostLevel,
        sightGlassBubbles,
        indoorSupplyDB,
        indoorSupplyRH,
        indoorDeltaT,
        outdoorExhaustDB,
        evapAir,
        condAir
      },
      phPoints: {
        p1: { label: '1', name: 'Compressor Suction', h: h1, P_psia: P_low_psia, P_psig: P_low_psig, T: tSuct },
        p2: { label: '2', name: 'Compressor Discharge', h: h2, P_psia: P_high_psia, P_psig: P_high_gauge_psig, T: tDisch },
        p3: { label: '3', name: 'Condenser Outlet (Subcooled)', h: h3, P_psia: P_high_psia, P_psig: P_high_gauge_psig, T: tLiq },
        p4: { label: '4', name: 'Evaporator Inlet (Flash Mix)', h: h4, P_psia: P_low_psia, P_psig: P_low_psig, T: stEvap.T },
        hfEvap: stEvap.hf,
        hgEvap: stEvap.hg,
        hfCond: stCond.hf,
        hgCond: stCond.hg,
        nre: h1 - h4,
        heatOfCompression: h2 - h1,
        heatRejected: h2 - h3
      },
      nodes
    };
  }

  global.HVACPhysics = {
    FAULTS,
    calcDewPointF,
    calcWetBulbF,
    solveCycle
  };
})(typeof window !== 'undefined' ? window : globalThis);
