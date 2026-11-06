import {t, formatNumber} from './i18n.mjs';

const phases = Object.freeze([
  'original', 'waiting', 'candidates', 'reveal', 'card', 'retreat', 'manual',
]);

// The adapter never owns a clock or copies transforms. init is the only operation
// that allocates WASM arrays; retain this view and do not call wasm.init again.
export async function loadMotion(occurrences) {
  const count = occurrences.length;
  if (!Number.isInteger(count) || count < 1 || count > 715827882) {
    throw new RangeError(t('errors.motionCount'));
  }
  const url = new URL('./motion.wasm', import.meta.url);
  const response = await fetch(url);
  if (!response.ok) throw new Error(t('errors.asset', {path: url.pathname, status: formatNumber(response.status)}));
  const imports = {
    env: {
      // AssemblyScript's assertion/allocation failure path. No imported clock,
      // randomness, animation callbacks, memory, or Math implementation is needed.
      abort(message, file, line, column) {
        throw new Error(t('errors.wasmAbort', {line: formatNumber(line), column: formatNumber(column)}));
      },
    },
  };
  const {instance} = await WebAssembly.instantiateStreaming(response, imports);
  const wasm = instance.exports;
  const pointer = wasm.init(count);
  const states = new Float32Array(wasm.memory.buffer, pointer, count * 3);
  for (let index = 0; index < count; index++) {
    if (occurrences[index].peakScale !== undefined) wasm.setPeakScale(index, occurrences[index].peakScale);
  }
  return {
    states,
    memory: wasm.memory,
    defaultPeakScale: wasm.DEFAULT_PEAK_SCALE.value,
    maxLift: wasm.MAX_LIFT.value,
    setAutomatic(enabled) {
      wasm.setAutomatic(enabled ? 1 : 0);
    },
    setPulseCount(value) {
      if (!Number.isFinite(value)) return;
      wasm.setPulseCount(Math.max(1, Math.min(count, Math.trunc(value))));
    },
    isPulsing(index) {
      return Number.isInteger(index) && index >= 0 && index < count && wasm.isPulsing(index) !== 0;
    },
    setManual(index) {
      wasm.setManual(Number.isInteger(index) && index >= 0 && index < count ? index : -1);
    },
    dismiss() {
      wasm.dismiss();
    },
    setReducedMotion(enabled) {
      wasm.setReducedMotion(enabled ? 1 : 0);
    },
    reset() {
      wasm.reset();
    },
    advance(deltaSeconds) {
      return wasm.advance(deltaSeconds) !== 0;
    },
    get phase() { return phases[wasm.getPhase()]; },
    get automatic() { return wasm.getAutomatic() !== 0; },
    get manualIndex() { return wasm.getManualIndex(); },
    get selectedIndex() { return wasm.getSelectedIndex(); },
    get cardIndex() { return wasm.getCardIndex(); },
    get threadProgress() { return wasm.getThreadProgress(); },
    get cardProgress() { return wasm.getCardProgress(); },
    get cardOffsetX() { return wasm.getCardOffsetX(); },
    get cardOffsetY() { return wasm.getCardOffsetY(); },
    get cardAngle() { return wasm.getCardAngle(); },
    get effectTime() { return wasm.getEffectTime(); },
    get pulseCount() { return wasm.getPulseCount(); },
    get remainingSeconds() { return wasm.getRemainingSeconds(); },
    get candidateA() { return wasm.getCandidateA(); },
    get candidateB() { return wasm.getCandidateB(); },
    get candidateC() { return wasm.getCandidateC(); },
    get reducedMotion() { return wasm.getReducedMotion() !== 0; },
  };
}
