import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGeometry, transformGeometry, clipInfiniteLine, exportDimensions, containExportView } from './geometry.js';
import { normalizeProject } from './project.js';
import { probeSignature } from './view.js';

const near = (actual, expected) => actual.forEach((p, i) => p.forEach((n, j) => assert.ok(Math.abs(n - expected[i][j]) < 1e-8, `${actual} ≠ ${expected}`)));
test('geometry validates point counts, finite bounds and distinct line anchors', () => {
  assert.throws(() => normalizeGeometry({ kind: 'line', points: [[1, 1], [1, 1]] }), /不同/);
  for (const value of [NaN, Infinity, 1e10]) assert.throws(() => normalizeGeometry({ kind: 'point', points: [[value, 0]] }));
  assert.throws(() => normalizeGeometry({ kind: 'point', points: [[0, 0], [1, 1]] }));
  assert.throws(() => normalizeGeometry({ kind: 'text', points: [[0, 0]], text: '<'.repeat(501) }));
  assert.deepEqual(normalizeGeometry({ kind: 'vector', points: [[0, 0], [0, 0]] }).points, [[0, 0], [0, 0]]);
});
test('rotation, translation, scaling and mirroring preserve coordinate mathematics', () => {
  const g = { kind: 'segment', points: [[1, 1], [4, 2]] };
  near(transformGeometry(g, { kind: 'rotate', angle: 90 }).points, [[-1, 1], [-2, 4]]);
  near(transformGeometry(g, { kind: 'scale', factor: 2, pivot: [1, 1] }).points, [[1, 1], [7, 3]]);
  near(transformGeometry(g, { kind: 'translate', dx: -3, dy: 5 }).points, [[-2, 6], [1, 7]]);
  near(transformGeometry(g, { kind: 'mirrorX', pivot: [0, 2] }).points, [[1, 3], [4, 2]]);
  near(transformGeometry(transformGeometry(g, { kind: 'mirrorY' }), { kind: 'mirrorY' }).points, g.points);
  near(transformGeometry(g, { kind: 'rotate', angle: 360, pivot: [2, 3] }).points, g.points);
  assert.throws(() => transformGeometry(g, { kind: 'scale', factor: 0 }));
  assert.throws(() => transformGeometry(g, { kind: 'translate', dx: NaN }));
});
test('text transformations retain readable size and update orientation', () => {
  const g = normalizeGeometry({ kind: 'text', points: [[2, 1]], text: '<script>字</script>', rotation: -90 });
  assert.equal(g.rotation, 270);
  const mirrored = transformGeometry(g, { kind: 'mirrorX' });
  assert.equal(mirrored.reflected, true);
  assert.deepEqual(transformGeometry(mirrored, { kind: 'mirrorX' }), g);
  assert.equal(transformGeometry(g, { kind: 'rotate', angle: 90 }).rotation, 0);
  assert.equal(transformGeometry(g, { kind: 'scale', factor: 10 }).fontSize, 96);
});
test('infinite lines clip horizontal, vertical, diagonal and outside cases', () => {
  const view = { xmin: -2, xmax: 2, ymin: -1, ymax: 1 };
  near(clipInfiniteLine([[0, 0], [0, 1]], view), [[0, -1], [0, 1]]);
  near(clipInfiniteLine([[0, 0], [1, 0]], view), [[-2, 0], [2, 0]]);
  near(clipInfiniteLine([[0, 0], [1, 1]], view), [[-1, -1], [1, 1]]);
  assert.equal(clipInfiniteLine([[5, 0], [5, 1]], view), null);
  assert.equal(clipInfiniteLine([[0, 0], [0, 0]], view), null);
});
test('version 1 migrates and version 2 round-trips mixed geometry and expressions', () => {
  const old = { schemaVersion: 1, layers: [{ id: 'a', expression: 'y=a*sin(x)', domain: [-2, 3] }] };
  const migrated = normalizeProject(old);
  assert.equal(migrated.schemaVersion, 2); assert.equal(migrated.layers[0].type, 'expression'); assert.equal(migrated.params.a, 1);
  const mixed = { ...migrated, layers: [...migrated.layers, { id: 'g', type: 'geometry', name: '向量', color: '#16a6a0', locked: true, opacity: .5, geometry: { kind: 'vector', points: [[1, 2], [4, 6]] } }] };
  const normalized = normalizeProject(mixed);
  assert.deepEqual(normalizeProject(JSON.parse(JSON.stringify(normalized))), normalized);
  assert.equal(normalized.layers[1].locked, true);
  assert.throws(() => normalizeProject({ ...old, layers: [old.layers[0], old.layers[0]] }), /重复/);
  assert.throws(() => normalizeProject({ ...old, layers: [{ type: 'unknown' }] }), /类型/);
  assert.throws(() => normalizeProject({ ...old, schemaVersion: 99 }));
});
test('geometry probes only invalidate when geometry changes', () => {
  const layer = { type: 'geometry', geometry: { kind: 'point', points: [[1, 2]] } };
  assert.equal(probeSignature(layer, { a: 1 }), probeSignature(layer, { a: 2 }));
  assert.notEqual(probeSignature(layer, {}), probeSignature({ ...layer, geometry: { kind: 'point', points: [[2, 2]] } }, {}));
});
test('PNG export validates size and total pixel allocation before rendering', () => {
  assert.deepEqual(exportDimensions({ width: 800, height: 600, scale: 2, transparent: true }, {}), { width: 800, height: 600, scale: 2, pixelWidth: 1600, pixelHeight: 1200, transparent: true });
  for (const options of [{ width: 10, height: 600 }, { width: 800.5, height: 600 }, { width: 800, height: 600, scale: 0 }, { width: 8192, height: 8192 }, { width: 8192, height: 64, scale: 2 }]) assert.throws(() => exportDimensions(options, {}));
});

test('export contains the viewport and preserves current screen proportions', () => {
  const view = { xmin: -10, xmax: 10, ymin: -4, ymax: 4 };
  assert.deepEqual(containExportView(view, { width: 800, height: 600 }, { width: 1600, height: 1200 }), view);
  const result = containExportView(view, { width: 800, height: 600 }, { width: 400, height: 600 });
  assert.deepEqual(result, { xmin: -10, xmax: 10, ymin: -8, ymax: 8 });
});
