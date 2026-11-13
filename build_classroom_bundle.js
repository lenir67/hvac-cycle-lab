/**
 * Repeatable bundler that packages index.html, styles.css, and js/*.js into a single
 * self-contained HTML file (HVAC_Refrigerant_Cycle_Lab.html) for Google Sites / Classroom.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = __dirname;
const OUTPUT_FILE = path.join(ROOT, 'HVAC_Refrigerant_Cycle_Lab.html');
const SCRIPT_FILES = [
  'js/refrigerants.js',
  'js/physics.js',
  'js/ph_diagram.js',
  'js/renderer.js',
  'js/tour_and_lab.js',
  'js/app.js'
];

function buildBundle() {
  const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const cssContent = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');

  const cssTag = '<link rel="stylesheet" href="./styles.css" />';
  if (!indexHtml.includes(cssTag)) {
    throw new Error(`Expected stylesheet tag not found in index.html: ${cssTag}`);
  }

  let bundled = indexHtml.replace(cssTag, () => `<style>\n${cssContent}\n</style>`);

  const scriptTagsBlock = SCRIPT_FILES
    .map((relPath) => `  <script defer src="./${relPath}"></script>`)
    .join('\n');

  const altScriptTagsBlock = SCRIPT_FILES
    .map((relPath) => `  <script defer src="./${relPath}"></script>`)
    .join('\r\n');

  const targetBlock = bundled.includes(altScriptTagsBlock) ? altScriptTagsBlock : scriptTagsBlock;
  if (!bundled.includes(targetBlock)) {
    throw new Error('Expected 6 defer script tags block not found in index.html');
  }

  const inlineScripts = SCRIPT_FILES.map((relPath) => {
    const code = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
    // Escape closing script sequences safely so HTML parser never terminates <script> early
    const safeCode = code.replace(/<\/script/gi, '<\\/script');
    return `  <script>\n${safeCode}\n  </script>`;
  }).join('\n');

  bundled = bundled.replace(targetBlock, () => inlineScripts);

  fs.writeFileSync(OUTPUT_FILE, bundled, 'utf8');
  return bundled;
}

function verifyBundle(bundled) {
  const stats = fs.statSync(OUTPUT_FILE);
  if (stats.size <= 100 * 1024) {
    throw new Error(`Bundle size too small (${stats.size} bytes); expected > 100 KB`);
  }

  if (bundled.includes('href="./styles.css"') || bundled.includes('src="./js/')) {
    throw new Error('Bundle still contains external styles.css or js/ references');
  }

  const scriptRegex = /<script>([\s\S]*?)<\/script>/g;
  let match;
  let scriptCount = 0;
  while ((match = scriptRegex.exec(bundled)) !== null) {
    scriptCount += 1;
    const code = match[1];
    new vm.Script(code, { filename: `inline-script-${scriptCount}.js` });
  }

  if (scriptCount !== SCRIPT_FILES.length) {
    throw new Error(`Expected ${SCRIPT_FILES.length} inline scripts, found ${scriptCount}`);
  }

  console.log(
    `Generated HVAC_Refrigerant_Cycle_Lab.html (${(stats.size / 1024).toFixed(1)} KB, ${scriptCount} validated inline scripts, 0 external dependencies).`
  );
}

const output = buildBundle();
verifyBundle(output);
