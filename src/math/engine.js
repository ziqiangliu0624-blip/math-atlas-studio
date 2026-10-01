/** A small, deterministic expression language for plotting. User text is never JavaScript. */

const FUNCTIONS = Object.freeze({
  sin: { fn: Math.sin, min: 1, max: 1 },
  cos: { fn: Math.cos, min: 1, max: 1 },
  tan: { fn: Math.tan, min: 1, max: 1 },
  asin: { fn: Math.asin, min: 1, max: 1 },
  acos: { fn: Math.acos, min: 1, max: 1 },
  atan: { fn: Math.atan, min: 1, max: 1 },
  sqrt: { fn: Math.sqrt, min: 1, max: 1 },
  abs: { fn: Math.abs, min: 1, max: 1 },
  exp: { fn: Math.exp, min: 1, max: 1 },
  log: { fn: Math.log10, min: 1, max: 1 },
  ln: { fn: Math.log, min: 1, max: 1 },
  min: { fn: Math.min, min: 1, max: Infinity },
  max: { fn: Math.max, min: 1, max: Infinity },
  floor: { fn: Math.floor, min: 1, max: 1 },
  ceil: { fn: Math.ceil, min: 1, max: 1 },
  round: { fn: Math.round, min: 1, max: 1 },
  sign: { fn: Math.sign, min: 1, max: 1 },
});

const COORDINATES = new Set(['x', 'y', 'z', 't', 'theta', 'u', 'v', 'r']);
const MAX_TOKENS = 512;
const MAX_DEPTH = 64;

function syntax(message, position) {
  return new Error(`${message}（位置 ${position + 1}）`);
}

function tokenize(expression) {
  const source = expression.replaceAll('−', '-').replaceAll('×', '*').replaceAll('·', '*');
  const tokens = [];
  let i = 0;
  while (i < source.length) {
    if (/\s/u.test(source[i])) { i++; continue; }
    const position = i;
    const number = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(source.slice(i));
    if (number) {
      tokens.push({ type: 'number', value: Number(number[0]), position });
      i += number[0].length;
    } else {
      const identifier = /^[\p{L}_][\p{L}\p{N}_]*/u.exec(source.slice(i));
      if (identifier) {
        let name = identifier[0];
        if (name === 'π') name = 'pi';
        if (name === 'θ') name = 'theta';
        tokens.push({ type: 'identifier', value: name, position });
        i += identifier[0].length;
      } else if ('+-*/^(),'.includes(source[i])) {
        tokens.push({ type: source[i], value: source[i], position });
        i++;
      } else {
        throw syntax(`不支持的字符“${source[i]}”`, i);
      }
    }
    if (tokens.length > MAX_TOKENS) throw new Error('表达式过长，请拆分为多个图层');
  }

  // Conventional notation such as 2x, 2(x+1), and (x+1)(x-1).
  const withMultiplication = [];
  for (const token of tokens) {
    const previous = withMultiplication.at(-1);
    const leftValue = previous && (previous.type === 'number' || previous.type === 'identifier' || previous.type === ')');
    const rightValue = token.type === 'number' || token.type === 'identifier' || token.type === '(';
    const functionCall = previous?.type === 'identifier' && token.type === '(' && Object.hasOwn(FUNCTIONS, previous.value);
    const unknownCall = previous?.type === 'identifier' && token.type === '(' && previous.value.length > 1 && !COORDINATES.has(previous.value);
    if (leftValue && rightValue && !functionCall && !unknownCall) {
      withMultiplication.push({ type: '*', value: '*', position: token.position });
    }
    withMultiplication.push(token);
  }
  withMultiplication.push({ type: 'end', position: source.length });
  return withMultiplication;
}

