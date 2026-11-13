/**
 * Main Application Controller for HVAC/R Refrigerant Cycle Simulator
 */
(function (global) {
  'use strict';

  const RefDB = global.HVACRef;
  const Physics = global.HVACPhysics;
  const Lab = global.HVACLab;

  const state = {
    params: {
      refrigerant: 'R410A',
      mode: 'cooling',
      metering: 'txv',
      fault: 'none',
      indoorDB: 75,
      indoorRH: 50,
      indoorCFM: 400,
      outdoorDB: 95,
      outdoorRH: 55,
      condAirflowPct: 100,
      chargePct: 100,
      compressorSpeed: 1.0
    },
    cycle: null,
    paused: false,
    animSpeed: 1,
    colorMode: 'hvac',
    labelMode: 'tech',
    theme: 'dark',
    selectedNodeId: null,
    hoveredNodeId: null,
    tourIndex: null,
    mystery: {
      active: false,
      actualFault: null,
      selectedGuess: null,
      correct: 0,
      attempts: 0
    }
  };

  let renderer = null;
  let phDiagram = null;
  const needleTarget = { low: -40, high: -40 };
  const needleDisplay = { low: null, high: null, lastLowStr: '', lastHighStr: '' };

  function recompute() {
    state.cycle = Physics.solveCycle(state.params);
    if (renderer) renderer.setState(state.cycle);
    if (phDiagram) phDiagram.setState(state.cycle);
    updateUI();
  }

  function updateLegend() {
    const strip = document.getElementById('legend-strip');
    if (state.colorMode === 'thermal') {
      strip.innerHTML = `
        <span class="leg-item"><span class="leg-swatch" style="background:rgb(40,175,255)"></span>Cold (25–45°F)</span>
        <span class="leg-item"><span class="leg-swatch" style="background:rgb(140,225,130)"></span>Cool (60–85°F)</span>
        <span class="leg-item"><span class="leg-swatch" style="background:rgb(245,165,45)"></span>Warm (100–145°F)</span>
        <span class="leg-item"><span class="leg-swatch" style="background:rgb(255,140,95)"></span>Hot Gas (165–225°F+)</span>
      `;
    } else {
      strip.innerHTML = `
        <span class="leg-item"><span class="leg-swatch" style="background:#ef4444"></span>High-P Superheated Gas</span>
        <span class="leg-item"><span class="leg-swatch" style="background:#f97316"></span>Condensing 2-Phase</span>
        <span class="leg-item"><span class="leg-swatch" style="background:#db2777"></span>High-P Subcooled Liquid</span>
        <span class="leg-item"><span class="leg-swatch" style="background:#22d3ee"></span>Low-P Boiling 2-Phase</span>
        <span class="leg-item"><span class="leg-swatch" style="background:#3b82f6"></span>Low-P Superheated Vapor</span>
      `;
    }
  }

  function updateManifoldAndPerf() {
    const s = state.cycle;
    const g = s.gauges;
    const p = s.performance;

    // Low-side dial: -14.7 psig (-130 deg) to 300 psig (+130 deg)
    const lowNorm = RefDB.clamp((g.lowPsig + 14.7) / 314.7, 0, 1);
    needleTarget.low = -130 + lowNorm * 260;

    // High-side dial: 0 psig (-130 deg) to 650 psig (+130 deg), smoothly damped in frame loop
    const highNorm = RefDB.clamp(g.highPsig / 650, 0, 1);
    needleTarget.high = -130 + highNorm * 260;

    if (needleDisplay.low === null) {
      needleDisplay.low = needleTarget.low;
      needleDisplay.high = needleTarget.high;
      document.getElementById('needle-low').setAttribute('transform', `rotate(${needleDisplay.low.toFixed(1)} 50 50)`);
      document.getElementById('needle-high').setAttribute('transform', `rotate(${needleDisplay.high.toFixed(1)} 50 50)`);
    }

    // LCD texts
    document.getElementById('lcd-low-psig').textContent = RefDB.formatPressure(g.lowPsig);
    document.getElementById('lcd-low-sat').textContent = `${g.lowSatDewF.toFixed(1)}°F`;
    document.getElementById('lcd-suct-temp').textContent = `${g.suctionTempF.toFixed(1)}°F`;
    document.getElementById('lcd-sh').textContent = `${g.superheatF.toFixed(1)}°F`;
    document.getElementById('lcd-sh-target').textContent =
      s.metering === 'fxo' ? '~8–14°F (Var)' : `~${g.targetSH.toFixed(0)}°F (${s.metering.toUpperCase()})`;

    const shBadge = document.getElementById('badge-sh');
    shBadge.className = `status-pill status-${g.shStatus}`;
    shBadge.textContent = p.isFloodback
      ? '⚠ FLOODBACK RISK (LOW SH)'
      : g.superheatF > g.targetSH + 7
        ? 'HIGH SUPERHEAT (STARVED)'
        : g.shStatus === 'warn'
          ? 'SUPERHEAT LOW / SHIFTED'
          : 'SUPERHEAT OK';

    document.getElementById('lcd-high-psig').textContent = RefDB.formatPressure(g.highPsig);
    document.getElementById('lcd-high-sat').textContent = `${g.highSatBubF.toFixed(1)}°F`;
    document.getElementById('lcd-liq-temp').textContent = `${g.liquidTempF.toFixed(1)}°F`;
    document.getElementById('lcd-sc').textContent = `${g.subcoolingF.toFixed(1)}°F`;
    document.getElementById('lcd-sc-target').textContent = `~${g.targetSC.toFixed(0)}°F`;

    const scBadge = document.getElementById('badge-sc');
    scBadge.className = `status-pill status-${g.scStatus}`;
    scBadge.textContent =
      g.subcoolingF < 3.0
        ? 'LOW SUBCOOLING (FLASH GAS)'
        : g.subcoolingF > g.targetSC + 5
          ? 'HIGH SUBCOOLING (BACKED UP)'
          : 'SUBCOOLING OK';

    // Performance tiles
    const capBTU = s.mode === 'cooling' ? p.qEvapBTUHr : p.qCondBTUHr;
    document.getElementById('m-tons').textContent = `${p.tons.toFixed(2)} Tons`;
    document.getElementById('m-btu').textContent = `${Math.round(capBTU).toLocaleString()} BTU/hr`;
    document.getElementById('m-supply').textContent = `${p.indoorSupplyDB.toFixed(1)}°F`;
    document.getElementById('m-dt').textContent =
      s.mode === 'cooling' ? `ΔT -${p.indoorDeltaT.toFixed(1)}°F` : `ΔT +${p.indoorDeltaT.toFixed(1)}°F`;

    const dischEl = document.getElementById('m-disch');
    dischEl.textContent = `${g.dischargeTempF.toFixed(0)}°F`;
    dischEl.style.color = p.isOverheating ? '#f87171' : '';
    document.getElementById('m-cr').textContent = `CR ${p.compressionRatio.toFixed(2)}:1`;

    document.getElementById('m-amps').textContent = `${p.compAmps.toFixed(1)} A`;
    document.getElementById('m-kw').textContent = `${(p.totalWatts / 1000).toFixed(2)} kW total`;
    document.getElementById('m-eer').textContent = `${p.eer.toFixed(1)} EER`;
    document.getElementById('m-cop').textContent = `COP ${p.cop.toFixed(2)}`;
    document.getElementById('m-condensate').textContent = `${p.condensateGPH.toFixed(2)} gph`;
    document.getElementById('m-mass').textContent = `${p.massFlowLbMin.toFixed(2)} lb/min`;
  }

  function updateInspector() {
    const s = state.cycle;
    const focusId = state.hoveredNodeId || state.selectedNodeId || (state.tourIndex !== null ? Lab.TOUR_STEPS[state.tourIndex].nodeId : null);

    const titleEl = document.getElementById('insp-title');
    const phaseEl = document.getElementById('insp-phase');
    const metricsEl = document.getElementById('insp-metrics');
    const descEl = document.getElementById('insp-desc');

    if (focusId && s.nodes[focusId]) {
      const n = s.nodes[focusId];
      titleEl.textContent = n.title;
      phaseEl.textContent = n.phase;
      metricsEl.innerHTML = `
        <span class="insp-chip">P: ${RefDB.formatPressure(n.P_psig)}</span>
        <span class="insp-chip">T: ${n.T.toFixed(1)}°F</span>
        <span class="insp-chip">T_sat: ${n.T_sat.toFixed(1)}°F</span>
        <span class="insp-chip">h: ${n.h.toFixed(1)} BTU/lb</span>
        <span class="insp-chip">ρ: ${n.rho.toFixed(2)} lb/ft³</span>
      `;
      descEl.textContent = n.description;
    } else {
      const p = s.performance;
      titleEl.textContent = `${s.ref.shortName} ${s.mode === 'cooling' ? 'A/C Cooling' : 'Heat Pump Heating'} (${s.metering.toUpperCase()})`;
      phaseEl.textContent = `100% Vapor Point at ${(p.wetCoilFrac * 100).toFixed(0)}% of Evaporator • Flash Gas ${(p.flashGasQuality * 100).toFixed(1)}%`;
      metricsEl.innerHTML = `
        <span class="insp-chip">Q_evap: ${Math.round(p.qEvapBTUHr).toLocaleString()} BTU/hr</span>
        <span class="insp-chip">W_comp: ${Math.round(p.wCompBTUHr).toLocaleString()} BTU/hr</span>
        <span class="insp-chip">Q_cond: ${Math.round(p.qCondBTUHr).toLocaleString()} BTU/hr</span>
        <span class="insp-chip">Windings: ${p.motorWindingTemp.toFixed(0)}°F</span>
      `;
      descEl.textContent =
        'Hover or click any pipe, coil, valve, sight glass, or compressor cutaway to inspect live state variables. Try injecting faults or switching TXV vs Fixed Orifice!';
    }
  }

  function updateSidebar() {
    const s = state.cycle;
    const ref = s.ref;

    // Top cylinder badge
    document.getElementById('top-cyl-dot').style.background = ref.cylinderHex;
    document.getElementById('top-ref-tag').textContent = `${ref.shortName} • ${ref.safetyClass.split(' ')[0]}`;

    // Refrigerant Info Card
    document.getElementById('ref-info-card').innerHTML = `
      <div><strong>${ref.name}</strong></div>
      <div>Composition: ${ref.composition}</div>
      <div>Safety: <strong>${ref.safetyClass}</strong> • Oil: ${ref.oilType}</div>
      <div>Cylinder: <strong style="color:${ref.cylinderHex}">${ref.cylinderColorName}</strong> • Glide: ${ref.glideF.toFixed(1)}°F • Crit: ${ref.Tc.toFixed(0)}°F</div>
      <div style="margin-top:4px;">${ref.notes}</div>
    `;

    // Fault active button & info
    document.querySelectorAll('.fault-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-fault') === state.params.fault);
    });
    const fObj = Physics.FAULTS[state.params.fault] || Physics.FAULTS.none;
    document.getElementById('fault-info-box').innerHTML = `
      <div style="font-weight:800; color:${fObj.id === 'none' ? 'var(--good)' : 'var(--warn)'};">${fObj.name}</div>
      <div style="margin-top:2px;">${fObj.description}</div>
      <ul>${fObj.clues.map((c) => `<li>${c}</li>`).join('')}</ul>
    `;

    // Sync slider displays
    document.getElementById('val-indoor-db').textContent = `${state.params.indoorDB}°F`;
    document.getElementById('val-indoor-rh').textContent = `${state.params.indoorRH}% RH`;
    document.getElementById('val-indoor-cfm').textContent = `${state.params.indoorCFM} CFM/ton`;
    document.getElementById('val-outdoor-db').textContent = `${state.params.outdoorDB}°F`;
    document.getElementById('val-cond-air').textContent = `${state.params.condAirflowPct}%`;
    document.getElementById('val-charge').textContent = `${state.params.chargePct}%`;
    document.getElementById('val-comp-speed').textContent = `${Math.round(state.params.compressorSpeed * 100)}%`;

    document.getElementById('rng-indoor-db').value = state.params.indoorDB;
    document.getElementById('rng-indoor-rh').value = state.params.indoorRH;
    document.getElementById('rng-indoor-cfm').value = state.params.indoorCFM;
    document.getElementById('rng-outdoor-db').value = state.params.outdoorDB;
    document.getElementById('rng-cond-air').value = state.params.condAirflowPct;
    document.getElementById('rng-charge').value = state.params.chargePct;
    document.getElementById('rng-comp-speed').value = Math.round(state.params.compressorSpeed * 100);

    // Disable charge/airflow sliders during Mystery Fault Mode so students diagnose from gauges
    const lockSliders = state.mystery.active;
    ['rng-indoor-cfm', 'rng-cond-air', 'rng-charge'].forEach((id) => {
      document.getElementById(id).disabled = lockSliders;
    });

    // P-H Table & Energy Breakdown
    const ph = s.phPoints;
    const rows = [ph.p1, ph.p2, ph.p3, ph.p4];
    document.getElementById('ph-state-tbody').innerHTML = rows
      .map(
        (pt) => `
      <tr>
        <td>Pt ${pt.label}: ${pt.name}</td>
        <td>${RefDB.formatPressure(pt.P_psig)}</td>
        <td>${pt.T.toFixed(1)}°F</td>
        <td>${pt.h.toFixed(1)}</td>
      </tr>`
      )
      .join('');

    const p = s.performance;
    document.getElementById('ph-energy-summary').innerHTML = `
      <div><strong>1st Law Cycle Balance (Per Pound &amp; Total):</strong></div>
      <div>• Net Refrig. Effect (h₁−h₄): <strong>${ph.nre.toFixed(1)} BTU/lb</strong> → Q_evap = <strong>${Math.round(p.qEvapBTUHr).toLocaleString()} BTU/hr</strong></div>
      <div>• Compression Work (h₂−h₁): <strong>${ph.heatOfCompression.toFixed(1)} BTU/lb</strong> → W_comp = <strong>${Math.round(p.wCompBTUHr).toLocaleString()} BTU/hr</strong></div>
      <div>• Heat Rejected (h₂−h₃): <strong>${ph.heatRejected.toFixed(1)} BTU/lb</strong> → Q_cond = <strong>${Math.round(p.qCondBTUHr).toLocaleString()} BTU/hr</strong></div>
      <div>• Sensible / Latent Split: <strong>${Math.round(p.sensibleBTUHr).toLocaleString()}</strong> / <strong>${Math.round(p.latentBTUHr).toLocaleString()} BTU/hr</strong></div>
    `;

    // Live Formulas
    const cards = Lab.buildFormulaCards(s);
    document.getElementById('formulas-container').innerHTML = cards
      .map(
        (c) => `
      <div class="formula-card">
        <div class="f-name">${c.name}</div>
        <div class="f-eq">${c.formula}</div>
        <div class="f-calc">${c.calc}</div>
        <div class="f-note">${c.meaning}</div>
      </div>`
      )
      .join('');
  }

  function updateTourBanner() {
    const banner = document.getElementById('tour-banner');
    if (state.tourIndex === null) {
      banner.classList.remove('visible');
      renderer.setTourStep(null);
      return;
    }
    const step = Lab.TOUR_STEPS[state.tourIndex];
    banner.classList.add('visible');
    document.getElementById('tour-badge').textContent = step.badge;
    document.getElementById('tour-title').textContent = step.title;
    document.getElementById('tour-summary').textContent = step.summary;
    document.getElementById('tour-points').innerHTML = step.keyPoints.map((k) => `<li>${k}</li>`).join('');
    document.getElementById('tour-watch').textContent = `💡 ${step.watchFor}`;
    renderer.setTourStep(step);
    updateInspector();
  }

  function updateUI() {
    updateLegend();
    updateManifoldAndPerf();
    updateInspector();
    updateSidebar();
  }

  function applyFaultPreset(faultId) {
    // Restore baseline sliders cleanly, then apply preset
    state.params.fault = faultId;
    state.params.indoorCFM = 400;
    state.params.condAirflowPct = 100;
    state.params.chargePct = 100;

    if (faultId === 'undercharge') state.params.chargePct = 65;
    else if (faultId === 'overcharge') state.params.chargePct = 128;
    else if (faultId === 'dirty_evap') state.params.indoorCFM = 210;
    else if (faultId === 'dirty_cond') state.params.condAirflowPct = 48;

    recompute();
  }

  function startMysteryFault() {
    const pool = state.params.metering === 'txv'
      ? Lab.MYSTERY_POOL
      : Lab.MYSTERY_POOL.filter((id) => id !== 'txv_unstrapped');
    let pick = pool[Math.floor(Math.random() * pool.length)];
    if (pool.length > 1 && pick === state.mystery.actualFault) {
      pick = pool[(pool.indexOf(pick) + 1) % pool.length];
    }
    state.mystery.active = true;
    state.mystery.actualFault = pick;
    state.mystery.selectedGuess = null;

    document.getElementById('fault-panel-normal').classList.add('hidden');
    document.getElementById('fault-panel-masked').classList.remove('hidden');
    document.getElementById('mystery-quiz-ui').classList.remove('hidden');
    document.getElementById('mystery-status').textContent = 'Diagnose the Active Fault:';
    document.getElementById('mystery-feedback').innerHTML = '';

    // Switch sidebar to Lab tab automatically
    activateTab('lab');

    // Render choice buttons
    const opts = Lab.MYSTERY_POOL.map((fid) => Physics.FAULTS[fid]);
    document.getElementById('mystery-options').innerHTML = opts
      .map(
        (f) => `<button class="quiz-choice" data-guess="${f.id}">${f.shortName}</button>`
      )
      .join('');

    document.querySelectorAll('.quiz-choice').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.mystery.selectedGuess = btn.getAttribute('data-guess');
        document.querySelectorAll('.quiz-choice').forEach((b) => b.classList.remove('selected'));
        btn.classList.add('selected');
      });
    });

    applyFaultPreset(pick);
  }

  function exitMysteryMode() {
    state.mystery.active = false;
    state.mystery.actualFault = null;
    state.mystery.selectedGuess = null;
    document.getElementById('fault-panel-normal').classList.remove('hidden');
    document.getElementById('fault-panel-masked').classList.add('hidden');
    document.getElementById('mystery-quiz-ui').classList.add('hidden');
    document.getElementById('mystery-status').textContent = 'Ready for Diagnostic Test';
    document.getElementById('mystery-feedback').innerHTML = '';
    applyFaultPreset('none');
  }

  function activateTab(tabName) {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.getAttribute('data-tab') === tabName));
    document.querySelectorAll('.tab-body').forEach((el) => el.classList.toggle('active', el.id === `tab-${tabName}`));
  }

  function initControls() {
    // Build Fault Preset Buttons
    const faultGrid = document.getElementById('fault-grid');
    faultGrid.innerHTML = Object.values(Physics.FAULTS)
      .map((f) => `<button class="fault-btn" data-fault="${f.id}" title="${f.name}">${f.shortName}</button>`)
      .join('');

    faultGrid.addEventListener('click', (e) => {
      const btn = e.target.closest('.fault-btn');
      if (!btn) return;
      applyFaultPreset(btn.getAttribute('data-fault'));
    });

    document.getElementById('btn-reset').addEventListener('click', () => {
      state.params.indoorDB = 75;
      state.params.indoorRH = 50;
      state.params.outdoorDB = state.params.mode === 'heating' ? 42 : 95;
      state.params.compressorSpeed = 1.0;
      applyFaultPreset('none');
    });

    // Top Selectors
    document.getElementById('sel-refrigerant').addEventListener('change', (e) => {
      state.params.refrigerant = e.target.value;
      recompute();
    });

    document.getElementById('sel-mode').addEventListener('change', (e) => {
      state.params.mode = e.target.value;
      if (state.params.mode === 'heating' && state.params.outdoorDB > 65) {
        state.params.outdoorDB = 42;
        state.params.indoorDB = 70;
      } else if (state.params.mode === 'cooling' && state.params.outdoorDB < 65) {
        state.params.outdoorDB = 95;
        state.params.indoorDB = 75;
      }
      recompute();
    });

    document.getElementById('sel-metering').addEventListener('change', (e) => {
      state.params.metering = e.target.value;
      recompute();
    });

    // Segmented Mode Buttons
    document.querySelectorAll('[data-color-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.colorMode = btn.getAttribute('data-color-mode');
        document.querySelectorAll('[data-color-mode]').forEach((b) => b.classList.toggle('active', b === btn));
        renderer.setColorMode(state.colorMode);
        updateLegend();
      });
    });

    document.querySelectorAll('[data-label-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.labelMode = btn.getAttribute('data-label-mode');
        document.querySelectorAll('[data-label-mode]').forEach((b) => b.classList.toggle('active', b === btn));
        renderer.setLabelMode(state.labelMode);
      });
    });

    // Playback Speed
    document.getElementById('btn-play-pause').addEventListener('click', (e) => {
      state.paused = !state.paused;
      e.target.textContent = state.paused ? 'Play' : 'Pause';
      e.target.classList.toggle('active', state.paused);
    });

    document.querySelectorAll('[data-speed]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.animSpeed = parseFloat(btn.getAttribute('data-speed'));
        document.querySelectorAll('[data-speed]').forEach((b) => b.classList.toggle('active', b === btn));
      });
    });

    // Theme toggle
    document.getElementById('btn-theme').addEventListener('click', (e) => {
      state.theme = state.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.classList.toggle('light', state.theme === 'light');
      e.target.textContent = state.theme === 'light' ? 'Dark Lab' : 'Light Mode';
      renderer.setTheme(state.theme);
      phDiagram.setTheme(state.theme);
    });

    // Guided Tour
    document.getElementById('btn-tour').addEventListener('click', () => {
      state.tourIndex = state.tourIndex === null ? 0 : null;
      updateTourBanner();
    });
    document.getElementById('btn-tour-prev').addEventListener('click', () => {
      if (state.tourIndex === null) return;
      state.tourIndex = (state.tourIndex - 1 + Lab.TOUR_STEPS.length) % Lab.TOUR_STEPS.length;
      updateTourBanner();
    });
    document.getElementById('btn-tour-next').addEventListener('click', () => {
      if (state.tourIndex === null) return;
      state.tourIndex = (state.tourIndex + 1) % Lab.TOUR_STEPS.length;
      updateTourBanner();
    });
    document.getElementById('btn-tour-close').addEventListener('click', () => {
      state.tourIndex = null;
      updateTourBanner();
    });

    // Sliders
    const bindSlider = (id, key, scale = 1, customHandler = null) => {
      document.getElementById(id).addEventListener('input', (e) => {
        state.params[key] = parseFloat(e.target.value) * scale;
        if (customHandler) customHandler(state.params[key]);
        recompute();
      });
    };
    bindSlider('rng-indoor-db', 'indoorDB');
    bindSlider('rng-indoor-rh', 'indoorRH');
    bindSlider('rng-indoor-cfm', 'indoorCFM', 1, () => {
      if (state.params.fault === 'dirty_evap') state.params.fault = 'none';
    });
    bindSlider('rng-outdoor-db', 'outdoorDB');
    bindSlider('rng-cond-air', 'condAirflowPct', 1, () => {
      if (state.params.fault === 'dirty_cond') state.params.fault = 'none';
    });
    bindSlider('rng-charge', 'chargePct', 1, () => {
      if (state.params.fault === 'undercharge' || state.params.fault === 'overcharge') state.params.fault = 'none';
    });
    bindSlider('rng-comp-speed', 'compressorSpeed', 0.01);

    // Sidebar Tabs
    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => activateTab(btn.getAttribute('data-tab')));
    });

    // Mystery Fault Challenge Buttons
    document.getElementById('btn-mystery-quick').addEventListener('click', startMysteryFault);
    document.getElementById('btn-start-mystery').addEventListener('click', startMysteryFault);
    document.getElementById('btn-exit-mystery').addEventListener('click', exitMysteryMode);
    document.getElementById('btn-submit-mystery').addEventListener('click', () => {
      if (!state.mystery.active || !state.mystery.selectedGuess) {
        document.getElementById('mystery-feedback').innerHTML =
          '<span style="color:var(--warn); font-weight:700;">Select a diagnosis option above before submitting!</span>';
        return;
      }
      const result = Lab.evaluateDiagnosis(
        state.mystery.selectedGuess,
        state.mystery.actualFault,
        state.cycle,
        Physics.FAULTS
      );
      state.mystery.attempts += 1;
      if (result.isCorrect) state.mystery.correct += 1;
      document.getElementById('quiz-score').textContent = `Score: ${state.mystery.correct} / ${state.mystery.attempts}`;

      document.getElementById('mystery-feedback').innerHTML = `
        <div style="padding:8px; border-radius:6px; border:1px solid ${result.isCorrect ? 'var(--good)' : 'var(--danger)'}; background:${result.isCorrect ? 'rgba(16,185,129,0.14)' : 'rgba(239,68,68,0.14)'};">
          <div style="font-weight:800; color:${result.isCorrect ? '#34d399' : '#f87171'};">
            ${result.isCorrect ? '✓ Correct Diagnosis!' : `✗ Not quite — You picked "${result.guess.shortName}". Actual Fault: "${result.actual.name}"`}
          </div>
          <div style="margin-top:4px;">${result.actual.description}</div>
          <ul style="margin:4px 0 0 16px; padding:0;">${result.evidence.map((ev) => `<li>${ev}</li>`).join('')}</ul>
        </div>
      `;
    });

    // Keyboard shortcuts for classroom projector efficiency
    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      if (e.code === 'Space') {
        e.preventDefault();
        document.getElementById('btn-play-pause').click();
      } else if (e.key === 'ArrowRight' && state.tourIndex !== null) {
        document.getElementById('btn-tour-next').click();
      } else if (e.key === 'ArrowLeft' && state.tourIndex !== null) {
        document.getElementById('btn-tour-prev').click();
      }
    });
  }

  function bootstrap() {
    renderer = new global.HVACRenderer(document.getElementById('schematic-stage'), {
      onHoverNode: (nodeId) => {
        state.hoveredNodeId = nodeId;
        updateInspector();
      },
      onSelectNode: (nodeId) => {
        state.selectedNodeId = nodeId;
        updateInspector();
      }
    });

    phDiagram = new global.HVACPHDiagram(document.getElementById('ph-canvas'), {
      onHoverPoint: (ptKey) => {
        const map = { p1: 'suction_line', p2: 'discharge_line', p3: 'liquid_line', p4: 'metering_device' };
        renderer.setHighlightedNode(ptKey ? map[ptKey] : null);
      },
      onSelectNode: (nodeId) => {
        state.selectedNodeId = nodeId;
        renderer.setSelectedNode(nodeId);
        updateInspector();
      }
    });

    initControls();
    recompute();

    const lowNeedleEl = document.getElementById('needle-low');
    const highNeedleEl = document.getElementById('needle-high');
    let lastTime = null;
    function frame(now) {
      const dt = lastTime === null ? 0.016 : Math.max(0, Math.min(0.05, (now - lastTime) / 1000));
      lastTime = now;

      renderer.render(dt, state.animSpeed, state.paused);
      phDiagram.render(dt, state.animSpeed, state.paused);

      // Smoothly damp manifold needles + optional micro-chatter when Non-Condensables active
      if (needleDisplay.low !== null) {
        const needleDamp = 1 - Math.exp(-12 * Math.max(0.004, dt));
        needleDisplay.low += (needleTarget.low - needleDisplay.low) * needleDamp;
        needleDisplay.high += (needleTarget.high - needleDisplay.high) * needleDamp;

        const chatter = state.params.fault === 'non_condensables' && !state.paused ? Math.sin(now * 0.04) * 3.5 : 0;
        const lowStr = needleDisplay.low.toFixed(2);
        const highStr = (needleDisplay.high + chatter).toFixed(2);

        if (lowStr !== needleDisplay.lastLowStr) {
          needleDisplay.lastLowStr = lowStr;
          lowNeedleEl.setAttribute('transform', `rotate(${lowStr} 50 50)`);
        }
        if (highStr !== needleDisplay.lastHighStr) {
          needleDisplay.lastHighStr = highStr;
          highNeedleEl.setAttribute('transform', `rotate(${highStr} 50 50)`);
        }
      }

      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})(window);
