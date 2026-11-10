// 水槽の背景・岩・流木・水草・ガラス・光の表現。
// 動かない部分はオフスクリーン canvas に1回だけ描き、水草のゆらぎ・コースティクス・水面だけ毎フレーム描く。

export interface TankLayout {
  w: number
  h: number
  /** 上のフタ（照明）の高さ */
  lidH: number
  /** 水面の y */
  waterY: number
  /** 底砂の手前のふち（ガラス越しの断面との境目）の y */
  frontY: number
  /** 底に着いた餌が止まる y */
  restY: number
}

export function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}

export function computeLayout(w: number, h: number): TankLayout {
  const lidH = 56
  const waterY = lidH + 16
  const crossH = clamp(h * 0.07, 28, 56)
  const frontY = h - crossH
  return { w, h, lidH, waterY, frontY, restY: frontY - 7 }
}

/** 底砂の奥側の輪郭（左の岩組の下が少し盛り上がる） */
export function contourY(L: TankLayout, x: number) {
  const u = x / L.w
  const H = L.frontY - L.waterY
  const mound =
    0.05 * Math.exp(-(((u - 0.3) / 0.2) ** 2)) + 0.035 * Math.exp(-(((u - 0.8) / 0.16) ** 2))
  return L.frontY - H * (0.045 + mound)
}

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function makeLayer(L: TankLayout, dpr: number) {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(L.w * dpr))
  c.height = Math.max(1, Math.round(L.h * dpr))
  const ctx = c.getContext('2d')!
  ctx.scale(dpr, dpr)
  return { c, ctx }
}

