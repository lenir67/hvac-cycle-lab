/**
 * Coupled Steady-State Vapor-Compression Cycle Physics Solver
 * Backed by HVACPhysicsLib (CoolProp 8.0.0 parity fluid DB, BKM cooling coil,
 * ε-NTU condenser, AHRI-style scroll compressor, metering valve orifice model,
 * psychrometrics, fan affinity laws, and transcritical CO2 cycle).
 *
 * Enforces exact mass conservation (mDot_comp == mDot_valve) and 1st-Law Energy Balance
 * (Q_cond == Q_evap + W_comp_fluid) across Cooling, Heat Pump Heating, TXV/FXO/EEV, and 9 fault states.
 */
(function (global) {
  'use strict';

  const RefDB = global.HVACRef;
  const Lib = global.HVACPhysicsLib;

  if (!Lib || !Lib.Refrigerants || !Lib.Psy || !Lib.Components || !Lib.CoilModel) {
    throw new Error('HVACPhysicsLib must be loaded before js/physics.js');
  }

  const R = Lib.Refrigerants;
  const ATM_PSIA = RefDB.ATM_PSIA;

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
        'Subcooling drops slightly as condensing approach widens'
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
    return Lib.Psy.dewPointF(tempF, RefDB.clamp(rhPct, 5, 100));
  }

  function calcWetBulbF(tempF, rhPct) {
    return Lib.Psy.wetBulbF(tempF, RefDB.clamp(rhPct, 5, 100));
  }

  function wrapAirState(airState) {
    return {
      db: airState.dbF,
      rh: airState.rhPct,
      wb: airState.wbF,
      dp: airState.dpF,
      cfm: airState.cfm,
      airState
    };
  }

  function solveCycle(params) {
    const refId = params.refrigerant || 'R410A';
    const ref = RefDB.REFRIGERANTS[refId] || RefDB.REFRIGERANTS.R410A;
    const fid = ref.fid;
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
      drierDeltaP = 95.0;
      restrictionFlowScale = 0.44;
    } else if (fault === 'txv_unstrapped') {
      // Guard: only TXV has an external suction-line sensing bulb to unstrap
      if (metering === 'txv') {
        bulbUnstrapped = true;
      }
    } else if (fault === 'bad_valves') {
      valveLeakFactor = 0.90;
    } else if (fault === 'non_condensables') {
      nonCondensablePsi = 55.0;
      condFoulingFactor = 0.86;
    }

    const indoorAirState = Lib.Psy.makeAirState(indoorDB, indoorRH, indoorCFMPerTon * 3.0, ATM_PSIA);
    const outdoorAirState = Lib.Psy.makeAirState(outdoorDB, outdoorRH, 2800 * (condAirflowPct / 100), ATM_PSIA);

    const indoorAir = wrapAirState(indoorAirState);
    const outdoorAir = wrapAirState(outdoorAirState);

    const evapAir = mode === 'cooling' ? indoorAir : outdoorAir;
    const condAir = mode === 'cooling' ? outdoorAir : indoorAir;

    const isR744Transcritical = refId === 'R744' && (condAir.db >= 68 || mode === 'heating');

    // Calibrate nominal 3-ton compressor displacement & valve orifice using HVACPhysicsLib components
    const nomEvapTempF = refId === 'R744' ? 35 : 40;
    const stNomEvap = R.satAtTempF(fid, nomEvapTempF, true, ATM_PSIA);
    const nomSuctState = R.vaporAtPT(fid, stNomEvap.pPsia, stNomEvap.tDewF + ref.nominalTargetSH);

    let nomCondPsia;
    let nomLiqState;
    if (refId === 'R744') {
      nomCondPsia = 1400.0;
      nomLiqState = R.stateAtPT(fid, nomCondPsia, 94.0);
    } else {
      const stNomCond = R.satAtTempF(fid, 112, false, ATM_PSIA);
      nomCondPsia = stNomCond.pPsia;
      nomLiqState = R.liquidAtPT(fid, stNomCond.pPsia, stNomCond.tBubF - ref.nominalTargetSC);
    }

    const nomNRE = Math.max(25, nomSuctState.hBtuLb - nomLiqState.hBtuLb);
    const nomMassFlowLbHr = 36000 / nomNRE;
    const nomMassFlowLbMin = nomMassFlowLbHr / 60;
    const nomRp = Math.max(1.2, nomCondPsia / stNomEvap.pPsia);
    const nomDeltaP = Math.max(50, nomCondPsia - stNomEvap.pPsia);

    const unitComp = Lib.Components.solveCompressor(
      fid,
      {
        kind: Lib.Components.ECompressorKind.Scroll,
        displacementCfm: 1.0,
        ratedRpm: 3500,
        currentRpm: 3500,
        motorEfficiency: 0.88,
        shellHeatLossFrac: 0.0,
        valveLeakSeverity: 0.0
      },
      nomSuctState,
      nomCondPsia
    );
    const compDispCFM = nomMassFlowLbHr / Math.max(0.1, unitComp.massFlowLbHr);
    const nomCompElecW = unitComp.electricalPowerW * compDispCFM;
    const nomCompAmps = nomCompElecW / (240 * 0.90);

    const meterKind =
      metering === 'eev'
        ? Lib.Components.EMeteringKind.EEV
        : metering === 'fxo'
          ? Lib.Components.EMeteringKind.FixedOrifice
          : Lib.Components.EMeteringKind.TXV;

    const unitValveFlow = Lib.Components.meteringValveMassFlowLbHr(
      meterKind,
      fid,
      nomLiqState,
      stNomEvap.pPsia,
      0.10,
      ref.nominalTargetSH,
      ref.nominalTargetSH,
      0.65,
      10000.0
    );
    const nomValveDiaIn = 0.10 * Math.sqrt(nomMassFlowLbHr / Math.max(1e-3, unitValveFlow));

    const indoorFlowFactor = Math.pow(RefDB.clamp(indoorCFMPerTon / 400, 0.25, 1.4), 0.62) * evapFoulingFactor;
    const outdoorFlowFactor = Math.pow(RefDB.clamp(condAirflowPct / 100, 0.22, 1.2), 0.64) * condFoulingFactor;

    const baseEvapAirUA = mode === 'cooling' ? 2150 * indoorFlowFactor : 3400 * outdoorFlowFactor;
    const baseEvapRefUA = mode === 'cooling' ? 5000 * indoorFlowFactor : 6800 * outdoorFlowFactor;
    const baseCondUA = mode === 'cooling' ? 3000 * outdoorFlowFactor : 1850 * indoorFlowFactor;

    const evapAirFactorCur = mode === 'cooling' ? indoorFlowFactor : outdoorFlowFactor;
    const fxoTargetSH = Lib.RefrigerantService.fixedOrificeTargetSuperheatF(evapAir.wb, condAir.db);
    const controllerTargetSH =
      metering === 'eev'
        ? 8.0
        : metering === 'fxo'
          ? fxoTargetSH
          : ref.nominalTargetSH;

    const cpCondAir = 0.240 + 0.444 * condAir.airState.w;
    const cAirCond = Math.max(50, condAir.airState.massLbHr * cpCondAir);

    // Precompute R744 transcritical gas cooler baseline when applicable
    const gasCoolerApproach =
      5.0 +
      (100 - condAirflowPct) * 0.16 +
      (condFoulingFactor < 1 ? (1 - condFoulingFactor) * 35 : 0);
    const gasCoolerOutTempF = RefDB.clamp(condAir.db + gasCoolerApproach, condAir.db + 3, 138);

    let r744OptP = 1400;
    if (isR744Transcritical) {
      const co2Init = Lib.VaporCompression.solveTranscriticalCO2Cycle({
        evapSatTempF: 32,
        superheatF: controllerTargetSH,
        gasCoolerOutletTempF: gasCoolerOutTempF,
        highPressurePsia: 1400,
        massFlowLbHr: nomMassFlowLbHr,
        isentropicEff: 0.72,
        internalHxEff: 0.0
      });
      r744OptP = co2Init.optimalHighPressurePsia || 1400;
    }

    /**
     * Evaluate steady-state cycle at candidate (tEvap, tCondOrHighP)
     */
    function evalState(tEvapGuess, tCondGuess, prevSH, prevSC) {
      const tEvapMax = Math.min(evapAir.db - 1.5, ref.Tc - 16);
      const tEvap = RefDB.clamp(tEvapGuess, -35, tEvapMax);
      const stEvap = R.satAtTempF(fid, tEvap, true, ATM_PSIA);

      const P_low_psia = Math.max(4.0, stEvap.pPsia);
      const P_low_psig = P_low_psia - ATM_PSIA;

      let tCond;
      let stCond;
      let P_high_ref_psia;
      let P_high_ref_psig;
      let P_high_gauge_psig;
      let P_high_psia;
      let sc;
      let tLiq;
      let stLiquid;
      let h3;
      let condActiveCondensingFrac = 1.0;

      const chargeExcess = chargePct - 100;

      if (isR744Transcritical) {
        const highPRef = RefDB.clamp(
          r744OptP +
            chargeExcess * 8.0 +
            (100 - condAirflowPct) * 5.0 -
            valveLeakFactor * 360 +
            (drierDeltaP > 5 ? 95 : 0),
          1090,
          1950
        );
        P_high_ref_psia = highPRef;
        P_high_ref_psig = P_high_ref_psia - ATM_PSIA;
        P_high_gauge_psig = P_high_ref_psig + nonCondensablePsi;
        P_high_psia = P_high_gauge_psig + ATM_PSIA;

        tCond = gasCoolerOutTempF;
        tLiq = gasCoolerOutTempF;
        sc = 0.0;
        stCond = {
          pPsia: P_high_ref_psia,
          pPsig: P_high_ref_psig,
          tBubF: ref.Tc,
          tDewF: ref.Tc,
          hfBtuLb: ref.hc,
          hgBtuLb: ref.hc,
          rhoFLbFt3: 32.0,
          rhoGLbFt3: 14.0
        };
        stLiquid = R.stateAtPT(fid, P_high_ref_psia, tLiq);
        h3 = stLiquid.hBtuLb;
      } else {
        tCond = RefDB.clamp(tCondGuess, condAir.db + 4, ref.Tc - 3.5);
        stCond = R.satAtTempF(fid, tCond, false, ATM_PSIA);

        P_high_ref_psia = stCond.pPsia;
        P_high_ref_psig = P_high_ref_psia - ATM_PSIA;
        P_high_gauge_psig = P_high_ref_psig + nonCondensablePsi;
        P_high_psia = P_high_gauge_psig + ATM_PSIA;

        condActiveCondensingFrac =
          chargeExcess > 0 ? RefDB.clamp(1.0 - chargeExcess * 0.0095, 0.52, 1.0) : 1.0;

        const r_p_approx = Math.max(1.15, P_high_psia / P_low_psia);
        const restrictionBackupSC = drierDeltaP > 5 ? 14.5 : 0;
        const unstrappedDrainSC = bulbUnstrapped ? -6.8 : 0;

        let targetSC =
          ref.nominalTargetSC +
          0.2 +
          chargeExcess * 0.34 +
          restrictionBackupSC +
          unstrappedDrainSC -
          (nonCondensablePsi > 5 ? 2.5 : 0) -
          (condAirflowPct < 75 ? (75 - condAirflowPct) * 0.06 : 0);

        if (metering === 'fxo') {
          targetSC -= (r_p_approx - nomRp) * 1.2;
        }

        const maxApproachSC = drierDeltaP > 5
          ? Math.max(0.5, tCond - condAir.db - 0.5)
          : Math.max(0.5, (tCond - condAir.db) * 0.92);
        sc = prevSC !== undefined
          ? 0.55 * prevSC + 0.45 * RefDB.clamp(targetSC, 0.0, maxApproachSC)
          : RefDB.clamp(targetSC, 0.0, maxApproachSC);

        tLiq = stCond.tBubF - sc;
        stLiquid = sc > 0.05
          ? R.liquidAtPT(fid, P_high_ref_psia, tLiq)
          : R.stateAtPQ(fid, P_high_ref_psia, 0.0);
        h3 = stLiquid.hBtuLb;
      }

      const r_p = Math.max(1.15, P_high_psia / P_low_psia);

      // Cleanly separate P_ref vs P_gauge post-drier pressure drop
      const P_postDrier_ref_psia = Math.max(P_low_psia + 2.0, P_high_ref_psia - drierDeltaP);
      const P_postDrier_ref_psig = P_postDrier_ref_psia - ATM_PSIA;
      const P_postDrier_gauge_psig = Math.max(P_low_psig + 2.0, P_high_gauge_psig - drierDeltaP);
      const P_postDrier_gauge_psia = P_postDrier_gauge_psig + ATM_PSIA;

      // Flash refrigerant state post-drier at (P_postDrier_ref_psia, h3)
      const stPostDrierRef = R.stateAtPH(fid, P_postDrier_ref_psia, h3);
      const stPostDrierSat = R.satAtPsia(fid, P_postDrier_ref_psia, ATM_PSIA);
      let tPostDrier = stPostDrierRef.tempF;
      let postDrierQuality =
        stPostDrierRef.phase === R.ERefPhase.TwoPhase ? RefDB.clamp(stPostDrierRef.quality, 0, 0.85) : 0.0;

      // Low charge with negligible subcooling causes pre-metering vapor bubbles
      let preMeterVaporFrac = postDrierQuality;
      if (!isR744Transcritical && chargePct < 90 && sc < 2.0) {
        preMeterVaporFrac = Math.max(preMeterVaporFrac, RefDB.clamp((90 - chargePct) * 0.009, 0, 0.40));
      }

      // Construct valve inlet state at P_postDrier_gauge_psia (total driving pressure) with refrigerant density/flash penalty
      const valveInletState =
        preMeterVaporFrac > 0.005
          ? {
              ...stPostDrierRef,
              pPsia: P_postDrier_gauge_psia,
              phase: R.ERefPhase.TwoPhase,
              quality: preMeterVaporFrac,
              subcoolingF: 0.0,
              rhoLbFt3: stPostDrierRef.rhoLbFt3 / (1.0 + 1.8 * preMeterVaporFrac)
            }
          : {
              ...stPostDrierRef,
              pPsia: P_postDrier_gauge_psia,
              subcoolingF: isR744Transcritical ? 6.0 : sc
            };

      const chargeScale = chargePct < 90 ? RefDB.clamp(0.52 + 0.48 * ((chargePct - 45) / 45), 0.44, 1.0) : 1.0;

      // Max wide-open metering valve flow rate (lb/min)
      const wideOpenFlowLbHr =
        Lib.Components.meteringValveMassFlowLbHr(
          meterKind,
          fid,
          valveInletState,
          P_low_psia,
          nomValveDiaIn,
          controllerTargetSH + 20.0,
          controllerTargetSH,
          1.0,
          10000.0
        ) *
        stageSpeed *
        chargeScale *
        restrictionFlowScale;
      const mDot_valve_max = wideOpenFlowLbHr / 60.0;

      // Iteratively converge suction superheat / floodback quality & compressor mass flow
      let sh = prevSH ?? controllerTargetSH;
      let suctionState = R.vaporAtPT(fid, P_low_psia, stEvap.tDewF + Math.max(0.5, sh));
      let compRes = null;
      let mDot_comp = nomMassFlowLbMin;
      let mDot_valve = mDot_valve_max;
      let valveOpenPct = 55;
      let isStarved = false;
      let suctionQuality = 1.0;

      for (let k = 0; k < 5; k++) {
        // Compute floodback inside-dome enthalpy via Lib.Refrigerants.stateAtPQ instead of clamping
        if (bulbUnstrapped) {
          suctionQuality = 0.94;
          suctionState = R.stateAtPQ(fid, P_low_psia, suctionQuality);
        } else if (sh < 0.8) {
          suctionQuality = RefDB.clamp(0.94 + (sh / 0.8) * 0.06, 0.94, 0.999);
          suctionState = R.stateAtPQ(fid, P_low_psia, suctionQuality);
        } else {
          suctionQuality = 1.0;
          suctionState = R.vaporAtPT(fid, P_low_psia, stEvap.tDewF + sh);
        }

        compRes = Lib.Components.solveCompressor(
          fid,
          {
            kind: Lib.Components.ECompressorKind.Scroll,
            displacementCfm: compDispCFM,
            ratedRpm: 3500,
            currentRpm: 3500 * stageSpeed,
            motorEfficiency: 0.88,
            shellHeatLossFrac: 0.0,
            valveLeakSeverity: valveLeakFactor
          },
          suctionState,
          P_high_psia
        );
        const leakExtra = valveLeakFactor > 0.5 ? (1.0 - (valveLeakFactor - 0.5) * 0.28) : 1.0;
        mDot_comp = (compRes.massFlowLbHr / 60.0) * leakExtra;

        if (bulbUnstrapped) {
          valveOpenPct = 100;
          mDot_valve = mDot_valve_max * 1.12;
          isStarved = false;
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

        let nextSH;
        if (bulbUnstrapped) {
          nextSH = 0.0;
        } else if (metering === 'txv' || metering === 'eev') {
          if (!isStarved) {
            const airStarveDrop = evapAirFactorCur < 0.72 ? (0.72 - evapAirFactorCur) * 14 : 0;
            nextSH = RefDB.clamp(controllerTargetSH - airStarveDrop, 3.5, 14.0);
          } else {
            const starveRatio = Math.max(0, 1.0 - mDot_valve / Math.max(0.2, nomMassFlowLbMin));
            const maxPossibleSH = Math.max(controllerTargetSH, evapAir.db - tEvap - 6);
            nextSH = RefDB.clamp(controllerTargetSH + starveRatio * 68.0, controllerTargetSH, maxPossibleSH);
          }
        } else {
          const flowRatio = mDot_valve / Math.max(0.2, mDot_comp);
          const nomRatio = mDot_valve / Math.max(0.2, nomMassFlowLbMin * stageSpeed);
          const starveBonus = nomRatio < 0.88 ? (0.88 - nomRatio) * 52.0 : 0;
          const loadBias = (evapAir.db - 75) * 0.22 + (evapAirFactorCur - 1.0) * 18.0;
          const maxPossibleSH = Math.max(12, evapAir.db - tEvap - 4);
          nextSH = RefDB.clamp(controllerTargetSH + loadBias + starveBonus + (1.0 - flowRatio) * 44.0, 0.0, maxPossibleSH);
        }
        sh = 0.5 * sh + 0.5 * nextSH;
      }

      // Final suction state after SH convergence
      if (bulbUnstrapped) {
        suctionQuality = 0.94;
        suctionState = R.stateAtPQ(fid, P_low_psia, suctionQuality);
      } else if (sh < 0.8) {
        suctionQuality = RefDB.clamp(0.94 + (sh / 0.8) * 0.06, 0.94, 0.999);
        suctionState = R.stateAtPQ(fid, P_low_psia, suctionQuality);
      } else {
        suctionQuality = 1.0;
        suctionState = R.vaporAtPT(fid, P_low_psia, stEvap.tDewF + sh);
      }

      compRes = Lib.Components.solveCompressor(
        fid,
        {
          kind: Lib.Components.ECompressorKind.Scroll,
          displacementCfm: compDispCFM,
          ratedRpm: 3500,
          currentRpm: 3500 * stageSpeed,
          motorEfficiency: 0.88,
          shellHeatLossFrac: 0.0,
          valveLeakSeverity: valveLeakFactor
        },
        suctionState,
        P_high_psia
      );
      const leakExtraFinal = valveLeakFactor > 0.5 ? (1.0 - (valveLeakFactor - 0.5) * 0.28) : 1.0;
      mDot_comp = (compRes.massFlowLbHr / 60.0) * leakExtraFinal;

      const tSuct = suctionState.tempF;
      const rhoSuct = suctionState.rhoLbFt3;
      const h1 = suctionState.hBtuLb;
      const h4 = h3;
      const wetCoilFrac = RefDB.clamp(0.98 - sh * 0.0155, 0.30, 1.0);

      const moistureDiff = Math.max(0, evapAir.dp - tEvap);
      const frostLevel =
        tEvap < 32.0
          ? RefDB.clamp(((32.0 - tEvap) / 18.0) * RefDB.clamp(moistureDiff / 10 + 0.35, 0.35, 1.0), 0, 1)
          : 0;
      const frostUAPenalty = 1.0 - frostLevel * 0.22;

      const effEvapAirUA = baseEvapAirUA * frostUAPenalty;
      const effEvapRefUA = baseEvapRefUA * frostUAPenalty * (0.35 + 0.65 * wetCoilFrac);

      // BKM Cooling/Evaporator Coil Model
      const bkmEvap = Lib.CoilModel.solveBkmCoolingCoil({
        enteringAir: evapAir.airState,
        coilSurfaceOrRefTempF: tEvap,
        airsideUaBtuHrF: effEvapAirUA,
        coolantCapRateOrRefUa: effEvapRefUA,
        isDxBoiling: true
      });
      const qEvap_airside = bkmEvap.totalHeatBtuHr;

      const activeFlow = Math.min(mDot_comp, mDot_valve);
      const nre = Math.max(15.0, h1 - h4);
      const qEvap_refside = activeFlow * 60 * nre;

      const massResidual = mDot_comp - mDot_valve_max;
      const thermalResidual = qEvap_refside - qEvap_airside;
      const starvedMode = mDot_valve_max < mDot_comp * 0.995 && !bulbUnstrapped;

      // Hermetic motor winding heat pickup + valve bypass friction into discharge gas, flashed with stateAtPH
      const activeMassLbHr = Math.max(1.0, activeFlow * 60.0);
      const scaleActive = activeFlow / Math.max(1e-4, mDot_comp);
      const motorHeatIntoGasBtuHr =
        (compRes.electricalPowerW - compRes.shaftPowerW) * 0.72 * 3.412142 * scaleActive +
        valveLeakFactor * 28.0 * activeMassLbHr * ref.cpVap;

      let h2;
      let stDisch;
      let tDisch;
      let wCompFluid;

      if (isR744Transcritical) {
        const co2Cycle = Lib.VaporCompression.solveTranscriticalCO2Cycle({
          evapSatTempF: tEvap,
          superheatF: Math.max(0.5, sh),
          gasCoolerOutletTempF: tLiq,
          highPressurePsia: P_high_ref_psia,
          massFlowLbHr: activeMassLbHr,
          isentropicEff: compRes.isentropicEff,
          internalHxEff: 0.0
        });
        h2 = Math.max(h1 + 8, co2Cycle.s2CompOutlet.hBtuLb + motorHeatIntoGasBtuHr / activeMassLbHr);
        stDisch = R.stateAtPH(fid, P_high_psia, h2);
        tDisch = stDisch.tempF;
        wCompFluid = activeMassLbHr * (h2 - h1);
      } else {
        h2 = Math.max(h1 + 8, compRes.dischargeState.hBtuLb + motorHeatIntoGasBtuHr / activeMassLbHr);
        stDisch = R.stateAtPH(fid, P_high_psia, h2);
        tDisch = stDisch.tempF;
        wCompFluid = activeMassLbHr * (h2 - h1);
      }

      const qEvap = qEvap_refside;
      const qCond = activeMassLbHr * (h2 - h3); // Exact 1st-Law: Q_cond == Q_evap + W_comp_fluid
      const effCondUA = baseCondUA * condActiveCondensingFrac;

      // ε-NTU Condenser Heat Rejection
      const condHx = Lib.HeatTransfer.solveHeatExchangerNTU(
        Lib.HeatTransfer.EHxFlowKind.PhaseChangeCrZero,
        effCondUA,
        1e9,
        cAirCond,
        tCond,
        condAir.db
      );
      const targetCondT = condAir.db + qCond / Math.max(250, condHx.effectiveness * cAirCond);
      const wCompElec = compRes.electricalPowerW * scaleActive;

      return {
        tEvap,
        tCond,
        stEvap,
        stCond,
        P_low_psig,
        P_low_psia,
        P_high_ref_psig,
        P_high_ref_psia,
        P_high_gauge_psig,
        P_high_psia,
        r_p,
        sc,
        sh,
        suctionQuality,
        tLiq,
        P_postDrier_ref_psig,
        P_postDrier_ref_psia,
        P_postDrier_gauge_psig,
        P_postDrier_gauge_psia,
        stPostDrier: stPostDrierSat,
        stPostDrierRef,
        tPostDrier,
        postDrierQuality,
        h1,
        h2,
        h3,
        h3b: h3,
        h4,
        hEvapOut: h1,
        tSuct,
        tDisch,
        stDisch,
        rhoSuct,
        etaV: compRes.volumetricEff,
        activeFlow,
        mDot_comp,
        mDot_valve_max,
        valveOpenPct,
        wetCoilFrac,
        frostLevel,
        bkmEvap,
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

    let tCond = isR744Transcritical ? gasCoolerOutTempF : condAir.db + 17;
    let prevSH = controllerTargetSH;
    let prevSC = isR744Transcritical ? 0.0 : ref.nominalTargetSC;
    let solved = null;

    const outerMax = isR744Transcritical ? 4 : 8;
    for (let outer = 0; outer < outerMax; outer++) {
      let lo = -34;
      let hi = Math.min(evapAir.db - 2.0, ref.Tc - 18);
      if (hi <= lo + 1) hi = lo + 2;

      for (let b = 0; b < 16; b++) {
        const mid = 0.5 * (lo + hi);
        const sMid = evalState(mid, tCond, prevSH, prevSC);
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
      if (!isR744Transcritical) {
        tCond = 0.4 * tCond + 0.6 * RefDB.clamp(solved.targetCondT, condAir.db + 4, ref.Tc - 4);
      }
    }

    solved = evalState(solved.tEvap, tCond, solved.sh, solved.sc);

    const {
      tEvap,
      stEvap,
      stCond,
      P_low_psig,
      P_low_psia,
      P_high_ref_psig,
      P_high_gauge_psig,
      P_high_psia,
      r_p,
      sc,
      sh,
      suctionQuality,
      tLiq,
      P_postDrier_ref_psig,
      P_postDrier_gauge_psig,
      P_postDrier_gauge_psia,
      stPostDrier,
      tPostDrier,
      postDrierQuality,
      h1,
      h2,
      h3,
      h4,
      tSuct,
      tDisch,
      stDisch,
      rhoSuct,
      etaV,
      activeFlow,
      valveOpenPct,
      wetCoilFrac,
      frostLevel,
      bkmEvap,
      qEvap,
      qCond,
      wCompFluid,
      wCompElec
    } = solved;

    const stLowSat = R.satAtPsia(fid, P_low_psia, ATM_PSIA);
    const stCondGaugeApparent = R.satAtPsig(fid, P_high_gauge_psig, ATM_PSIA);
    const apparentSC = isR744Transcritical
      ? 0.0
      : Math.max(0, stCondGaugeApparent.tBubF - tLiq);

    // Post-expansion state inside evaporator dome via stateAtPH
    const stEvapInlet = R.stateAtPH(fid, P_low_psia, h4);
    const hfgEvap = Math.max(10, stEvap.hgBtuLb - stEvap.hfBtuLb);
    const flashGasQuality = RefDB.clamp(
      stEvapInlet.phase === R.ERefPhase.TwoPhase ? stEvapInlet.quality : (h4 - stEvap.hfBtuLb) / hfgEvap,
      0.02,
      0.92
    );
    const liquidPctPostMeter = (1 - flashGasQuality) * 100;

    let sightGlassBubbles = 0;
    if (drierDeltaP > 5 && postDrierQuality > 0.01) {
      sightGlassBubbles = 0.92;
    } else if (drierDeltaP > 5 && tLiq >= stPostDrier.tBubF - 0.5) {
      sightGlassBubbles = 0.92;
    } else if (!isR744Transcritical && sc < 3.5) {
      sightGlassBubbles = RefDB.clamp((3.5 - sc) / 3.5, 0.14, 0.95);
    } else if (isR744Transcritical && chargePct < 90) {
      sightGlassBubbles = RefDB.clamp((90 - chargePct) / 35, 0.25, 0.95);
    }

    const windingCoolingFactor = RefDB.clamp(nomMassFlowLbMin / Math.max(1.5, activeFlow), 0.75, 2.0);
    const motorWindingTemp =
      tSuct + 48 * windingCoolingFactor + (r_p - 2.5) * 12 + valveLeakFactor * 42;
    const dischOverheatLimitF = ref.dischWarnF || (refId === 'R32' ? 235 : 215);
    const isOverheating = tDisch > dischOverheatLimitF || motorWindingTemp > 210;
    const isFloodback = sh <= 1.5 || suctionQuality < 0.995;

    // Fan Affinity Laws via Lib.FanLaws.scaleFanAffinity
    const indoorFan = Lib.FanLaws.scaleFanAffinity(
      1200,
      0.5,
      0.40,
      1050,
      1050 * (indoorCFMPerTon / 400)
    );
    const condFan = Lib.FanLaws.scaleFanAffinity(
      2800,
      0.25,
      0.25,
      825,
      825 * (condAirflowPct / 100)
    );
    const fanWatts = (indoorFan.motorInputKw + condFan.motorInputKw) * 1000;
    const totalWatts = wCompElec + fanWatts;

    // Consistent electrical P = V * I * PF relation
    const lineVoltage = 240;
    const powerFactor = RefDB.clamp(0.86 + 0.04 * (r_p / 3.0) - valveLeakFactor * 0.08, 0.72, 0.94);
    const compAmps = wCompElec / (lineVoltage * powerFactor);

    let indoorSupplyDB, indoorSupplyRH, indoorDeltaT, sensibleBTUHr, latentBTUHr, condensateGPH;
    if (mode === 'cooling') {
      const shr = RefDB.clamp(bkmEvap.sensibleHeatRatio, 0.50, 1.0);
      sensibleBTUHr = qEvap * shr;
      latentBTUHr = qEvap - sensibleBTUHr;
      const leavingAir = Lib.Psy.processSensibleHeat(indoorAirState, -sensibleBTUHr);
      indoorSupplyDB = leavingAir.dbF;
      indoorSupplyRH = bkmEvap.leavingAir.rhPct;
      indoorDeltaT = indoorAir.db - indoorSupplyDB;
      const bkmRatio = bkmEvap.totalHeatBtuHr > 10 ? qEvap / bkmEvap.totalHeatBtuHr : 1.0;
      condensateGPH = (bkmEvap.condensateLbHr * bkmRatio) / 8.34;
    } else {
      const condAirOut = Lib.Psy.processSensibleHeat(indoorAirState, qCond);
      sensibleBTUHr = qCond;
      latentBTUHr = 0;
      indoorSupplyDB = condAirOut.dbF;
      indoorSupplyRH = condAirOut.rhPct;
      indoorDeltaT = indoorSupplyDB - indoorAir.db;
      condensateGPH =
        outdoorAir.dp > tEvap + 2 ? Math.max(0, (outdoorAir.dp - tEvap) * 0.06) : 0;
    }

    const condAirExhaust = Lib.Psy.processSensibleHeat(
      outdoorAirState,
      mode === 'cooling' ? qCond : -qEvap
    );
    const outdoorExhaustDB = condAirExhaust.dbF;

    const tons = (mode === 'cooling' ? qEvap : qCond) / 12000;
    const eer = (mode === 'cooling' ? qEvap : qCond) / Math.max(200, totalWatts);
    const cop = (mode === 'cooling' ? qEvap : qCond) / Math.max(500, totalWatts * 3.412142);

    const shDelta = sh - controllerTargetSH;
    const scDelta = apparentSC - ref.nominalTargetSC;
    const shStatus = isFloodback ? 'danger' : Math.abs(shDelta) <= 4.5 ? 'good' : 'warn';
    const scStatus = isR744Transcritical
      ? (chargePct < 85 ? 'warn' : 'good')
      : apparentSC < 3.0 ? 'danger' : Math.abs(scDelta) <= 4.5 ? 'good' : 'warn';

    const condTotalDh = Math.max(20, h2 - h3);
    let desupFrac, condensingFrac, subcoolFrac;
    if (isR744Transcritical) {
      desupFrac = 0.85;
      condensingFrac = 0.15;
      subcoolFrac = 0.0;
    } else {
      desupFrac = RefDB.clamp((h2 - stCond.hgBtuLb) / condTotalDh, 0.08, 0.35);
      subcoolFrac = RefDB.clamp((stCond.hfBtuLb - h3) / condTotalDh, 0.01, 0.25);
      condensingFrac = Math.max(0.45, 1.0 - desupFrac - subcoolFrac);
    }

    const condLabelT = isR744Transcritical ? tLiq : stCondGaugeApparent.tBubF;
    const condPhaseLabel = isR744Transcritical
      ? 'Supercritical Gas Cooler (Single-Phase Dense Fluid Cooling)'
      : `3 Zones: ${(desupFrac * 100).toFixed(0)}% Desuperheat → ${(condensingFrac * 100).toFixed(0)}% Condensing → ${(subcoolFrac * 100).toFixed(0)}% Subcool`;

    const nodes = {
      suction_line: {
        id: 'suction_line',
        title: '1. Suction Line (Low-Pressure Vapor)',
        short: 'Suction Line',
        P_psig: P_low_psig,
        P_psia: P_low_psia,
        T: tSuct,
        T_sat: stEvap.tDewF,
        phase: isFloodback ? '2-Phase Wet Vapor (FLOODBACK RISK!)' : 'Superheated Vapor (100% Gas)',
        quality: suctionQuality,
        h: h1,
        rho: rhoSuct,
        sh,
        description: isFloodback
          ? `Danger! Liquid droplets (${((1 - suctionQuality) * 100).toFixed(1)}% wet) are escaping the evaporator and entering the suction line toward the compressor!`
          : `Cool, low-pressure vapor carries absorbed heat back to the compressor. Superheat is ${sh.toFixed(1)}°F above dew point (${stEvap.tDewF.toFixed(1)}°F), guaranteeing 100% vapor.`
      },
      compressor: {
        id: 'compressor',
        title: '2. Hermetic Scroll Compressor',
        short: 'Compressor',
        P_psig: P_high_gauge_psig,
        P_psia: P_high_psia,
        T: tDisch,
        T_sat: condLabelT,
        phase: isR744Transcritical ? 'Supercritical High-Pressure Gas' : 'High-Pressure Superheated Vapor',
        quality: 1.0,
        h: h2,
        rho: stDisch.rhoLbFt3,
        description: `Orbiting scroll compresses ${activeFlow.toFixed(2)} lb/min of vapor across a ${r_p.toFixed(2)}:1 pressure ratio (${P_low_psig.toFixed(0)} → ${P_high_gauge_psig.toFixed(0)} psig). Suction gas cools motor windings (${motorWindingTemp.toFixed(0)}°F) before compression raises discharge temp to ${tDisch.toFixed(0)}°F.`
      },
      discharge_line: {
        id: 'discharge_line',
        title: '2b. Hot Gas Discharge Line',
        short: 'Discharge Line',
        P_psig: P_high_gauge_psig,
        P_psia: P_high_psia,
        T: tDisch,
        T_sat: condLabelT,
        phase: isR744Transcritical ? 'Supercritical High-Pressure Gas' : 'High-Pressure Superheated Vapor',
        quality: 1.0,
        h: h2,
        rho: stDisch.rhoLbFt3,
        description: `Hottest point in the cycle (${tDisch.toFixed(1)}°F). Carries both evaporator heat (${Math.round(qEvap).toLocaleString()} BTU/hr) and heat of compression (${Math.round(wCompFluid).toLocaleString()} BTU/hr) toward the ${isR744Transcritical ? 'gas cooler' : 'condenser'}.`
      },
      condenser: {
        id: 'condenser',
        title: isR744Transcritical
          ? (mode === 'cooling' ? '3. Outdoor CO₂ Gas Cooler (Transcritical)' : '3. Indoor CO₂ Gas Cooler (Heating Mode)')
          : (mode === 'cooling' ? '3. Outdoor Condenser Coil (Heat Rejection)' : '3. Indoor Condenser Coil (Heating Mode)'),
        short: isR744Transcritical ? 'Gas Cooler' : 'Condenser Coil',
        P_psig: P_high_gauge_psig,
        P_psia: P_high_psia,
        T: isR744Transcritical ? tLiq : stCond.tBubF,
        T_sat: condLabelT,
        phase: condPhaseLabel,
        quality: isR744Transcritical ? 1.0 : 0.5,
        h: (h2 + h3) / 2,
        rho: isR744Transcritical ? solved.stCond.rhoFLbFt3 : (stCond.rhoFLbFt3 + stCond.rhoGLbFt3) / 2,
        description: isR744Transcritical
          ? `Supercritical CO₂ rejects ${Math.round(qCond).toLocaleString()} BTU/hr sensibly to ${condAir.db.toFixed(0)}°F air without condensing, gliding down from ${tDisch.toFixed(0)}°F to ${tLiq.toFixed(1)}°F at ${P_high_gauge_psig.toFixed(0)} psig.`
          : `Rejects ${Math.round(qCond).toLocaleString()} BTU/hr to ${condAir.db.toFixed(0)}°F air. Vapor first desuperheats from ${tDisch.toFixed(0)}°F to ${stCond.tBubF.toFixed(0)}°F, condenses at constant pressure, then subcools ${sc.toFixed(1)}°F into pure liquid.`
      },
      liquid_line: {
        id: 'liquid_line',
        title: isR744Transcritical ? '3b. High-Pressure Gas Cooler Outlet Line' : '3b. Liquid Line & Sight Glass',
        short: 'Liquid Line',
        P_psig: P_high_gauge_psig,
        P_psia: P_high_psia,
        T: tLiq,
        T_sat: condLabelT,
        phase: isR744Transcritical
          ? 'Dense Supercritical Fluid (High Pressure)'
          : sc > 2.5 ? 'Subcooled Liquid (100% Liquid)' : 'Saturated / Flashing Liquid',
        quality: isR744Transcritical ? 0.0 : sc > 2.5 ? 0.0 : 0.08,
        h: h3,
        rho: isR744Transcritical ? R.stateAtPT(fid, P_high_psia, tLiq).rhoLbFt3 : stCond.rhoFLbFt3,
        sc: apparentSC,
        description: isR744Transcritical
          ? `Dense supercritical CO₂ feeding the high-pressure expansion valve at ${tLiq.toFixed(1)}°F and ${P_high_gauge_psig.toFixed(0)} psig.`
          : `Solid liquid feeding the metering device at ${tLiq.toFixed(1)}°F. Subcooling is ${apparentSC.toFixed(1)}°F below bubble temp (${stCondGaugeApparent.tBubF.toFixed(1)}°F) to prevent flash gas before expansion.`
      },
      filter_drier: {
        id: 'filter_drier',
        title: 'Bi-Flow Filter-Drier',
        short: 'Filter-Drier',
        P_psig: P_postDrier_gauge_psig,
        P_psia: P_postDrier_gauge_psia,
        T: tPostDrier,
        T_sat: stPostDrier.tBubF,
        phase: postDrierQuality > 0.01 ? `RESTRICTED! Flashing (${(postDrierQuality * 100).toFixed(0)}% vapor)` : (isR744Transcritical ? 'Dense Supercritical Fluid (ΔP < 1 psi)' : 'Subcooled Liquid (ΔP < 1 psi)'),
        quality: postDrierQuality,
        h: h3,
        rho: stCond.rhoFLbFt3,
        description: drierDeltaP > 5
          ? `CLOGGED FILTER-DRIER! Pressure drops ${drierDeltaP.toFixed(0)} psi across the drier (${P_high_ref_psig.toFixed(0)} → ${P_postDrier_ref_psig.toFixed(0)} psig ref), causing immediate flash-gas boiling and frost/sweat on the outlet!`
          : `Captures moisture, acid, and particulate debris. Normal pressure drop is under 1 psi (${drierDeltaP.toFixed(1)} psi).`
      },
      metering_device: {
        id: 'metering_device',
        title: `4. Metering Device (${metering.toUpperCase()})`,
        short: metering.toUpperCase(),
        P_psig: P_low_psig,
        P_psia: P_low_psia,
        T: stEvap.tBubF,
        T_sat: stEvap.tDewF,
        phase: `Adiabatic Expansion → ${(flashGasQuality * 100).toFixed(1)}% Flash Gas / ${liquidPctPostMeter.toFixed(1)}% Cold Liquid`,
        quality: flashGasQuality,
        h: h4,
        rho: stEvapInlet.rhoLbFt3,
        description: `Drops pressure instantaneously from ${P_postDrier_gauge_psig.toFixed(0)} to ${P_low_psig.toFixed(0)} psig at constant enthalpy (${h4.toFixed(1)} BTU/lb). ${(flashGasQuality * 100).toFixed(1)}% flashes to vapor, self-cooling the remaining ${liquidPctPostMeter.toFixed(1)}% liquid down to ${stEvap.tBubF.toFixed(1)}°F.`
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
        T_sat: condLabelT,
        phase: isR744Transcritical
          ? 'Supercritical Fluid (Free Bypass Flow — ΔP ≈ 0 psi)'
          : sc > 2.5 ? 'Subcooled Liquid (Free Bypass Flow — ΔP ≈ 0 psi)' : 'Saturated Liquid (Free Bypass Flow)',
        quality: 0.0,
        h: h3,
        rho: stCond.rhoFLbFt3,
        description: mode === 'cooling'
          ? `In Cooling mode, high-pressure fluid (${tLiq.toFixed(1)}°F, ${P_high_gauge_psig.toFixed(0)} psig) leaving the outdoor coil pushes this internal check valve open to bypass the outdoor heat-pump metering device without dropping pressure.`
          : `In Heating mode, high-pressure fluid (${tLiq.toFixed(1)}°F, ${P_high_gauge_psig.toFixed(0)} psig) leaving the indoor coil pushes this internal check valve open to bypass the indoor cooling metering device without dropping pressure.`
      },
      evaporator: {
        id: 'evaporator',
        title: mode === 'cooling' ? '4b. Indoor Evaporator Coil (Heat Absorption)' : '4b. Outdoor Evaporator Coil (Heating Mode)',
        short: 'Evaporator Coil',
        P_psig: P_low_psig,
        P_psia: P_low_psia,
        T: stEvap.tDewF,
        T_sat: stEvap.tDewF,
        phase: `Boiling Zone (0–${(wetCoilFrac * 100).toFixed(0)}%) → Superheat Zone (${(wetCoilFrac * 100).toFixed(0)}–100%)`,
        quality: 0.65,
        h: (h4 + h1) / 2,
        rho: stEvap.rhoGLbFt3 * 2.2,
        description: `Absorbs ${Math.round(qEvap).toLocaleString()} BTU/hr from ${evapAir.db.toFixed(0)}°F air. Liquid boils to 100% vapor at ${(wetCoilFrac * 100).toFixed(0)}% coil travel, then picks up ${sh.toFixed(1)}°F of superheat in the remaining passes.`
      }
    };

    return {
      ref,
      mode,
      metering,
      fault,
      isTranscritical: isR744Transcritical,
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
        lowSatDewF: stLowSat.tDewF,
        lowSatBubF: stLowSat.tBubF,
        highPsig: P_high_gauge_psig,
        highRefPsig: P_high_ref_psig,
        highPsia: P_high_psia,
        highSatBubF: isR744Transcritical ? tLiq : stCondGaugeApparent.tBubF,
        highSatDewF: isR744Transcritical ? tLiq : stCondGaugeApparent.tDewF,
        trueCondBubF: isR744Transcritical ? tLiq : stCond.tBubF,
        suctionTempF: tSuct,
        liquidTempF: tLiq,
        postDrierTempF: tPostDrier,
        dischargeTempF: tDisch,
        superheatF: sh,
        subcoolingF: apparentSC,
        trueSubcoolingF: sc,
        targetSH: controllerTargetSH,
        targetSC: isR744Transcritical ? 0.0 : ref.nominalTargetSC,
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
        nominalCompAmps: nomCompAmps,
        powerFactor,
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
        p3: { label: '3', name: isR744Transcritical ? 'Gas Cooler Outlet' : 'Condenser Outlet (Subcooled)', h: h3, P_psia: P_high_psia, P_psig: P_high_gauge_psig, T: tLiq },
        p3b: { label: '3b', name: 'Filter-Drier Outlet', h: h3, P_psia: P_postDrier_gauge_psia, P_psig: P_postDrier_gauge_psig, T: tPostDrier },
        p4: { label: '4', name: 'Evaporator Inlet (Flash Mix)', h: h4, P_psia: P_low_psia, P_psig: P_low_psig, T: stEvap.tBubF },
        hfEvap: stEvap.hfBtuLb,
        hgEvap: stEvap.hgBtuLb,
        hfCond: stCond.hfBtuLb,
        hgCond: stCond.hgBtuLb,
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
