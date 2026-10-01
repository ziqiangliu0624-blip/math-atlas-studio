import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { compile, parsePlot } from '../math/engine.js'
import './Plot2D.css'

const DEFAULT_VIEW = { xmin: -10, xmax: 10, ymin: -6, ymax: 6 }
const TAU = Math.PI * 2
const MAX_SAMPLES = 2200

function safeView(candidate) {
  const value = candidate ?? DEFAULT_VIEW
  const { xmin, xmax, ymin, ymax } = value
  const width = xmax - xmin
  const height = ymax - ymin
  const scale = Math.max(1, Math.abs(xmin), Math.abs(xmax), Math.abs(ymin), Math.abs(ymax))
  if (![xmin, xmax, ymin, ymax, width, height].every(Number.isFinite)
    || width <= Math.max(1e-10, Number.EPSILON * scale * 32)
    || height <= Math.max(1e-10, Number.EPSILON * scale * 32)
    || width > 1e12 || height > 1e12 || scale > 1e12) {
    return DEFAULT_VIEW
  }
  return value
}

function niceStep(target) {
  if (!Number.isFinite(target) || target <= 0) return 1
  const power = 10 ** Math.floor(Math.log10(target))
  const scaled = target / power
  return (scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10) * power
}

function formatTick(value, step) {
  if (Math.abs(value) < step * 1e-8) return '0'
  if (Math.abs(value) >= 1e5 || Math.abs(value) < 1e-3) return value.toExponential(1)
  const precision = Math.min(8, Math.max(0, -Math.floor(Math.log10(step)) + 1))
  return Number(value.toFixed(precision)).toString()
}

function getRange(layer, parsed, variable, fallback) {
  const possibilities = [
    layer?.domain,
    layer?.domain?.[variable],
    layer?.[`${variable}Range`],
    parsed?.domain,
    parsed?.domain?.[variable],
    parsed?.[`${variable}Range`],
  ]
  for (const item of possibilities) {
    const range = Array.isArray(item) ? item : item && [item.min, item.max]
    if (range && Number.isFinite(Number(range[0])) && Number.isFinite(Number(range[1])) && Number(range[1]) > Number(range[0])) {
      return [Number(range[0]), Number(range[1])]
    }
  }
  return fallback
}

function prepareLayers(layers) {
  return (Array.isArray(layers) ? layers : []).map((layer) => {
    try {
      const parsed = parsePlot(layer.expression ?? '')
      if (parsed.error) return { layer, kind: 'error', error: parsed.error, evaluators: [] }
      const { kind, formulas = {} } = parsed
      if (kind === 'function2d') {
        const direction = typeof formulas.x === 'string' ? 'x' : 'y'
        return { layer, parsed, kind, direction, evaluators: [compile(formulas[direction])] }
      }
      if (kind === 'polar2d') return { layer, parsed, kind, evaluators: [compile(formulas.r)] }
      if (kind === 'parametric2d') return { layer, parsed, kind, evaluators: [compile(formulas.x), compile(formulas.y)] }
      return { layer, parsed, kind: 'unsupported', evaluators: [] }
    } catch (error) {
      return { layer, kind: 'error', error: error instanceof Error ? error.message : String(error), evaluators: [] }
    }
  })
}

function evaluate(fn, scope) {
  try {
    const value = Number(fn(scope))
    return Number.isFinite(value) ? value : NaN
  } catch {
    return NaN
  }
}

