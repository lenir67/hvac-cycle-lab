const assert = require('assert');

globalThis.HVACPhysics = require('../js/vendor/hvac-physics.hub.bundle.js');
require('../js/refrigerants.js');
require('../js/physics.js');
require('../js/tour_and_lab.js');

const Lib = globalThis.HVACPhysicsLib;
const RefDB = globalThis.HVACRef;
const Physics = globalThis.HVACPhysics;
const Lab = globalThis.HVACLab;

console.log('1. Testing Namespace Separation & All 9 Fluids CoolProp 8.0.0 Parity...');
assert(Lib && Lib.Refrigerants && Lib.Psy && Lib.CoilModel && Lib.Components && Lib.VaporCompression && Lib.Controls,
  'HVACPhysicsLib must preserve all library modules after physics.js loads');
assert(Physics && typeof Physics.solveCycle === 'function', 'HVACPhysics app solver must be exported');

const EXPECTED_FLUIDS = ['R410A', 'R454B', 'R32', 'R22', 'R134A', 'R404A', 'R448A', 'R290', 'R744'];
for (const code of EXPECTED_FLUIDS) {
  assert(RefDB.REFRIGERANTS[code], `Missing fluid ${code}`);
}

// CoolProp 8.0.0 Parity Checks
const r410Sat40 = RefDB.lookupByTemp('R410A', 40);
assert(Math.abs(r410Sat40.P_dew_psig - 118.36) < 0.5, `R-410A @ 40F P_dew expected ~118.36, got ${r410Sat40.P_dew_psig}`);
assert(Math.abs(r410Sat40.hf - 27.68) < 0.2 && Math.abs(r410Sat40.hg - 120.56) < 0.2, 'R-410A @ 40F enthalpy parity');

assert(Math.abs(RefDB.REFRIGERANTS.R22.Pc_psia - 723.74) < 0.05,
  `R-22 Pc_psia expected 723.74 (CoolProp 8.0.0), got ${RefDB.REFRIGERANTS.R22.Pc_psia}`);
const r22Sat40 = RefDB.lookupByTemp('R22', 40);
assert(Math.abs(r22Sat40.P_bub_psig - 68.56) < 0.3, `R-22 @ 40F P_bub expected ~68.56, got ${r22Sat40.P_bub_psig}`);

// R-454B Zeotropic Glide
const r454SatAtP = Lib.Refrigerants.satAtTempF(RefDB.REFRIGERANTS.R454B.fid, 40, false, RefDB.ATM_PSIA);
const r454Glide = r454SatAtP.tDewF - r454SatAtP.tBubF;
assert(r454Glide > 2.0 && r454Glide < 3.5, `R-454B glide expected ~2.7F, got ${r454Glide.toFixed(2)}F`);
assert(RefDB.REFRIGERANTS.R454B.safetyCode === 'A2L', 'R-454B safety class A2L');

// R-448A High-Glide Blend
const r448SatAtP = Lib.Refrigerants.satAtTempF(RefDB.REFRIGERANTS.R448A.fid, 40, false, RefDB.ATM_PSIA);
const r448Glide = r448SatAtP.tDewF - r448SatAtP.tBubF;
assert(r448Glide > 9.0 && r448Glide < 12.5, `R-448A glide expected ~10.7F, got ${r448Glide.toFixed(2)}F`);
assert(RefDB.REFRIGERANTS.R448A.gwpAR4 === 1387, 'R-448A GWP AR4 parity');

// R-290 Propane A3 Hydrocarbon
assert(RefDB.REFRIGERANTS.R290.safetyCode === 'A3', 'R-290 safety class A3');
assert(RefDB.REFRIGERANTS.R290.gwpAR4 === 3, 'R-290 GWP AR4 = 3');
const r290Sat40 = RefDB.lookupByTemp('R290', 40);
assert((r290Sat40.hg - r290Sat40.hf) > 150, `R-290 latent heat > 150 BTU/lb, got ${r290Sat40.hg - r290Sat40.hf}`);

// R-744 CO2 Critical Point
assert(Math.abs(RefDB.REFRIGERANTS.R744.Tc - 87.76) < 0.2, `R-744 Tc expected ~87.76F, got ${RefDB.REFRIGERANTS.R744.Tc}`);
assert(Math.abs(RefDB.REFRIGERANTS.R744.Pc_psia - 1069.99) < 0.5, `R-744 Pc expected ~1069.99 psia, got ${RefDB.REFRIGERANTS.R744.Pc_psia}`);

