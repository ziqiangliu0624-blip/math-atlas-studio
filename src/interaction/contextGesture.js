/** Keep native Windows contextmenu timing separate from a completed right click. */
export function bindContextGesture(element, { onOpen, onStart = () => {}, capturePointer = true }) {
  let press = null;
  let suppressMouseMenu = false;
  const ownerWindow = element.ownerDocument.defaultView;
  const cancel = () => { press = null; suppressMouseMenu = true; };
  const down = event => {
    onStart();
    if (event.button !== 2) { cancel(); return; }
    suppressMouseMenu = true;
    press = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
    element.focus({ preventScroll: true });
    if (capturePointer) element.setPointerCapture?.(event.pointerId);
  };
  const move = event => {
    if (press?.pointerId !== event.pointerId) return;
    for (const sample of [event, ...(event.getCoalescedEvents?.() || [])]) {
      if (Math.hypot(sample.clientX - press.x, sample.clientY - press.y) > 5) press.moved = true;
    }
  };
  const up = event => {
    if (press?.pointerId !== event.pointerId) return;
    move(event);
    const open = !press.moved;
    press = null;
    if (capturePointer && element.hasPointerCapture?.(event.pointerId)) element.releasePointerCapture(event.pointerId);
    if (open) onOpen({ clientX: event.clientX, clientY: event.clientY, keyboard: false });
  };
  const context = event => {
    event.preventDefault();
    // Keyboard shortcuts are handled below; mouse events may fire on either down or up.
    if (!press && !suppressMouseMenu) onOpen({ clientX: event.clientX, clientY: event.clientY, keyboard: false });
  };
  const key = event => {
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = element.getBoundingClientRect();
    onOpen({ clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, keyboard: true });
  };
  const listeners = [
    ['pointerdown', down], ['pointermove', move], ['pointerup', up],
    ['pointercancel', cancel], ['lostpointercapture', cancel], ['contextmenu', context], ['keydown', key],
  ];
  for (const [name, handler] of listeners) element.addEventListener(name, handler, true);
  ownerWindow.addEventListener('blur', cancel);
  return () => {
    for (const [name, handler] of listeners) element.removeEventListener(name, handler, true);
    ownerWindow.removeEventListener('blur', cancel);
  };
}
