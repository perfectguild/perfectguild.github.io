// One scene and one WASM clock; selectable glyph materials do not own card geometry.
import {loadMotion} from './motion.mjs';
import {createEnsembleRenderer} from './renderer.mjs';
import {createEdgeFog} from './edge-fog.mjs';
import {createCharacterCard} from './card.mjs';
import {createCardPresentation} from './presentation.mjs';
import {createPointerInput} from './pointer-input.mjs';
import {createFloatingControls} from './floating-controls.mjs';
import {createScreenshotScene} from './screenshot-scene.mjs';
import {locale, localizeDocument, t, formatNumber} from './i18n.mjs';

localizeDocument();
const image = document.getElementById('logo1');
const canvas = document.getElementById('ensemble-canvas');
const fogCanvas = document.getElementById('edge-fog');
const targetsContainer = document.getElementById('nickname-targets');
const picker = document.getElementById('nickname-picker');
const showButton = document.getElementById('show-nickname');
const cardControlsPicker = document.getElementById('card-controls-style');
const autoButton = document.getElementById('autoplay');
const originalButton = document.getElementById('original');
const controls = document.querySelector('.prototype-controls');
const controlsLauncher = document.getElementById('controls-launcher');
const pulseCount = document.getElementById('pulse-count');
const pulseValue = document.getElementById('pulse-count-value');
const highlightPicker = document.getElementById('highlight-style');
const effectPicker = document.getElementById('light-effect');
const fogPicker = document.getElementById('edge-style');
const memoryEnabled = document.getElementById('memory-enabled');
const memoryCount = document.getElementById('memory-count');
const memoryRevealPicker = document.getElementById('memory-reveal');
const memoryViewerPicker = document.getElementById('memory-viewer-effect');
const memoryViewerTarget = document.getElementById('memory-viewer-target');
const status = document.getElementById('state');
const announcement = document.getElementById('announcement');
const technology = document.getElementById('technology');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let repositionCard = null;
const floatingControls = createFloatingControls({panel: controls, onLayout: () => repositionCard?.()});
window.addEventListener('pagehide', event => {
  if (!event.persisted) floatingControls.dispose();
});

async function readJSON(path) {
  const response = await fetch(new URL(path, import.meta.url));
  if (!response.ok) throw new Error(t('errors.asset', {path, status: formatNumber(response.status)}));
  return response.json();
}
async function decodeImage(path) {
  const decoded = new Image();
  decoded.src = path;
  try { await decoded.decode(); }
  catch { throw new Error(t('errors.image', {path})); }
  return decoded;
}
function showFailure(error) {
  canvas.hidden = true;
  fogCanvas.hidden = true;
  document.getElementById('character-card').hidden = true;
  const thread = document.getElementById('nickname-thread');
  if (thread) thread.style.display = 'none';
  for (const button of document.querySelectorAll('.nickname-target, #autoplay, #original, #show-nickname, .prototype-controls select, .prototype-controls input')) {
    button.disabled = true;
  }
  document.body.dataset.ready = 'false';
  document.body.dataset.phase = 'unavailable';
  technology.textContent = t('technology.unavailable');
  status.textContent = t('status.unavailable', {message: error.message});
  announcement.textContent = status.textContent;
  console.error(error);
}

