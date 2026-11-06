const ALPHA_THRESHOLD = 64;
const AUTOMATIC_ALPHA_THRESHOLD = 160;
const HISTORY_MS = 100;
const HISTORY_LIMIT = 48;
const APPROACH_PIXELS = 6;

/**
 * Synchronously sample the already-decoded masks once, then track primary mouse
 * input without a frame loop. Coordinates x/y are mask-local; entryX/entryY
 * are viewport CSS pixels. dx/dy is the inverse, unit-length mouse approach.
 *
 * capture(index, event) returns a contact without changing hover or notifying
 * callbacks; a click in a target's letter gap snaps to its nearest ink pixel.
 * createAutomaticContact(index) samples cached facing-edge ink once; its frozen
 * mask-local anchor and 25–65 degree exit remain caller-owned until replaced.
 * reset() silently clears hover/history; dispose() also removes all listeners.
 * The caller owns touch/keyboard fallbacks, hover intent and delayed closing.
 */
export function createPointerInput({image, images, scene, motion, onEnter, onLeave, contactError}) {
  const document = image.ownerDocument;
  const window = document.defaultView;
  const container = image.parentElement;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', {willReadFrequently: true});
  if (!context) throw new Error('Pointer input requires a 2D canvas context.');
  const masks = images.map(({mask}, index) => {
    const {width, height} = scene.occurrences[index].bounds;
    canvas.width = width;
    canvas.height = height;
    context.drawImage(mask, 0, 0);
    const rgba = context.getImageData(0, 0, width, height).data;
    const alpha = new Uint8Array(width * height);
    for (let pixel = 0; pixel < alpha.length; pixel++) alpha[pixel] = rgba[pixel * 4 + 3];
    return {width, height, alpha};
  });
  // Only alpha planes survive initialization, not canvas pixel buffers/textures.
  canvas.width = canvas.height = 0;

  let activeIndex = -1;
  let activeContact = null;
  let disposed = false;
  const history = [];

  function rectangle() {
    const rect = image.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 ? rect : null;
  }

  function local(index, clientX, clientY, rect, original = false) {
    const bounds = scene.occurrences[index].bounds;
    const offset = index * 3;
    const moving = !original && motion.states[offset] > 0;
    const scale = moving ? motion.states[offset + 1] : 1;
    const lift = moving ? motion.states[offset + 2] : 0;
    return {
      x: ((clientX - rect.left) * scene.imageWidth / rect.width - bounds.x - bounds.width / 2) / scale + bounds.width / 2,
      y: ((clientY - rect.top) * scene.imageHeight / rect.height - bounds.y - bounds.height / 2 - lift) / scale + bounds.height / 2,
    };
  }

  function within(index, point) {
    const {width, height} = masks[index];
    return point.x >= 0 && point.y >= 0 && point.x < width && point.y < height;
  }

  function inRegion(index, x, y, rect) {
    return within(index, local(index, x, y, rect, true)) || within(index, local(index, x, y, rect));
  }

  // Exact grid traversal after clipping: even a short diagonal intersection
  // with a one-pixel stroke is detected, without sampling the GPU at runtime.
  function sweep(index, from, to) {
    const {width, height, alpha} = masks[index];
    const dx = to.x - from.x, dy = to.y - from.y;
    let start = 0, end = 1;
    for (const [position, delta, size] of [[from.x, dx, width], [from.y, dy, height]]) {
      if (delta === 0) {
        if (position < 0 || position >= size) return null;
      } else {
        const a = -position / delta, b = (size - position) / delta;
        start = Math.max(start, Math.min(a, b));
        end = Math.min(end, Math.max(a, b));
        if (start > end) return null;
      }
    }
    // Step just inside the clipped boundary, never changing which pixel is hit.
    const epsilon = 1e-7 / Math.max(1, Math.abs(dx), Math.abs(dy));
    const inside = Math.min(end, start + epsilon);
    let x = Math.floor(from.x + dx * inside), y = Math.floor(from.y + dy * inside);
    const stepX = Math.sign(dx), stepY = Math.sign(dy);
    let nextX = dx === 0 ? Infinity : ((stepX > 0 ? x + 1 : x) - from.x) / dx;
    let nextY = dy === 0 ? Infinity : ((stepY > 0 ? y + 1 : y) - from.y) / dy;
    const deltaX = dx === 0 ? Infinity : 1 / Math.abs(dx);
    const deltaY = dy === 0 ? Infinity : 1 / Math.abs(dy);
    let t = start;
    while (x >= 0 && y >= 0 && x < width && y < height && t <= end) {
      if (alpha[y * width + x] >= ALPHA_THRESHOLD) {
        const hitT = Math.min(end, t + epsilon);
        return {x: from.x + dx * hitT, y: from.y + dy * hitT, t: hitT};
      }
      const next = Math.min(nextX, nextY);
      if (next > end || next === Infinity) break;
      if (nextX === next) { x += stepX; nextX += deltaX; }
      if (nextY === next) { y += stepY; nextY += deltaY; }
      t = next;
    }
    return null;
  }

  function prune(time) {
    if (history.length && (time < history[history.length - 1].time || time - history[history.length - 1].time > HISTORY_MS)) {
      history.length = 0;
    }
    while (history.length && time - history[0].time > HISTORY_MS) history.shift();
  }

  function contact(index, hit, entryX, entryY, time, pointerX = entryX, pointerY = entryY, event = null) {
    let dx = 0, dy = 0;
    // Use several pixels of history, not only the final (possibly one-pixel)
    // event delta. Do not use samples newer than a swept intersection.
    for (let sample = history.length - 1; sample >= 0; sample--) {
      const previous = history[sample];
      if (previous.time > time) continue;
      dx = previous.x - pointerX;
      dy = previous.y - pointerY;
      if (Math.hypot(dx, dy) >= APPROACH_PIXELS) break;
    }
    let length = Math.hypot(dx, dy);
    let approachKnown = length > 0.01;
    // Native movement can retain real approach information after reset or a
    // stale history gap. Its units are not reliably CSS pixels, so use only
    // its direction: never manufacture a previous position or sweep origin.
    if (!approachKnown && Number.isFinite(event?.movementX) && Number.isFinite(event?.movementY)) {
      const nativeLength = Math.hypot(event.movementX, event.movementY);
      if (nativeLength > 0) {
        dx = -event.movementX;
        dy = -event.movementY;
        length = nativeLength;
        approachKnown = true;
      }
    }
    if (approachKnown) { dx /= length; dy /= length; }
    else {
      dx = 0;
      const bounds = scene.occurrences[index].bounds;
      const offset = index * 3;
      const scale = motion.states[offset] > 0 ? motion.states[offset + 1] : 1;
      const lift = motion.states[offset] > 0 ? motion.states[offset + 2] : 0;
      const sourceY = bounds.y + bounds.height / 2 + (hit.y - bounds.height / 2) * scale + lift;
      const protection = scene.protectedBounds;
      const top = protection ? protection.y : 0;
      const bottom = protection ? protection.y + protection.height : scene.imageHeight;
      dy = Math.abs(sourceY - top) <= Math.abs(bottom - sourceY) ? -1 : 1;
    }
    return Object.freeze({mode: 'pointer', index, x: hit.x, y: hit.y, dx, dy, entryX, entryY, approachKnown});
  }

  function leave() {
    if (activeIndex < 0) return;
    activeIndex = -1;
    activeContact = null;
    onLeave();
  }

  function move(event) {
    if (disposed || event.pointerType !== 'mouse' || event.isPrimary === false) return;
    const time = event.timeStamp;
    prune(time);
    const x = event.clientX, y = event.clientY;
    const previous = history[history.length - 1];
    const rect = rectangle();
    const inside = container.contains(event.target);
    if (!inside || !rect) leave();
    else if (activeIndex < 0 || !inRegion(activeIndex, x, y, rect)) {
      const departed = activeIndex;
      leave();
      let best = null;
      const selected = motion.selectedIndex;
      // Renderer draws selected last, then other layers in index order.
      // Prefer endpoint ink, then a touched word containing the endpoint, over
      // transient crossings. Persistent candidates win front-to-back; only
      // fully crossed words compete by earliest intersection along the sweep.
      for (let layer = masks.length; layer >= 0; layer--) {
        const index = layer === masks.length ? selected : layer;
        if (index < 0 || index >= masks.length || (layer !== masks.length && index === selected)) continue;
        // The outgoing segment must not re-enter the word we just left.
        if (index === departed) continue;
        const to = local(index, x, y, rect);
        const from = previous ? local(index, previous.x, previous.y, rect) : to;
        const hit = sweep(index, from, to);
        if (!hit) continue;
        const priority = sweep(index, to, to) ? 2 : inRegion(index, x, y, rect) ? 1 : 0;
        if (!best || priority > best.priority ||
            (priority === 0 && best.priority === 0 && hit.t < best.hit.t - 1e-8)) {
          best = {index, hit, priority};
        }
        // This is the frontmost endpoint ink; retain its swept entry anchor.
        if (priority === 2) break;
      }
      if (best) {
        const t = best.hit.t;
        const entryX = previous ? previous.x + (x - previous.x) * t : x;
        const entryY = previous ? previous.y + (y - previous.y) * t : y;
        const entryTime = previous ? previous.time + (time - previous.time) * t : time;
        activeIndex = best.index;
        activeContact = contact(best.index, best.hit, entryX, entryY, entryTime, entryX, entryY, event);
        onEnter(activeIndex, activeContact);
        // A fast event can cross the entire word: report the real contact, but
        // do not leave a hover stuck outside its region until the next event.
        if (activeIndex >= 0 && !inRegion(activeIndex, x, y, rect)) leave();
      }
    }
    history.push({x, y, time});
    if (history.length > HISTORY_LIMIT) history.shift();
  }

  function capture(index, event) {
    if (disposed || index < 0 || index >= masks.length) return null;
    if (activeIndex === index) return activeContact;
    if (!event || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY) || !container.contains(event.target)) return null;
    const rect = rectangle();
    if (!rect) return null;
    prune(event.timeStamp);
    const x = event.clientX, y = event.clientY;
    const point = local(index, x, y, rect);
    let hit = sweep(index, point, point);
    if (!hit) {
      // Only an actual accessible target (or its descendants), not arbitrary
      // postcard whitespace, permits the native-click inter-letter fallback.
      const target = event.target.closest?.('button, [role="button"]');
      if (!target || !container.contains(target) || !inRegion(index, x, y, rect)) return null;
      const {width, height, alpha} = masks[index];
      let nearest = Infinity;
      for (let py = 0; py < height; py++) {
        for (let px = 0; px < width; px++) {
          if (alpha[py * width + px] < ALPHA_THRESHOLD) continue;
          const distance = (px + 0.5 - point.x) ** 2 + (py + 0.5 - point.y) ** 2;
          if (distance < nearest) {
            nearest = distance;
            hit = {x: px + 0.5, y: py + 0.5};
          }
        }
      }
    }
    if (!hit) return null;
    const bounds = scene.occurrences[index].bounds;
    const offset = index * 3;
    const moving = motion.states[offset] > 0;
    const scale = moving ? motion.states[offset + 1] : 1;
    const lift = moving ? motion.states[offset + 2] : 0;
    const entryX = rect.left + (bounds.x + bounds.width / 2 + (hit.x - bounds.width / 2) * scale) * rect.width / scene.imageWidth;
    const entryY = rect.top + (bounds.y + bounds.height / 2 + (hit.y - bounds.height / 2) * scale + lift) * rect.height / scene.imageHeight;
    // A gap click anchors to real ink, but its direction still comes from the
    // physical pointer path, never from the artificial snapping displacement.
    return contact(index, hit, entryX, entryY, event.timeStamp, x, y, event);
  }

  function createAutomaticContact(index) {
    if (disposed || index < 0 || index >= masks.length) return null;
    const {width, height, alpha} = masks[index];
    const above = Math.random() < 0.5;
    const firstColumn = Math.floor(Math.random() * width);
    for (let column = 0; column < width; column++) {
      const pixelX = (firstColumn + column) % width;
      for (let row = 0; row < height; row++) {
        const pixelY = above ? row : height - 1 - row;
        if (alpha[pixelY * width + pixelX] < AUTOMATIC_ALPHA_THRESHOLD) continue;
        const x = pixelX + 0.5, y = pixelY + 0.5;
        const occurrence = scene.occurrences[index];
        const bounds = occurrence.bounds;
        const peakScale = occurrence.peakScale ?? motion.defaultPeakScale;
        const rect = image.getBoundingClientRect();
        const viewportX = rect.left + (bounds.x + bounds.width / 2 +
          (x - bounds.width / 2) * peakScale) * rect.width / scene.imageWidth;
        const viewportWidth = document.documentElement.clientWidth;
        const sign = viewportX < viewportWidth * 0.3 ? 1
          : viewportX > viewportWidth * 0.7 ? -1 : Math.random() < 0.5 ? -1 : 1;
        const angle = (25 + Math.random() * 40) * Math.PI / 180;
        return Object.freeze({
          mode: 'automatic', index, x, y,
          dx: sign * Math.sin(angle), dy: (above ? -1 : 1) * Math.cos(angle),
          approachKnown: false,
        });
      }
    }
    throw new Error(contactError);
  }

  function reset() {
    activeIndex = -1;
    activeContact = null;
    history.length = 0;
  }
  function exit() { history.length = 0; leave(); }
  function pointerOut(event) {
    if (event.pointerType === 'mouse' && event.relatedTarget === null) exit();
  }
  function cancel(event) {
    if (event.pointerType === 'mouse') exit();
  }
  function visibility() { if (document.hidden) exit(); }
  const options = {capture: true, passive: true};
  document.addEventListener('pointermove', move, options);
  document.addEventListener('pointerout', pointerOut, options);
  document.addEventListener('pointercancel', cancel, options);
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('blur', exit);
  window.addEventListener('resize', exit);

  return {
    get currentIndex() { return activeIndex; },
    get currentContact() { return activeContact; },
    capture,
    createAutomaticContact,
    reset,
    dispose() {
      if (disposed) return;
      disposed = true;
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('pointerout', pointerOut, true);
      document.removeEventListener('pointercancel', cancel, true);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('blur', exit);
      window.removeEventListener('resize', exit);
      reset();
    },
  };
}
