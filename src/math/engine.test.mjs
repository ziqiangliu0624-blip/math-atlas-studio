import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, findParameters, parsePlot, sample2D } from './engine.js';

test('arithmetic follows conventional precedence, associativity and implicit multiplication', () => {
  assert.equal(compile('2 + 3*4')(), 14);
  assert.equal(compile('2^3^2')(), 512);
  assert.equal(compile('-2^2')(), -4);
  assert.equal(compile('2^-2')(), 0.25);
  assert.equal(compile('2x + 3(x+1)')({ x: 2 }), 13);
});

test('functions, constants and parameters produce numeric values', () => {
  assert.ok(Math.abs(compile('a*sin(pi/2) + ln(e) + log(100)')({ a: 3 }) - 6) < 1e-12);
  assert.equal(compile('min(4,2,8) + max(4,2,8)')(), 10);
  assert.equal(compile('floor(2.9)+ceil(2.1)+round(2.6)+sign(-3)')(), 7);
  assert.ok(Math.abs(compile('r*cos(theta)')({ r: 2, theta: Math.PI }) + 2) < 1e-12);
});

test('non-finite and missing values return NaN for safe rendering', () => {
  assert.ok(Number.isNaN(compile('1/x')({ x: 0 })));
  assert.ok(Number.isNaN(compile('sqrt(-1)')()));
  assert.ok(Number.isNaN(compile('a*x')({ x: 2 })));
  assert.ok(Number.isNaN(compile('exp(1000)')()));
});

test('expressions cannot execute JavaScript or call unknown functions', () => {
  for (const expression of ['process.exit(0)', 'constructor(1)', 'x;alert(1)', 'sin()', 'sin(1,2)', '1/']) {
    assert.throws(() => compile(expression), Error, expression);
  }
});

test('plot parser identifies supported 2D and 3D forms', () => {
  assert.deepEqual(parsePlot('y = a*sin(x)').kind, 'function2d');
  assert.deepEqual(parsePlot('x = y^2').formulas, { x: 'y^2' });
  assert.deepEqual(parsePlot('r(theta) = 2*cos(theta)').kind, 'polar2d');
  assert.deepEqual(parsePlot('z = sin(x)*cos(y)').kind, 'surface3d');
  assert.deepEqual(parsePlot('x(t)=cos(t), y(t)=sin(t)').kind, 'parametric2d');
  assert.deepEqual(parsePlot('x(t)=cos(t); y(t)=sin(t); z(t)=t').kind, 'curve3d');
});

test('plot parser explains unsupported and malformed relations', () => {
  assert.match(parsePlot('y=x+').error, /表达式未写完/);
  assert.match(parsePlot('y=sin(y)').error, /变量 y/);
  assert.match(parsePlot('x^2+y^2=4').error, /暂不支持左侧/);
  assert.match(parsePlot('x(t)=t; z(t)=t').error, /完整输入/);
  assert.match(parsePlot('x(t)=t; y=t').error, /每个分量/);
  assert.match(parsePlot('r(t)=t').error, /参数应为 theta/);
});

test('free parameters exclude coordinate variables and constants', () => {
  assert.deepEqual(findParameters('y = a*sin(b*x)+c+pi'), ['a', 'b', 'c']);
  assert.deepEqual(findParameters('x(t)=a*cos(t); y(t)=a*sin(t)+b'), ['a', 'b']);
  assert.deepEqual(findParameters('z=sin(x)*cos(y)+h'), ['h']);
  assert.deepEqual(findParameters('a*sin(b*x)+c'), ['a', 'b', 'c']);
});

test('2D sampler includes endpoints and breaks at undefined values', () => {
  const points = sample2D(parsePlot('y=1/x'), {}, [-1, 1], 3);
  assert.deepEqual(points.map(point => point.valid), [true, false, true]);
  assert.deepEqual(points.map(point => point.x), [-1, 0, 1]);
  assert.deepEqual(points.map(point => point.y), [-1, NaN, 1]);
  const sideways = sample2D(parsePlot('x=y^2'), {}, [-1, 1], 3);
  assert.deepEqual(sideways.map(({ x, y }) => [x, y]), [[1, -1], [0, 0], [1, 1]]);
});
