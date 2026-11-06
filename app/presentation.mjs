// One contact impulse: glyph ink -> thread -> growing frame -> gentle sway.
// All progress and oscillation come from WASM; this module owns only geometry.
export function createCardPresentation({image, controls, card, scene}) {
  const nicknames = new Map(scene.nicknames.map(nickname => [nickname.id, nickname]));
  const ns = 'http://www.w3.org/2000/svg';
  function node(tag, attributes) {
    const element = document.createElementNS(ns, tag);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
    return element;
  }
  const svg = node('svg', {id: 'nickname-thread', 'aria-hidden': 'true'});
  svg.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:8;pointer-events:none;overflow:visible;display:none';
  const line = node('path', {
    id: 'thread-line', fill: 'none', stroke: '#b8d2c0', 'stroke-width': '1.15',
    'stroke-linecap': 'butt', 'stroke-opacity': '0.72', pathLength: '1', 'stroke-dasharray': '1',
  });
  const wave = node('path', {
    id: 'thread-wave', fill: 'none', stroke: '#e2ffeb', 'stroke-width': '1.9',
    'stroke-linecap': 'round', pathLength: '1', 'stroke-dasharray': '0.14 1',
  });
  const contactRing = node('circle', {
    id: 'contact-wave', fill: 'none', stroke: '#d6f4df', 'stroke-width': '1',
  });
  const contact = node('circle', {id: 'glyph-contact', r: '1.3', fill: '#e2ffeb'});
  const frame = node('g', {id: 'card-frame'});
  const outline = node('rect', {
    id: 'card-outline', fill: '#151917', 'fill-opacity': '0.98',
    stroke: '#8fa596', 'stroke-width': '1.15',
  });
  const rimLeft = node('path', {
    id: 'frame-wave-left', fill: 'none', stroke: '#e2ffeb', 'stroke-width': '1.8',
    'stroke-linecap': 'round', pathLength: '1', 'stroke-dasharray': '0.18 1',
  });
  const rimRight = rimLeft.cloneNode();
  rimRight.id = 'frame-wave-right';
  frame.append(outline, rimLeft, rimRight);
  svg.append(line, wave, contactRing, contact, frame);
  document.body.append(svg);
  card.element.inert = true;
  const content = Array.from(card.element.children);
  for (const element of content) element.inert = true;

  let index = -1;
  let geometry = null;
  let latestMotion = null;
  let inputContact = null;
  let imageRectangle = null;
  let viewport = null;
  let controlBounds = null;
  const exclusion = {x: 0, y: 0, width: 0, height: 0};
  const rectangleKeys = ['x', 'y', 'width', 'height'];
  const screenshots = Array.from({length: 3}, (_, slot) => ({
    slot, active: false, source: {x: 0, y: 0, width: 0, height: 0},
    viewport: {x: 0, y: 0, width: 0, height: 0},
  }));
  // Match the motion module's maximum offsets and angle, plus the SVG rim.
  const swaySin = Math.sin(0.35 * Math.PI / 180);
  const swayInset = 1 - Math.cos(0.35 * Math.PI / 180);
  let lastStartX = NaN, lastStartY = NaN, lastEndX = NaN, lastEndY = NaN;
  let lastOffsetX = NaN, lastOffsetY = NaN, lastAngle = NaN;
  let lastThread = -1, lastGrowth = -1;
  let visible = false, ready = false;
  let frameX = 0, frameY = 0, frameWidth = 0, frameHeight = 0;

  const ease = value => {
    const t = Math.max(0, Math.min(1, value));
    return t * t * (3 - 2 * t);
  };
  function setReady(value) {
    if (value === ready) return;
    ready = value;
    for (const element of content) element.inert = !value;
  }
  function measureLayout() {
    const view = window.visualViewport;
    viewport = {x: view?.offsetLeft || 0, y: view?.offsetTop || 0,
      width: view?.width || document.documentElement.clientWidth,
      height: view?.height || innerHeight};
    const docked = !controls.hidden && controls.dataset.floating !== 'true' && viewport.width >= 900;
    document.documentElement.style.setProperty('--controls-left', docked ? '320px' : '0px');
    imageRectangle = image.getBoundingClientRect();
    const launcher = document.getElementById('controls-launcher');
    const activeControls = controls.hidden ? launcher : controls;
    const rect = activeControls && !activeControls.hidden ? activeControls.getBoundingClientRect() : null;
    controlBounds = rect?.width && rect.height
      ? {x: rect.left, y: rect.top, width: rect.width, height: rect.height} : null;
    svg.setAttribute('viewBox', `0 0 ${document.documentElement.clientWidth} ${innerHeight}`);
    projectScreenshots();
  }
  function cacheScreenshots(renderStates) {
    let changed = false;
    for (let slot = 0; slot < screenshots.length; slot++) {
      const cached = screenshots[slot];
      const state = renderStates?.[slot];
      const bounds = state?.bounds;
      const active = Boolean(state?.image && bounds?.width > 0 && bounds.height > 0);
      if (cached.active !== active) {
        cached.active = active;
        changed = true;
      }
      if (!active) continue;
      for (const key of rectangleKeys) {
        if (cached.source[key] !== bounds[key]) {
          cached.source[key] = bounds[key];
          changed = true;
        }
      }
    }
    return changed;
  }
  function projectScreenshots() {
    if (!imageRectangle) return;
    const scaleX = imageRectangle.width / (image.naturalWidth || scene.imageWidth);
    const scaleY = imageRectangle.height / (image.naturalHeight || scene.imageHeight);
    for (const screenshot of screenshots) {
      if (!screenshot.active) continue;
      const source = screenshot.source, target = screenshot.viewport;
      target.x = imageRectangle.left + source.x * scaleX;
      target.y = imageRectangle.top + source.y * scaleY;
      target.width = source.width * scaleX;
      target.height = source.height * scaleY;
    }
  }
  function intersects(a, b) {
    return a.x < b.x + b.width && a.x + a.width > b.x
      && a.y < b.y + b.height && a.y + a.height > b.y;
  }
  function freeRectangles(region, obstacles) {
    let free = region.width > 0 && region.height > 0 ? [region] : [];
    for (const obstacle of obstacles) {
      const next = [];
      for (const area of free) {
        if (!intersects(area, obstacle)) {
          next.push(area);
          continue;
        }
        const right = area.x + area.width, bottom = area.y + area.height;
        const add = (x, y, width, height) => {
          if (width > 0 && height > 0) next.push({x, y, width, height});
        };
        add(area.x, area.y, obstacle.x - area.x, area.height);
        add(obstacle.x + obstacle.width, area.y, right - obstacle.x - obstacle.width, area.height);
        add(area.x, area.y, area.width, obstacle.y - area.y);
        add(area.x, obstacle.y + obstacle.height, area.width, bottom - obstacle.y - obstacle.height);
      }
      free = next.filter((area, i) => !next.some((other, j) => i !== j
        && other.x <= area.x && other.y <= area.y
        && other.x + other.width >= area.x + area.width
        && other.y + other.height >= area.y + area.height
        && (j < i || other.width > area.width || other.height > area.height)));
    }
    return free;
  }
  function swayPadding(width, height) {
    return {x: 3.2 + 1.5 + height * swaySin + width * swayInset,
      y: 2.1 + 1.5 + width * swaySin + height * swayInset};
  }
  function layout() {
    if (index < 0) return;
    if (!imageRectangle) measureLayout();
    const rectangle = imageRectangle;
    const ratio = rectangle.width / scene.imageWidth;
    const occurrence = scene.occurrences[index];
    const bounds = occurrence.bounds;
    const protection = scene.protectedBounds;
    const protectedTop = rectangle.top + protection.y * ratio;
    const protectedBottom = rectangle.top + (protection.y + protection.height) * ratio;
    const directed = inputContact?.mode === 'automatic' || inputContact?.approachKnown;
    const preferredAbove = inputContact && Math.abs(inputContact.dy) >= 0.2
      ? inputContact.dy < 0 : bounds.y + bounds.height / 2 < scene.imageHeight / 2;
    const preferredSide = preferredAbove ? 'above' : 'below';
    // Moving the destination must not change the glyph contact or outgoing angle.
    const ink = inputContact || occurrence.contacts[preferredSide];
    const padding = 12, gap = 14, obstacleGap = 8;
    const obstacles = [];
    const addObstacle = obstacle => obstacles.push({
      x: obstacle.x - obstacleGap, y: obstacle.y - obstacleGap,
      width: obstacle.width + obstacleGap * 2, height: obstacle.height + obstacleGap * 2,
    });
    if (controlBounds) addObstacle(controlBounds);
    for (const screenshot of screenshots) {
      if (screenshot.active) addObstacle(screenshot.viewport);
    }
    const viewportRight = viewport.x + viewport.width - padding;
    const viewportBottom = viewport.y + viewport.height - padding;
    const regions = [
      {side: 'above', x: viewport.x + padding, y: viewport.y + padding,
        width: viewport.width - padding * 2,
        height: Math.min(viewportBottom, protectedTop - gap) - viewport.y - padding},
      {side: 'below', x: viewport.x + padding, y: Math.max(viewport.y + padding, protectedBottom + gap),
        width: viewport.width - padding * 2,
        height: viewportBottom - Math.max(viewport.y + padding, protectedBottom + gap)},
    ];
    const wasHidden = card.element.hidden;
    if (wasHidden) {
      card.element.style.visibility = 'hidden';
      card.element.inert = true;
      card.show(nicknames.get(occurrence.nicknameId));
    }
    card.element.style.transform = 'none';
    card.element.style.minHeight = '0';
    card.element.style.width = '';
    card.element.style.maxHeight = `${Math.max(1, viewport.height - padding * 2)}px`;
    const natural = card.element.getBoundingClientRect();
    const sourceCenterX = rectangle.left + (bounds.x + bounds.width / 2) * ratio;
    const peakScale = occurrence.peakScale ?? latestMotion.defaultPeakScale;
    const restingInkX = sourceCenterX + (ink.x - bounds.width / 2) * ratio * peakScale;
    const desiredJoint = inputContact ? restingInkX + (directed ? inputContact.dx * 180 : 0) : sourceCenterX;
    function choosePlacement(blocked, minimumWidth = 160, minimumHeight = 64) {
      let best = null;
      for (const region of regions) {
        for (const area of freeRectangles(region, blocked)) {
          let width = Math.min(natural.width, area.width - 9.4);
          let height = Math.min(natural.height, area.height - 7.2);
          // Solve both dimensions against the conservative rotated envelope.
          for (let pass = 0; pass < 3; pass++) {
            width = Math.min(natural.width, (area.width - 9.4 - 2 * height * swaySin) / (1 + 2 * swayInset));
            height = Math.min(natural.height, (area.height - 7.2 - 2 * width * swaySin) / (1 + 2 * swayInset));
          }
          width = Math.min(width, (area.width - 9.4 - 2 * height * swaySin) / (1 + 2 * swayInset));
          if (width < Math.min(minimumWidth, natural.width) || height < Math.min(minimumHeight, natural.height)) continue;
          const safety = swayPadding(width, height);
          const left = Math.max(area.x + safety.x,
            Math.min(desiredJoint - width / 2, area.x + area.width - safety.x - width));
          const top = region.side === 'above' ? area.y + area.height - safety.y - height : area.y + safety.y;
          const compression = Math.max(0, 1 - width / natural.width) + Math.max(0, 1 - height / natural.height);
          const score = compression * 1000000 + (region.side === preferredSide ? 0 : 10000)
            + Math.abs(left + width / 2 - desiredJoint)
            + Math.abs(top - (region.side === 'above' ? protectedTop - gap - height : protectedBottom + gap));
          if (!best || score < best.score) best = {side: region.side, left, top, width, height, safety, score};
        }
      }
      return best;
    }
    let placement = choosePlacement(obstacles);
    // If previews leave no usable pocket, reserve a readable, title-safe area
    // and let the host reflow those previews before either layer is painted.
    const fixedObstacles = controlBounds ? obstacles.slice(0, 1) : [];
    if (!placement) placement = choosePlacement(fixedObstacles) || choosePlacement(fixedObstacles, 26, 22);
    if (!placement) {
      const region = regions.reduce((best, candidate) =>
        candidate.height > best.height ? candidate : best, regions[0]);
      let width = Math.min(natural.width, region.width - 9.4);
      let height = Math.min(natural.height, region.height - 7.2);
      for (let pass = 0; pass < 3; pass++) {
        width = Math.min(natural.width, (region.width - 9.4 - 2 * height * swaySin) / (1 + 2 * swayInset));
        height = Math.min(natural.height, (region.height - 7.2 - 2 * width * swaySin) / (1 + 2 * swayInset));
      }
      width = Math.max(26, width);
      height = Math.max(22, height);
      const safety = swayPadding(width, height);
      placement = {side: region.side,
        left: Math.max(region.x + safety.x,
          Math.min(desiredJoint - width / 2, viewportRight - safety.x - width)),
        top: region.side === 'above' ? region.y + region.height - safety.y - height : region.y + safety.y,
        width, height, safety};
    }
    const {side, left, top, width, height, safety} = placement;
    const above = side === 'above';
    const jointInset = Math.min(26, width / 2);
    const jointX = inputContact
      ? Math.max(left + jointInset, Math.min(desiredJoint, left + width - jointInset)) : left + width / 2;
    card.element.style.width = `${width}px`;
    card.element.style.maxHeight = `${height}px`;
    card.element.style.left = `${left}px`;
    card.element.style.top = `${top}px`;
    card.element.style.transformOrigin = `${jointX - left}px ${above ? height : 0}px`;
    card.element.dataset.side = side;
    exclusion.x = left - safety.x;
    exclusion.y = top - safety.y;
    exclusion.width = width + safety.x * 2;
    exclusion.height = height + safety.y * 2;
    geometry = {
      side, preferredSide, ratio, sourceCenterX,
      sourceCenterY: rectangle.top + (bounds.y + bounds.height / 2) * ratio,
      contactX: (ink.x - bounds.width / 2) * ratio,
      contactY: (ink.y - bounds.height / 2) * ratio,
      contactPixel: {x: ink.x, y: ink.y},
      contactMode: inputContact ? inputContact.mode : 'measured',
      entry: inputContact?.mode === 'pointer' ? {x: inputContact.entryX, y: inputContact.entryY} : null,
      approachKnown: inputContact?.mode === 'pointer' && Boolean(inputContact.approachKnown),
      exitX: inputContact ? inputContact.dx : 0,
      exitY: inputContact ? inputContact.dy : (preferredAbove ? -1 : 1),
      viewportWidth: document.documentElement.clientWidth, viewportHeight: innerHeight,
      endX: jointX, endY: above ? top + height : top,
      card: {x: left, y: top, width, height},
      protected: {x: rectangle.left + protection.x * ratio, y: protectedTop,
        width: protection.width * ratio, height: protection.height * ratio},
      safety, constrained: screenshots.some(screenshot => screenshot.active && intersects(exclusion, screenshot.viewport)),
    };
    if (wasHidden) card.hide();
    lastStartX = lastStartY = lastEndX = lastEndY = NaN;
    lastOffsetX = lastOffsetY = lastAngle = NaN;
    lastGrowth = -1;
  }
  function growFrame(progress) {
    if (progress === lastGrowth) return;
    const box = geometry.card;
    frameWidth = Math.max(1, box.width * (1 - (1 - progress) ** 3));
    frameHeight = Math.max(1, box.height * ease(progress));
    frameX = geometry.endX - (geometry.endX - box.x) * frameWidth / box.width;
    frameY = geometry.side === 'above' ? geometry.endY - frameHeight : geometry.endY;
    const radius = Math.min(10, geometry.endX - frameX, frameX + frameWidth - geometry.endX, frameHeight / 2);
    outline.setAttribute('x', frameX);
    outline.setAttribute('y', frameY);
    outline.setAttribute('width', frameWidth);
    outline.setAttribute('height', frameHeight);
    outline.setAttribute('rx', radius);
    const nearY = geometry.endY;
    const direction = geometry.side === 'above' ? -1 : 1;
    const farY = nearY + direction * frameHeight;
    const left = frameX, right = frameX + frameWidth, jointX = geometry.endX;
    const leftSweep = direction === 1 ? 0 : 1;
    const rightSweep = 1 - leftSweep;
    // Both wave paths start at the beam joint and meet on the opposite edge.
    rimLeft.setAttribute('d', `M ${jointX} ${nearY} H ${left + radius} A ${radius} ${radius} 0 0 ${leftSweep} ${left} ${nearY + direction * radius} V ${farY - direction * radius} A ${radius} ${radius} 0 0 ${leftSweep} ${left + radius} ${farY} H ${jointX}`);
    rimRight.setAttribute('d', `M ${jointX} ${nearY} H ${right - radius} A ${radius} ${radius} 0 0 ${rightSweep} ${right} ${nearY + direction * radius} V ${farY - direction * radius} A ${radius} ${radius} 0 0 ${rightSweep} ${right - radius} ${farY} H ${jointX}`);
    const rimOffset = String(0.18 - progress * 1.18);
    const rimOpacity = String(1 - ease((progress - 0.78) / 0.22));
    rimLeft.setAttribute('stroke-dashoffset', rimOffset);
    rimRight.setAttribute('stroke-dashoffset', rimOffset);
    rimLeft.setAttribute('opacity', rimOpacity);
    rimRight.setAttribute('opacity', rimOpacity);
    if (progress >= 1) {
      card.element.style.clipPath = 'none';
    } else {
      const insetLeft = frameX - box.x;
      const insetRight = box.x + box.width - frameX - frameWidth;
      const vertical = box.height - frameHeight;
      card.element.style.clipPath = `inset(${geometry.side === 'above' ? vertical : 0}px ${insetRight}px ${geometry.side === 'below' ? vertical : 0}px ${insetLeft}px round ${radius}px)`;
    }
    // Keep the early expanding strip empty instead of exposing clipped letters.
    card.element.style.opacity = String(ease((progress - 0.35) / 0.65));
    lastGrowth = progress;
  }
  function paint(motion) {
    const thread = motion.threadProgress;
    const growth = motion.cardIndex >= 0 ? motion.cardProgress : 0;
    const nextVisible = growth > 0 && index >= 0;
    setReady(nextVisible && growth >= 1);
    if (nextVisible !== visible) {
      visible = nextVisible;
      // Accept pointer crossing on the visible frame while its clipped controls
      // remain inert until unfolding completes.
      card.element.inert = !visible;
      if (visible) {
        card.show(nicknames.get(scene.occurrences[index].nicknameId));
        card.element.style.visibility = 'visible';
      } else {
        card.hide();
      }
    }
    frame.style.display = visible ? '' : 'none';
    if (thread <= 0 || !geometry) {
      svg.style.display = 'none';
      lastThread = lastGrowth = 0;
      return;
    }
    svg.style.display = '';
    growFrame(growth);
    const dx = motion.cardOffsetX, dy = motion.cardOffsetY, angle = motion.cardAngle;
    const angleChanged = angle !== lastAngle;
    if (dx !== lastOffsetX || dy !== lastOffsetY || angleChanged) {
      card.element.style.transform = `translate(${dx}px, ${dy}px) rotate(${angle}deg)`;
      frame.setAttribute('transform', `translate(${dx} ${dy}) rotate(${angle} ${geometry.endX} ${geometry.endY})`);
      lastOffsetX = dx; lastOffsetY = dy; lastAngle = angle;
    }
    const direction = geometry.side === 'above' ? -1 : 1;
    const offset = index * 3;
    const scale = motion.states[offset + 1];
    const startX = geometry.sourceCenterX + geometry.contactX * scale;
    const startY = geometry.sourceCenterY + geometry.contactY * scale + motion.states[offset + 2] * geometry.ratio;
    const endX = geometry.endX + dx, endY = geometry.endY + dy;
    if (startX !== lastStartX || startY !== lastStartY || endX !== lastEndX || endY !== lastEndY || angleChanged) {
      const distance = Math.hypot(endX - startX, endY - startY);
      let lead = Math.min(110, Math.max(30, distance * 0.45));
      // Keep the outgoing handle inside the viewport without changing its angle.
      if (geometry.exitX > 0) lead = Math.min(lead, Math.max(0, geometry.viewportWidth - 6 - startX) / geometry.exitX);
      else if (geometry.exitX < 0) lead = Math.min(lead, Math.max(0, startX - 6) / -geometry.exitX);
      if (geometry.exitY > 0) lead = Math.min(lead, Math.max(0, geometry.viewportHeight - 6 - startY) / geometry.exitY);
      else if (geometry.exitY < 0) lead = Math.min(lead, Math.max(0, startY - 6) / -geometry.exitY);
      const radians = angle * Math.PI / 180;
      const curve = `M ${startX} ${startY} C ${startX + geometry.exitX * lead} ${startY + geometry.exitY * lead}, ${endX + direction * Math.sin(radians) * distance * 0.35} ${endY - direction * Math.cos(radians) * distance * 0.35}, ${endX} ${endY}`;
      line.setAttribute('d', curve);
      wave.setAttribute('d', curve);
      contact.setAttribute('cx', startX); contact.setAttribute('cy', startY);
      contactRing.setAttribute('cx', startX); contactRing.setAttribute('cy', startY);
      lastStartX = startX; lastStartY = startY; lastEndX = endX; lastEndY = endY;
    }
    if (thread !== lastThread) {
      line.setAttribute('stroke-dashoffset', String(1 - thread));
      wave.setAttribute('stroke-dashoffset', String(0.14 - thread));
      lastThread = thread;
    }
    const travelling = !motion.reducedMotion && (motion.phase === 'reveal' || motion.phase === 'manual') && thread < 1;
    wave.setAttribute('opacity', travelling ? '1' : '0');
    const touch = Math.min(1, thread * 2.1);
    contactRing.setAttribute('r', String(1.5 + touch * 12));
    contactRing.setAttribute('opacity', travelling ? String((1 - touch) ** 2 * 0.85) : '0');
    contact.setAttribute('opacity', travelling ? String(1 - touch) : '0');
  }
  function update(motion, input, renderStates) {
    latestMotion = motion;
    const nextContact = input?.index === motion.selectedIndex ? input : null;
    const contactChanged = nextContact !== inputContact;
    inputContact = nextContact;
    const screenshotsChanged = cacheScreenshots(renderStates);
    if (screenshotsChanged) projectScreenshots();
    if (index !== motion.selectedIndex) {
      index = motion.selectedIndex;
      if (index >= 0) {
        visible = false;
        setReady(false);
        card.hide();
        card.element.inert = true;
        layout();
      } else {
        geometry = null;
      }
    } else if ((contactChanged || screenshotsChanged) && index >= 0) {
      layout();
    }
    paint(motion);
  }
  function reposition() {
    measureLayout();
    layout();
    if (latestMotion) paint(latestMotion);
  }
  const observer = new ResizeObserver(reposition);
  observer.observe(controls);
  observer.observe(image);
  window.addEventListener('resize', reposition);
  window.addEventListener('scroll', reposition, {passive: true});
  measureLayout();
  return {
    update,
    reposition,
    get visible() { return visible; },
    get ready() { return ready; },
    get exclusionBounds() { return index >= 0 && geometry ? exclusion : null; },
    get constrained() { return Boolean(geometry?.constrained); },
    dispose() {
      observer.disconnect();
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition);
      svg.remove();
      card.hide();
      card.element.inert = true;
    },
  };
}
