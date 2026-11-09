// All timing, selection and transforms live in WASM. JS retains one view of state.
export const DEFAULT_PEAK_SCALE: f32 = 1.65;
export const MAX_LIFT: f32 = -18.0;

const ORIGINAL: i32 = 0;
const WAITING: i32 = 1;
const CANDIDATES: i32 = 2;
const REVEAL: i32 = 3;
const CARD: i32 = 4;
const RETREAT: i32 = 5;
const MANUAL: i32 = 6;
const WAIT_SECONDS: f64 = 8.0;
const CANDIDATE_SECONDS: f64 = 4.0;
const THREAD_SECONDS: f64 = 0.75;
const CARD_GROW_SECONDS: f64 = 0.90;
const REVEAL_SECONDS: f64 = THREAD_SECONDS + CARD_GROW_SECONDS;
const CARD_SECONDS: f64 = 30.0;
const RETREAT_SECONDS: f64 = 0.65;

let count: i32 = 0;
let states = new StaticArray<f32>(0);
let origins = new StaticArray<f32>(0);
let peakScales = new StaticArray<f32>(0);
let pulsePeriods = new StaticArray<f64>(0);
let pulseOffsets = new StaticArray<f64>(0);
let pulseFlags = new StaticArray<u8>(0);
let configuredPulseCount: i32 = 0;
let phase: i32 = ORIGINAL;
let automatic: bool = false;
let reducedMotion: bool = false;
let manualIndex: i32 = -1;
let selectedIndex: i32 = -1;
let nextWinner: i32 = 0;
let candidateA: i32 = -1;
let candidateB: i32 = -1;
let candidateC: i32 = -1;
let elapsed: f64 = RETREAT_SECONDS;
let pulseClock: f64 = 0.0;
let cardOffsetX: f64 = 0.0;
let cardOffsetY: f64 = 0.0;
let cardAngle: f64 = 0.0;

function ease(value: f64): f64 {
  const t = Math.min(1.0, Math.max(0.0, value));
  return t * t * (3.0 - 2.0 * t);
}

function refreshPulses(): void {
  for (let i: i32 = 0; i < count; i++) unchecked(pulseFlags[i] = 0);
  if (!automatic || reducedMotion || phase == ORIGINAL) return;
  // Even/odd traversal distributes membership instead of taking a contiguous
  // prefix. The consumed queue position rotates this order between selections.
  const evens = (count + 1) / 2;
  let active: i32 = 0;
  for (let slot: i32 = 0; slot < count && active < configuredPulseCount; slot++) {
    const rank = (slot + nextWinner) % count;
    const index = rank < evens ? rank * 2 : (rank - evens) * 2 + 1;
    if (phase == CANDIDATES) {
      if (index == candidateA || index == candidateB || index == candidateC) continue;
    } else if (phase != WAITING && index == selectedIndex) {
      continue;
    }
    unchecked(pulseFlags[index] = 1);
    active++;
  }
}

function ambient(index: i32): f64 {
  if (unchecked(pulseFlags[index]) == 0) return 0.0;
  const period = unchecked(pulsePeriods[index]);
  const t = ((pulseClock + unchecked(pulseOffsets[index])) % period) / period;
  const triangle = 1.0 - Math.abs(2.0 * t - 1.0);
  return 0.08 + 0.40 * ease(triangle);
}

function writeProgress(index: i32, progress: f64): void {
  const offset = index * 3;
  const amount = <f32>progress;
  unchecked(states[offset] = amount);
  unchecked(states[offset + 1] = 1.0 + (unchecked(peakScales[index]) - 1.0) * amount);
  unchecked(states[offset + 2] = MAX_LIFT * amount);
}

function capture(): void {
  for (let i: i32 = 0; i < count; i++) {
    unchecked(origins[i] = unchecked(states[i * 3]));
  }
}

function clearCandidates(): void {
  candidateA = candidateB = candidateC = -1;
}

function duration(): f64 {
  if (phase == WAITING) return WAIT_SECONDS;
  if (phase == CANDIDATES) return CANDIDATE_SECONDS;
  if (phase == REVEAL || phase == MANUAL) return reducedMotion ? 0.0 : REVEAL_SECONDS;
  if (phase == CARD) return CARD_SECONDS;
  return reducedMotion ? 0.0 : RETREAT_SECONDS;
}

function render(): void {
  // The contact impulse reaches the card before it unfolds. The shared
  // oscillator clock also keeps a manually inspected card gently swaying.
  const blend = reducedMotion || phase == CARD ? 1.0 : ease(elapsed / THREAD_SECONDS);
  for (let i: i32 = 0; i < count; i++) {
    let target = ambient(i);
    if (phase == CANDIDATES) {
      if (i == candidateA) target = 0.65;
      else if (i == candidateB) target = 0.60;
      else if (i == candidateC) target = 0.55;
    } else if ((phase == REVEAL || phase == CARD || phase == MANUAL) && i == selectedIndex) {
      target = 1.0;
    }
    if (blend != 1.0) {
      const origin = <f64>unchecked(origins[i]);
      target = origin + (target - origin) * blend;
    }
    writeProgress(i, target);
  }
  const sway = reducedMotion ? 0.0 : ease(getCardProgress());
  if (sway > 0.0) {
    cardOffsetX = 3.2 * sway * Math.sin(pulseClock * (2.0 * Math.PI / 6.8));
    cardOffsetY = 2.1 * sway * Math.sin(pulseClock * (2.0 * Math.PI / 5.4));
    cardAngle = 0.35 * sway * Math.sin(pulseClock * (2.0 * Math.PI / 8.6));
  } else {
    cardOffsetX = cardOffsetY = cardAngle = 0.0;
  }
}

