const assert = require('assert');

require('../js/refrigerants.js');
require('../js/physics.js');
require('../js/tour_and_lab.js');

const RefDB = globalThis.HVACRef;
const Physics = globalThis.HVACPhysics;
const Lab = globalThis.HVACLab;

console.log('1. Testing Refrigerant PT & Enthalpy Monotonicity...');
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

    // Inverse lookup round-trip check
    const inv = RefDB.lookupByPressure(refId, st.P_bub_psig, 'bubble');
    assert(Math.abs(inv.T - T) < 0.05, `${refId} inverse lookup error at ${T}: got ${inv.T}`);
  }
}

console.log('2. Testing 1st-Law Conservation & Convergence across All Refrigerants & Metering Devices...');
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
        `${refId} ${mode} ${metering}: check_bypass node must carry subcooled liquid at high-side pressure`
      );
      assert(
        !s.performance.isOverheating,
        `${refId} ${mode} ${metering}: Nominal operation must not trigger thermal overheat (tDisch=${s.gauges.dischargeTempF.toFixed(1)}°F, winding=${s.performance.motorWindingTemp.toFixed(1)}°F)`
      );
      if (mode === 'cooling') {
        assert(s.performance.indoorSupplyDB < s.inputs.indoorDB, 'Cooling supply air cooler than return');
      } else {
        assert(s.performance.indoorSupplyDB > s.inputs.indoorDB, 'Heating supply air warmer than return');
      }
    }
  }
}

assert(RefDB.REFRIGERANTS.R32 && RefDB.REFRIGERANTS.R32.glideF === 0.0, 'R-32 present with zero glide');
const r410Nom = Physics.solveCycle({ refrigerant: 'R410A', mode: 'cooling', metering: 'txv', fault: 'none' });
const r32Cycle = Physics.solveCycle({ refrigerant: 'R32', mode: 'cooling', metering: 'txv', fault: 'none' });
assert(r32Cycle.phPoints.nre > r410Nom.phPoints.nre + 25, `R-32 higher NRE than R-410A (${r32Cycle.phPoints.nre} vs ${r410Nom.phPoints.nre})`);
assert(r32Cycle.gauges.dischargeTempF > r410Nom.gauges.dischargeTempF + 8, `R-32 higher discharge temp than R-410A (${r32Cycle.gauges.dischargeTempF} vs ${r410Nom.gauges.dischargeTempF})`);

console.log('3. Testing Diagnostic Fault Signatures (R-410A TXV)...');
const base = Physics.solveCycle({ refrigerant: 'R410A', mode: 'cooling', metering: 'txv', fault: 'none' });
const fUnder = Physics.solveCycle({ refrigerant: 'R410A', mode: 'cooling', metering: 'txv', fault: 'undercharge' });
const fOver = Physics.solveCycle({ refrigerant: 'R410A', mode: 'cooling', metering: 'txv', fault: 'overcharge' });
const fEvap = Physics.solveCycle({ refrigerant: 'R410A', mode: 'cooling', metering: 'txv', fault: 'dirty_evap' });
const fCond = Physics.solveCycle({ refrigerant: 'R410A', mode: 'cooling', metering: 'txv', fault: 'dirty_cond' });
const fRest = Physics.solveCycle({ refrigerant: 'R410A', mode: 'cooling', metering: 'txv', fault: 'restriction' });
const fBulb = Physics.solveCycle({ refrigerant: 'R410A', mode: 'cooling', metering: 'txv', fault: 'txv_unstrapped' });
const fValves = Physics.solveCycle({ refrigerant: 'R410A', mode: 'cooling', metering: 'txv', fault: 'bad_valves' });
const fNonCond = Physics.solveCycle({ refrigerant: 'R410A', mode: 'cooling', metering: 'txv', fault: 'non_condensables' });

assert(fUnder.gauges.lowPsig < base.gauges.lowPsig - 20, 'Undercharge drops suction pressure');
assert(fUnder.gauges.superheatF > 20 && fUnder.gauges.subcoolingF < 2.0, 'Undercharge: High SH + Low SC');
assert(fUnder.performance.sightGlassBubbles > 0.5, 'Undercharge: Sight glass bubbles');

assert(fOver.gauges.highPsig > base.gauges.highPsig + 20 && fOver.gauges.subcoolingF > 16, 'Overcharge: High head & High SC');

assert(fEvap.gauges.lowPsig < base.gauges.lowPsig - 20 && fEvap.performance.frostLevel > 0.2, 'Dirty Evap: Low suction & coil frost');

assert(fCond.gauges.highPsig > base.gauges.highPsig + 60 && fCond.gauges.dischargeTempF > 210, 'Dirty Condenser: High head & high discharge');

assert(fRest.gauges.superheatF > 18 && fRest.gauges.subcoolingF > 14, 'Restriction: High SH + High SC');
assert(fRest.gauges.drierDeltaP > 20 && fRest.performance.sightGlassBubbles > 0.5, 'Restriction: Drier dP & sight glass flash');

assert(fBulb.gauges.superheatF < 2.0 && fBulb.performance.isFloodback, 'Unstrapped Bulb: Low SH & floodback');

assert(fValves.gauges.lowPsig > base.gauges.lowPsig + 20 && fValves.gauges.highPsig < base.gauges.highPsig - 20, 'Bad Valves: Pressures equalize');
assert(fValves.performance.compressionRatio < 2.5, 'Bad Valves: Low compression ratio');

assert(fNonCond.gauges.highPsig > base.gauges.highPsig + 50 && fNonCond.gauges.subcoolingF > 14, 'Non-Condensables: High head & apparent SC');

console.log('4. Testing Lab Tour & Formula Substitution...');
assert(Lab.TOUR_STEPS.length === 5, '5 guided tour steps');
const formulas = Lab.buildFormulaCards(base);
assert(formulas.length === 6 && formulas.every((c) => c.calc && !c.calc.includes('NaN')), 'Valid live formula cards');

console.log('ALL PHYSICS & LAB ASSERTIONS PASSED!');