function drawGrid(ctx, width, height, view, palette, polar) {
  const scaleX = width / (view.xmax - view.xmin)
  const scaleY = height / (view.ymax - view.ymin)
  const toX = (x) => (x - view.xmin) * scaleX
  const toY = (y) => height - (y - view.ymin) * scaleY
  const xStep = niceStep(88 / scaleX)
  const yStep = niceStep(88 / scaleY)
  const axisX = toX(0)
  const axisY = toY(0)

  ctx.save()
  ctx.lineWidth = 1
  ctx.strokeStyle = palette.grid
  ctx.beginPath()

  if (polar) {
    const farthest = Math.max(
      Math.hypot(view.xmin, view.ymin), Math.hypot(view.xmin, view.ymax),
      Math.hypot(view.xmax, view.ymin), Math.hypot(view.xmax, view.ymax),
    )
    const radiusStep = niceStep(86 / Math.min(scaleX, scaleY))
    const rings = Math.min(80, Math.ceil(farthest / radiusStep))
    for (let i = 1; i <= rings; i += 1) {
      const radius = i * radiusStep
      ctx.moveTo(axisX + radius * scaleX, axisY)
      ctx.ellipse(axisX, axisY, radius * scaleX, radius * scaleY, 0, 0, TAU)
    }
    for (let i = 0; i < 12; i += 1) {
      const angle = i * Math.PI / 6
      const extent = farthest * 1.05
      ctx.moveTo(axisX, axisY)
      ctx.lineTo(toX(extent * Math.cos(angle)), toY(extent * Math.sin(angle)))
    }
  } else {
    const firstX = Math.ceil(view.xmin / xStep)
    const lastX = Math.floor(view.xmax / xStep)
    for (let i = firstX; i <= lastX && i - firstX < 150; i += 1) {
      const x = i * xStep
      if (Math.abs(x) < xStep * 1e-8) continue
      const px = Math.round(toX(x)) + 0.5
      ctx.moveTo(px, 0)
      ctx.lineTo(px, height)
    }
    const firstY = Math.ceil(view.ymin / yStep)
    const lastY = Math.floor(view.ymax / yStep)
    for (let i = firstY; i <= lastY && i - firstY < 150; i += 1) {
      const y = i * yStep
      if (Math.abs(y) < yStep * 1e-8) continue
      const py = Math.round(toY(y)) + 0.5
      ctx.moveTo(0, py)
      ctx.lineTo(width, py)
    }
  }
  ctx.stroke()

  ctx.strokeStyle = palette.axis
  ctx.lineWidth = 1.35
  ctx.beginPath()
  if (axisX >= 0 && axisX <= width) {
    ctx.moveTo(Math.round(axisX) + 0.5, 0)
    ctx.lineTo(Math.round(axisX) + 0.5, height)
  }
  if (axisY >= 0 && axisY <= height) {
    ctx.moveTo(0, Math.round(axisY) + 0.5)
    ctx.lineTo(width, Math.round(axisY) + 0.5)
  }
  ctx.stroke()

  ctx.font = '11px Inter, "Segoe UI", sans-serif'
  ctx.fillStyle = palette.label
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  const xLabelY = Math.min(height - 18, Math.max(7, axisY + 6))
  const firstX = Math.ceil(view.xmin / xStep)
  const lastX = Math.floor(view.xmax / xStep)
  for (let i = firstX; i <= lastX && i - firstX < 150; i += 1) {
    const x = i * xStep
    const px = toX(x)
    if (px > 22 && px < width - 22 && (Math.abs(x) >= xStep * 1e-8 || axisY < 0 || axisY > height)) {
      ctx.fillText(formatTick(x, xStep), px, xLabelY)
    }
  }
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  const yLabelX = Math.min(width - 8, Math.max(32, axisX - 7))
  const firstY = Math.ceil(view.ymin / yStep)
  const lastY = Math.floor(view.ymax / yStep)
  for (let i = firstY; i <= lastY && i - firstY < 150; i += 1) {
    const y = i * yStep
    const py = toY(y)
    if (py > 14 && py < height - 14 && Math.abs(y) >= yStep * 1e-8) {
      ctx.fillText(formatTick(y, yStep), yLabelX, py)
    }
  }
  ctx.restore()
}