function enterOriginal(): void {
  capture();
  phase = ORIGINAL;
  elapsed = 0.0;
  selectedIndex = -1;
  clearCandidates();
  refreshPulses();
  render();
}

function enterWaiting(): void {
  capture();
  phase = WAITING;
  elapsed = 0.0;
  selectedIndex = -1;
  clearCandidates();
  refreshPulses();
  render();
}

function nextPhase(): void {
  capture();
  elapsed = 0.0;
  if (phase == WAITING) {
    phase = CANDIDATES;
    selectedIndex = nextWinner;
    nextWinner = (nextWinner + 1) % count;
    candidateA = selectedIndex;
    candidateB = count > 1 ? (selectedIndex + 1) % count : -1;
    candidateC = count > 2 ? (selectedIndex + 2) % count : -1;
  } else if (phase == CANDIDATES) {
    phase = REVEAL;
  } else if (phase == REVEAL) {
    phase = CARD;
    clearCandidates();
  } else if (phase == CARD) {
    phase = RETREAT;
  } else {
    phase = WAITING;
    selectedIndex = -1;
    clearCandidates();
  }
  refreshPulses();
  render();
}

// Call once before constructing the JS view. No subsequent command allocates.
// Explicit parameters on every exported function avoid the optional-argument ABI.
export function init(nicknameCount: i32): usize {
  assert(nicknameCount > 0 && nicknameCount <= 715827882);
  count = nicknameCount;
  states = new StaticArray<f32>(count * 3);
  origins = new StaticArray<f32>(count);
  peakScales = new StaticArray<f32>(count);
  pulsePeriods = new StaticArray<f64>(count);
  pulseOffsets = new StaticArray<f64>(count);
  pulseFlags = new StaticArray<u8>(count);
  configuredPulseCount = count < 12 ? count : 12;
  for (let i: i32 = 0; i < count; i++) {
    unchecked(peakScales[i] = DEFAULT_PEAK_SCALE);
    const period: f64 = 3.0 + <f64>(i % 9) * 0.25;
    unchecked(pulsePeriods[i] = period);
    unchecked(pulseOffsets[i] = ((<f64>i * 0.38196601125) % 1.0) * period);
  }
  reducedMotion = false;
  reset();
  return changetype<usize>(states);
}

export function setPeakScale(index: i32, value: f32): void {
  assert(index >= 0 && index < count && isFinite(value) && value >= 1.0);
  unchecked(peakScales[index] = value);
  writeProgress(index, <f64>unchecked(states[index * 3]));
}

export function reset(): void {
  automatic = false;
  manualIndex = selectedIndex = -1;
  nextWinner = 0;
  phase = ORIGINAL;
  elapsed = RETREAT_SECONDS;
  pulseClock = 0.0;
  cardOffsetX = cardOffsetY = cardAngle = 0.0;
  clearCandidates();
  refreshPulses();
  for (let i: i32 = 0; i < count; i++) {
    unchecked(origins[i] = 0.0);
    writeProgress(i, 0.0);
  }
}

export function setPulseCount(value: i32): void {
  configuredPulseCount = value < 1 ? 1 : (value > count ? count : value);
  refreshPulses();
  render();
}

export function setAutomatic(enabled: i32): void {
  const next = enabled != 0;
  if (automatic == next) return;
  automatic = next;
  if (manualIndex >= 0) {
    refreshPulses();
    render();
    return;
  }
  if (automatic) enterWaiting();
  else enterOriginal();
}

export function setManual(index: i32): void {
  const next = index >= 0 && index < count ? index : -1;
  if (manualIndex == next) return;
  // Preserve both presentation legs when inspecting the already selected word;
  // in particular, a fully visible automatic card must never blink on handoff.
  const sameReveal = next >= 0 && next == selectedIndex && phase == REVEAL;
  const sameCard = next >= 0 && next == selectedIndex && phase == CARD;
  const revealElapsed = sameCard ? REVEAL_SECONDS : (sameReveal ? elapsed : 0.0);
  manualIndex = next;
  if (next < 0) {
    if (automatic) enterWaiting();
    else enterOriginal();
    return;
  }
  capture();
  phase = MANUAL;
  selectedIndex = next;
  clearCandidates();
  elapsed = revealElapsed;
  refreshPulses();
  render();
}

export function dismiss(): void {
  // An automatic winner consumes its queue position on entry to candidates;
  // leave nextWinner intact so dismissal cannot repeat or skip the next name.
  manualIndex = -1;
  if (automatic) enterWaiting();
  else enterOriginal();
}

