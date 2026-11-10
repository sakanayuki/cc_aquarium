import { useEffect, useRef, useState } from 'react'
import { TEMPLATES } from '../lib/templates'
import { addFish, loadFish, MAX_FISH } from '../lib/storage'
import { initAudio, isMuted, playFanfare, setMuted } from '../lib/sound'

const SIZE = 1000
const COLORS = [
  '#ef5350', '#ff9800', '#ffeb3b', '#66bb6a',
  '#26c6da', '#42a5f5', '#5c6bc0', '#ab47bc',
  '#ec407a', '#8d6e63', '#ffffff', '#37474f',
]
const WIDTHS = [12, 26, 46]

type Tool = 'pen' | 'eraser' | 'fill'

function hexToRgba(hex: string): [number, number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255]
}

/** バケツ：タップした場所とつながった領域を塗る（スキャンライン・フラッドフィル） */
function floodFill(ctx: CanvasRenderingContext2D, startX: number, startY: number, fillHex: string) {
  const w = ctx.canvas.width
  const h = ctx.canvas.height
  if (startX < 0 || startY < 0 || startX >= w || startY >= h) return
  const img = ctx.getImageData(0, 0, w, h)
  const data = img.data
  const si = (startY * w + startX) * 4
  const tr = data[si]
  const tg = data[si + 1]
  const tb = data[si + 2]
  const ta = data[si + 3]
  const [fr, fg, fb, fa] = hexToRgba(fillHex)
  if (tr === fr && tg === fg && tb === fb && ta === fa) return
  const tol = 48
  const matches = (i: number) =>
    Math.abs(data[i] - tr) <= tol &&
    Math.abs(data[i + 1] - tg) <= tol &&
    Math.abs(data[i + 2] - tb) <= tol &&
    Math.abs(data[i + 3] - ta) <= tol
  const visited = new Uint8Array(w * h)
  const stack: number[] = [startX, startY]
  while (stack.length > 0) {
    const y = stack.pop()!
    let x = stack.pop()!
    // 左端まで戻る
    while (x >= 0 && matches((y * w + x) * 4) && !visited[y * w + x]) x--
    x++
    let spanUp = false
    let spanDown = false
    while (x < w && matches((y * w + x) * 4) && !visited[y * w + x]) {
      const p = y * w + x
      visited[p] = 1
      const i = p * 4
      data[i] = fr
      data[i + 1] = fg
      data[i + 2] = fb
      data[i + 3] = fa
      if (y > 0) {
        const up = matches(((y - 1) * w + x) * 4) && !visited[(y - 1) * w + x]
        if (up && !spanUp) {
          stack.push(x, y - 1)
          spanUp = true
        } else if (!up) spanUp = false
      }
      if (y < h - 1) {
        const down = matches(((y + 1) * w + x) * 4) && !visited[(y + 1) * w + x]
        if (down && !spanDown) {
          stack.push(x, y + 1)
          spanDown = true
        } else if (!down) spanDown = false
      }
      x++
    }
  }
  ctx.putImageData(img, 0, 0)
}

/** 描いた絵を、透明な余白を詰めて長辺512pxに縮小し dataURL 化する。何も描かれていなければ null。 */
function exportFishImage(canvas: HTMLCanvasElement): string | null {
  const ctx = canvas.getContext('2d')!
  const w = canvas.width
  const h = canvas.height
  const img = ctx.getImageData(0, 0, w, h)
  const data = img.data
  let minX = w
  let minY = h
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 8) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) return null
  const pad = 8
  minX = Math.max(0, minX - pad)
  minY = Math.max(0, minY - pad)
  maxX = Math.min(w - 1, maxX + pad)
  maxY = Math.min(h - 1, maxY + pad)
  const bw = maxX - minX + 1
  const bh = maxY - minY + 1
  const scale = Math.min(1, 512 / Math.max(bw, bh))
  const out = document.createElement('canvas')
  out.width = Math.max(1, Math.round(bw * scale))
  out.height = Math.max(1, Math.round(bh * scale))
  const octx = out.getContext('2d')!
  octx.imageSmoothingEnabled = true
  octx.imageSmoothingQuality = 'high'
  octx.drawImage(canvas, minX, minY, bw, bh, 0, 0, out.width, out.height)
  return out.toDataURL('image/png')
}

