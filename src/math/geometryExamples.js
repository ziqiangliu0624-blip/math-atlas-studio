const object = (name, kind, points, color = '#5368d9', extra = {}) => ({ name, geometry: { kind, points, ...extra }, color });
const label = (name, position, text) => object(name, 'text', [position], '#69788b', { text, fontSize: 16, rotation: 0 });
const base = { group: '2D · 几何', mode: '2d', aspectLocked: true, params: {}, ranges: {}, view: { xmin: -6, xmax: 8, ymin: -4, ymax: 7 } };

export const GEOMETRY_EXAMPLES = [
  { ...base, id: 'slope', title: '两点与斜率', symbol: '↗', description: '编辑两点坐标，比较线段的升高与水平距离。',
    concept: 'A(−2,−1) 到 B(4,3)，斜率为 (3+1)/(4+2)=2/3。示例对象相互独立，可分别拖动和编辑。',
    layers: [object('点 A', 'point', [[-2, -1]]), object('点 B', 'point', [[4, 3]], '#ef785b'), object('线段 AB', 'segment', [[-2, -1], [4, 3]]), label('斜率说明', [-1, 4.5], '斜率 = Δy / Δx = 2/3')] },
  { ...base, id: 'vector-addition', title: '向量的首尾相接', symbol: '⇢', description: '观察两个向量首尾相接得到的合向量。',
    concept: 'u=(3,1)，v=(1,3)，u+v=(4,4)。向量可以整体平移，分量是终点坐标减起点坐标。示例没有自动约束联动。',
    layers: [object('向量 u', 'vector', [[0, 0], [3, 1]]), object('平移后的 v', 'vector', [[3, 1], [4, 4]], '#ef785b'), object('合向量 u+v', 'vector', [[0, 0], [4, 4]], '#16a6a0'), label('向量说明', [-2, 5], '(3,1) + (1,3) = (4,4)')] },
  { ...base, id: 'transformations', title: '旋转与镜像', symbol: '⤾', description: '对照原线段，尝试绕原点旋转和镜像。',
    concept: '逆时针旋转 90° 将 (x,y) 变为 (−y,x)；沿 X 轴镜像变为 (x,−y)。选择副本后，可在属性栏输入变换。',
    layers: [object('原线段', 'segment', [[1, 1], [4, 2]]), object('旋转 90°', 'segment', [[-1, 1], [-2, 4]], '#ef785b'), object('X 轴镜像', 'segment', [[1, -1], [4, -2]], '#16a6a0'), label('变换说明', [-3, 5.5], '绕原点逆时针旋转 90°： (x,y) → (−y,x)')] },
];
