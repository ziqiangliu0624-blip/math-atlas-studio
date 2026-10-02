import test from 'node:test';
import assert from 'node:assert/strict';
import { validView, equalAspect, normalizeStyle, normalizeBox, normalizeProbes, probeSignature } from './view.js';
import { createHistory, recordHistory, finishGroup } from '../interaction/history.js';

test('view ranges reject unusable spans and contain a rectangle at equal scale', () => {
  const view = { xmin: -2, xmax: 2, ymin: -1, ymax: 1 };
  assert.equal(validView(view), true);
  for (const xmax of [NaN, Infinity, -2, -2 + 1e-12, 1e13]) assert.equal(validView({ ...view, xmax }), false);
  const result = equalAspect(view, { width: 300, height: 500 }, true);
  assert.ok(result.xmin <= view.xmin && result.xmax >= view.xmax && result.ymin <= view.ymin && result.ymax >= view.ymax);
  assert.ok(Math.abs((result.xmax - result.xmin) / 300 - (result.ymax - result.ymin) / 500) < 1e-12);
  assert.equal(equalAspect(view, { width: 300, height: 500 }, false), view);
});

test('old settings receive defaults and invalid imported styles are bounded', () => {
  assert.deepEqual(normalizeStyle(), { lineWidth: 2.3, lineStyle: 'solid', opacity: 1, locked: false });
  assert.deepEqual(normalizeStyle({ lineWidth: 50, opacity: -1, lineStyle: 'invalid', locked: 'yes' }), { lineWidth: 12, opacity: 0, lineStyle: 'solid', locked: false });
  assert.deepEqual(normalizeBox({ x: [-2, 4], y: [2, 2], z: [-1e4, 3] }), { x: [-2, 4], y: [-6, 6], z: [-6, 6] });
});

test('probe signatures change with geometry and parameters, not appearance', () => {
  const layer = { id: 'a', expression: 'y = a*x', domain: [-2, 2], color: '#123456' };
  assert.equal(probeSignature(layer, { a: 1 }), probeSignature({ ...layer, opacity: .2, color: '#654321' }, { a: 1 }));
  assert.notEqual(probeSignature(layer, { a: 1 }), probeSignature(layer, { a: 2 }));
  assert.notEqual(probeSignature(layer, {}), probeSignature({ ...layer, domain: [0, 2] }, {}));
  assert.deepEqual(normalizeProbes({ '3d': { point: { x: 1, y: 2, z: 3 } }, '2d': { layerId: 'missing', point: { x: 1, y: 2 } } }, [layer]), {});
});

test('one long held gesture keeps its starting snapshot; new gestures and discrete edits split history', () => {
  const history = createHistory();
  recordHistory(history, 'before-drag', { group: 'drag', hold: true }, 0);
  recordHistory(history, 'during-drag', { group: 'drag', hold: true }, 5000);
  assert.deepEqual(history.past, ['before-drag']);
  finishGroup(history);
  recordHistory(history, 'after-drag', { group: 'drag' }, 5010);
  recordHistory(history, 'before-delete', {}, 5020);
  assert.deepEqual(history.past, ['before-drag', 'after-drag', 'before-delete']);
});

test('typing and wheel bursts coalesce only inside their idle window and invalidate redo', () => {
  const history = createHistory();
  history.future = ['old-redo'];
  recordHistory(history, 'original', { group: 'text' }, 100);
  recordHistory(history, 'first-letter', { group: 'text' }, 500);
  recordHistory(history, 'pause', { group: 'text' }, 1400);
  recordHistory(history, 'new-wheel', { group: 'wheel' }, 1500);
  assert.deepEqual(history.past, ['original', 'pause', 'new-wheel']);
  assert.deepEqual(history.future, []);
});