interface Props {
  onDone: () => void
  onBack: () => void
}

export default function DrawScreen({ onDone, onBack }: Props) {
  const drawRef = useRef<HTMLCanvasElement>(null)
  const tmplRef = useRef<HTMLCanvasElement>(null)
  const historyRef = useRef<string[]>([])
  const drawingRef = useRef(false)
  const lastRef = useRef<{ x: number; y: number } | null>(null)
  const toastTimerRef = useRef<number | undefined>(undefined)

  const [color, setColor] = useState(COLORS[0])
  const [widthIdx, setWidthIdx] = useState(1)
  const [tool, setTool] = useState<Tool>('pen')
  const [tmplIdx, setTmplIdx] = useState(0)
  const [toast, setToast] = useState<string | null>(null)
  const [mutedState, setMutedState] = useState(isMuted())

  const showToast = (msg: string) => {
    setToast(msg)
    window.clearTimeout(toastTimerRef.current)
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2600)
  }

  // 枠線テンプレートを下のレイヤーに描く
  useEffect(() => {
    const canvas = tmplRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, SIZE, SIZE)
    const path = new Path2D(TEMPLATES[tmplIdx].path)
    ctx.fillStyle = 'rgba(160, 220, 255, 0.20)'
    ctx.fill(path)
    ctx.strokeStyle = 'rgba(38, 110, 170, 0.6)'
    ctx.lineWidth = 15
    ctx.setLineDash([30, 22])
    ctx.lineJoin = 'round'
    ctx.stroke(path)
    ctx.setLineDash([])
  }, [tmplIdx])

  const pushHistory = () => {
    const c = drawRef.current
    if (!c) return
    historyRef.current.push(c.toDataURL())
    if (historyRef.current.length > 40) historyRef.current.shift()
  }

  const undo = () => {
    const prev = historyRef.current.pop()
    const canvas = drawRef.current
    if (!prev || !canvas) {
      showToast('もどせないよ')
      return
    }
    const ctx = canvas.getContext('2d')!
    const img = new Image()
    img.onload = () => {
      ctx.clearRect(0, 0, SIZE, SIZE)
      ctx.drawImage(img, 0, 0)
    }
    img.src = prev
  }

  const clearAll = () => {
    const canvas = drawRef.current
    if (!canvas) return
    pushHistory()
    canvas.getContext('2d')!.clearRect(0, 0, SIZE, SIZE)
  }

  const getPos = (e: React.PointerEvent) => {
    const rect = drawRef.current!.getBoundingClientRect()
    return {
      x: Math.floor(((e.clientX - rect.left) / rect.width) * SIZE),
      y: Math.floor(((e.clientY - rect.top) / rect.height) * SIZE),
    }
  }

  const strokeStyle = (ctx: CanvasRenderingContext2D) => {
    ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over'
    ctx.strokeStyle = color
    ctx.fillStyle = color
    ctx.lineWidth = WIDTHS[widthIdx]
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
  }

  const onPointerDown = (e: React.PointerEvent) => {
    initAudio()
    const canvas = drawRef.current
    if (!canvas) return
    ;(e.target as Element).setPointerCapture(e.pointerId)
    const pos = getPos(e)
    const ctx = canvas.getContext('2d')!
    if (tool === 'fill') {
      pushHistory()
      floodFill(ctx, pos.x, pos.y, color)
      return
    }
    pushHistory()
    drawingRef.current = true
    lastRef.current = pos
    strokeStyle(ctx)
    ctx.beginPath()
    ctx.arc(pos.x, pos.y, WIDTHS[widthIdx] / 2, 0, Math.PI * 2)
    ctx.fill()
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drawingRef.current || !lastRef.current) return
    const canvas = drawRef.current
    if (!canvas) return
    const pos = getPos(e)
    const ctx = canvas.getContext('2d')!
    strokeStyle(ctx)
    ctx.beginPath()
    ctx.moveTo(lastRef.current.x, lastRef.current.y)
    ctx.lineTo(pos.x, pos.y)
    ctx.stroke()
    lastRef.current = pos
  }

  const endStroke = () => {
    drawingRef.current = false
    lastRef.current = null
  }

  const handleDone = () => {
    const canvas = drawRef.current
    if (!canvas) return
    const dataUrl = exportFishImage(canvas)
    if (!dataUrl) {
      showToast('なにか かいてね！')
      return
    }
    if (loadFish().length >= MAX_FISH) {
      showToast('おさかなは いっぱい！ すいそうの いちらんから けしてね')
      return
    }
    const next = addFish(dataUrl)
    if (!next) {
      showToast('おさかなは いっぱい！ すいそうの いちらんから けしてね')
      return
    }
    playFanfare()
    onDone()
  }

  const toggleMute = () => {
    const v = !mutedState
    setMuted(v)
    setMutedState(v)
  }

  return (
    <div className="draw-screen">
      <div className="draw-top">
        <button className="btn btn-water btn-mid" onClick={onBack}>
          ← すいそう
        </button>
        <button className="btn icon-btn" onClick={toggleMute} aria-label="おと オン・オフ">
          {mutedState ? '🔇' : '🔊'}
        </button>
      </div>

      <div className="template-row">
        {TEMPLATES.map((t, i) => (
          <button
            key={t.id}
            className={`template-btn${i === tmplIdx ? ' selected' : ''}`}
            onClick={() => setTmplIdx(i)}
          >
            <svg viewBox="0 0 1000 1000" aria-hidden>
              <path
                d={t.path}
                fill="rgba(120,200,255,0.25)"
                stroke="#5b8db8"
                strokeWidth={42}
                strokeDasharray="72 46"
                strokeLinejoin="round"
              />
            </svg>
            <span>{t.name}</span>
          </button>
        ))}
      </div>

      <div className="draw-canvas-wrap">
        <canvas ref={tmplRef} width={SIZE} height={SIZE} />
        <canvas
          ref={drawRef}
          width={SIZE}
          height={SIZE}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endStroke}
          onPointerCancel={endStroke}
          onContextMenu={(e) => e.preventDefault()}
        />
      </div>

      <div className="palette-row">
        {COLORS.map((c) => (
          <button
            key={c}
            className={`swatch${tool !== 'eraser' && color === c ? ' selected' : ''}`}
            style={{ background: c }}
            onClick={() => {
              setColor(c)
              if (tool === 'eraser') setTool('pen')
            }}
            aria-label={`いろ ${c}`}
          />
        ))}
      </div>

      <div className="tool-row">
        {WIDTHS.map((w, i) => (
          <button
            key={w}
            className={`btn btn-tool btn-mid width-btn${tool === 'pen' && widthIdx === i ? ' selected' : ''}`}
            onClick={() => {
              setTool('pen')
              setWidthIdx(i)
            }}
            aria-label={`ペンの ふとさ ${i + 1}`}
          >
            <span className="width-dot" style={{ width: 6 + i * 7, height: 6 + i * 7 }} />
          </button>
        ))}
        <button
          className={`btn btn-tool btn-mid${tool === 'eraser' ? ' selected' : ''}`}
          onClick={() => setTool('eraser')}
        >
          🧽 けしゴム
        </button>
        <button
          className={`btn btn-tool btn-mid${tool === 'fill' ? ' selected' : ''}`}
          onClick={() => setTool('fill')}
        >
          🪣 バケツ
        </button>
      </div>

      <div className="draw-actions">
        <button className="btn btn-water btn-mid" onClick={undo}>
          ↩️ もどる
        </button>
        <button className="btn btn-water btn-mid" onClick={clearAll}>
          🗑 ぜんぶけす
        </button>
        <button className="btn btn-primary btn-big" onClick={handleDone}>
          できた！🐠
        </button>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