console.log('2. Testing Refrigerant PT & Enthalpy Monotonicity...');
for (const refId of Object.keys(RefDB.REFRIGERANTS)) {
  const ref = RefDB.REFRIGERANTS[refId];
  let prevP = -Infinity;
  let prevHf = -Infinity;
  for (let T = -40; T <= Math.min(140, ref.Tc - 5); T += 5) {
    const st = RefDB.lookupByTemp(refId, T);
    assert(Number.isFinite(st.P_bub_psig), `${refId} P_bub finite at ${T}`);
    assert(st.P_bub_psig > prevP, `${refId} pressure must increase with T (${T})`);
    assert(st.hf > prevHf, `${refId} hf must increase with T (${T})`);
    assert(st.hg > st.hf, `${refId} hg > hf below Tc (${T})`);
    assert(st.rho_g > 0 && st.rho_f > st.rho_g, `${refId} densities valid (${T})`);
    prevP = st.P_bub_psig;
    prevHf = st.hf;

    const inv = RefDB.lookupByPressure(refId, st.P_bub_psig, 'bubble');
    assert(Math.abs(inv.T - T) < 0.05, `${refId} inverse lookup error at ${T}: got ${inv.T}`);
  }
}

console.log('3. Testing 1st-Law Conservation, Convergence, R-744 Transcritical & BKM Coil...');
for (const refId of Object.keys(RefDB.REFRIGERANTS)) {
  for (const metering of ['txv', 'fxo', 'eev']) {
    for (const mode of ['cooling', 'heating']) {
      const s = Physics.solveCycle({
        refrigerant: refId,
        mode,
        metering,
        outdoorDB: mode === 'heating' ? 38 : 95,
        indoorDB: mode === 'heating' ? 70 : 75
      });
      const diff = Math.abs(s.performance.qCondBTUHr - (s.performance.qEvapBTUHr + s.performance.wCompBTUHr));
      assert(diff < 1.0, `1st law mismatch for ${refId} ${mode} ${metering}: ${diff}`);
      assert(s.performance.tons > 0.5 && s.performance.tons < 6.0, `Reasonable tons for ${refId} ${mode}: ${s.performance.tons}`);
      assert(s.performance.compressionRatio > 1.2, `Valid CR for ${refId}`);
      assert(
        s.nodes.check_bypass &&
        s.nodes.check_bypass.quality === 0.0 &&
        s.nodes.check_bypass.P_psig === s.gauges.highPsig,
        `${refId} ${mode} ${metering}: check_bypass node must carry high-side fluid`
      );
      assert(
        !s.performance.isOverheating,
        `${refId} ${mode} ${metering}: Nominal operation must not trigger thermal overheat (tDisch=${s.gauges.dischargeTempF.toFixed(1)}°F, winding=${s.performance.motorWindingTemp.toFixed(1)}°F)`
      );
      assert(
        !s.performance.isFloodback && s.gauges.superheatF >= 4.5,
        `${refId} ${mode} ${metering}: Nominal operation must not trigger liquid floodback/slugging (SH=${s.gauges.superheatF.toFixed(2)}°F)`
      );
      if (mode === 'cooling') {
        assert(s.performance.indoorSupplyDB < s.inputs.indoorDB, 'Cooling supply air cooler than return');
      } else {
        assert(s.performance.indoorSupplyDB > s.inputs.indoorDB, 'Heating supply air warmer than return');
      }
      // P = V * I * PF consistency check
      const pCheck = 240 * s.performance.compAmps * s.performance.powerFactor;
      assert(Math.abs(pCheck - s.performance.compWatts) < 1.0, `Electrical P=V*I*PF mismatch for ${refId}`);
    }
  }
}

// Winter heating ambient sweep (R-410A across TXV, FXO, EEV)
for (const metering of ['txv', 'fxo', 'eev']) {
  for (const outdoorDB of [15, 30, 42, 55]) {
    const sHeat = Physics.solveCycle({
      refrigerant: 'R410A',
      mode: 'heating',
      metering,
      fault: 'none',
      outdoorDB,
      indoorDB: 70
    });
    assert(
      !sHeat.performance.isFloodback && sHeat.gauges.superheatF >= 4.5,
      `R410A heating ${metering} @ ${outdoorDB}F normal must not slug (SH=${sHeat.gauges.superheatF.toFixed(2)}°F)`
    );
  }
}

