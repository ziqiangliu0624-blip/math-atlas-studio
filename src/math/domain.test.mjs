import test from 'node:test';
import assert from 'node:assert/strict';
import { domainPair, normalizeDomain, withSurfaceAxis } from './domain.js';

test('legacy shared surface range becomes independent X and Y ranges', () => {
  assert.deepEqual(normalizeDomain([-5, 5], 'surface3d'), { x: [-5, 5], y: [-5, 5] });
});

test('editing one surface axis preserves the other through normalization', () => {
  const domain = withSurfaceAxis([-5, 5], 'x', [-3, 8]);
  assert.deepEqual(domain, { x: [-3, 8], y: [-5, 5] });
  const withY = withSurfaceAxis(domain, 'y', [1, 6]);
  assert.deepEqual(withY, { x: [-3, 8], y: [1, 6] });
  assert.deepEqual(normalizeDomain(withY, 'surface3d'), withY);
  assert.deepEqual(domainPair(withY, 'x'), [-3, 8]);
});

test('invalid saved axis range does not affect a valid other axis', () => {
  assert.deepEqual(normalizeDomain({ x: [4, 4], y: [-2, 7] }, 'surface3d'),
    { x: [-5, 5], y: [-2, 7] });
});
