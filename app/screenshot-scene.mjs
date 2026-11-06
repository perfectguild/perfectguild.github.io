import {t} from './i18n.mjs';
import {createMemoryViewerShader} from './memory-viewer-shader.mjs';

const REVEAL_SECONDS = 3;
const HOLD_SECONDS = 12;
const DISSOLVE_SECONDS = 3;
const HOVER_MILLISECONDS = 300;
const VISIBLE_AMOUNT = 0.28;
const SPACING = 30;
const randomBetween = (minimum, maximum) => minimum + Math.random() * (maximum - minimum);
const smoothstep = value => value * value * (3 - 2 * value);
const intersects = (a, b, padding = 0) => a.x < b.x + b.width + padding
  && a.x + a.width > b.x - padding && a.y < b.y + b.height + padding
  && a.y + a.height > b.y - padding;

// One host clock, one shuffled deck, three permanent shader/input slots.
export function createScreenshotScene({image, protectedBounds, items, getCardBounds = () => null, onChange = () => {}}) {
  const surface = image.parentElement;
  const events = new AbortController();
  const renderStates = Array.from({length: 3}, () => ({
    image: null, bounds: {x: 0, y: 0, width: 0, height: 0}, amount: 0, elapsed: 0,
  }));
  const slots = renderStates.map((state, index) => {
    const target = document.createElement('button');
    target.className = 'screenshot-target';
    target.dataset.slot = String(index);
    target.type = 'button';
    target.hidden = true;
    target.disabled = true;
    target.setAttribute('aria-haspopup', 'dialog');
    target.setAttribute('aria-controls', 'screenshot-viewer');
    surface.append(target);
    return {
      index, state, target, current: null, phase: 'disabled', phaseTime: 0,
      pausedPhase: null, amount: 0, delay: 0, quietSeconds: 0,
      token: 0, loading: null, hoverBlocked: false,
    };
  });

  const viewer = document.createElement('dialog');
  viewer.id = 'screenshot-viewer';
  viewer.setAttribute('aria-label', t('memory.viewer'));
  const fullCanvas = document.createElement('canvas');
  fullCanvas.className = 'screenshot-viewer-image';
  fullCanvas.width = fullCanvas.height = 1;
  fullCanvas.draggable = false;
  fullCanvas.setAttribute('role', 'img');
  const closeButton = document.createElement('button');
  closeButton.id = 'screenshot-viewer-close';
  closeButton.type = 'button';
  closeButton.title = t('memory.close');
  // Material Design Icons window-close; see LICENSE-mdi.txt.
  closeButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z"/></svg>';
  closeButton.setAttribute('aria-label', t('memory.closeLabel'));
  closeButton.autofocus = true;
  const previousButton = document.createElement('button');
  const nextButton = document.createElement('button');
  // Same chevrons as the character cards; native buttons retain keyboard input.
  for (const [button, direction, key, path] of [
    [previousButton, -1, 'memory.previous', 'M15.4 5.4 8.8 12l6.6 6.6-1.4 1.4-8-8 8-8Z'],
    [nextButton, 1, 'memory.next', 'm8.6 4 8 8-8 8-1.4-1.4 6.6-6.6-6.6-6.6Z'],
  ]) {
    const side = direction < 0 ? 'previous' : 'next';
    button.id = `screenshot-viewer-${side}`;
    button.className = `screenshot-viewer-nav screenshot-viewer-${side}`;
    button.type = 'button';
    button.title = t(key);
    button.setAttribute('aria-label', t(key));
    button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${path}"/></svg>`;
    button.hidden = items.length < 2;
    button.addEventListener('click', () => navigateViewer(direction), {signal: events.signal});
  }
  const viewerPosition = document.createElement('div');
  viewerPosition.id = 'screenshot-viewer-position';
  viewerPosition.setAttribute('aria-live', 'polite');
  viewer.setAttribute('aria-describedby', viewerPosition.id);
  viewer.append(fullCanvas, previousButton, nextButton, viewerPosition, closeButton);
  document.body.append(viewer);

  let contextFailed = false;
  const fullRenderer = createMemoryViewerShader(fullCanvas, {
    onFailure: failViewer,
    onRestored() {
      contextFailed = false;
      updateTargets();
      notify();
    },
    onSettled: notify,
  });
  contextFailed = !fullRenderer.available;
  const failedIds = new Set();
  const cardBounds = {x: 0, y: 0, width: 0, height: 0};
  const lastCardBounds = {x: NaN, y: NaN, width: NaN, height: NaN};
  let hasCard = false;
  let area = null;
  let imageRect = null;
  let scaleX = 0, scaleY = 0;
  let targetOffsetX = 0, targetOffsetY = 0;
  let bag = [];
  let lastId = null;
  let count = 3;
  let enabled = false;
  let reducedMotion = false;
  let disposed = false;
  let suspended = document.hidden;
  let fullToken = 0;
  let fullLoading = null;
  let pendingFull = null;
  let selected = null;
  let viewerIndex = -1;
  let requestedIndex = -1;
  let gesture = null;
  let suppressGestureClick = false;
  let hoverTimer = 0;
  let hoverSlot = null;
  let restoreFocus = null;
  let expansion = null;
  let viewerEffect = 0;
  let activeViewerEffect = 0;
  let viewerTarget = 0;
  let activeViewerTarget = 0;
  let pointerX = NaN, pointerY = NaN;

  function notify() {
    if (!disposed) onChange();
  }

  function cancelHover(slot = null) {
    if (slot && hoverSlot !== slot) return;
    clearTimeout(hoverTimer);
    hoverTimer = 0;
    hoverSlot = null;
  }

  function measureLayout() {
    const rect = image.getBoundingClientRect();
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    imageRect = rect;
    scaleX = rect.width / width;
    scaleY = rect.height / height;
    targetOffsetX = image.offsetLeft;
    targetOffsetY = image.offsetTop;
    if (!rect.width || !rect.height || !width || !height) {
      area = null;
      return;
    }
    const viewport = window.visualViewport;
    const left = viewport?.offsetLeft || 0;
    const top = viewport?.offsetTop || 0;
    const right = left + (viewport?.width || window.innerWidth);
    const bottom = top + (viewport?.height || window.innerHeight);
    const x = Math.max(120, (left - rect.left) / scaleX + 16 / scaleX);
    const y = Math.max(96, (top - rect.top) / scaleY + 16 / scaleY);
    const endX = Math.min(width - 120, (right - rect.left) / scaleX - 16 / scaleX);
    const endY = Math.min(height - 96, (bottom - rect.top) / scaleY - 16 / scaleY);
    area = {x, y, width: Math.max(0, endX - x), bottom: endY};
  }

  // The card publishes planned viewport geometry, including its sway safety.
  // Compare scalar values every tick, but measure DOM only on layout events.
  function readCardBounds(force = false) {
    const next = getCardBounds();
    const present = Boolean(next && next.width > 0 && next.height > 0);
    const changed = force || present !== hasCard || (present && (
      next.x !== lastCardBounds.x || next.y !== lastCardBounds.y
      || next.width !== lastCardBounds.width || next.height !== lastCardBounds.height));
    hasCard = present;
    if (!changed) return false;
    if (present) {
      Object.assign(lastCardBounds, next);
      if (imageRect && scaleX > 0 && scaleY > 0) {
        cardBounds.x = (next.x - imageRect.left) / scaleX;
        cardBounds.y = (next.y - imageRect.top) / scaleY;
        cardBounds.width = next.width / scaleX;
        cardBounds.height = next.height / scaleY;
      }
    }
    return true;
  }

  function positionTarget(slot) {
    const {bounds} = slot.state;
    slot.target.style.left = `${targetOffsetX + bounds.x * scaleX}px`;
    slot.target.style.top = `${targetOffsetY + bounds.y * scaleY}px`;
    slot.target.style.width = `${bounds.width * scaleX}px`;
    slot.target.style.height = `${bounds.height * scaleY}px`;
  }

  function fitsScene(bounds) {
    return area && bounds.width > 0 && bounds.height > 0
      && bounds.x >= area.x && bounds.x + bounds.width <= area.x + area.width
      && bounds.y >= area.y && bounds.y + bounds.height <= area.bottom
      && (bounds.y + bounds.height <= protectedBounds.y - SPACING
        || bounds.y >= protectedBounds.y + protectedBounds.height + SPACING)
      && (!hasCard || !intersects(bounds, cardBounds, SPACING));
  }

  function subtract(regions, obstacle) {
    const result = [];
    for (const region of regions) {
      const left = Math.max(region.x, obstacle.x - SPACING);
      const right = Math.min(region.x + region.width, obstacle.x + obstacle.width + SPACING);
      const top = Math.max(region.y, obstacle.y - SPACING);
      const bottom = Math.min(region.y + region.height, obstacle.y + obstacle.height + SPACING);
      if (right <= left || bottom <= top) {
        result.push(region);
        continue;
      }
      if (top > region.y) result.push({...region, height: top - region.y});
      if (bottom < region.y + region.height) result.push({...region, y: bottom, height: region.y + region.height - bottom});
      if (left > region.x) result.push({...region, y: top, width: left - region.x, height: bottom - top});
      if (right < region.x + region.width) result.push({...region, x: right, y: top, width: region.x + region.width - right, height: bottom - top});
    }
    return result;
  }

  function place(slot) {
    if (!area || !slot.state.image) return false;
    const topEnd = Math.min(area.bottom, protectedBounds.y - SPACING);
    const bottomStart = Math.max(area.y, protectedBounds.y + protectedBounds.height + SPACING);
    let regions = [
      {x: area.x, y: area.y, width: area.width, height: topEnd - area.y},
      {x: area.x, y: bottomStart, width: area.width, height: area.bottom - bottomStart},
    ].filter(region => region.width >= 160 && region.height >= 90);
    if (hasCard) regions = subtract(regions, cardBounds);
    for (const other of slots) {
      if (other !== slot && other.state.image && other.state.bounds.width > 0) {
        regions = subtract(regions, other.state.bounds);
      }
    }
    // Shuffle bands/free rectangles only when a slot actually needs placement.
    for (let index = regions.length - 1; index > 0; index--) {
      const other = Math.floor(Math.random() * (index + 1));
      [regions[index], regions[other]] = [regions[other], regions[index]];
    }
    const ratio = slot.state.image.naturalWidth / slot.state.image.naturalHeight;
    for (const region of regions) {
      const height = Math.min(Math.max(90, 160 / ratio, region.height * randomBetween(0.65, 0.9)), region.height, region.width / ratio);
      const width = height * ratio;
      if (width < 160 || height < 90) continue;
      const bounds = slot.state.bounds;
      bounds.width = width;
      bounds.height = height;
      bounds.x = randomBetween(region.x, region.x + region.width - width);
      bounds.y = randomBetween(region.y, region.y + region.height - height);
      positionTarget(slot);
      return true;
    }
    return false;
  }

  function defer(slot) {
    slot.state.bounds.x = slot.state.bounds.y = slot.state.bounds.width = slot.state.bounds.height = 0;
    slot.state.amount = 0;
    if (slot.phase !== 'deferred') {
      slot.pausedPhase = slot.phase;
      slot.phase = 'deferred';
    }
  }

  function reconcileLayout() {
    // Retain valid reservations; invalidate all obsolete ones before finding gaps.
    for (const slot of slots) {
      if (!slot.state.image) continue;
      if (!fitsScene(slot.state.bounds)) defer(slot);
    }
    for (let index = 0; index < slots.length; index++) {
      const slot = slots[index];
      if (!slot.state.image || !slot.state.bounds.width) continue;
      for (let other = 0; other < index; other++) {
        if (slots[other].state.image && slots[other].state.bounds.width
          && intersects(slot.state.bounds, slots[other].state.bounds, SPACING)) {
          defer(slot);
          break;
        }
      }
    }
    for (const slot of slots) {
      if (!slot.state.image) continue;
      if (!slot.state.bounds.width && place(slot)) {
        slot.phase = slot.pausedPhase || (reducedMotion ? 'static' : 'reveal');
        slot.pausedPhase = null;
      } else if (!slot.state.bounds.width) defer(slot);
      if (slot.state.bounds.width) positionTarget(slot);
    }
  }

  function updateTargets() {
    for (const slot of slots) {
      const {state, target} = slot;
      state.amount = state.bounds.width > 0 && state.bounds.height > 0 ? slot.amount : 0;
      const visible = enabled && slot.index < count && !suspended && !viewer.open && !contextFailed
        && state.image !== null && state.amount >= VISIBLE_AMOUNT;
      target.hidden = !visible;
      target.disabled = !visible;
      if (!visible) cancelHover(slot);
    }
  }

  function isActive(id) {
    return slots.some(slot => slot.current?.id === id);
  }

  function refillBag() {
    bag = items.filter(item => !failedIds.has(item.id) && !isActive(item.id));
    for (let index = bag.length - 1; index > 0; index--) {
      const other = Math.floor(Math.random() * (index + 1));
      [bag[index], bag[other]] = [bag[other], bag[index]];
    }
    if (bag.length > 1 && bag[bag.length - 1].id === lastId) {
      [bag[0], bag[bag.length - 1]] = [bag[bag.length - 1], bag[0]];
    }
  }

  function nextItem() {
    for (let refill = 0; refill < 2; refill++) {
      for (let index = bag.length - 1; index >= 0; index--) {
        if (!failedIds.has(bag[index].id) && !isActive(bag[index].id)) return bag.splice(index, 1)[0];
      }
      refillBag();
    }
    return null;
  }

  function clearSlot(slot, phase = 'disabled') {
    cancelHover(slot);
    ++slot.token;
    slot.loading?.removeAttribute('src');
    slot.loading = null;
    slot.state.image = null;
    slot.state.amount = slot.state.elapsed = 0;
    slot.state.bounds.x = slot.state.bounds.y = slot.state.bounds.width = slot.state.bounds.height = 0;
    slot.current = null;
    slot.amount = slot.phaseTime = 0;
    slot.pausedPhase = null;
    slot.phase = phase;
    slot.target.removeAttribute('data-memory-id');
  }

  function beginNext(slot, first = false) {
    if (!enabled || disposed || slot.index >= count) return;
    clearSlot(slot, 'loading');
    slot.delay = first ? 1 + slot.index * 3.25 : 0;
    slot.current = nextItem();
    slot.hoverBlocked = false;
    if (!slot.current) {
      slot.phase = items.length ? 'unavailable' : 'empty';
      updateTargets();
      return;
    }
    const entry = slot.current;
    const token = slot.token;
    const decoded = new Image();
    slot.loading = decoded;
    decoded.decoding = 'async';
    decoded.src = entry.previewUrl;
    slot.target.dataset.memoryId = entry.id;
    slot.target.setAttribute('aria-label', t('memory.open', {name: entry.sourceName}));
    updateTargets();
    decoded.decode().then(() => {
      if (disposed || token !== slot.token || !enabled || slot.index >= count) return;
      if (!decoded.naturalWidth || !decoded.naturalHeight) throw new Error(t('memory.unavailable'));
      slot.loading = null;
      slot.state.image = decoded;
      lastId = entry.id;
      slot.phase = reducedMotion ? 'static' : slot.delay ? 'waiting' : 'reveal';
      slot.amount = reducedMotion ? 1 : 0;
      readCardBounds();
      reconcileLayout();
      updateTargets();
      notify();
    }).catch(() => {
      if (disposed || token !== slot.token || !enabled || slot.index >= count) return;
      slot.loading = null;
      failedIds.add(entry.id);
      beginNext(slot, first);
      reconcileLayout();
      updateTargets();
      notify();
    });
  }

  function containedRect() {
    const rect = viewer.getBoundingClientRect();
    const ratio = fullRenderer.sourceWidth / fullRenderer.sourceHeight || 1;
    const width = Math.min(rect.width, rect.height * ratio);
    const height = width / ratio;
    return {left: rect.left + (rect.width - width) / 2, top: rect.top + (rect.height - height) / 2, width, height};
  }

  function cancelExpansion() {
    expansion?.cancel();
    expansion = null;
  }

  function failViewer() {
    contextFailed = true;
    ++fullToken;
    fullLoading?.removeAttribute('src');
    fullLoading = null;
    cancelExpansion();
    closeViewer();
    updateTargets();
    notify();
  }

  function displayViewerImage(index, decoded, resolution, sourceRect = null) {
    cancelExpansion();
    if (!fullRenderer.open(decoded, activeViewerEffect, activeViewerTarget, reducedMotion,
      viewer.clientWidth, viewer.clientHeight)) {
      closeViewer();
      return false;
    }
    viewerIndex = index;
    fullCanvas.setAttribute('aria-label', t('memory.image', {name: items[index].sourceName}));
    viewer.dataset.memoryId = items[index].id;
    viewer.dataset.resolution = resolution;
    viewerPosition.textContent = t('memory.position', {index: index + 1, count: items.length});
    if (sourceRect && !reducedMotion) {
      const destination = containedRect();
      const x = sourceRect.left + sourceRect.width / 2 - destination.left - destination.width / 2;
      const y = sourceRect.top + sourceRect.height / 2 - destination.top - destination.height / 2;
      const scale = sourceRect.width / destination.width;
      const animation = fullCanvas.animate([
        {transform: `translate(${x}px, ${y}px) scale(${scale})`},
        {transform: 'translate(0, 0) scale(1)'},
      ], {duration: 420, easing: 'cubic-bezier(.2,.75,.2,1)'});
      expansion = animation;
      animation.onfinish = () => {
        if (expansion !== animation) return;
        expansion = null;
        animation.cancel();
      };
    }
    return true;
  }

  function applyLoadedImage(decoded, index, upgrade) {
    if (upgrade && index === viewerIndex) {
      // The initial preview upgrade preserves the current color/effect clock.
      if (!fullRenderer.replaceSource(decoded)) return;
      viewer.dataset.resolution = 'full';
    } else if (!displayViewerImage(index, decoded, 'full')) return;
    requestedIndex = -1;
    viewer.removeAttribute('aria-busy');
    notify();
  }

  function requestViewerImage(index, upgrade = false) {
    const token = ++fullToken;
    fullLoading?.removeAttribute('src');
    pendingFull = null;
    requestedIndex = index;
    viewer.setAttribute('aria-busy', 'true');
    const decoded = new Image();
    fullLoading = decoded;
    decoded.decoding = 'async';
    decoded.src = items[index].url;
    decoded.decode().then(() => {
      if (disposed || token !== fullToken || !viewer.open) return;
      fullLoading = null;
      if (suspended) pendingFull = {decoded, index, upgrade};
      else applyLoadedImage(decoded, index, upgrade);
    }).catch(() => {
      if (disposed || token !== fullToken || !viewer.open) return;
      fullLoading = null;
      requestedIndex = -1;
      viewer.removeAttribute('aria-busy');
      // Keep the displayed image; never relabel it as a failed navigation.
      if (!upgrade) viewerPosition.textContent = t('memory.unavailable');
      notify();
    });
  }

  function navigateViewer(direction) {
    if (!viewer.open || disposed || suspended || contextFailed || items.length < 2) return;
    const from = requestedIndex >= 0 ? requestedIndex : viewerIndex;
    requestViewerImage((from + direction + items.length) % items.length);
  }

  function openViewer(slot) {
    cancelHover();
    if (disposed || viewer.open || slot.target.disabled || !slot.state.image || suspended || contextFailed) return;
    const sourceRect = slot.target.getBoundingClientRect();
    restoreFocus = document.activeElement instanceof HTMLElement && document.activeElement !== document.body
      ? document.activeElement : slot.target;
    selected = slot;
    activeViewerEffect = viewerEffect;
    activeViewerTarget = viewerTarget;
    viewer.dataset.slot = String(slot.index);
    viewer.dataset.reducedMotion = String(reducedMotion);
    viewer.dataset.effect = String(activeViewerEffect);
    viewer.dataset.target = String(activeViewerTarget);
    viewer.showModal();
    updateTargets();
    const index = items.indexOf(slot.current);
    if (!displayViewerImage(index, slot.state.image, 'preview', sourceRect)) return;
    requestViewerImage(index, true);
    notify();
  }

  function finishClose(notifyChange = true) {
    cancelHover();
    ++fullToken;
    fullLoading?.removeAttribute('src');
    fullLoading = null;
    pendingFull = null;
    viewerIndex = requestedIndex = -1;
    gesture = null;
    suppressGestureClick = false;
    viewer.removeAttribute('aria-busy');
    viewerPosition.textContent = '';
    cancelExpansion();
    fullRenderer.clear();
    updateTargets();
    // Hover-open must not immediately reopen after Escape with a stationary mouse.
    if (selected) {
      const rect = selected.target.getBoundingClientRect();
      selected.hoverBlocked = pointerX >= rect.left && pointerX <= rect.right
        && pointerY >= rect.top && pointerY <= rect.bottom;
    }
    const previous = restoreFocus;
    const fallback = selected?.target;
    restoreFocus = null;
    selected = null;
    delete viewer.dataset.memoryId;
    delete viewer.dataset.slot;
    const focusTarget = previous?.isConnected && !previous.disabled && previous.getClientRects().length
      ? previous : fallback && !fallback.disabled ? fallback : null;
    if (focusTarget) {
      if (focusTarget.classList.contains('screenshot-target')) focusTarget.dataset.viewerReturned = '';
      focusTarget.focus({preventScroll: true});
    }
    if (notifyChange) notify();
  }

  function closeViewer(notifyChange = true) {
    if (!viewer.open) return;
    viewer.close();
    finishClose(notifyChange);
  }

  function disable() {
    enabled = false;
    closeViewer(false);
    cancelHover();
    for (const slot of slots) clearSlot(slot);
    updateTargets();
  }

  function layout() {
    if (disposed) return;
    measureLayout();
    readCardBounds(true);
    reconcileLayout();
    updateTargets();
    // Refit backing pixels without restarting the independent opening clock.
    if (viewer.open) fullRenderer.resize(viewer.clientWidth, viewer.clientHeight);
    notify();
  }

  function advanceSlot(slot, seconds) {
    let remaining = seconds;
    while (remaining > 0) {
      const duration = slot.phase === 'waiting' ? slot.delay : slot.phase === 'reveal' ? REVEAL_SECONDS
        : slot.phase === 'hold' ? HOLD_SECONDS : slot.phase === 'dissolve' ? DISSOLVE_SECONDS
          : slot.phase === 'quiet' ? slot.quietSeconds : 0;
      if (!duration) break;
      const step = Math.min(remaining, duration - slot.phaseTime);
      slot.phaseTime += step;
      slot.state.elapsed += step;
      remaining -= step;
      if (slot.phase === 'reveal') slot.amount = smoothstep(Math.min(1, slot.phaseTime / REVEAL_SECONDS));
      else if (slot.phase === 'dissolve') slot.amount = 1 - smoothstep(Math.min(1, slot.phaseTime / DISSOLVE_SECONDS));
      if (slot.phaseTime < duration) break;
      slot.phaseTime = 0;
      if (slot.phase === 'waiting') slot.phase = 'reveal';
      else if (slot.phase === 'reveal') { slot.phase = 'hold'; slot.amount = 1; }
      else if (slot.phase === 'hold') slot.phase = 'dissolve';
      else if (slot.phase === 'dissolve') {
        clearSlot(slot, 'quiet');
        slot.quietSeconds = randomBetween(6, 12);
        reconcileLayout();
      } else if (slot.phase === 'quiet') {
        beginNext(slot);
        break;
      }
    }
  }

  for (const slot of slots) {
    const showFocusIndicator = () => { delete slot.target.dataset.viewerReturned; };
    slot.target.addEventListener('blur', showFocusIndicator, {signal: events.signal});
    slot.target.addEventListener('keydown', showFocusIndicator, {signal: events.signal});
    slot.target.addEventListener('pointerenter', event => {
      if (event.pointerType !== 'mouse' || slot.hoverBlocked || slot.target.disabled || viewer.open) return;
      cancelHover();
      hoverSlot = slot;
      hoverTimer = setTimeout(() => openViewer(slot), HOVER_MILLISECONDS);
    }, {signal: events.signal});
    slot.target.addEventListener('pointerleave', () => {
      cancelHover(slot);
      if (!viewer.open) slot.hoverBlocked = false;
    }, {signal: events.signal});
    slot.target.addEventListener('pointerdown', () => cancelHover(slot), {signal: events.signal});
    slot.target.addEventListener('click', () => openViewer(slot), {signal: events.signal});
  }
  document.addEventListener('pointermove', event => {
    if (event.pointerType !== 'mouse') return;
    pointerX = event.clientX;
    pointerY = event.clientY;
  }, {signal: events.signal, passive: true});
  closeButton.addEventListener('click', () => closeViewer(), {signal: events.signal});
  viewer.addEventListener('cancel', event => {
    event.preventDefault();
    closeViewer();
  }, {signal: events.signal});
  viewer.addEventListener('close', () => {
    // A queued old close event must not close a newly reopened dialog.
    if (!viewer.open && restoreFocus !== null) finishClose();
  }, {signal: events.signal});
  viewer.addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    navigateViewer(event.key === 'ArrowLeft' ? -1 : 1);
  }, {signal: events.signal});
  viewer.addEventListener('pointerdown', event => {
    suppressGestureClick = false;
    if (!event.isPrimary) {
      gesture = null;
      return;
    }
    if (event.button !== 0 || event.target.closest('button')) return;
    gesture = {id: event.pointerId, x: event.clientX, y: event.clientY};
    viewer.setPointerCapture(event.pointerId);
  }, {signal: events.signal});
  viewer.addEventListener('pointerup', event => {
    if (!gesture || gesture.id !== event.pointerId) return;
    const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
    gesture = null;
    if (viewer.hasPointerCapture(event.pointerId)) viewer.releasePointerCapture(event.pointerId);
    suppressGestureClick = Math.max(Math.abs(dx), Math.abs(dy)) > 10;
    const threshold = Math.max(40, Math.min(100, viewer.clientWidth * 0.06));
    if (Math.abs(dx) >= threshold && Math.abs(dx) > Math.abs(dy) * 1.25) {
      navigateViewer(dx < 0 ? 1 : -1);
    }
  }, {signal: events.signal});
  viewer.addEventListener('pointercancel', () => { gesture = null; }, {signal: events.signal});
  viewer.addEventListener('lostpointercapture', () => { gesture = null; }, {signal: events.signal});
  viewer.addEventListener('click', event => {
    if (suppressGestureClick) {
      suppressGestureClick = false;
      event.preventDefault();
      return;
    }
    if (event.target !== viewer) return;
    const rect = containedRect();
    if (event.clientX < rect.left || event.clientX > rect.left + rect.width
      || event.clientY < rect.top || event.clientY > rect.top + rect.height) closeViewer();
  }, {signal: events.signal});
  fullCanvas.addEventListener('dragstart', event => event.preventDefault(), {signal: events.signal});
  window.addEventListener('resize', layout, {signal: events.signal});
  window.addEventListener('scroll', layout, {signal: events.signal, passive: true});
  window.visualViewport?.addEventListener('resize', layout, {signal: events.signal});
  window.visualViewport?.addEventListener('scroll', layout, {signal: events.signal});
  document.addEventListener('visibilitychange', () => {
    suspended = document.hidden;
    cancelHover();
    fullRenderer.suspend(suspended);
    if (!suspended && pendingFull && viewer.open) {
      const pending = pendingFull;
      pendingFull = null;
      applyLoadedImage(pending.decoded, pending.index, pending.upgrade);
    }
    if (suspended) {
      expansion?.pause();
    } else {
      if (expansion?.playState === 'paused') expansion.play();
    }
    updateTargets();
    notify();
  }, {signal: events.signal});
  const observer = new ResizeObserver(layout);
  observer.observe(image);
  measureLayout();
  readCardBounds(true);

  return {
    get moving() {
      return enabled && !reducedMotion && !viewer.open && !suspended && slots.some(slot =>
        ['waiting', 'reveal', 'hold', 'dissolve', 'quiet'].includes(slot.phase));
    },
    get open() { return viewer.open; },
    get renderStates() { return renderStates; },
    advance(deltaSeconds, options) {
      if (disposed) return;
      const wasReduced = reducedMotion;
      reducedMotion = Boolean(options.reducedMotion);
      viewerEffect = Number.isInteger(options.viewerEffect) && options.viewerEffect >= 0 && options.viewerEffect <= 4
        ? options.viewerEffect : 0;
      viewerTarget = Number.isInteger(options.viewerTarget) && options.viewerTarget >= 0 && options.viewerTarget <= 2
        ? options.viewerTarget : 0;
      const nextCount = Number.isFinite(options.count) ? Math.min(3, Math.max(1, Math.round(options.count))) : 3;
      const oldCount = count;
      count = nextCount;
      if (!options.enabled) {
        if (enabled) disable();
        return;
      }
      if (!enabled) {
        enabled = true;
        suspended = document.hidden;
        readCardBounds(true);
        for (let index = 0; index < count; index++) beginNext(slots[index], true);
      } else if (oldCount !== count) {
        if (selected && selected.index >= count) closeViewer(false);
        for (let index = count; index < oldCount; index++) clearSlot(slots[index]);
        for (let index = oldCount; index < count; index++) beginNext(slots[index], true);
        reconcileLayout();
      }
      if (wasReduced !== reducedMotion) {
        for (let index = 0; index < count; index++) {
          const slot = slots[index];
          if (reducedMotion && slot.state.image) {
            if (slot.phase === 'deferred') slot.pausedPhase = 'static';
            else slot.phase = 'static';
            slot.phaseTime = 0;
            slot.amount = 1;
          } else if (reducedMotion && slot.phase === 'quiet') {
            beginNext(slot, true);
          } else if (!reducedMotion && slot.phase === 'static') {
            slot.phase = 'hold';
            slot.phaseTime = 0;
          } else if (!reducedMotion && slot.phase === 'deferred' && slot.pausedPhase === 'static') {
            slot.pausedPhase = 'hold';
            slot.phaseTime = 0;
          }
        }
        if (reducedMotion && viewer.open) {
          cancelExpansion();
          fullRenderer.settle();
        }
        viewer.dataset.reducedMotion = String(reducedMotion);
      }
      if (readCardBounds()) reconcileLayout();
      if (!viewer.open && !reducedMotion && !suspended) {
        const seconds = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0;
        for (let index = 0; index < count; index++) advanceSlot(slots[index], seconds);
      }
      updateTargets();
    },
    suspend() {
      cancelHover();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      disable();
      events.abort();
      observer.disconnect();
      fullRenderer.dispose();
      bag = [];
      for (const slot of slots) slot.target.remove();
      viewer.remove();
    },
  };
}
