/**
 * Classroom Pedagogy Engine:
 * 1. 5-Step Guided Cycle Tour
 * 2. Mystery Fault Diagnostic Challenge (with live clue-based grading + HVACPhysicsLib.Controls.diagnoseSystemFaults hints)
 * 3. Live-Substituted Thermodynamic Formulas & Rules of Thumb
 */
(function (global) {
  'use strict';

  const Lib = global.HVACPhysicsLib;

  const TOUR_STEPS = [
    {
      id: 'compressor',
      nodeId: 'compressor',
      badge: 'Stage 1 of 5',
      title: 'The Hermetic Scroll Compressor (Vapor Pump)',
      summary:
        'Draws in cool, low-pressure superheated vapor (Point 1) and mechanically squeezes it into hot, high-pressure superheated vapor (Point 2).',
      keyPoints: [
        'Pumps VAPOR ONLY — liquid is incompressible and causes hydraulic slugging/valve damage.',
        'Incoming suction gas flows over the copper motor windings to cool the hermetic motor.',
        'Adds the "Heat of Compression" (electrical work converted to thermal energy), raising discharge temp well above condensing temp.'
      ],
      watchFor: 'Watch the orbiting scroll trap crescent pockets inward and check the Compression Ratio & Discharge Temp!'
    },
    {
      id: 'condenser',
      nodeId: 'condenser',
      badge: 'Stage 2 of 5',
      title: 'The Condenser Coil (3-Zone Heat Rejection)',
      summary:
        'Because high pressure raises the refrigerant’s boiling/condensing temperature above outdoor air, heat flows naturally OUT of the coil.',
      keyPoints: [
        'Zone 1 — Desuperheating (~15–20%): Cools hot discharge gas down to saturation temperature.',
        'Zone 2 — Condensing (~65–75%): Latent heat escapes as vapor turns into 100% liquid at constant temperature.',
        'Zone 3 — Subcooling (~10%): Cools pure liquid below saturation so it never flashes into vapor before the metering device.'
      ],
      watchFor: 'Try lowering Condenser Airflow or injecting "Overcharge" to watch Subcooling & Head Pressure climb!'
    },
    {
      id: 'metering',
      nodeId: 'metering_device',
      badge: 'Stage 3 of 5',
      title: 'Filter-Drier, Sight Glass & Metering Device',
      summary:
        'Creates a sharp pressure drop from High-Side to Low-Side at constant enthalpy, spraying cold liquid + flash gas into the evaporator.',
      keyPoints: [
        'Adiabatic Flash Gas (~20–28%): Part of the liquid flashes instantly to vapor, absorbing latent heat from the rest to self-cool down to evaporator temp!',
        'TXV modulates needle opening using its suction-line sensing bulb to hold constant Superheat.',
        'Fixed Orifice has no moving control — Superheat swings wildly with indoor load & outdoor ambient.'
      ],
      watchFor: 'Look at the Sight Glass: crystal-clear = solid subcooled liquid; bubbles = low charge or clogged filter-drier!'
    },
    {
      id: 'evaporator',
      nodeId: 'evaporator',
      badge: 'Stage 4 of 5',
      title: 'The Evaporator Coil (Latent Boiling & Superheat)',
      summary:
        'Low pressure drops the refrigerant’s boiling point (~40°F) below indoor air (~75°F), pulling sensible and latent heat out of the airstream.',
      keyPoints: [
        'Boiling Zone: Liquid refrigerant boils at constant saturation temperature while absorbing huge latent heat (h_fg).',
        '100% Vapor Point: The exact spot where the last drop of liquid boils dry (watch the sliding marker!).',
        'Superheat Zone: Dry vapor warms an extra 8–12°F before leaving the coil — proving ZERO liquid reaches the compressor.'
      ],
      watchFor: 'When coil temp drops below air Dew Point, water drips into the drain pan. Below 32°F, frost builds on the fins!'
    },
    {
      id: 'balance',
      nodeId: 'suction_line',
      badge: 'Stage 5 of 5',
      title: 'First Law Energy Balance & Diagnostic Mastery',
      summary:
        'Energy cannot be created or destroyed: Every BTU absorbed indoors PLUS compressor work MUST be rejected outdoors.',
      keyPoints: [
        'Q_condenser = Q_evaporator + W_compressor (First Law of Thermodynamics).',
        'Diagnostic Matrix: Low Charge = High SH + Low SC; Restriction = High SH + High SC.',
        'Airflow / Overfeed Faults = Low SH (floodback hazard); Dirty Condenser = Very High Head & Amps.'
      ],
      watchFor: 'Switch to the "P-H Mollier Chart" or "HVAC Lab & Quiz" tab to test your diagnostic skills!'
    }
  ];

  const MYSTERY_POOL = [
    'undercharge',
    'overcharge',
    'dirty_evap',
    'dirty_cond',
    'restriction',
    'txv_unstrapped',
    'bad_valves',
    'non_condensables'
  ];

  function getDiagnosticHints(state) {
    if (!Lib || !Lib.Controls || !Lib.Controls.diagnoseSystemFaults || !state) {
      return [];
    }
    const g = state.gauges;
    const p = state.performance;
    const isCooling = state.mode === 'cooling';
    const expectedEvapSat = isCooling ? 40.0 : (p.evapAir ? p.evapAir.db - 15.0 : 25.0);
    const expectedCondSat = isCooling ? (p.condAir ? p.condAir.db + 17.0 : 112.0) : 105.0;
    const obs = {
      superheatF: g.superheatF,
      targetSuperheatF: g.targetSH,
      subcoolingF: g.subcoolingF,
      targetSubcoolingF: g.targetSC,
      suctionSatDeltaF: g.lowSatDewF - expectedEvapSat,
      dischargeSatDeltaF: g.highSatBubF - expectedCondSat,
      evapAirDeltaTF: p.indoorDeltaT,
      ampDrawRatio: p.compAmps / Math.max(1.0, p.nominalCompAmps || p.compAmps),
      isTxv: state.metering === 'txv' || state.metering === 'eev'
    };
    return Lib.Controls.diagnoseSystemFaults(obs);
  }

  function buildFormulaCards(state) {
    const g = state.gauges;
    const p = state.performance;
    const ph = state.phPoints;

    const condPlusComp = p.qEvapBTUHr + p.wCompBTUHr;
    return [
      {
        name: 'Superheat (Evaporator Outlet)',
        formula: 'SH = T_suction − T_evap_sat (Dew)',
        calc: `${g.suctionTempF.toFixed(1)}°F − ${g.lowSatDewF.toFixed(1)}°F = <strong>${g.superheatF.toFixed(1)}°F</strong>`,
        meaning: `Target ~${g.targetSH.toFixed(0)}°F. Protects compressor from liquid slugging while maximizing wet coil usage.`
      },
      {
        name: state.isTranscritical ? 'Gas Cooler Approach (Transcritical CO₂)' : 'Subcooling (Liquid Line)',
        formula: state.isTranscritical ? 'Approach = T_gc_out − T_air_in' : 'SC = T_cond_sat (Bubble) − T_liquid',
        calc: state.isTranscritical
          ? `${g.liquidTempF.toFixed(1)}°F − ${p.condAir.db.toFixed(1)}°F = <strong>${(g.liquidTempF - p.condAir.db).toFixed(1)}°F</strong>`
          : `${g.highSatBubF.toFixed(1)}°F − ${g.liquidTempF.toFixed(1)}°F = <strong>${g.subcoolingF.toFixed(1)}°F</strong>`,
        meaning: state.isTranscritical
          ? 'Above 87.8°F critical temp, CO₂ cools sensibly without condensing; high-side pressure is optimized for COP.'
          : `Target ~${g.targetSC.toFixed(0)}°F. Ensures 100% solid liquid reaches the metering valve without flash gas.`
      },
      {
        name: 'Flash Gas Fraction (After Expansion)',
        formula: 'x₄ = (h₃ − h_f,evap) / (h_g,evap − h_f,evap)',
        calc: `(${ph.p3.h.toFixed(1)} − ${ph.hfEvap.toFixed(1)}) / (${ph.hgEvap.toFixed(1)} − ${ph.hfEvap.toFixed(1)}) = <strong>${(p.flashGasQuality * 100).toFixed(1)}% vapor</strong>`,
        meaning: `Self-cooling: ${(p.flashGasQuality * 100).toFixed(1)}% flashes immediately to cool the remaining ${((1 - p.flashGasQuality) * 100).toFixed(1)}% liquid to ${g.lowSatDewF.toFixed(1)}°F.`
      },
      {
        name: 'Net Refrigeration Effect (NRE)',
        formula: 'NRE = h₁ − h₄',
        calc: `${ph.p1.h.toFixed(1)} − ${ph.p4.h.toFixed(1)} = <strong>${ph.nre.toFixed(1)} BTU/lb</strong>`,
        meaning: `Heat absorbed per pound of circulating ${state.ref.shortName} (${p.massFlowLbMin.toFixed(2)} lb/min × 60 × ${ph.nre.toFixed(1)} = ${Math.round(p.qEvapBTUHr).toLocaleString()} BTU/hr).`
      },
      {
        name: 'First Law Energy Balance',
        formula: 'Q_cond = Q_evap + W_comp',
        calc: `${Math.round(p.qEvapBTUHr).toLocaleString()} + ${Math.round(p.wCompBTUHr).toLocaleString()} = <strong>${Math.round(condPlusComp).toLocaleString()} BTU/hr</strong> (Q_cond: ${Math.round(p.qCondBTUHr).toLocaleString()})`,
        meaning: 'Total heat rejected outdoors equals indoor heat removed plus compressor thermal work.'
      },
      {
        name: 'Compression Ratio (Absolute)',
        formula: 'CR = P_high(psia) / P_low(psia)',
        calc: `${g.highPsia.toFixed(1)} / ${g.lowPsia.toFixed(1)} = <strong>${p.compressionRatio.toFixed(2)} : 1</strong>`,
        meaning: `Nominal AC range is 2.5–4.0 : 1. Below 2.1:1 hints at leaking valves; above 5.0:1 risks overheating.`
      }
    ];
  }

  function evaluateDiagnosis(guessFaultId, actualFaultId, state, faultDefs) {
    const actual = faultDefs[actualFaultId];
    const guess = faultDefs[guessFaultId];
    const isCorrect = guessFaultId === actualFaultId;
    const g = state.gauges;
    const p = state.performance;
    const hints = getDiagnosticHints(state);
    const topHint = hints[0];

    const evidence = [
      `Low Side: ${global.HVACRef.formatPressure(g.lowPsig)} (Sat ${g.lowSatDewF.toFixed(1)}°F) • Superheat: ${g.superheatF.toFixed(1)}°F`,
      `High Side: ${global.HVACRef.formatPressure(g.highPsig)} (Sat ${g.highSatBubF.toFixed(1)}°F) • Subcooling: ${g.subcoolingF.toFixed(1)}°F`,
      `Sight Glass Bubbles: ${(p.sightGlassBubbles * 100).toFixed(0)}% • Indoor ΔT: ${p.indoorDeltaT.toFixed(1)}°F • Amps: ${p.compAmps.toFixed(1)}A`
    ];

    if (topHint && topHint.verificationHint) {
      evidence.push(`Field Verification Hint: ${topHint.verificationHint}`);
    }

    return {
      isCorrect,
      actual,
      guess,
      evidence,
      hints
    };
  }

  global.HVACLab = {
    TOUR_STEPS,
    MYSTERY_POOL,
    getDiagnosticHints,
    buildFormulaCards,
    evaluateDiagnosis
  };
})(typeof window !== 'undefined' ? window : globalThis);