async function start() {
  const [scene, source, snapshot, forum, screenshots] = await Promise.all([
    readJSON('./nicknames.json'), readJSON('./sample-source.json'),
    readJSON('./armory-snapshot.json'), readJSON('./forum-media.json'),
    readJSON('./screenshots.json'),
    image.decode().catch(() => { throw new Error(t('errors.image', {path: image.getAttribute('src')})); }),
  ]);
  if (scene.imageWidth !== image.naturalWidth || scene.imageHeight !== image.naturalHeight) {
    throw new Error(t('errors.dimensions'));
  }
  if (scene.nicknames.length !== source.sampleNames.length ||
      scene.nicknames.some((entry, index) => entry.label !== source.sampleNames[index])) {
    throw new Error(t('errors.source'));
  }
  const characterNames = new Map(snapshot.characters.map(character => [character.id, character.characterName]));
  if (characterNames.size !== snapshot.characters.length ||
      scene.nicknames.some(entry => entry.characterId
        ? !characterNames.has(entry.characterId) || !entry.evidence?.note
        : characterNames.get(entry.id) !== entry.label) ||
      snapshot.characterGroups.some(group => group.members.some(member => !characterNames.has(member.characterId)))) {
    throw new Error(t('errors.cardSource'));
  }
  const nicknames = new Map(scene.nicknames.map(nickname => [nickname.id, nickname]));
  const occurrenceGroups = new Map(scene.nicknames.map(nickname => [nickname.id, []]));
  const occurrenceIds = new Set();
  scene.occurrences.forEach((occurrence, index) => {
    const group = occurrenceGroups.get(occurrence.nicknameId);
    if (!group || group.length >= 2 || occurrenceIds.has(occurrence.id)) {
      throw new Error(t('errors.source'));
    }
    group.push(index);
    occurrenceIds.add(occurrence.id);
  });
  if (nicknames.size !== scene.nicknames.length || scene.nicknames.some(nickname =>
    nickname.placement === 'catalog-only' ? occurrenceGroups.get(nickname.id).length !== 0
      : occurrenceGroups.get(nickname.id).length === 0)) {
    throw new Error(t('errors.source'));
  }
  const nicknameFor = index => nicknames.get(scene.occurrences[index].nicknameId);
  const [motion, images, flowBackground, flowForeground] = await Promise.all([
    loadMotion(scene.occurrences),
    Promise.all(scene.occurrences.map(async occurrence => {
      const [mask, repair] = await Promise.all([decodeImage(occurrence.maskUrl), decodeImage(occurrence.repairUrl)]);
      return {mask, repair};
    })),
    decodeImage('/assets/background-flow-base.webp'),
    decodeImage('/assets/background-flow-foreground.png'),
  ]);
  const renderer = createEnsembleRenderer(canvas, scene, images, motion.defaultPeakScale, motion.maxLift, flowBackground);
  const edgeFog = createEdgeFog(fogCanvas, image, scene.protectedBounds, {
    background: flowBackground, foreground: flowForeground,
  });
  const card = createCharacterCard({snapshot, forum, reducedMotion: reducedMotion.matches, onLayout() {
    if (frame || wakeTimer) advance((performance.now() - previousTime) / 1000);
    repositionCard();
    refresh();
  }});
  const presentation = createCardPresentation({image, controls, card, scene});
  repositionCard = () => {
    presentation.reposition();
    const bounds = presentation.exclusionBounds;
    if (catalogue && !controls.hidden && bounds
      && (bounds.width < 200 || card.element.scrollHeight > card.element.clientHeight + 1)) {
      catalogue.restoreControls = true;
      floatingControls.hide();
    }
  };
  window.addEventListener('resize', () => repositionCard?.());
  window.visualViewport?.addEventListener('resize', () => repositionCard?.());
  const targets = [];
  let pinned = false;
  let catalogue = null;
  let overTarget = -1;
  let overCard = false;
  let focusPending = false;
  let pointerContact = null;
  let automaticContact = null;
  let frame = 0;
  let wakeTimer = 0;
  let closeTimer = 0;
  let hoverTimer = 0;
  let previousTime = performance.now();
  let displayedCard = -1;
  let lastPhase = '';
  let lastSelected = -1;
  let lastCardNickname = '';
  let lastSecond = -1;
  let lastReturning = false;
  let lastPresentationPhase = '';
  let lastAutomatic = null;
  let failed = false;
  const lastProgress = new Float32Array(scene.occurrences.length).fill(NaN);
  let lastDrawnSelected = -1;
  let highlightStyle = Number(highlightPicker.value);
  let lightEffect = Number(effectPicker.value);
  let edgeStyle = Number(fogPicker.value);
  let memoryReveal = Number(memoryRevealPicker.value);
  let lastDrawnStyle = -1;
  let lastDrawnEffect = -1;
  let lastDrawnAnimated = false;
  let lastDrawnBackground = false;
  const memoryOptions = {
    enabled: false, reducedMotion: false,
    count: Number(memoryCount.value), viewerEffect: Number(memoryViewerPicker.value),
    viewerTarget: Number(memoryViewerTarget.value),
  };
  const memories = createScreenshotScene({
    image, protectedBounds: scene.protectedBounds, items: screenshots.images,
    getCardBounds: () => presentation.exclusionBounds,
    onChange() {
      if (memories.open) {
        cancelClose();
        cancelHover();
        pointerInput.reset();
        overTarget = -1;
        // The pinned card keeps its original glyph contact while the modal is open.
      }
      refresh();
    },
  });

  function advance(seconds) {
    const moving = motion.advance(memories.open ? 0 : seconds, Boolean(catalogue));
    memoryOptions.enabled = memoryEnabled.checked && (Boolean(catalogue) || motion.phase !== 'original');
    memoryOptions.reducedMotion = motion.reducedMotion;
    memoryOptions.count = Number(memoryCount.value);
    memoryOptions.viewerEffect = Number(memoryViewerPicker.value);
    memoryOptions.viewerTarget = Number(memoryViewerTarget.value);
    memories.advance(seconds, memoryOptions);
    const cardMoving = card.advance(seconds, presentation.ready && (Boolean(catalogue) || motion.phase !== 'original')
      && !memories.open && !motion.reducedMotion && !document.hidden);
    return !memories.open && (moving || memories.moving || cardMoving);
  }


  function sync() {
    const phase = catalogue ? 'catalogue' : motion.phase;
    const selected = motion.selectedIndex;
    if (selected < 0 || phase === 'original' || phase === 'waiting' || phase === 'candidates') {
      automaticContact = null;
    } else if (motion.manualIndex < 0 && (phase === 'reveal' || phase === 'card')
        && automaticContact?.index !== selected) {
      automaticContact = pointerInput.createAutomaticContact(selected);
    }
    const nextCard = motion.cardProgress > 0 ? motion.cardIndex : -1;
    const second = Math.ceil(motion.remainingSeconds);
    let hasInk = false;
    const backgroundSeconds = edgeStyle === 7 && phase !== 'original'
      ? (motion.reducedMotion ? 0 : motion.effectTime) : null;
    const backgroundActive = backgroundSeconds !== null;
    const animateMaterial = (lightEffect > 0 || highlightStyle === 2 || highlightStyle === 3 || highlightStyle >= 5)
      && phase !== 'candidates' && selected >= 0 && motion.states[selected * 3] > 0 && !motion.reducedMotion;
    let dirty = selected !== lastDrawnSelected || highlightStyle !== lastDrawnStyle
      || lightEffect !== lastDrawnEffect || animateMaterial !== lastDrawnAnimated || animateMaterial
      || backgroundActive !== lastDrawnBackground || (backgroundActive && !motion.reducedMotion);
    for (let index = 0; index < targets.length; index++) {
      const progress = motion.states[index * 3];
      hasInk ||= progress > 0;
      dirty ||= lastProgress[index] !== progress;
      lastProgress[index] = progress;
    }
    // Moving repairs share the background phase; glyph geometry stays in WASM.
    if (dirty) renderer.draw(motion.states, selected, highlightStyle, lightEffect,
      animateMaterial ? motion.effectTime : 0, animateMaterial, backgroundSeconds);
    lastDrawnStyle = highlightStyle;
    lastDrawnEffect = lightEffect;
    lastDrawnAnimated = animateMaterial;
    lastDrawnSelected = selected;
    lastDrawnBackground = backgroundActive;
    canvas.hidden = !hasInk;
    presentation.update(motion, pointerContact || automaticContact, memories.renderStates);
    if (presentation.constrained) {
      // Reconcile a crowded viewport before either the DOM or fog canvas is painted.
      memories.advance(0, memoryOptions);
      presentation.update(motion, pointerContact || automaticContact, memories.renderStates);
    }
    edgeFog.update(motion.reducedMotion ? 0 : motion.effectTime, edgeStyle,
      phase !== 'original', memories.renderStates, memoryReveal);
    const presentationPhase = catalogue ? 'catalogue' : motion.cardProgress >= 1 ? 'card'
      : motion.cardProgress > 0 ? 'growing' : motion.threadProgress > 0 ? 'thread' : 'none';
    if (document.body.dataset.presentation !== presentationPhase) {
      document.body.dataset.presentation = presentationPhase;
    }
    const nextNickname = catalogue?.nickname.id || (nextCard < 0 ? '' : nicknameFor(nextCard).id);
    if (nextCard !== displayedCard || document.body.dataset.card !== nextNickname) {
      displayedCard = nextCard;
      for (let index = 0; index < targets.length; index++) {
        targets[index].setAttribute('aria-expanded', String(index === nextCard));
      }
      showButton.setAttribute('aria-expanded', String(Boolean(catalogue) || nextCard >= 0));
      document.body.dataset.card = nextNickname;
      document.body.dataset.occurrence = catalogue || nextCard < 0 ? '' : scene.occurrences[nextCard].id;
    }
    if (focusPending && presentation.ready) {
      focusPending = false;
      card.element.focus({preventScroll: true});
    }
    const phaseChanged = phase !== lastPhase || selected !== lastSelected || nextNickname !== lastCardNickname;
    const returning = phase === 'original' && hasInk;
    if (phaseChanged || second !== lastSecond || returning !== lastReturning || presentationPhase !== lastPresentationPhase) {
      const name = catalogue ? catalogue.nickname.label : selected < 0 ? '' : nicknameFor(selected).label;
      const names = phase === 'candidates'
        ? [motion.candidateA, motion.candidateB, motion.candidateC].map(index => nicknameFor(index).label).join(', ')
        : '';
      const key = returning ? 'status.returning'
        : presentationPhase === 'thread' && (phase === 'reveal' || phase === 'manual') ? 'status.thread'
        : presentationPhase === 'growing' ? 'status.reveal' : `status.${phase}`;
      status.textContent = t(key, {name, names, seconds: formatNumber(second)});
      if (phaseChanged || returning !== lastReturning || presentationPhase !== lastPresentationPhase) {
        announcement.textContent = status.textContent;
      }
      if (phase !== lastPhase) document.body.dataset.phase = phase;
      lastPhase = phase;
      lastSelected = selected;
      lastCardNickname = nextNickname;
      lastSecond = second;
      lastReturning = returning;
      lastPresentationPhase = presentationPhase;
    }
    const automatic = catalogue ? catalogue.automatic : motion.automatic;
    if (lastAutomatic !== automatic) {
      lastAutomatic = automatic;
      autoButton.textContent = t(lastAutomatic ? 'controls.stop' : 'controls.start');
      autoButton.setAttribute('aria-pressed', String(lastAutomatic));
    }
  }

  function stopUpdates() {
    cancelAnimationFrame(frame);
    clearTimeout(wakeTimer);
    frame = wakeTimer = 0;
  }
  function schedule(moving) {
    if (!moving || document.hidden || failed || memories.open) return;
    if (motion.reducedMotion) {
      const delay = Math.max(16, Math.min(1000, motion.remainingSeconds * 1000));
      wakeTimer = setTimeout(() => tick(performance.now()), delay);
    } else {
      frame = requestAnimationFrame(tick);
    }
  }
  function tick(time) {
    frame = wakeTimer = 0;
    if (failed || document.hidden) return;
    const moving = advance((time - previousTime) / 1000);
    previousTime = time;
    sync();
    schedule(moving);
  }
  function refresh() {
    if (failed) return;
    stopUpdates();
    previousTime = performance.now();
    const moving = advance(0);
    sync();
    schedule(moving);
  }
  function cancelClose() {
    clearTimeout(closeTimer);
    closeTimer = 0;
  }
  function cancelHover() {
    clearTimeout(hoverTimer);
    hoverTimer = 0;
  }
  function clearPointer() {
    cancelHover();
    pointerInput.reset();
    pointerContact = null;
    overTarget = -1;
  }
  function leaveCatalogue(restoreAutomatic = true) {
    if (!catalogue) return;
    const automatic = catalogue.automatic;
    const restoreControls = catalogue.restoreControls;
    catalogue = null;
    presentation.setCatalogue(null);
    if (restoreAutomatic) motion.setAutomatic(automatic);
    if (restoreControls && controls.hidden) floatingControls.show({focus: false, docked: false});
  }
  function inspectCatalogue(nickname) {
    cancelClose();
    clearPointer();
    automaticContact = null;
    const automatic = catalogue ? catalogue.automatic : motion.automatic;
    catalogue = {nickname, automatic, restoreControls: catalogue?.restoreControls || false};
    motion.setAutomatic(false);
    motion.dismiss();
    pinned = true;
    focusPending = true;
    picker.value = nickname.id;
    presentation.setCatalogue(nickname);
    repositionCard();
    refresh();
  }
  function inspect(index, pin = false, focus = false, contact) {
    cancelHover();
    cancelClose();
    leaveCatalogue();
    if (contact === null) {
      clearPointer();
      automaticContact = null;
    }
    else if (contact !== undefined) pointerContact = contact;
    else if (motion.manualIndex !== index) pointerContact = null;
    pinned = pin || (pinned && motion.manualIndex === index);
    focusPending = focus;
    picker.value = nicknameFor(index).id;
    motion.setManual(index);
    refresh();
    if (focus && displayedCard === index && presentation.ready) {
      focusPending = false;
      card.element.focus({preventScroll: true});
    }
  }
  function releaseManual() {
    cancelClose();
    clearPointer();
    leaveCatalogue();
    pinned = focusPending = false;
    motion.setManual(-1);
    refresh();
  }
  function requestClose() {
    cancelClose();
    if (pinned || motion.manualIndex < 0 || memories.open) return;
    closeTimer = setTimeout(() => {
      closeTimer = 0;
      if (!pinned && overTarget < 0 && !overCard &&
          !targetsContainer.contains(document.activeElement) && !card.element.contains(document.activeElement) &&
          !controls.contains(document.activeElement) && !controlsLauncher.contains(document.activeElement)) {
        releaseManual();
      }
    }, 300);
  }
  function reset() {
    cancelClose();
    leaveCatalogue(false);
    pinned = overCard = focusPending = false;
    clearPointer();
    motion.reset();
    refresh();
  }
  function dismiss() {
    cancelClose();
    leaveCatalogue();
    pinned = overCard = focusPending = false;
    clearPointer();
    motion.dismiss();
    refresh();
  }

  const pointerInput = createPointerInput({
    image, images, scene, motion,
    contactError: t('errors.contact'),
    onEnter(index, contact) {
      if (memories.open) return;
      overTarget = index;
      cancelClose();
      cancelHover();
      if (motion.manualIndex >= 0) pinned = true;
      if (index === motion.manualIndex || index === displayedCard) return;
      if (!catalogue && motion.manualIndex < 0 && displayedCard < 0 && motion.threadProgress === 0) {
        inspect(index, true, false, contact);
        return;
      }
      hoverTimer = setTimeout(() => {
        hoverTimer = 0;
        if (overTarget === index && !document.hidden && !failed) {
          inspect(index, true, false, contact);
        }
      }, 1000);
    },
    onLeave() {
      overTarget = -1;
      cancelHover();
      requestClose();
    },
  });

  scene.occurrences.forEach((occurrence, index) => {
    const nickname = nicknameFor(index);
    const group = occurrenceGroups.get(nickname.id);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'nickname-target';
    button.dataset.nickname = nickname.id;
    button.dataset.occurrence = occurrence.id;
    button.setAttribute('aria-label', group.length > 1
      ? t('target.occurrence', {name: nickname.label, position: formatNumber(group.indexOf(index) + 1)})
      : t('target.label', {name: nickname.label}));
    button.setAttribute('aria-controls', 'character-card');
    button.setAttribute('aria-expanded', 'false');
    const {bounds} = occurrence;
    button.style.left = `${bounds.x / scene.imageWidth * 100}%`;
    button.style.top = `${bounds.y / scene.imageHeight * 100}%`;
    button.style.width = `${bounds.width / scene.imageWidth * 100}%`;
    button.style.height = `${bounds.height / scene.imageHeight * 100}%`;
    button.addEventListener('focus', () => {
      if (button.matches(':focus-visible')) inspect(index, false, false, null);
    });
    button.addEventListener('blur', requestClose);
    button.addEventListener('click', event => {
      const mouse = event.detail > 0 && event.pointerType === 'mouse';
      const chosen = mouse && pointerInput.currentIndex >= 0 ? pointerInput.currentIndex : index;
      inspect(chosen, true, event.detail === 0, mouse ? pointerInput.capture(chosen, event) : null);
    });
    targets.push(button);
    targetsContainer.append(button);
  });
  const nicknameOrder = new Intl.Collator(locale);
  [...scene.nicknames].sort((a, b) => nicknameOrder.compare(a.label, b.label)).forEach(nickname => {
    const option = document.createElement('option');
    option.value = nickname.id;
    option.textContent = nickname.label;
    picker.append(option);
  });
  card.element.addEventListener('pointerenter', () => {
    overCard = true;
    cancelClose();
    if (displayedCard >= 0 && motion.manualIndex < 0) inspect(displayedCard, true);
  });
  card.element.addEventListener('pointerleave', () => { overCard = false; requestClose(); });
  card.element.addEventListener('focusin', () => {
    cancelClose();
    if (displayedCard >= 0 && motion.manualIndex < 0) inspect(displayedCard, true);
  });
  card.element.addEventListener('focusout', requestClose);
  pulseCount.addEventListener('input', () => {
    // Consume elapsed time before changing density; dragging must not restart or
    // silently lengthen the current 30-second card hold.
    if (frame || wakeTimer) advance((performance.now() - previousTime) / 1000);
    motion.setPulseCount(Number(pulseCount.value));
    const label = t('controls.pulseValue', {
      count: formatNumber(motion.pulseCount), total: formatNumber(scene.occurrences.length),
    });
    pulseValue.textContent = label;
    pulseCount.setAttribute('aria-valuetext', label);
    refresh();
  });
  function changeMaterial() {
    if (frame || wakeTimer) advance((performance.now() - previousTime) / 1000);
    highlightStyle = Number(highlightPicker.value);
    lightEffect = Number(effectPicker.value);
    edgeStyle = Number(fogPicker.value);
    memoryReveal = Number(memoryRevealPicker.value);
    refresh();
  }
  controls.addEventListener('focusin', cancelClose);
  controls.addEventListener('focusout', requestClose);
  controlsLauncher.addEventListener('focusin', cancelClose);
  controlsLauncher.addEventListener('focusout', requestClose);
  cardControlsPicker.addEventListener('change', () => card.setControlsStyle(cardControlsPicker.value));
  highlightPicker.addEventListener('change', changeMaterial);
  effectPicker.addEventListener('change', changeMaterial);
  fogPicker.addEventListener('change', changeMaterial);
  memoryRevealPicker.addEventListener('change', changeMaterial);
  function changeMemories() {
    if (frame || wakeTimer) advance((performance.now() - previousTime) / 1000);
    refresh();
  }
  memoryEnabled.addEventListener('change', changeMemories);
  memoryCount.addEventListener('change', changeMemories);
  memoryViewerPicker.addEventListener('change', changeMemories);
  memoryViewerTarget.addEventListener('change', changeMemories);
  showButton.addEventListener('click', () => {
    const group = occurrenceGroups.get(picker.value);
    if (!group.length) {
      inspectCatalogue(nicknames.get(picker.value));
      return;
    }
    const current = motion.manualIndex >= 0 ? motion.manualIndex : displayedCard;
    const next = group[(group.indexOf(current) + 1) % group.length];
    inspect(next, true, true, null);
  });
  autoButton.addEventListener('click', () => {
    const enabled = !(catalogue ? catalogue.automatic : motion.automatic);
    leaveCatalogue(false);
    cancelClose();
    clearPointer();
    pinned = focusPending = false;
    motion.setManual(-1);
    motion.setAutomatic(enabled);
    refresh();
  });
  originalButton.addEventListener('click', reset);
  card.element.querySelector('#close-card').addEventListener('click', () => {
    dismiss();
    (controls.hidden ? controlsLauncher : showButton).focus({preventScroll: true});
  });
  document.addEventListener('pointerdown', event => {
    if (memories.open || event.target.closest('.screenshot-target')) return;
    if (event.pointerType === 'mouse' && pointerInput.currentIndex >= 0 &&
        image.parentElement.contains(event.target) && !targetsContainer.contains(event.target)) {
      event.preventDefault();
      inspect(pointerInput.currentIndex, true, false, pointerInput.currentContact);
      return;
    }
    if ((catalogue || motion.manualIndex >= 0) && !targetsContainer.contains(event.target) &&
        !card.element.contains(event.target) && !controls.contains(event.target) &&
        !controlsLauncher.contains(event.target)) {
      releaseManual();
    }
  });
  document.addEventListener('keydown', event => {
    if (event.defaultPrevented || memories.open) return;
    if (event.key === 'Escape' && (catalogue || motion.automatic || motion.manualIndex >= 0 || displayedCard >= 0)) {
      event.preventDefault();
      const restoreFocus = card.element.contains(document.activeElement);
      reset();
      if (restoreFocus) (controls.hidden ? controlsLauncher : showButton).focus({preventScroll: true});
    }
  });
  reducedMotion.addEventListener('change', () => {
    if (failed) return;
    card.setReducedMotion(reducedMotion.matches);
    motion.setReducedMotion(reducedMotion.matches);
    if (reducedMotion.matches) {
      if (catalogue) catalogue.automatic = false;
      motion.setAutomatic(false);
    }
    announceTechnology();
    refresh();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopUpdates(); cancelClose(); cancelHover(); memories.suspend(); card.advance(0, false);
    }
    else refresh();
  });
  function handleContextLost(event) {
    event.preventDefault();
    failed = true;
    stopUpdates();
    cancelClose();
    cancelHover();
    pointerInput.dispose();
    memories.dispose();
    card.dispose();
    repositionCard = null;
    presentation.dispose();
    edgeFog.dispose();
    renderer.dispose();
    showFailure(new Error(t('errors.contextLost')));
  }
  canvas.addEventListener('webglcontextlost', handleContextLost);
  fogCanvas.addEventListener('webglcontextlost', handleContextLost);
  window.addEventListener('pagehide', event => {
    stopUpdates();
    cancelClose();
    cancelHover();
    if (event.persisted) {
      memories.suspend();
      card.advance(0, false);
      return;
    }
    pointerInput.dispose();
    memories.dispose();
    card.dispose();
    presentation.dispose();
    edgeFog.dispose();
    renderer.dispose();
  });
  window.addEventListener('pageshow', event => {
    if (event.persisted) refresh();
  });

  function announceTechnology() {
    technology.textContent = t('technology.ready', {
      count: formatNumber(scene.nicknames.length), places: formatNumber(scene.occurrences.length),
    })
      + (reducedMotion.matches ? ` · ${t('motion.reduced')}` : '');
  }

  document.getElementById('source-note').textContent = t('source.summary', {
    guild: source.guildName, realm: t(`realm.${source.realmSlug}`),
  });
  announceTechnology();
  pulseCount.max = String(scene.occurrences.length);
  pulseCount.value = String(motion.pulseCount);
  pulseValue.textContent = t('controls.pulseValue', {
    count: formatNumber(motion.pulseCount), total: formatNumber(scene.occurrences.length),
  });
  pulseCount.setAttribute('aria-valuetext', pulseValue.textContent);
  card.setControlsStyle(cardControlsPicker.value);
  cardControlsPicker.disabled = false;
  pulseCount.disabled = highlightPicker.disabled = effectPicker.disabled = fogPicker.disabled = memoryEnabled.disabled = memoryCount.disabled = memoryRevealPicker.disabled = memoryViewerPicker.disabled = memoryViewerTarget.disabled = picker.disabled = showButton.disabled = autoButton.disabled = originalButton.disabled = false;
  motion.setReducedMotion(reducedMotion.matches);
  motion.setAutomatic(!reducedMotion.matches);
  refresh();
  document.body.dataset.ready = 'true';
}

start().catch(showFailure);