type RGB = [number, number, number]
const mix = (a: RGB, b: RGB, t: number): RGB => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
]
const rgb = (c: RGB, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`

// ---------------------------------------------------------------------------
// 水草の定義
// ---------------------------------------------------------------------------
interface Ribbon {
  kind: 'ribbon'
  x: number
  y: number
  len: number
  width: number
  ang: number
  bend: number
  phase: number
  sway: number
  c1: string
  c2: string
}

interface StemBunch {
  kind: 'stem'
  stems: {
    x: number
    y: number
    len: number
    ang: number
    bend: number
    phase: number
    leaf: number
  }[]
  base: RGB
  tip: RGB
}

interface Sword {
  kind: 'sword'
  x: number
  y: number
  leaves: { ang: number; len: number; width: number; phase: number; bend: number }[]
  c1: string
  c2: string
}

type Plant = Ribbon | StemBunch | Sword

function vallisneria(
  rand: () => number,
  x: number,
  y: number,
  count: number,
  minLen: number,
  maxLen: number,
  palette: [string, string][],
): Ribbon[] {
  const out: Ribbon[] = []
  for (let i = 0; i < count; i++) {
    const [c1, c2] = palette[Math.floor(rand() * palette.length)]
    out.push({
      kind: 'ribbon',
      x: x + (rand() - 0.5) * 16,
      y: y + rand() * 3,
      len: minLen + rand() * (maxLen - minLen),
      width: 4.5 + rand() * 3.5,
      ang: (rand() - 0.5) * 0.5,
      bend: (rand() - 0.5) * 0.7,
      phase: rand() * Math.PI * 2,
      sway: 0.16 + rand() * 0.12,
      c1,
      c2,
    })
  }
  // 長い葉を奥に
  return out.sort((a, b) => b.len - a.len)
}

function stemBunch(
  rand: () => number,
  x: number,
  y: number,
  count: number,
  minLen: number,
  maxLen: number,
  base: RGB,
  tip: RGB,
): StemBunch {
  const stems = []
  for (let i = 0; i < count; i++) {
    stems.push({
      x: x + (rand() - 0.5) * 26,
      y: y + rand() * 4,
      len: minLen + rand() * (maxLen - minLen),
      ang: (rand() - 0.5) * 0.4,
      bend: (rand() - 0.5) * 0.4,
      phase: rand() * Math.PI * 2,
      leaf: 7 + rand() * 3,
    })
  }
  return { kind: 'stem', stems, base, tip }
}

function sword(
  rand: () => number,
  x: number,
  y: number,
  count: number,
  len: number,
  width: number,
  c1: string,
  c2: string,
  spread = 1.1,
): Sword {
  const leaves = []
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1)
    const ang = (t - 0.5) * 2 * spread + (rand() - 0.5) * 0.15
    leaves.push({
      ang,
      len: len * (0.75 + rand() * 0.35) * (1 - Math.abs(ang) * 0.18),
      width: width * (0.85 + rand() * 0.3),
      phase: rand() * Math.PI * 2,
      bend: ang * 0.35,
    })
  }
  // 外側の葉を奥に
  leaves.sort((a, b) => Math.abs(b.ang) - Math.abs(a.ang))
  return { kind: 'sword', x, y, leaves, c1, c2 }
}

// 中心線を作る（angle 0 = 真上）。sway は先ほど大きく揺れる
function centerline(
  x: number,
  y: number,
  len: number,
  ang: number,
  bend: number,
  sway: number,
  phase: number,
  t: number,
  n: number,
) {
  const pts: { x: number; y: number; a: number }[] = []
  let px = x
  let py = y
  const step = len / n
  for (let i = 0; i <= n; i++) {
    const u = i / n
    const a = ang + bend * u + Math.sin(t * 1.15 + phase - u * 2.4) * sway * (0.25 + u)
    pts.push({ x: px, y: py, a })
    px += Math.sin(a) * step
    py -= Math.cos(a) * step
  }
  return pts
}

function smoothPath(ctx: CanvasRenderingContext2D, xs: number[], ys: number[], move: boolean) {
  const n = xs.length
  if (move) ctx.moveTo(xs[0], ys[0])
  else ctx.lineTo(xs[0], ys[0])
  for (let i = 1; i < n - 1; i++) {
    ctx.quadraticCurveTo(xs[i], ys[i], (xs[i] + xs[i + 1]) / 2, (ys[i] + ys[i + 1]) / 2)
  }
  ctx.lineTo(xs[n - 1], ys[n - 1])
}

function drawRibbon(ctx: CanvasRenderingContext2D, b: Ribbon, t: number) {
  const N = 10
  const pts = centerline(b.x, b.y, b.len, b.ang, b.bend, b.sway, b.phase, t, N)
  const lx: number[] = []
  const ly: number[] = []
  const rx: number[] = []
  const ry: number[] = []
  for (let i = 0; i <= N; i++) {
    const u = i / N
    const wdt = b.width * (u < 0.8 ? 1 - u * 0.2 : ((1 - u) / 0.2) * 0.84)
    const p = pts[i]
    const nx = Math.cos(p.a) * (wdt / 2)
    const ny = Math.sin(p.a) * (wdt / 2)
    lx.push(p.x - nx)
    ly.push(p.y - ny)
    rx.unshift(p.x + nx)
    ry.unshift(p.y + ny)
  }
  const tip = pts[N]
  const g = ctx.createLinearGradient(b.x, b.y, tip.x, tip.y)
  g.addColorStop(0, b.c1)
  g.addColorStop(1, b.c2)
  ctx.fillStyle = g
  ctx.beginPath()
  smoothPath(ctx, lx, ly, true)
  smoothPath(ctx, rx, ry, false)
  ctx.closePath()
  ctx.fill()
  // 葉脈のハイライト
  ctx.strokeStyle = 'rgba(220,255,200,0.18)'
  ctx.lineWidth = 1
  ctx.beginPath()
  smoothPath(
    ctx,
    pts.slice(0, N - 1).map((p) => p.x),
    pts.slice(0, N - 1).map((p) => p.y),
    true,
  )
  ctx.stroke()
}

const STEM_BUCKETS = 5
function drawStemBunch(ctx: CanvasRenderingContext2D, s: StemBunch, t: number) {
  // 色ごとにまとめて塗る（描画回数を減らす）
  const paths: Path2D[] = []
  for (let i = 0; i < STEM_BUCKETS; i++) paths.push(new Path2D())
  const stemPath = new Path2D()
  for (const st of s.stems) {
    const n = Math.max(6, Math.round(st.len / 9))
    const pts = centerline(st.x, st.y, st.len, st.ang, st.bend, 0.08, st.phase, t, n)
    stemPath.moveTo(pts[0].x, pts[0].y)
    for (const p of pts) stemPath.lineTo(p.x, p.y)
    for (let i = 1; i <= n; i++) {
      const u = i / n
      const p = pts[i]
      const size = st.leaf * (1 - u * 0.45)
      const bucket = Math.min(STEM_BUCKETS - 1, Math.floor(Math.pow(u, 1.4) * STEM_BUCKETS))
      const path = paths[bucket]
      const spread = 1.05 - u * 0.35
      for (const side of [-1, 1]) {
        const la = p.a + side * spread + Math.sin(t * 1.6 + st.phase + i) * 0.06
        const cx = p.x + Math.sin(la) * size * 0.55
        const cy = p.y - Math.cos(la) * size * 0.55
        path.moveTo(cx + Math.cos(la - Math.PI / 2) * size * 0.55, cy + Math.sin(la - Math.PI / 2) * size * 0.55)
        path.ellipse(cx, cy, size * 0.55, size * 0.2, la - Math.PI / 2, 0, Math.PI * 2)
      }
      if (i === n) {
        path.moveTo(p.x + Math.cos(p.a) * size * 0.3, p.y - size * 0.1 + Math.sin(p.a) * size * 0.3)
        path.ellipse(p.x, p.y - size * 0.1, size * 0.3, size * 0.45, p.a, 0, Math.PI * 2)
      }
    }
  }
  ctx.strokeStyle = rgb(mix(s.base, [60, 70, 40], 0.4))
  ctx.lineWidth = 1.6
  ctx.stroke(stemPath)
  for (let i = 0; i < STEM_BUCKETS; i++) {
    ctx.fillStyle = rgb(mix(s.base, s.tip, i / (STEM_BUCKETS - 1)))
    ctx.fill(paths[i])
  }
}

function drawSword(ctx: CanvasRenderingContext2D, s: Sword, t: number) {
  const N = 8
  for (const lf of s.leaves) {
    const pts = centerline(s.x, s.y, lf.len, lf.ang, lf.bend, 0.06, lf.phase, t, N)
    const lx: number[] = []
    const ly: number[] = []
    const rx: number[] = []
    const ry: number[] = []
    for (let i = 0; i <= N; i++) {
      const u = i / N
      // 葉柄（細い）→ 葉身（ふくらむ）→ 先がとがる
      const wdt = u < 0.22 ? 1.6 : Math.max(1.6, lf.width * Math.sin((Math.PI * (u - 0.22)) / 0.78) ** 0.8)
      const p = pts[i]
      const nx = Math.cos(p.a) * (wdt / 2)
      const ny = Math.sin(p.a) * (wdt / 2)
      lx.push(p.x - nx)
      ly.push(p.y - ny)
      rx.unshift(p.x + nx)
      ry.unshift(p.y + ny)
    }
    const tip = pts[N]
    const g = ctx.createLinearGradient(s.x, s.y, tip.x, tip.y)
    g.addColorStop(0, s.c1)
    g.addColorStop(1, s.c2)
    ctx.fillStyle = g
    ctx.beginPath()
    smoothPath(ctx, lx, ly, true)
    smoothPath(ctx, rx, ry, false)
    ctx.closePath()
    ctx.fill()
    ctx.strokeStyle = 'rgba(225,255,205,0.28)'
    ctx.lineWidth = 1.1
    ctx.beginPath()
    smoothPath(
      ctx,
      pts.slice(1).map((p) => p.x),
      pts.slice(1).map((p) => p.y),
      true,
    )
    ctx.stroke()
  }
}

function drawPlant(ctx: CanvasRenderingContext2D, p: Plant, t: number) {
  if (p.kind === 'ribbon') drawRibbon(ctx, p, t)
  else if (p.kind === 'stem') drawStemBunch(ctx, p, t)
  else drawSword(ctx, p, t)
}

// ---------------------------------------------------------------------------
// 岩（セイリュウ石のような角ばった石を、面ごとに陰影をつけて描く）
// ---------------------------------------------------------------------------
function drawRock(
  ctx: CanvasRenderingContext2D,
  cx: number,
  baseY: number,
  rw: number,
  rh: number,
  rand: () => number,
  moss: boolean,
) {
  const n = 8 + Math.floor(rand() * 3)
  const peakT = 0.3 + rand() * 0.4
  const top: [number, number][] = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const x = cx - rw + 2 * rw * t + (i > 0 && i < n ? (rand() - 0.5) * rw * 0.14 : 0)
    const d = t < peakT ? t / peakT : (1 - t) / (1 - peakT)
    let y = baseY - rh * Math.pow(Math.max(0, d), 0.55) * (0.78 + rand() * 0.32)
    if (i === 0 || i === n) y = baseY - rh * (0.04 + rand() * 0.08)
    top.push([x, y])
  }
  const poly: [number, number][] = [...top, [cx + rw * 0.96, baseY + 4], [cx - rw * 0.96, baseY + 4]]
  const apex: [number, number] = [cx + (peakT - 0.5) * rw * 1.1 + (rand() - 0.5) * rw * 0.2, baseY - rh * 0.42]

  // 接地の影
  ctx.fillStyle = 'rgba(20,25,20,0.32)'
  ctx.beginPath()
  ctx.ellipse(cx + rw * 0.08, baseY + 3, rw * 1.12, Math.max(4, rh * 0.07), 0, 0, Math.PI * 2)
  ctx.fill()

  const dark: RGB = [58, 68, 76]
  const light: RGB = [200, 210, 214]
  const L = [-0.5, -0.86]
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    let nx = -(b[1] - a[1])
    let ny = b[0] - a[0]
    const nl = Math.hypot(nx, ny) || 1
    nx /= nl
    ny /= nl
    const mx = (a[0] + b[0]) / 2 - apex[0]
    const my = (a[1] + b[1]) / 2 - apex[1]
    if (nx * mx + ny * my < 0) {
      nx = -nx
      ny = -ny
    }
    const s = clamp(0.5 + 0.5 * (nx * L[0] + ny * L[1]), 0, 1)
    const jitter = (rand() - 0.5) * 0.12
    const col = rgb(mix(dark, light, clamp(Math.pow(s, 1.25) + jitter, 0, 1)))
    ctx.fillStyle = col
    ctx.strokeStyle = col
    ctx.lineWidth = 1
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(apex[0], apex[1])
    ctx.lineTo(a[0], a[1])
    ctx.lineTo(b[0], b[1])
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
  }

  // 質感：地層の筋・ざらつき・下側の陰
  ctx.save()
  ctx.beginPath()
  poly.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)))
  ctx.closePath()
  ctx.clip()
  const strata = 3 + Math.floor(rand() * 3)
  const slope = (rand() - 0.5) * 0.35
  for (let k = 0; k < strata; k++) {
    const y0 = baseY - rh * (0.15 + (k / strata) * 0.8) + (rand() - 0.5) * 6
    ctx.beginPath()
    for (let x = cx - rw * 1.1; x <= cx + rw * 1.1; x += rw * 0.18) {
      const y = y0 + (x - cx) * slope + (rand() - 0.5) * 3.5
      if (x === cx - rw * 1.1) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.strokeStyle = 'rgba(25,32,38,0.42)'
    ctx.lineWidth = 1.3
    ctx.stroke()
    ctx.translate(0, 1.3)
    ctx.strokeStyle = 'rgba(255,255,255,0.14)'
    ctx.lineWidth = 0.8
    ctx.stroke()
    ctx.translate(0, -1.3)
  }
  for (let i = 0; i < rw * 1.4; i++) {
    const x = cx - rw + rand() * rw * 2
    const y = baseY - rand() * rh
    ctx.fillStyle = rand() < 0.5 ? 'rgba(20,28,34,0.22)' : 'rgba(255,255,255,0.16)'
    ctx.fillRect(x, y, 1 + rand() * 1.5, 1 + rand() * 1.5)
  }
  const ao = ctx.createLinearGradient(0, baseY - rh * 0.35, 0, baseY + 4)
  ao.addColorStop(0, 'rgba(10,20,25,0)')
  ao.addColorStop(1, 'rgba(10,20,25,0.45)')
  ctx.fillStyle = ao
  ctx.fillRect(cx - rw * 1.2, baseY - rh * 0.35, rw * 2.4, rh * 0.35 + 6)
  // 上からの水の色をうっすら乗せる
  const tint = ctx.createLinearGradient(0, baseY - rh, 0, baseY)
  tint.addColorStop(0, 'rgba(120,210,235,0.10)')
  tint.addColorStop(1, 'rgba(20,90,120,0.12)')
  ctx.fillStyle = tint
  ctx.fillRect(cx - rw * 1.2, baseY - rh * 1.1, rw * 2.4, rh * 1.2)
  ctx.restore()

  // 稜線のハイライト
  ctx.strokeStyle = 'rgba(235,245,248,0.55)'
  ctx.lineWidth = 1.2
  ctx.beginPath()
  for (let i = 0; i < top.length - 1; i++) {
    const a = top[i]
    const b = top[i + 1]
    if (b[0] - a[0] > 0 && a[1] - b[1] > -rh * 0.4) {
      ctx.moveTo(a[0], a[1])
      ctx.lineTo(b[0], b[1])
    }
  }
  ctx.stroke()

  // こけ
  if (moss) {
    const greens = ['#3f7a34', '#5b9a43', '#4c8a3b', '#76b356', '#33682c']
    for (let i = 0; i < top.length - 1; i++) {
      const a = top[i]
      const b = top[i + 1]
      const dx = b[0] - a[0]
      const dy = b[1] - a[1]
      if (Math.abs(dy) > Math.abs(dx) * 0.9) continue
      if (rand() < 0.3) continue
      const cnt = 8 + Math.floor(rand() * 10)
      for (let k = 0; k < cnt; k++) {
        const t = rand()
        const x = a[0] + dx * t
        const y = a[1] + dy * t + 1.5
        const r = 1.3 + rand() * 2.6
        ctx.fillStyle = greens[Math.floor(rand() * greens.length)]
        ctx.beginPath()
        ctx.arc(x, y - rand() * 2.5, r, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }
}

// 流木：曲がりくねった中心線に沿って、先細りの形で塗る
function drawWood(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ang: number,
  len: number,
  width: number,
  depth: number,
  rand: () => number,
) {
  const N = 14
  const bend = (rand() - 0.5) * 0.8
  const ph = rand() * 6
  const pts: { x: number; y: number; a: number; w: number }[] = []
  let px = x
  let py = y
  for (let i = 0; i <= N; i++) {
    const u = i / N
    const a = ang + bend * u + Math.sin(u * 6.5 + ph) * 0.22
    const wv = width * (1 - u * 0.72) * (1 + Math.sin(u * 11 + ph) * 0.08)
    pts.push({ x: px, y: py, a, w: wv })
    px += (Math.sin(a) * len) / N
    py -= (Math.cos(a) * len) / N
  }
  const edge = (side: number, k: number) =>
    pts.map((p) => [p.x + Math.cos(p.a) * p.w * 0.5 * side * k, p.y + Math.sin(p.a) * p.w * 0.5 * side * k])
  const outline = (k1: number, k2: number) => {
    const l = edge(-1, k1)
    const r = edge(1, k2).reverse()
    ctx.beginPath()
    smoothPath(ctx, l.map((q) => q[0]), l.map((q) => q[1]), true)
    smoothPath(ctx, r.map((q) => q[0]), r.map((q) => q[1]), false)
    ctx.closePath()
  }
  // 枝分かれ（幹より先に描いて、付け根を幹で隠す）
  if (depth > 0) {
    const nb = 1 + Math.floor(rand() * 2)
    for (let b = 0; b < nb; b++) {
      const i = Math.floor(N * (0.35 + rand() * 0.35))
      const p = pts[i]
      const side = b % 2 === 0 ? 1 : -1
      drawWood(ctx, p.x, p.y, p.a + side * (0.55 + rand() * 0.45), len * (0.38 + rand() * 0.15), p.w * 0.6, depth - 1, rand)
    }
  }
  outline(1, 1)
  ctx.fillStyle = '#4a3222'
  ctx.fill()
  // 光の当たる左側を明るく
  outline(1, -0.1)
  ctx.fillStyle = 'rgba(150,104,68,0.55)'
  ctx.fill()
  outline(1, -0.65)
  ctx.fillStyle = 'rgba(196,150,104,0.35)'
  ctx.fill()
  // 木目
  ctx.lineCap = 'round'
  for (let k = 0; k < 3; k++) {
    const off = (rand() - 0.5) * 0.7
    const from = Math.floor(rand() * N * 0.3)
    const to = Math.min(N, from + 4 + Math.floor(rand() * N * 0.6))
    ctx.strokeStyle = 'rgba(40,24,14,0.45)'
    ctx.lineWidth = Math.max(0.7, width * 0.06)
    ctx.beginPath()
    for (let i = from; i <= to; i++) {
      const p = pts[i]
      const qx = p.x + Math.cos(p.a) * p.w * 0.5 * off
      const qy = p.y + Math.sin(p.a) * p.w * 0.5 * off
      if (i === from) ctx.moveTo(qx, qy)
      else ctx.lineTo(qx, qy)
    }
    ctx.stroke()
  }
  // 先端の切り口
  const tip = pts[N]
  ctx.fillStyle = '#a77a52'
  ctx.beginPath()
  ctx.ellipse(tip.x, tip.y, tip.w * 0.5, tip.w * 0.3, tip.a, 0, Math.PI * 2)
  ctx.fill()
}

// ---------------------------------------------------------------------------
// コースティクス（水面の光が底に映る網目模様）のタイル
// ---------------------------------------------------------------------------
function buildCausticTile(size: number) {
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const ctx = c.getContext('2d')!
  const img = ctx.createImageData(size, size)
  const TAU = Math.PI * 2
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * TAU
      const v = (y / size) * TAU
      const a = Math.sin(u * 2 + Math.sin(v * 3) * 1.3)
      const b = Math.sin(v * 2 + Math.sin(u * 3 + 1) * 1.3)
      const d = Math.sin(u + v * 3 + Math.sin(u * 2 - v) * 1.1)
      const val =
        Math.pow(Math.max(0, 1 - Math.abs(a + b) * 0.85), 5) * 0.7 +
        Math.pow(Math.max(0, 1 - Math.abs(b + d) * 0.85), 5) * 0.6
      const i = (y * size + x) * 4
      img.data[i] = 255
      img.data[i + 1] = 255
      img.data[i + 2] = 235
      img.data[i + 3] = Math.min(255, val * 255)
    }
  }
  ctx.putImageData(img, 0, 0)
  return c
}

// ---------------------------------------------------------------------------
// シーン
// ---------------------------------------------------------------------------
export interface Scene {
  L: TankLayout
  back: HTMLCanvasElement
  hard: HTMLCanvasElement
  front: HTMLCanvasElement
  backPlants: Plant[]
  midPlants: Plant[]
  caustic: HTMLCanvasElement
  airStoneX: number
  particles: { x: number; y: number; r: number; ph: number }[]
  rays: { x: number; w: number; lean: number; ph: number }[]
}

let causticCache: HTMLCanvasElement | null = null

export function buildScene(w: number, h: number, dpr: number): Scene {
  const L = computeLayout(w, h)
  const H = L.frontY - L.waterY
  const rand = mulberry32(20261110)

  // ---- 奥のレイヤー：水・奥の水草のシルエット・フタと照明
  const back = makeLayer(L, dpr)
  {
    const ctx = back.ctx
    const g = ctx.createLinearGradient(0, L.waterY, 0, L.frontY)
    g.addColorStop(0, '#74d0ea')
    g.addColorStop(0.35, '#40a9d3')
    g.addColorStop(0.75, '#2484b3')
    g.addColorStop(1, '#1a6c95')
    ctx.fillStyle = g
    ctx.fillRect(0, L.waterY, w, h - L.waterY)
    // 奥がほんのり明るい（バックスクリーンの照り返し）
    const rg = ctx.createRadialGradient(w * 0.5, L.frontY - H * 0.25, 10, w * 0.5, L.frontY - H * 0.25, Math.max(w, H) * 0.75)
    rg.addColorStop(0, 'rgba(190,245,225,0.32)')
    rg.addColorStop(1, 'rgba(190,245,225,0)')
    ctx.fillStyle = rg
    ctx.fillRect(0, L.waterY, w, h - L.waterY)
    // 遠くの水草（かすんだシルエット）
    for (const [alpha, col, count, scale] of [
      [0.2, '40,120,120', 16, 1],
      [0.22, '45,135,115', 12, 0.75],
    ] as const) {
      for (let i = 0; i < count; i++) {
        const x = rand() * w
        const len = H * (0.25 + rand() * 0.35) * scale
        const blades = 3 + Math.floor(rand() * 4)
        for (let b = 0; b < blades; b++) {
          const ang = (rand() - 0.5) * 0.6
          const width = 5 + rand() * 6
          const pts = centerline(x + (rand() - 0.5) * 14, contourY(L, x) + 6, len * (0.6 + rand() * 0.5), ang, (rand() - 0.5) * 0.6, 0, 0, 0, 6)
          ctx.fillStyle = `rgba(${col},${alpha})`
          ctx.beginPath()
          pts.forEach((p, k) => {
            const ww = width * (1 - k / 6)
            const px = p.x - Math.cos(p.a) * ww * 0.5
            const py = p.y - Math.sin(p.a) * ww * 0.5
            if (k === 0) ctx.moveTo(px, py)
            else ctx.lineTo(px, py)
          })
          for (let k = pts.length - 1; k >= 0; k--) {
            const p = pts[k]
            const ww = width * (1 - k / 6)
            ctx.lineTo(p.x + Math.cos(p.a) * ww * 0.5, p.y + Math.sin(p.a) * ww * 0.5)
          }
          ctx.closePath()
          ctx.fill()
        }
      }
    }
    // 水面より上：空気の層（奥のガラス）
    const ag = ctx.createLinearGradient(0, L.lidH, 0, L.waterY)
    ag.addColorStop(0, '#dff4fb')
    ag.addColorStop(1, '#b3e1f1')
    ctx.fillStyle = ag
    ctx.fillRect(0, L.lidH, w, L.waterY - L.lidH + 1)
    // フタ（照明）
    const lg = ctx.createLinearGradient(0, 0, 0, L.lidH)
    lg.addColorStop(0, '#2c3a44')
    lg.addColorStop(1, '#1b252c')
    ctx.fillStyle = lg
    ctx.fillRect(0, 0, w, L.lidH)
    ctx.fillStyle = 'rgba(255,255,255,0.08)'
    ctx.fillRect(0, 0, w, 1)
    ctx.fillStyle = '#fff8dc'
    ctx.fillRect(10, L.lidH - 4, w - 20, 4)
    const glow = ctx.createLinearGradient(0, L.lidH, 0, L.waterY + H * 0.3)
    glow.addColorStop(0, 'rgba(255,252,230,0.55)')
    glow.addColorStop(1, 'rgba(255,252,230,0)')
    ctx.fillStyle = glow
    ctx.fillRect(0, L.lidH, w, L.waterY + H * 0.3 - L.lidH)
  }

  // ---- 岩・流木・底砂のレイヤー
  const hard = makeLayer(L, dpr)
  {
    const ctx = hard.ctx
    // 底砂の上面
    ctx.beginPath()
    ctx.moveTo(0, L.frontY + 1)
    for (let x = 0; x <= w; x += 6) ctx.lineTo(x, contourY(L, x))
    ctx.lineTo(w, L.frontY + 1)
    ctx.closePath()
    const sg = ctx.createLinearGradient(0, contourY(L, w * 0.3), 0, L.frontY)
    sg.addColorStop(0, '#a99a7b')
    sg.addColorStop(1, '#dcc597')
    ctx.fillStyle = sg
    ctx.fill()
    ctx.save()
    ctx.clip()
    const sand: RGB[] = [
      [184, 160, 118],
      [222, 204, 160],
      [150, 132, 100],
      [240, 226, 190],
      [120, 108, 90],
    ]
    for (let i = 0; i < w * 3.2; i++) {
      const x = rand() * w
      const top = contourY(L, x)
      const y = top + rand() * (L.frontY - top)
      const depth = (y - top) / Math.max(1, L.frontY - top)
      const r = (0.8 + rand() * 1.8) * (0.5 + depth)
      ctx.fillStyle = rgb(sand[Math.floor(rand() * sand.length)], 0.85)
      ctx.beginPath()
      ctx.ellipse(x, y, r, r * 0.6, 0, 0, Math.PI * 2)
      ctx.fill()
    }
    // 奥はかすむ
    const haze = ctx.createLinearGradient(0, L.frontY - H * 0.12, 0, L.frontY)
    haze.addColorStop(0, 'rgba(40,120,150,0.4)')
    haze.addColorStop(1, 'rgba(40,120,150,0)')
    ctx.fillStyle = haze
    ctx.fillRect(0, L.frontY - H * 0.14, w, H * 0.14)
    ctx.restore()

    // 流木（岩の後ろ）
    drawWood(ctx, w * 0.4, contourY(L, w * 0.4) + 8, 0.55, H * 0.46, clamp(w * 0.06, 14, 32), 2, rand)
    drawWood(ctx, w * 0.24, contourY(L, w * 0.24) + 8, -0.75, H * 0.3, clamp(w * 0.045, 11, 24), 1, rand)

    // 岩組
    const rocks: [number, number, number, boolean][] = [
      [0.17, 0.075, 0.13, true],
      [0.3, 0.16, 0.32, true],
      [0.46, 0.085, 0.17, false],
      [0.79, 0.12, 0.22, true],
      [0.66, 0.05, 0.09, false],
      [0.92, 0.06, 0.08, false],
    ]
    for (const [xf, rwf, rhf, moss] of rocks) {
      const x = w * xf
      const base = contourY(L, x) + (L.frontY - contourY(L, x)) * 0.45
      drawRock(ctx, x, base, clamp(w * rwf, 14, 120), H * rhf, rand, moss)
    }
    // 小石
    for (let i = 0; i < 26; i++) {
      const x = rand() * w
      const y = L.frontY - 2 - rand() * (L.frontY - contourY(L, x)) * 0.5
      const r = 2 + rand() * 4.5
      const tone = mix([110, 116, 120], [190, 186, 176], rand())
      ctx.fillStyle = 'rgba(0,0,0,0.2)'
      ctx.beginPath()
      ctx.ellipse(x + 1, y + r * 0.45, r, r * 0.35, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = rgb(tone)
      ctx.beginPath()
      ctx.ellipse(x, y, r, r * 0.62, (rand() - 0.5) * 0.6, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = 'rgba(255,255,255,0.3)'
      ctx.beginPath()
      ctx.ellipse(x - r * 0.3, y - r * 0.25, r * 0.4, r * 0.2, -0.3, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  // ---- 手前のレイヤー：底砂の断面・前景草・ガラス
  const front = makeLayer(L, dpr)
  {
    const ctx = front.ctx
    // 前景の草（ショートヘアーグラス風）
    const grass: RGB[] = [
      [62, 140, 58],
      [92, 170, 70],
      [48, 115, 52],
      [120, 190, 80],
    ]
    for (let x = -4; x < w + 4; x += 1.6) {
      const dens = 0.5 + 0.5 * Math.sin(x * 0.021 + 1.3) * Math.sin(x * 0.0071 + 0.4)
      if (rand() > dens * 0.9 + 0.15) continue
      const hgt = 5 + rand() * 11 * (0.5 + dens)
      const lean = (rand() - 0.5) * 0.9
      ctx.strokeStyle = rgb(grass[Math.floor(rand() * grass.length)])
      ctx.lineWidth = 1.2 + rand() * 0.8
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(x, L.frontY + 2)
      ctx.quadraticCurveTo(x + lean * hgt * 0.3, L.frontY - hgt * 0.6, x + lean * hgt, L.frontY - hgt)
      ctx.stroke()
    }
    // 底砂の断面（ガラス越し）
    const cg = ctx.createLinearGradient(0, L.frontY, 0, h)
    cg.addColorStop(0, '#7a6548')
    cg.addColorStop(0.4, '#5a4a36')
    cg.addColorStop(1, '#2e261d')
    ctx.fillStyle = cg
    ctx.fillRect(0, L.frontY, w, h - L.frontY)
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, L.frontY, w, h - L.frontY)
    ctx.clip()
    const pebble: RGB[] = [
      [196, 176, 136],
      [150, 128, 96],
      [120, 104, 82],
      [220, 204, 168],
      [96, 88, 78],
      [170, 160, 150],
    ]
    for (let i = 0; i < w * 1.6; i++) {
      const x = rand() * w
      const y = L.frontY + rand() * (h - L.frontY)
      const depth = (y - L.frontY) / (h - L.frontY)
      const r = 1.5 + rand() * 4
      const col = mix(pebble[Math.floor(rand() * pebble.length)], [30, 25, 20], depth * 0.55)
      ctx.fillStyle = rgb(col)
      ctx.beginPath()
      ctx.ellipse(x, y, r, r * 0.7, rand() * Math.PI, 0, Math.PI * 2)
      ctx.fill()
      if (r > 3) {
        ctx.fillStyle = `rgba(255,255,255,${0.25 * (1 - depth)})`
        ctx.beginPath()
        ctx.ellipse(x - r * 0.3, y - r * 0.3, r * 0.35, r * 0.2, -0.4, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    // ガラスの青み
    ctx.fillStyle = 'rgba(110,190,220,0.14)'
    ctx.fillRect(0, L.frontY, w, h - L.frontY)
    ctx.restore()
    // 断面の上のふち
    ctx.fillStyle = 'rgba(255,240,210,0.35)'
    ctx.fillRect(0, L.frontY, w, 1.2)
    // 下のフレーム
    ctx.fillStyle = '#10171c'
    ctx.fillRect(0, h - 5, w, 5)
    ctx.fillStyle = 'rgba(255,255,255,0.12)'
    ctx.fillRect(0, h - 5, w, 1)

    // ガラスの左右のふち（厚みと反射）
    for (const side of [0, 1]) {
      const x0 = side === 0 ? 0 : w
      const dir = side === 0 ? 1 : -1
      const eg = ctx.createLinearGradient(x0, 0, x0 + dir * 14, 0)
      eg.addColorStop(0, 'rgba(200,240,255,0.55)')
      eg.addColorStop(0.25, 'rgba(160,220,240,0.18)')
      eg.addColorStop(1, 'rgba(160,220,240,0)')
      ctx.fillStyle = eg
      ctx.fillRect(side === 0 ? 0 : w - 14, L.lidH, 14, h - L.lidH)
      ctx.fillStyle = 'rgba(20,50,60,0.4)'
      ctx.fillRect(side === 0 ? 4 : w - 5, L.lidH, 1, h - L.lidH)
    }
    // 正面ガラスのうっすらした映り込み
    ctx.save()
    ctx.globalAlpha = 0.06
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.moveTo(w * 0.62, L.waterY)
    ctx.lineTo(w * 0.8, L.waterY)
    ctx.lineTo(w * 0.48, L.frontY)
    ctx.lineTo(w * 0.36, L.frontY)
    ctx.closePath()
    ctx.fill()
    ctx.globalAlpha = 0.04
    ctx.beginPath()
    ctx.moveTo(w * 0.84, L.waterY)
    ctx.lineTo(w * 0.88, L.waterY)
    ctx.lineTo(w * 0.6, L.frontY)
    ctx.lineTo(w * 0.56, L.frontY)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
    // 四すみを少し暗く
    const vg = ctx.createRadialGradient(w / 2, (L.waterY + L.frontY) / 2, Math.min(w, H) * 0.35, w / 2, (L.waterY + L.frontY) / 2, Math.max(w, H) * 0.8)
    vg.addColorStop(0, 'rgba(0,30,50,0)')
    vg.addColorStop(1, 'rgba(0,30,50,0.28)')
    ctx.fillStyle = vg
    ctx.fillRect(0, L.waterY, w, h - L.waterY)
  }

  // ---- 動く水草
  const plantRand = mulberry32(77)
  const valliPal: [string, string][] = [
    ['#2c6e36', '#7fcd68'],
    ['#2f7a3a', '#9bdc78'],
    ['#256232', '#6abf5e'],
  ]
  const backPlants: Plant[] = [
    ...vallisneria(plantRand, w * 0.05, contourY(L, w * 0.05) + 8, 8, H * 0.55, H * 0.92, valliPal),
    ...vallisneria(plantRand, w * 0.95, contourY(L, w * 0.95) + 8, 8, H * 0.5, H * 0.9, valliPal),
    stemBunch(plantRand, w * 0.18, contourY(L, w * 0.18) + 6, 6, H * 0.35, H * 0.6, [64, 140, 60], [232, 110, 64]),
    stemBunch(plantRand, w * 0.86, contourY(L, w * 0.86) + 6, 6, H * 0.3, H * 0.5, [70, 150, 60], [170, 230, 100]),
    ...vallisneria(plantRand, w * 0.62, contourY(L, w * 0.62) + 8, 5, H * 0.35, H * 0.62, valliPal),
    sword(plantRand, w * 0.54, contourY(L, w * 0.54) + 10, 9, H * 0.36, clamp(w * 0.05, 12, 26), '#2e6b2f', '#6cc35a'),
  ]
  const midPlants: Plant[] = [
    sword(plantRand, w * 0.4, L.frontY - 6, 5, H * 0.12, clamp(w * 0.04, 9, 18), '#1f4f27', '#3f8a3e', 0.9),
    sword(plantRand, w * 0.71, L.frontY - 5, 4, H * 0.1, clamp(w * 0.036, 8, 16), '#1f4f27', '#478f43', 0.8),
    ...vallisneria(plantRand, w * 0.1, L.frontY - 3, 4, H * 0.06, H * 0.12, [['#3b8a3a', '#8fd36e']]),
    ...vallisneria(plantRand, w * 0.58, L.frontY - 3, 3, H * 0.05, H * 0.1, [['#3b8a3a', '#8fd36e']]),
    ...vallisneria(plantRand, w * 0.9, L.frontY - 3, 4, H * 0.06, H * 0.11, [['#3b8a3a', '#8fd36e']]),
  ]

  if (!causticCache) causticCache = buildCausticTile(160)

  const particles = []
  for (let i = 0; i < 34; i++) {
    particles.push({
      x: rand() * w,
      y: L.waterY + rand() * H,
      r: 0.6 + rand() * 1.3,
      ph: rand() * Math.PI * 2,
    })
  }
  const rays = []
  for (let i = 0; i < 4; i++) {
    rays.push({ x: w * (0.12 + i * 0.25 + (rand() - 0.5) * 0.08), w: w * (0.06 + rand() * 0.06), lean: w * (0.08 + rand() * 0.06), ph: rand() * 6 })
  }

  return {
    L,
    back: back.c,
    hard: hard.c,
    front: front.c,
    backPlants,
    midPlants,
    caustic: causticCache,
    airStoneX: w * 0.83,
    particles,
    rays,
  }
}

/** 静的レイヤーを等倍で貼る */
export function blitLayer(ctx: CanvasRenderingContext2D, layer: HTMLCanvasElement, dpr: number) {
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.drawImage(layer, 0, 0)
  ctx.restore()
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
}

export function drawBackPlants(ctx: CanvasRenderingContext2D, s: Scene, t: number) {
  for (const p of s.backPlants) drawPlant(ctx, p, t)
}

export function drawMidPlants(ctx: CanvasRenderingContext2D, s: Scene, t: number) {
  for (const p of s.midPlants) drawPlant(ctx, p, t)
}

/** 光の筋（ゆっくり明滅） */
export function drawRays(ctx: CanvasRenderingContext2D, s: Scene, t: number) {
  const { L } = s
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  for (const r of s.rays) {
    const a = 0.045 + 0.035 * Math.sin(t * 0.35 + r.ph)
    const g = ctx.createLinearGradient(0, L.waterY, 0, L.frontY)
    g.addColorStop(0, `rgba(255,255,235,${a})`)
    g.addColorStop(1, 'rgba(255,255,235,0)')
    ctx.fillStyle = g
    const sway = Math.sin(t * 0.2 + r.ph) * 8
    ctx.beginPath()
    ctx.moveTo(r.x + sway, L.waterY)
    ctx.lineTo(r.x + r.w + sway, L.waterY)
    ctx.lineTo(r.x + r.w * 2.2 + r.lean, L.frontY)
    ctx.lineTo(r.x + r.lean - r.w * 0.4, L.frontY)
    ctx.closePath()
    ctx.fill()
  }
  ctx.restore()
}

/** 底砂に揺れる光の網目 */
export function drawCaustics(ctx: CanvasRenderingContext2D, s: Scene, t: number) {
  const { L } = s
  const tile = s.caustic
  const tw = 170
  const th = tw * 0.42
  ctx.save()
  ctx.beginPath()
  ctx.moveTo(0, L.frontY)
  for (let x = 0; x <= L.w; x += 12) ctx.lineTo(x, contourY(L, x) - 2)
  ctx.lineTo(L.w, L.frontY)
  ctx.closePath()
  ctx.clip()
  ctx.globalCompositeOperation = 'lighter'
  const yTop = contourY(L, L.w * 0.3) - 4
  const layers: [number, number, number][] = [
    [t * 11, t * 2, 0.22],
    [-t * 8 + 50, -t * 3 + 20, 0.16],
  ]
  for (const [ox, oy, a] of layers) {
    ctx.globalAlpha = a
    const sx = ((ox % tw) + tw) % tw
    const sy = ((oy % th) + th) % th
    for (let y = yTop - th + sy; y < L.frontY; y += th) {
      for (let x = -tw + sx; x < L.w; x += tw) {
        ctx.drawImage(tile, x, y, tw, th)
      }
    }
  }
  ctx.restore()
}

/** ただよう小さなチリ */
export function drawParticles(ctx: CanvasRenderingContext2D, s: Scene, t: number) {
  const { L } = s
  const H = L.frontY - L.waterY
  ctx.fillStyle = 'rgba(235,250,255,0.45)'
  ctx.beginPath()
  for (const p of s.particles) {
    const x = (p.x + Math.sin(t * 0.21 + p.ph) * 14 + t * 2.5) % L.w
    const y = L.waterY + ((p.y - L.waterY + Math.cos(t * 0.17 + p.ph) * 10 - t * 1.5 + H * 10) % H)
    ctx.moveTo(x + p.r, y)
    ctx.arc(x, y, p.r, 0, Math.PI * 2)
  }
  ctx.fill()
}

export interface Ripple {
  x: number
  age: number
  size: number
}

export function surfaceOffset(x: number, t: number) {
  return Math.sin(x * 0.035 + t * 1.6) * 1.6 + Math.sin(x * 0.083 - t * 2.3) * 0.9
}

/** 水面：波打つ線と、下から見た水面のきらめき */
export function drawSurface(ctx: CanvasRenderingContext2D, s: Scene, t: number, ripples: Ripple[]) {
  const { L } = s
  const pts: number[] = []
  for (let x = 0; x <= L.w + 8; x += 8) {
    let y = L.waterY + surfaceOffset(x, t)
    for (const r of ripples) {
      const d = Math.abs(x - r.x)
      const rad = r.age * 120
      const k = d - rad
      if (Math.abs(k) < 24) y += Math.cos((k / 24) * Math.PI) * 2.6 * r.size * Math.max(0, 1 - r.age / 1.2)
    }
    pts.push(x, y)
  }
  // 水面の上側（空気の色）を波に合わせて塗る
  ctx.fillStyle = '#b3e1f1'
  ctx.beginPath()
  ctx.moveTo(0, L.waterY - 6)
  for (let i = 0; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1])
  ctx.lineTo(L.w, L.waterY - 6)
  ctx.closePath()
  ctx.fill()
  // 水面の裏側の明るい帯
  const g = ctx.createLinearGradient(0, L.waterY - 3, 0, L.waterY + 16)
  g.addColorStop(0, 'rgba(255,255,255,0.55)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.moveTo(0, L.waterY + 16)
  for (let i = 0; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1])
  ctx.lineTo(L.w, L.waterY + 16)
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.9)'
  ctx.lineWidth = 1.6
  ctx.beginPath()
  for (let i = 0; i < pts.length; i += 2) {
    if (i === 0) ctx.moveTo(pts[i], pts[i + 1])
    else ctx.lineTo(pts[i], pts[i + 1])
  }
  ctx.stroke()
  // 波紋の輪
  for (const r of ripples) {
    const a = Math.max(0, 1 - r.age / 1.2)
    if (a <= 0) continue
    ctx.strokeStyle = `rgba(255,255,255,${0.7 * a})`
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.ellipse(r.x, L.waterY + 1, 6 + r.age * 70 * r.size, (6 + r.age * 70 * r.size) * 0.14, 0, 0, Math.PI * 2)
    ctx.stroke()
  }
}
