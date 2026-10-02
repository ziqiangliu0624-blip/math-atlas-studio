export function createHistory() {
  return { past: [], future: [], group: null };
}

export function finishGroup(history) { history.group = null; }

export function recordHistory(history, snapshot, options = {}, now = Date.now()) {
  const same = options.group && history.group?.key === options.group &&
    (history.group.hold || now - history.group.time <= 800);
  if (!same) history.past = [...history.past.slice(-79), snapshot];
  history.future = [];
  history.group = options.group ? { key: options.group, time: now, hold: options.hold === true } : null;
  return !same;
}