export function setReducedMotion(enabled: i32): void {
  const next = enabled != 0;
  if (reducedMotion == next) return;
  reducedMotion = next;
  refreshPulses();
  // Enabling the preference finishes, rather than merely freezing, a transition.
  if (next) {
    if (phase == REVEAL || phase == RETREAT) nextPhase();
    if (phase == ORIGINAL) elapsed = RETREAT_SECONDS;
    else if (phase == MANUAL) elapsed = REVEAL_SECONDS;
  } else if (phase == WAITING) {
    capture();
  }
  render();
}

export function advance(deltaSeconds: f64, continueEffects: bool): i32 {
  // Invalid input must not poison the clock. Finite positive deltas are never clamped.
  if (!(deltaSeconds >= 0.0) || deltaSeconds == Infinity) deltaSeconds = 0.0;
  if (phase == ORIGINAL || phase == MANUAL) {
    const limit = phase == ORIGINAL ? RETREAT_SECONDS : REVEAL_SECONDS;
    elapsed = reducedMotion ? limit : Math.min(limit, elapsed + deltaSeconds);
    // A threadless catalogue card keeps scenery moving without selecting a glyph.
    const effectsMoving = (phase == MANUAL || continueEffects) && !reducedMotion;
    if (effectsMoving) pulseClock += deltaSeconds;
    render();
    return elapsed < limit || effectsMoving ? 1 : 0;
  }

  let remaining = deltaSeconds;
  while (true) {
    // Skip whole cycles only at a quiet boundary. This preserves queue order and
    // the full delta even after a suspended tab, without an unbounded phase loop.
    const cycle = WAIT_SECONDS + CANDIDATE_SECONDS + CARD_SECONDS
      + (reducedMotion ? 0.0 : REVEAL_SECONDS + RETREAT_SECONDS);
    if (phase == WAITING && elapsed == 0.0 && remaining >= cycle) {
      const cycles = Math.floor(remaining / cycle);
      const skipped = cycles * cycle;
      pulseClock += skipped;
      remaining = Math.max(0.0, remaining - skipped);
      nextWinner = (nextWinner + <i32>(cycles % <f64>count)) % count;
      refreshPulses();
      for (let i: i32 = 0; i < count; i++) writeProgress(i, ambient(i));
      capture();
    }
    const limit = duration();
    const step = Math.min(remaining, Math.max(0.0, limit - elapsed));
    elapsed += step;
    pulseClock += step;
    remaining -= step;
    render();
    if (elapsed >= limit) {
      nextPhase();
      // Zero-duration reduced-motion reveal/retreat must resolve even at delta 0.
      if (remaining > 0.0 || duration() == 0.0) continue;
    }
    break;
  }
  return 1;
}

export function getPhase(): i32 { return phase; }
export function getAutomatic(): i32 { return automatic ? 1 : 0; }
export function getManualIndex(): i32 { return manualIndex; }
export function getSelectedIndex(): i32 { return selectedIndex; }
export function getEffectTime(): f64 { return pulseClock % 60.0; }
export function getCardIndex(): i32 {
  if (phase == CARD) return selectedIndex;
  if ((phase == REVEAL || phase == MANUAL) && (reducedMotion || elapsed >= THREAD_SECONDS)) return selectedIndex;
  return -1;
}
export function getThreadProgress(): f64 {
  if (phase == CARD) return 1.0;
  if (phase == REVEAL || phase == MANUAL) return reducedMotion ? 1.0 : Math.min(1.0, elapsed / THREAD_SECONDS);
  if (phase == RETREAT) return reducedMotion ? 0.0 : 1.0 - ease(elapsed / RETREAT_SECONDS);
  return 0.0;
}
export function getCardProgress(): f64 {
  if (phase == CARD) return 1.0;
  if (phase == REVEAL || phase == MANUAL) {
    if (reducedMotion || elapsed >= REVEAL_SECONDS) return 1.0;
    return Math.min(1.0, Math.max(0.0, (elapsed - THREAD_SECONDS) / CARD_GROW_SECONDS));
  }
  return 0.0;
}
// Presentation offsets are CSS pixels; angle is degrees about the beam joint.
export function getCardOffsetX(): f64 { return cardOffsetX; }
export function getCardOffsetY(): f64 { return cardOffsetY; }
export function getCardAngle(): f64 { return cardAngle; }
export function getRemainingSeconds(): f64 {
  if (phase == ORIGINAL || phase == MANUAL) return 0.0;
  return Math.max(0.0, duration() - elapsed);
}
export function getPulseCount(): i32 { return configuredPulseCount; }
export function isPulsing(index: i32): i32 {
  if (index < 0 || index >= count) return 0;
  return unchecked(pulseFlags[index]) != 0 ? 1 : 0;
}
export function getCandidateA(): i32 { return candidateA; }
export function getCandidateB(): i32 { return candidateB; }
export function getCandidateC(): i32 { return candidateC; }
export function getReducedMotion(): i32 { return reducedMotion ? 1 : 0; }