function sampleLayer(entry, view, width, height, params) {
  const scaleX = width / (view.xmax - view.xmin)
  const scaleY = height / (view.ymax - view.ymin)
  const screenX = (x) => (x - view.xmin) * scaleX
  const screenY = (y) => height - (y - view.ymin) * scaleY
  const { layer, parsed, kind, evaluators } = entry
  let start, end, count, point

  if (kind === 'function2d') {
    const vertical = entry.direction === 'x'
    const viewport = vertical ? [view.ymin, view.ymax] : [view.xmin, view.xmax]
    const domain = getRange(layer, parsed, vertical ? 'y' : 'x', viewport)
    start = Math.max(viewport[0], domain[0])
    end = Math.min(viewport[1], domain[1])
    if (end <= start) return []
    count = Math.min(MAX_SAMPLES, Math.max(320, Math.ceil((vertical ? height : width) * 1.5)))
    point = (value) => {
      const result = evaluate(evaluators[0], { ...params, [vertical ? 'y' : 'x']: value })
      return vertical ? [result, value] : [value, result]
    }
  } else if (kind === 'polar2d') {
    ;[start, end] = getRange(layer, parsed, 'theta', [0, TAU])
    count = Math.min(MAX_SAMPLES, Math.max(480, Math.ceil(Math.max(width, height) * 1.6)))
    point = (theta) => {
      const r = evaluate(evaluators[0], { ...params, theta, θ: theta })
      return [r * Math.cos(theta), r * Math.sin(theta)]
    }
  } else if (kind === 'parametric2d') {
    ;[start, end] = getRange(layer, parsed, 't', [-10, 10])
    count = Math.min(MAX_SAMPLES, Math.max(480, Math.ceil(Math.max(width, height) * 1.6)))
    point = (t) => {
      const scope = { ...params, t }
      return [evaluate(evaluators[0], scope), evaluate(evaluators[1], scope)]
    }
  } else {
    return []
  }

  const points = []
  for (let i = 0; i <= count; i += 1) {
    const value = start + (end - start) * (i / count)
    const [x, y] = point(value)
    const current = Number.isFinite(x) && Number.isFinite(y) ? { x: screenX(x), y: screenY(y), value } : null
    const previous = points.at(-1)
    if (kind === 'function2d' && previous && current) {
      const distance = Math.hypot(current.x - previous.x, current.y - previous.y)
      if (distance > 24) {
        const [midX, midY] = point((previous.value + value) / 2)
        const deviation = Math.hypot(
          screenX(midX) - (current.x + previous.x) / 2,
          screenY(midY) - (current.y + previous.y) / 2,
        )
        if (!Number.isFinite(deviation) || (deviation > 12 && deviation > distance * 0.28)) current.breakBefore = true
      }
    }
    points.push(current)
  }
  return points
}

function drawLayer(ctx, entry, points, selected, width, height) {
  const color = entry.layer.color || '#4A67DE'
  const segments = []
  const maxJump = Math.max(height * 0.85, width * 0.85)
  const buildPath = () => {
    ctx.beginPath()
    let previous = null
    for (const current of points) {
      if (!current) {
        previous = null
        continue
      }
      const jump = previous && Math.hypot(current.x - previous.x, current.y - previous.y)
      if (!previous || current.breakBefore || jump > maxJump) {
        ctx.moveTo(current.x, current.y)
      } else {
        ctx.lineTo(current.x, current.y)
        if (current.x > -12 && current.x < width + 12 && current.y > -12 && current.y < height + 12) {
          segments.push([previous.x, previous.y, current.x, current.y])
        }
      }
      previous = current
    }
  }

  ctx.save()
  ctx.beginPath()
  ctx.rect(0, 0, width, height)
  ctx.clip()
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  if (selected) {
    buildPath()
    ctx.strokeStyle = color
    ctx.globalAlpha = 0.18
    ctx.lineWidth = 9
    ctx.stroke()
    ctx.globalAlpha = 1
  }
  buildPath()
  ctx.strokeStyle = color
  ctx.lineWidth = selected ? 3.2 : 2.3
  ctx.stroke()
  ctx.restore()
  return segments
}

function distanceToSegment(px, py, segment) {
  const [x1, y1, x2, y2] = segment
  const dx = x2 - x1
  const dy = y2 - y1
  const lengthSquared = dx * dx + dy * dy
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSquared))
  return Math.hypot(px - x1 - t * dx, py - y1 - t * dy)
}

