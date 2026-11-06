const EDGE_GAP = 10;
const DRAG_THRESHOLD = 3;

/** Position and visibility only; the caller owns postcard/card layout and state. */
export function createFloatingControls({panel, onLayout}) {
  const document = panel.ownerDocument;
  const window = document.defaultView;
  const header = panel.querySelector('#controls-header');
  const handle = panel.querySelector('#controls-drag');
  const dockButton = panel.querySelector('#controls-dock');
  const hideButton = panel.querySelector('#controls-hide');
  const launcher = document.getElementById('controls-launcher');
  let disposed = false;
  let frame = 0;
  let drag = null;
  let lastFocus = handle;

  function viewport() {
    const visible = window.visualViewport;
    return {
      left: visible?.offsetLeft ?? 0,
      top: visible?.offsetTop ?? 0,
      width: visible?.width ?? window.innerWidth,
      height: visible?.height ?? window.innerHeight,
    };
  }

  function updateConstraints() {
    const view = viewport();
    panel.style.setProperty('--controls-viewport-width', `${view.width}px`);
    panel.style.setProperty('--controls-viewport-height', `${view.height}px`);
    panel.style.setProperty('--controls-dock-left', `${view.left + EDGE_GAP}px`);
    panel.style.setProperty('--controls-dock-top', `${view.top + EDGE_GAP}px`);
    launcher.style.maxWidth = `${Math.max(0, view.width - EDGE_GAP * 2)}px`;
    return view;
  }

  function place(left, top) {
    const view = viewport();
    const rect = panel.getBoundingClientRect();
    const minLeft = view.left + EDGE_GAP;
    const minTop = view.top + EDGE_GAP;
    const maxLeft = Math.max(minLeft, view.left + view.width - rect.width - EDGE_GAP);
    const maxTop = Math.max(minTop, view.top + view.height - rect.height - EDGE_GAP);
    panel.style.left = `${Math.min(maxLeft, Math.max(minLeft, left))}px`;
    panel.style.top = `${Math.min(maxTop, Math.max(minTop, top))}px`;
  }

  function placeLauncher(view) {
    const rect = launcher.getBoundingClientRect();
    launcher.style.right = 'auto';
    launcher.style.bottom = 'auto';
    launcher.style.left = `${view.left + EDGE_GAP}px`;
    launcher.style.top = `${Math.max(view.top + EDGE_GAP, view.top + view.height - rect.height - EDGE_GAP)}px`;
  }

  function clamp() {
    frame = 0;
    if (disposed) return;
    const view = updateConstraints();
    if (panel.hidden) {
      placeLauncher(view);
    } else if (panel.dataset.floating === 'true') {
      const rect = panel.getBoundingClientRect();
      place(rect.left, rect.top);
    }
  }

  function scheduleClamp() {
    if (!disposed && !frame) frame = window.requestAnimationFrame(clamp);
  }

  function notifyLayout() {
    onLayout?.();
  }

  function endDrag() {
    if (!drag) return;
    const pointerId = drag.pointerId;
    drag = null;
    delete panel.dataset.dragging;
    if (header.hasPointerCapture(pointerId)) header.releasePointerCapture(pointerId);
  }

  function pointerDown(event) {
    if (disposed || panel.hidden || drag || !event.isPrimary || event.button !== 0) return;
    const interactive = event.target.closest('button, a, input, select, textarea, summary, [contenteditable]');
    if (interactive) return;
    const rect = panel.getBoundingClientRect();
    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      left: rect.left,
      top: rect.top,
      moved: false,
    };
    header.setPointerCapture(event.pointerId);
    handle.focus({preventScroll: true});
    event.preventDefault();
  }

  function pointerMove(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    drag.moved = true;
    panel.dataset.dragging = 'true';
    panel.dataset.floating = 'true';
    place(drag.left + dx, drag.top + dy);
    notifyLayout();
    event.preventDefault();
  }

  function pointerUp(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    pointerMove(event);
    endDrag();
  }

  function pointerCancel(event) {
    if (drag?.pointerId === event.pointerId) endDrag();
  }

  function moveByKeyboard(event) {
    if (disposed || event.altKey || event.ctrlKey || event.metaKey) return;
    let dx = 0;
    let dy = 0;
    const step = event.shiftKey ? 1 : 10;
    switch (event.key) {
      case 'ArrowLeft': dx = -step; break;
      case 'ArrowRight': dx = step; break;
      case 'ArrowUp': dy = -step; break;
      case 'ArrowDown': dy = step; break;
      default: return;
    }
    event.preventDefault();
    endDrag();
    const rect = panel.getBoundingClientRect();
    panel.dataset.floating = 'true';
    place(rect.left + dx, rect.top + dy);
    notifyLayout();
  }

  function rememberFocus(event) {
    if (event.target !== hideButton && event.target !== dockButton) lastFocus = event.target;
  }

  function hide() {
    if (disposed || panel.hidden) return;
    endDrag();
    const focusedInside = panel.contains(document.activeElement);
    panel.hidden = true;
    launcher.hidden = false;
    launcher.setAttribute('aria-expanded', 'false');
    clamp();
    if (focusedInside) launcher.focus({preventScroll: true});
    notifyLayout();
  }

  function show() {
    if (disposed || !panel.hidden) return;
    panel.hidden = false;
    launcher.hidden = true;
    launcher.setAttribute('aria-expanded', 'true');
    dock();
    clamp();
    const target = panel.contains(lastFocus) && !lastFocus.disabled && lastFocus.getClientRects().length ? lastFocus : handle;
    target.focus({preventScroll: true});
  }

  function dock() {
    if (disposed) return;
    endDrag();
    panel.dataset.floating = 'false';
    panel.style.removeProperty('left');
    panel.style.removeProperty('top');
    updateConstraints();
    notifyLayout();
  }

  function viewportChanged() {
    endDrag();
    scheduleClamp();
  }

  panel.dataset.floating = panel.dataset.floating === 'true' ? 'true' : 'false';
  launcher.hidden = !panel.hidden;
  launcher.setAttribute('aria-expanded', String(!panel.hidden));
  header.addEventListener('pointerdown', pointerDown);
  header.addEventListener('pointermove', pointerMove);
  header.addEventListener('pointerup', pointerUp);
  header.addEventListener('pointercancel', pointerCancel);
  header.addEventListener('lostpointercapture', pointerCancel);
  handle.addEventListener('keydown', moveByKeyboard);
  panel.addEventListener('focusin', rememberFocus);
  hideButton.addEventListener('click', hide);
  launcher.addEventListener('click', show);
  dockButton.addEventListener('click', dock);
  window.addEventListener('resize', viewportChanged);
  window.visualViewport?.addEventListener('resize', viewportChanged);
  window.visualViewport?.addEventListener('scroll', viewportChanged);
  const observer = new window.ResizeObserver(scheduleClamp);
  observer.observe(panel);
  observer.observe(launcher);
  clamp();

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      endDrag();
      if (frame) window.cancelAnimationFrame(frame);
      observer.disconnect();
      header.removeEventListener('pointerdown', pointerDown);
      header.removeEventListener('pointermove', pointerMove);
      header.removeEventListener('pointerup', pointerUp);
      header.removeEventListener('pointercancel', pointerCancel);
      header.removeEventListener('lostpointercapture', pointerCancel);
      handle.removeEventListener('keydown', moveByKeyboard);
      panel.removeEventListener('focusin', rememberFocus);
      hideButton.removeEventListener('click', hide);
      launcher.removeEventListener('click', show);
      dockButton.removeEventListener('click', dock);
      window.removeEventListener('resize', viewportChanged);
      window.visualViewport?.removeEventListener('resize', viewportChanged);
      window.visualViewport?.removeEventListener('scroll', viewportChanged);
    },
  };
}