function parseExpression(source) {
  if (typeof source !== 'string' || !source.trim()) throw new Error('请输入表达式');
  const tokens = tokenize(source);
  let index = 0;
  let depth = 0;
  const peek = () => tokens[index];
  const take = () => tokens[index++];
  const accept = type => peek().type === type ? take() : null;
  const expect = type => {
    const found = accept(type);
    if (!found) throw syntax(`应输入“${type}”`, peek().position);
    return found;
  };
  const descend = parser => {
    if (++depth > MAX_DEPTH) throw new Error('表达式嵌套过深');
    try { return parser(); } finally { depth--; }
  };

  function addition() {
    let node = multiplication();
    while (peek().type === '+' || peek().type === '-') {
      const op = take().type;
      node = { type: 'binary', op, left: node, right: multiplication() };
    }
    return node;
  }
  function multiplication() {
    let node = unary();
    while (peek().type === '*' || peek().type === '/') {
      const op = take().type;
      node = { type: 'binary', op, left: node, right: unary() };
    }
    return node;
  }
  function unary() {
    if (peek().type === '+' || peek().type === '-') {
      const op = take().type;
      return descend(() => ({ type: 'unary', op, value: unary() }));
    }
    return power();
  }
  function power() {
    let node = primary();
    if (accept('^')) node = { type: 'binary', op: '^', left: node, right: descend(unary) };
    return node;
  }
  function primary() {
    const token = take();
    if (token.type === 'number') {
      if (!Number.isFinite(token.value)) throw syntax('数字超出可计算范围', token.position);
      return { type: 'number', value: token.value };
    }
    if (token.type === 'identifier') {
      if (accept('(')) {
        const specification = Object.hasOwn(FUNCTIONS, token.value) ? FUNCTIONS[token.value] : null;
        if (!specification) throw syntax(`未知函数“${token.value}”`, token.position);
        const arguments_ = [];
        if (peek().type !== ')') {
          do { arguments_.push(descend(addition)); } while (accept(','));
        }
        expect(')');
        if (arguments_.length < specification.min || arguments_.length > specification.max) {
          throw syntax(`函数 ${token.value} 的参数个数不正确`, token.position);
        }
        return { type: 'call', name: token.value, arguments: arguments_ };
      }
      if (Object.hasOwn(FUNCTIONS, token.value)) throw syntax(`函数 ${token.value} 需要括号和参数`, token.position);
      if (token.value === 'pi') return { type: 'number', value: Math.PI };
      if (token.value === 'e') return { type: 'number', value: Math.E };
      return { type: 'variable', name: token.value };
    }
    if (token.type === '(') {
      const node = descend(addition);
      expect(')');
      return node;
    }
    throw syntax(token.type === 'end' ? '表达式未写完' : `此处不能输入“${token.value}”`, token.position);
  }

  const tree = addition();
  if (peek().type !== 'end') throw syntax(`多余的内容“${peek().value}”`, peek().position);
  return tree;
}

function walkVariables(tree, names) {
  if (tree.type === 'variable') names.add(tree.name);
  if (tree.type === 'unary') walkVariables(tree.value, names);
  if (tree.type === 'binary') { walkVariables(tree.left, names); walkVariables(tree.right, names); }
  if (tree.type === 'call') tree.arguments.forEach(item => walkVariables(item, names));
  return names;
}

function evaluate(tree, scope) {
  switch (tree.type) {
    case 'number': return tree.value;
    case 'variable': {
      const value = Object.hasOwn(scope, tree.name) ? scope[tree.name] : undefined;
      return typeof value === 'number' ? value : NaN;
    }
    case 'unary': {
      const value = evaluate(tree.value, scope);
      return tree.op === '-' ? -value : value;
    }
    case 'binary': {
      const a = evaluate(tree.left, scope);
      const b = evaluate(tree.right, scope);
      if (tree.op === '+') return a + b;
      if (tree.op === '-') return a - b;
      if (tree.op === '*') return a * b;
      if (tree.op === '/') return a / b;
      return a ** b;
    }
    case 'call': return FUNCTIONS[tree.name].fn(...tree.arguments.map(item => evaluate(item, scope)));
    default: return NaN;
  }
}

/** Compile a mathematical expression. Syntax errors throw; undefined/non-finite results become NaN. */
export function compile(expression) {
  const tree = parseExpression(expression);
  return (scope = {}) => {
    const result = evaluate(tree, scope ?? {});
    return Number.isFinite(result) ? result : NaN;
  };
}

function splitClauses(source) {
  const clauses = [];
  let start = 0;
  let depth = 0;
  for (let i = 0; i < source.length; i++) {
    const character = source[i];
    if (character === '(') depth++;
    if (character === ')') depth--;
    if (depth === 0 && (character === ';' || character === ',' || character === '\n' || character === '；' || character === '，')) {
      const clause = source.slice(start, i).trim();
      if (clause) clauses.push(clause);
      start = i + 1;
    }
  }
  const last = source.slice(start).trim();
  if (last) clauses.push(last);
  return clauses;
}