// R-744 Transcritical CO2 verification
const r744Cool = Physics.solveCycle({ refrigerant: 'R744', mode: 'cooling', metering: 'eev', outdoorDB: 95, indoorDB: 75 });
assert(r744Cool.isTranscritical === true, 'R-744 @ 95F ambient must operate transcritically');
assert(r744Cool.gauges.highPsia > RefDB.REFRIGERANTS.R744.Pc_psia, `R-744 high pressure (${r744Cool.gauges.highPsia.toFixed(0)} psia) must exceed Pc`);
assert(r744Cool.phPoints.p2.P_psia > 1100 && r744Cool.phPoints.p3b, 'R-744 P-H points include transcritical p2 and p3b');

// BKM Sensible / Latent / SHR verification
const bkmWet = Physics.solveCycle({ refrigerant: 'R410A', mode: 'cooling', metering: 'txv', indoorDB: 75, indoorRH: 55, outdoorDB: 95 });
const shrWet = bkmWet.performance.sensibleBTUHr / bkmWet.performance.qEvapBTUHr;
assert(bkmWet.performance.latentBTUHr > 2000 && shrWet > 0.58 && shrWet < 0.88,
  `BKM wet coil expected SHR in (0.58, 0.88), got ${shrWet.toFixed(3)}`);
assert(Math.abs(bkmWet.performance.sensibleBTUHr + bkmWet.performance.latentBTUHr - bkmWet.performance.qEvapBTUHr) < 1.0,
  'Sensible + Latent must sum to total qEvap');
const bkmDry = Physics.solveCycle({ refrigerant: 'R410A', mode: 'cooling', metering: 'txv', indoorDB: 75, indoorRH: 20, outdoorDB: 95 });
const shrDry = bkmDry.performance.sensibleBTUHr / bkmDry.performance.qEvapBTUHr;
assert(shrDry > 0.96, `BKM dry coil (20% RH) expected SHR > 0.96, got ${shrDry.toFixed(3)}`);

assert(RefDB.REFRIGERANTS.R32 && RefDB.REFRIGERANTS.R32.glideF === 0.0, 'R-32 present with zero glide');
const r410Nom = Physics.solveCycle({ refrigerant: 'R410A', mode: 'cooling', metering: 'txv', fault: 'none' });
const r32Cycle = Physics.solveCycle({ refrigerant: 'R32', mode: 'cooling', metering: 'txv', fault: 'none' });
assert(r32Cycle.phPoints.nre > r410Nom.phPoints.nre + 25, `R-32 higher NRE than R-410A (${r32Cycle.phPoints.nre} vs ${r410Nom.phPoints.nre})`);
assert(r32Cycle.gauges.dischargeTempF > r410Nom.gauges.dischargeTempF + 8, `R-32 higher discharge temp than R-410A (${r32Cycle.gauges.dischargeTempF} vs ${r410Nom.gauges.dischargeTempF})`);

console.log('4. Testing Diagnostic Fault Signatures (R-410A TXV) & Metering Guards...');
const base = Physics.solveCycle({ refrigerant: 'R410A', mode: 'cooling', metering: 'txv', fault: 'none' });
const fUnder = Physics.solveCycle({ refrigerant: 'R410A', mode: 'cooling', metering: 'txv', fault: 'undercharge' });
const fOver = Physics.solveCycle({ refrigerant: 'R410A', mode: 'cooling', metering: 'txv', fault: 'overcharge' });
const fEvap = Physics.solveCycle({ refrigerant: 'R410A', mode: 'cooling', metering: 'txv', fault: 'dirty_evap' });
const fCond = Physics.solveCycle({ refrigerant: 'R410A', mode: 'cooling', metering: 'txv', fault: 'dirty_cond' });
const fRest = Physics.solveCycle({ refrigerant: 'R410A', mode: 'cooling', metering: 'txv', fault: 'restriction' });
const fBulb = Physics.solveCycle({ refrigerant: 'R410A', mode: 'cooling', metering: 'txv', fault: 'txv_unstrapped' });
const fBulbFxo = Physics.solveCycle({ refrigerant: 'R410A', mode: 'cooling', metering: 'fxo', fault: 'txv_unstrapped' });
const fBulbEev = Physics.solveCycle({ refrigerant: 'R410A', mode: 'cooling', metering: 'eev', fault: 'txv_unstrapped' });
const fValves = Physics.solveCycle({ refrigerant: 'R410A', mode: 'cooling', metering: 'txv', fault: 'bad_valves' });
const fNonCond = Physics.solveCycle({ refrigerant: 'R410A', mode: 'cooling', metering: 'txv', fault: 'non_condensables' });

