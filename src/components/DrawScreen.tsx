import { useEffect, useRef, useState } from 'react'
import { TEMPLATES } from '../lib/templates'
import { addFish, loadFish, MAX_FISH } from '../lib/storage'
import { initAudio, isMuted, playFanfare, setMuted } from '../lib/sound'
import Icon from './Icon'

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
  /** 保存できたら、新しい魚の id を渡す */
  onDone: (newFishId: string) => void
  onBack: () => void
}

const WIDTH_LABELS = ['ほそい', 'ふつう', 'ふとい']

/** 色が明るいかどうか（チェックマークの色を決める） */
function isLight(hex: string) {
  const n = parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return r * 0.299 + g * 0.587 + b * 0.114 > 160
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
  const [lifting, setLifting] = useState(false)

  const showToast = (msg: string) => {
    setToast(msg)
    window.clearTimeout(toastTimerRef.current)
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2600)
  }

  useEffect(() => () => window.clearTimeout(toastTimerRef.current), [])

  // 枠線テンプレートを下のレイヤーに描く
  useEffect(() => {
    const canvas = tmplRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, SIZE, SIZE)
    const path = new Path2D(TEMPLATES[tmplIdx].path)
    ctx.fillStyle = 'rgba(0, 99, 155, 0.07)'
    ctx.fill(path)
    ctx.strokeStyle = 'rgba(0, 99, 155, 0.45)'
    ctx.lineWidth = 15
    ctx.setLineDash([30, 22])
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
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
      ctx.globalCompositeOperation = 'source-over'
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
    if (!canvas || lifting) return
    ;(e.target as Element).setPointerCapture(e.pointerId)
    const pos = getPos(e)
    const ctx = canvas.getContext('2d')!
    if (tool === 'fill') {
      pushHistory()
      ctx.globalCompositeOperation = 'source-over'
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
    if (!canvas || lifting) return
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
    // 絵がふわっと持ち上がってから水槽へ
    setLifting(true)
    const newId = next[next.length - 1].id
    window.setTimeout(() => onDone(newId), 480)
  }

  const toggleMute = () => {
    const v = !mutedState
    setMuted(v)
    setMutedState(v)
  }

  return (
    <div className="screen draw-screen">
      <div className="draw-topbar">
        <button className="m3-icon-btn tonal" onClick={onBack} aria-label="すいそうに もどる">
          <Icon name="arrow_back" />
        </button>
        <div className="m3-connected" role="radiogroup" aria-label="さかなの かたち">
          {TEMPLATES.map((t, i) => (
            <button
              key={t.id}
              role="radio"
              aria-checked={i === tmplIdx}
              aria-label={t.name}
              className={`m3-seg-btn${i === tmplIdx ? ' selected' : ''}`}
              onClick={() => setTmplIdx(i)}
            >
              <svg className="template-icon" viewBox="40 180 950 640" aria-hidden>
                <path
                  d={t.path}
                  fill="currentColor"
                  fillOpacity={0.18}
                  stroke="currentColor"
                  strokeWidth={46}
                  strokeDasharray="80 50"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          ))}
        </div>
        <button
          className={`m3-icon-btn tonal${mutedState ? ' toggle-off' : ''}`}
          onClick={toggleMute}
          aria-label="おと オン・オフ"
          aria-pressed={!mutedState}
        >
          <Icon name={mutedState ? 'volume_off' : 'volume_up'} />
        </button>
      </div>

      <div className="draw-canvas-area">
        <div className={`draw-canvas-wrap${lifting ? ' lifting' : ''}`}>
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
      </div>

      <div className="palette" role="radiogroup" aria-label="いろ">
        {COLORS.map((c) => {
          const selected = tool !== 'eraser' && color === c
          return (
            <button
              key={c}
              role="radio"
              aria-checked={selected}
              className={`swatch${selected ? ' selected' : ''}`}
              style={{ background: c, color: isLight(c) ? '#181c20' : '#ffffff' }}
              onClick={() => {
                setColor(c)
                if (tool === 'eraser') setTool('pen')
              }}
              aria-label={`いろ ${c}`}
            >
              {selected && <Icon name="check" size={22} />}
            </button>
          )
        })}
      </div>

      <div className="m3-connected" role="radiogroup" aria-label="どうぐ">
        {WIDTHS.map((w, i) => (
          <button
            key={w}
            role="radio"
            aria-checked={tool === 'pen' && widthIdx === i}
            className={`m3-seg-btn${tool === 'pen' && widthIdx === i ? ' selected' : ''}`}
            onClick={() => {
              setTool('pen')
              setWidthIdx(i)
            }}
          >
            <span className="width-dot-box">
              <span
                className="width-dot"
                style={{ width: 6 + i * 7, height: 6 + i * 7 }}
              />
            </span>
            {WIDTH_LABELS[i]}
          </button>
        ))}
        <button
          role="radio"
          aria-checked={tool === 'eraser'}
          className={`m3-seg-btn${tool === 'eraser' ? ' selected' : ''}`}
          onClick={() => setTool('eraser')}
        >
          <Icon name="eraser" />
          けしゴム
        </button>
        <button
          role="radio"
          aria-checked={tool === 'fill'}
          className={`m3-seg-btn${tool === 'fill' ? ' selected' : ''}`}
          onClick={() => setTool('fill')}
        >
          <Icon name="fill" />
          バケツ
        </button>
      </div>

      <div className="draw-actions">
        <button className="m3-icon-btn tonal" onClick={undo} aria-label="ひとつ もどる">
          <Icon name="undo" size={28} />
        </button>
        <button className="m3-icon-btn tonal" onClick={clearAll} aria-label="ぜんぶ けす">
          <Icon name="delete" size={28} />
        </button>
        <button className="m3-fab tertiary" onClick={handleDone}>
          <Icon name="check" size={30} />
          できた！
        </button>
      </div>

      {toast && (
        <div className="m3-snackbar draw-snackbar" role="status">
          <span className="msg">{toast}</span>
        </div>
      )}
    </div>
  )
}