/** Parse a plot relation into component formula strings; errors are returned for display. */
export function parsePlot(source) {
  const failure = message => ({ kind: 'function2d', formulas: {}, error: message });
  if (typeof source !== 'string' || !source.trim()) return failure('请输入绘图表达式，例如 y=sin(x)');
  const clauses = splitClauses(source);
  const components = new Map();
  let parametric = false;
  const parameterized = new Set();
  for (const clause of clauses) {
    const equals = clause.indexOf('=');
    if (equals < 0) return failure(`缺少等号：${clause}`);
    const lhs = clause.slice(0, equals).replace(/\s+/gu, '');
    const expression = clause.slice(equals + 1).trim();
    const match = /^(x|y|z|r)(?:\((t|theta|θ)\))?$/u.exec(lhs);
    if (!match) return failure(`暂不支持左侧“${lhs}”；请使用 y=、x=、r=、z= 或 x(t)= 等形式`);
    const component = match[1];
    const argument = match[2];
    if (argument && !((component === 'r' && (argument === 'theta' || argument === 'θ')) || (component !== 'r' && argument === 't'))) {
      return failure(`“${lhs}”的参数应为 ${component === 'r' ? 'theta' : 't'}`);
    }
    if (components.has(component)) return failure(`重复定义了 ${component}`);
    if (!expression) return failure(`${component}= 后面需要表达式`);
    components.set(component, expression);
    if (component !== 'r' && argument === 't') { parametric = true; parameterized.add(component); }
  }
  if (parametric && [...components.keys()].some(key => !parameterized.has(key))) {
    return failure('参数曲线的每个分量都应使用 (t)，例如 x(t)=…; y(t)=…');
  }
  const keys = [...components.keys()].sort().join('');
  let kind;
  let allowed;
  if (keys === 'y' && !parametric) { kind = 'function2d'; allowed = new Set(['x']); }
  else if (keys === 'x' && !parametric) { kind = 'function2d'; allowed = new Set(['y']); }
  else if (keys === 'r') { kind = 'polar2d'; allowed = new Set(['theta']); }
  else if (keys === 'z' && !parametric) { kind = 'surface3d'; allowed = new Set(['x', 'y']); }
  else if (keys === 'xy' && parametric && clauses.length === 2) { kind = 'parametric2d'; allowed = new Set(['t']); }
  else if (keys === 'xyz' && parametric && clauses.length === 3) { kind = 'curve3d'; allowed = new Set(['t']); }
  else return failure('请完整输入一种图形：y=…、x=…、r=…、z=…、x(t)=…; y(t)=…，或再加 z(t)=…');

  const formulas = Object.fromEntries(components);
  for (const [component, expression] of components) {
    let tree;
    try { tree = parseExpression(expression); }
    catch (error) { return { kind, formulas, error: `${component}=：${error.message}` }; }
    for (const variable of walkVariables(tree, new Set())) {
      if (COORDINATES.has(variable) && !allowed.has(variable)) {
        return { kind, formulas, error: `变量 ${variable} 不能用于此类图形；可用坐标变量：${[...allowed].join('、')}` };
      }
    }
  }
  return { kind, formulas };
}

/** Return distinct free parameters, excluding coordinates, constants and function names. */
export function findParameters(source) {
  if (typeof source !== 'string' || !source.trim()) return [];
  if (!source.includes('=')) {
    try {
      return [...walkVariables(parseExpression(source), new Set())].filter(name => !COORDINATES.has(name));
    } catch { return []; }
  }
  const plot = parsePlot(source);
  if (plot.error) return [];
  const names = new Set();
  for (const formula of Object.values(plot.formulas)) {
    walkVariables(parseExpression(formula), names);
  }
  return [...names].filter(name => !COORDINATES.has(name));
}

/** Sample an explicit 2D function over a finite independent-variable interval. */
export function sample2D(plot, scope = {}, domain = [-10, 10], count = 501) {
  if (plot?.kind !== 'function2d' || plot.error) throw new Error('sample2D 仅支持有效的 2D 显式函数');
  const independent = Object.hasOwn(plot.formulas, 'y') ? 'x' : 'y';
  const dependent = independent === 'x' ? 'y' : 'x';
  const [start, end] = domain;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error('绘制范围必须是递增的有限区间');
  if (!Number.isInteger(count) || count < 2 || count > 100000) throw new Error('采样点数必须介于 2 和 100000 之间');
  const calculate = compile(plot.formulas[dependent]);
  const points = [];
  for (let i = 0; i < count; i++) {
    const input = start + (end - start) * i / (count - 1);
    const output = calculate({ ...scope, [independent]: input });
    points.push({ x: independent === 'x' ? input : output, y: independent === 'y' ? input : output, valid: Number.isFinite(output) });
  }
  return points;
}