assert(fUnder.gauges.lowPsig < base.gauges.lowPsig - 20, 'Undercharge drops suction pressure');
assert(fUnder.gauges.superheatF > 20 && fUnder.gauges.subcoolingF < 2.0, 'Undercharge: High SH + Low SC');
assert(fUnder.performance.sightGlassBubbles > 0.5, 'Undercharge: Sight glass bubbles');

assert(fOver.gauges.highPsig > base.gauges.highPsig + 20 && fOver.gauges.subcoolingF > 16, 'Overcharge: High head & High SC');

assert(fEvap.gauges.lowPsig < base.gauges.lowPsig - 20 && fEvap.performance.frostLevel > 0.2, 'Dirty Evap: Low suction & coil frost');

assert(fCond.gauges.highPsig > base.gauges.highPsig + 60 && fCond.gauges.dischargeTempF > 210, 'Dirty Condenser: High head & high discharge');
assert(Physics.FAULTS.dirty_cond.clues.some((c) => c.includes('widens')), 'Dirty Condenser clue wording corrected to widens');

assert(fRest.gauges.superheatF > 18 && fRest.gauges.subcoolingF > 14, 'Restriction: High SH + High SC');
assert(fRest.gauges.drierDeltaP > 20 && fRest.performance.sightGlassBubbles > 0.5, 'Restriction: Drier dP & sight glass flash');

assert(fBulb.gauges.superheatF < 2.0 && fBulb.performance.isFloodback, 'Unstrapped Bulb: Low SH & floodback');
assert(fBulb.phPoints.p1.h < fBulb.phPoints.hgEvap, 'Floodback enthalpy computed inside saturation dome via stateAtPQ');
assert(!fBulbFxo.performance.isFloodback && !fBulbEev.performance.isFloodback, 'txv_unstrapped fault guarded for FXO and EEV');

assert(fValves.gauges.lowPsig > base.gauges.lowPsig + 20 && fValves.gauges.highPsig < base.gauges.highPsig - 20, 'Bad Valves: Pressures equalize');
assert(fValves.performance.compressionRatio < 2.5, 'Bad Valves: Low compression ratio');

assert(fNonCond.gauges.highPsig > base.gauges.highPsig + 50 && fNonCond.gauges.subcoolingF > 14, 'Non-Condensables: High head & apparent SC');
assert(fNonCond.gauges.highPsig - fNonCond.gauges.highRefPsig > 50, 'Non-Condensables separates P_gauge from P_ref');

console.log('5. Testing Lab Tour, Formula Substitution & diagnoseSystemFaults Hints...');
assert(Lab.TOUR_STEPS.length === 5, '5 guided tour steps');
const formulas = Lab.buildFormulaCards(base);
assert(formulas.length === 6 && formulas.every((c) => c.calc && !c.calc.includes('NaN')), 'Valid live formula cards');
const co2Formulas = Lab.buildFormulaCards(r744Cool);
assert(co2Formulas.length === 6 && co2Formulas.every((c) => c.calc && !c.calc.includes('NaN')), 'Valid R-744 transcritical formula cards');
const hints = Lab.getDiagnosticHints(fUnder);
assert(Array.isArray(hints) && hints.length >= 5 && hints[0].verificationHint, 'diagnoseSystemFaults hints available');
const diagEval = Lab.evaluateDiagnosis('undercharge', 'undercharge', fUnder, Physics.FAULTS);
assert(diagEval.isCorrect && diagEval.evidence.some((e) => e.includes('Field Verification Hint:')), 'Diagnosis feedback includes field verification hint');

console.log('ALL PHYSICS & LAB ASSERTIONS PASSED!');
