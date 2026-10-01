const DEFAULT_2D = [-10, 10];
const DEFAULT_3D = [-5, 5];

export function validDomainPair(value) {
  return Array.isArray(value) && value.length === 2 &&
    value.every(Number.isFinite) && value[1] > value[0];
}

export function domainPair(domain, axis, fallback = DEFAULT_2D) {
  const value = Array.isArray(domain) ? domain : domain?.[axis];
  return validDomainPair(value) ? [...value] : [...fallback];
}

export function normalizeDomain(domain, kind) {
  if (kind === 'surface3d') {
    const within3dLimit = pair => pair.every(value => Math.abs(value) <= 1000);
    const sharedCandidate = domainPair(domain, 'x', DEFAULT_3D);
    const shared = within3dLimit(sharedCandidate) ? sharedCandidate : [...DEFAULT_3D];
    const xCandidate = domainPair(domain, 'x', shared);
    const yCandidate = domainPair(domain, 'y', shared);
    return {
      x: within3dLimit(xCandidate) ? xCandidate : [...shared],
      y: within3dLimit(yCandidate) ? yCandidate : [...shared],
    };
  }
  const axis = kind === 'curve3d' || kind === 'parametric2d' ? 't' :
    kind === 'polar2d' ? 'theta' : 'x';
  const pair = domainPair(domain, axis, kind === 'curve3d' ? DEFAULT_3D : DEFAULT_2D);
  return kind === 'curve3d' && pair.some(value => Math.abs(value) > 1000) ? [...DEFAULT_3D] : pair;
}

export function withSurfaceAxis(domain, axis, pair) {
  if (axis !== 'x' && axis !== 'y') throw new Error('只能调整 X 或 Y 轴范围');
  if (!validDomainPair(pair)) throw new Error('绘制范围必须是递增的有限区间');
  const next = normalizeDomain(domain, 'surface3d');
  return { ...next, [axis]: [...pair] };
}