export default function Plot2D({
  layers = [],
  params = {},
  selectedId = null,
  onSelectLayer,
  onStatus,
  view,
  onViewChange,
  canvasRef,
  theme = 'light',
  coordinateSystem = 'cartesian',
}) {
  const wrapperRef = useRef(null)
  const localCanvasRef = useRef(null)
  const hitSegmentsRef = useRef([])
  const dragRef = useRef(null)
  const [size, setSize] = useState({ width: 0, height: 0, dpr: 1 })
  const [internalView, setInternalView] = useState(DEFAULT_VIEW)
  const [cursor, setCursor] = useState(null)
  const currentView = safeView(view ?? internalView)
  const parsedLayers = useMemo(() => prepareLayers(layers), [layers])
  const dark = theme === 'dark' || theme?.mode === 'dark'
  const polarGrid = coordinateSystem === 'polar'
  const palette = dark
    ? { background: '#111820', grid: '#273341', axis: '#64768B', label: '#AAB9C7' }
    : { background: '#FBFCFE', grid: '#E7EBF1', axis: '#9CAAC0', label: '#69788B' }

  const attachCanvas = useCallback((node) => {
    localCanvasRef.current = node
    if (typeof canvasRef === 'function') canvasRef(node)
    else if (canvasRef && typeof canvasRef === 'object') canvasRef.current = node
  }, [canvasRef])

  const changeView = useCallback((next) => {
    if (safeView(next) !== next) return
    if (typeof onViewChange === 'function') onViewChange(next)
    else setInternalView(next)
  }, [onViewChange])

  useEffect(() => {
    const element = wrapperRef.current
    if (!element) return undefined
    const measure = () => {
      const bounds = element.getBoundingClientRect()
      const width = Math.max(1, Math.round(bounds.width))
      const height = Math.max(1, Math.round(bounds.height))
      const dpr = Math.min(3, window.devicePixelRatio || 1)
      setSize((before) => before.width === width && before.height === height && before.dpr === dpr
        ? before : { width, height, dpr })
    }
    measure()
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    observer?.observe(element)
    window.addEventListener('resize', measure)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  useEffect(() => {
    const canvas = localCanvasRef.current
    if (!canvas || !size.width || !size.height) return
    const pixelWidth = Math.round(size.width * size.dpr)
    const pixelHeight = Math.round(size.height * size.dpr)
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth
      canvas.height = pixelHeight
    }
    canvas.style.width = `${size.width}px`
    canvas.style.height = `${size.height}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0)
    ctx.fillStyle = palette.background
    ctx.fillRect(0, 0, size.width, size.height)
    drawGrid(ctx, size.width, size.height, currentView, palette, polarGrid)
    const hitSegments = []
    for (const entry of parsedLayers) {
      if (entry.layer.visible === false || entry.kind === 'error' || entry.kind === 'unsupported') continue
      const points = sampleLayer(entry, currentView, size.width, size.height, params)
      const segments = drawLayer(ctx, entry, points, entry.layer.id === selectedId, size.width, size.height)
      hitSegments.push({ id: entry.layer.id, segments })
    }
    hitSegmentsRef.current = hitSegments
  }, [size, currentView, parsedLayers, params, selectedId, dark, polarGrid])

  const pointerPosition = useCallback((event) => {
    const rect = localCanvasRef.current?.getBoundingClientRect()
    if (!rect) return null
    return { px: event.clientX - rect.left, py: event.clientY - rect.top }
  }, [])

  const reportCursor = useCallback((position) => {
    if (!position || !size.width || !size.height) return
    const x = currentView.xmin + position.px * (currentView.xmax - currentView.xmin) / size.width
    const y = currentView.ymax - position.py * (currentView.ymax - currentView.ymin) / size.height
    const next = { x, y }
    setCursor(next)
    onStatus?.({ cursor: { x, y } })
  }, [currentView, size.width, size.height, onStatus])

  const handleWheel = (event) => {
    event.preventDefault()
    const position = pointerPosition(event)
    if (!position || !size.width || !size.height) return
    const factor = Math.max(0.5, Math.min(2, Math.exp(event.deltaY * 0.0015)))
    const anchorX = currentView.xmin + position.px * (currentView.xmax - currentView.xmin) / size.width
    const anchorY = currentView.ymax - position.py * (currentView.ymax - currentView.ymin) / size.height
    const nextWidth = (currentView.xmax - currentView.xmin) * factor
    const nextHeight = (currentView.ymax - currentView.ymin) * factor
    const fx = position.px / size.width
    const fy = position.py / size.height
    changeView({
      xmin: anchorX - fx * nextWidth,
      xmax: anchorX + (1 - fx) * nextWidth,
      ymin: anchorY - (1 - fy) * nextHeight,
      ymax: anchorY + fy * nextHeight,
    })
  }

  const handlePointerDown = (event) => {
    if (event.button !== 0 && event.button !== 1) return
    const position = pointerPosition(event)
    if (!position) return
    dragRef.current = { pointerId: event.pointerId, origin: position, view: currentView, moved: false }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const handlePointerMove = (event) => {
    const position = pointerPosition(event)
    if (!position) return
    reportCursor(position)
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId || !size.width || !size.height) return
    const dx = position.px - drag.origin.px
    const dy = position.py - drag.origin.py
    if (Math.hypot(dx, dy) > 3) drag.moved = true
    if (!drag.moved) return
    const shiftX = dx * (drag.view.xmax - drag.view.xmin) / size.width
    const shiftY = dy * (drag.view.ymax - drag.view.ymin) / size.height
    changeView({
      xmin: drag.view.xmin - shiftX,
      xmax: drag.view.xmax - shiftX,
      ymin: drag.view.ymin + shiftY,
      ymax: drag.view.ymax + shiftY,
    })
  }

  const handlePointerUp = (event) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (!drag.moved && typeof onSelectLayer === 'function') {
      const position = pointerPosition(event)
      let best = { id: null, distance: 9 }
      if (position) {
        for (const item of hitSegmentsRef.current) {
          for (const segment of item.segments) {
            const distance = distanceToSegment(position.px, position.py, segment)
            if (distance < best.distance) best = { id: item.id, distance }
          }
        }
      }
      if (best.id != null) onSelectLayer(best.id)
    }
    dragRef.current = null
    event.currentTarget.releasePointerCapture?.(event.pointerId)
  }

  const handleKeyDown = (event) => {
    const key = event.key
    if (!['+', '=', '-', '_', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key)) return
    event.preventDefault()
    const spanX = currentView.xmax - currentView.xmin
    const spanY = currentView.ymax - currentView.ymin
    if (key === '+' || key === '=' || key === '-' || key === '_') {
      const factor = key === '+' || key === '=' ? 0.8 : 1.25
      const cx = (currentView.xmin + currentView.xmax) / 2
      const cy = (currentView.ymin + currentView.ymax) / 2
      changeView({ xmin: cx - spanX * factor / 2, xmax: cx + spanX * factor / 2, ymin: cy - spanY * factor / 2, ymax: cy + spanY * factor / 2 })
      return
    }
    const dx = key === 'ArrowLeft' ? -spanX * 0.1 : key === 'ArrowRight' ? spanX * 0.1 : 0
    const dy = key === 'ArrowDown' ? -spanY * 0.1 : key === 'ArrowUp' ? spanY * 0.1 : 0
    changeView({ xmin: currentView.xmin + dx, xmax: currentView.xmax + dx, ymin: currentView.ymin + dy, ymax: currentView.ymax + dy })
  }

  return (
    <div className={`plot2d ${dark ? 'plot2d--dark' : ''}`} ref={wrapperRef}>
      <canvas
        ref={attachCanvas}
        className="plot2d__canvas"
        role="img"
        aria-label="二维坐标画布。使用滚轮缩放，拖动画布平移，方向键移动视图。"
        tabIndex={0}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => { dragRef.current = null }}
        onPointerLeave={() => {
          if (!dragRef.current) {
            setCursor(null)
            onStatus?.({ cursor: null })
          }
        }}
        onKeyDown={handleKeyDown}
      />
      {cursor && <div className="plot2d__coordinate" aria-hidden="true">x {cursor.x.toFixed(2)} <span>·</span> y {cursor.y.toFixed(2)}</div>}
    </div>
  )
}
