(() => {
  'use strict';

  // v91.38 displays the complete daily Brief. The former differential Brief
  // renderer hid the normal Brief to show only "facts since the last Brief".
  // Keeping both renderers active made them fight over the same DOM and caused
  // the Brief to alternate continuously between content and a blank area.
  //
  // Keep a tiny compatibility API for diagnostics/tests, but do not install
  // any DOM observer, fetch wrapper or visibility mutation here.
  const stats = {
    version: '91.38-disabled',
    disabled: true,
    lastDeduped: 0,
    lastCandidates: 0,
    lastChosen: 0,
    lastTopScores: []
  };
  const api = Object.freeze({
    version: '91.38-disabled',
    disabled: true,
    stats,
    sameEvent: () => false,
    rank: () => 0,
    impactScore: () => 0,
    selectIds: () => []
  });
  window.__briefSmartV9110 = api;
  window.__briefSmartV9112 = api;
})();
