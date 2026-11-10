import { useEffect, useRef, useState } from 'react'
import { loadFish, saveFishList, type FishRecord } from '../lib/storage'
import { initAudio, isMuted, playBubble, playEat, playSprinkle, setMuted } from '../lib/sound'
import FishListModal from './FishListModal'

const MAX_PELLETS = 60
const SLICES = 26

interface FishEntity {
  id: string
  img: HTMLImageElement
  ready: boolean
  x: number
  y: number
  vx: number
  vy: number
  face: 1 | -1
  targetX: number
  targetY: number
  wanderWait: number
  widthFrac: number
  phase: number
  swimPhase: number
  speedMul: number
  bobY: number
}

interface Pellet {
  x: number
  y: number
  sinkSpeed: number
  swayPhase: number
  state: 'falling' | 'resting'
  restTime: number
  delay: number
  alpha: number
}

interface Bubble {
  x: number
  y: number
  r: number
  speed: number
  wobblePhase: number
}

interface Plant {
  xFrac: number
  heightFrac: number
  phase: number
  blades: number
}

const PLANTS: Plant[] = [
  { xFrac: 0.07, heightFrac: 0.34, phase: 0.4, blades: 3 },
  { xFrac: 0.2, heightFrac: 0.24, phase: 2.1, blades: 2 },
  { xFrac: 0.8, heightFrac: 0.28, phase: 1.2, blades: 3 },
  { xFrac: 0.93, heightFrac: 0.38, phase: 3.4, blades: 2 },
]

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}

/** 背景（水・砂利・岩）をオフスクリーンに描く */
function buildDecor(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w))
  c.height = Math.max(1, Math.round(h))
  const ctx = c.getContext('2d')!
  // 水のグラデーション
  const grad = ctx.createLinearGradient(0, 0, 0, h)
  grad.addColorStop(0, '#5ec2f2')
  grad.addColorStop(0.55, '#2b93d8')
  grad.addColorStop(1, '#1668ab')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, w, h)
  // 光の筋
  ctx.save()
  ctx.globalAlpha = 0.07
  ctx.fillStyle = '#ffffff'
  for (let i = 0; i < 3; i++) {
    const x = w * (0.18 + i * 0.3)
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x + w * 0.09, 0)
    ctx.lineTo(x + w * 0.02, h * 0.75)
    ctx.lineTo(x - w * 0.07, h * 0.75)
    ctx.closePath()
    ctx.fill()
  }
  ctx.restore()
  // 砂利
  const gravelH = h * 0.1
  ctx.fillStyle = '#c9ae7e'
  ctx.fillRect(0, h - gravelH, w, gravelH)
  let seed = 1234567
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed / 2147483648
  }
  const pebbleColors = ['#b89b6c', '#a5875a', '#dcc491', '#97835f', '#e6d3a3']
  for (let i = 0; i < Math.floor(w / 3); i++) {
    const px = rand() * w
    const py = h - gravelH + rand() * gravelH
    const pr = 2.5 + rand() * 5
    ctx.fillStyle = pebbleColors[Math.floor(rand() * pebbleColors.length)]
    ctx.beginPath()
    ctx.ellipse(px, py, pr, pr * 0.62, rand() * 0.6, 0, Math.PI * 2)
    ctx.fill()
  }
  // 岩
  const drawRock = (cx: number, cy: number, rw: number, rh: number, tone: string) => {
    ctx.fillStyle = tone
    ctx.beginPath()
    ctx.ellipse(cx, cy, rw, rh, 0, Math.PI, Math.PI * 2)
    ctx.quadraticCurveTo(cx + rw * 0.9, cy + rh * 0.4, cx + rw * 0.6, cy + rh * 0.55)
    ctx.lineTo(cx - rw * 0.6, cy + rh * 0.55)
    ctx.quadraticCurveTo(cx - rw * 0.9, cy + rh * 0.4, cx - rw, cy)
    ctx.fill()
    ctx.fillStyle = 'rgba(255,255,255,0.13)'
    ctx.beginPath()
    ctx.ellipse(cx - rw * 0.3, cy - rh * 0.35, rw * 0.42, rh * 0.3, -0.3, 0, Math.PI * 2)
    ctx.fill()
  }
  drawRock(w * 0.14, h - gravelH * 0.55, w * 0.13, h * 0.075, '#7d8a96')
  drawRock(w * 0.2, h - gravelH * 0.4, w * 0.09, h * 0.05, '#8d9aa5')
  drawRock(w * 0.88, h - gravelH * 0.5, w * 0.11, h * 0.065, '#75828d')
  return c
}

interface Props {
  onDraw: () => void
}

export default function TankScreen({ onDraw }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const entitiesRef = useRef<Map<string, FishEntity>>(new Map())
  const pelletsRef = useRef<Pellet[]>([])
  const bubblesRef = useRef<Bubble[]>([])
  const decorRef = useRef<HTMLCanvasElement | null>(null)
  const sizeRef = useRef({ w: 0, h: 0 })
  const bubbleTimerRef = useRef(0)
  const bubbleSoundAtRef = useRef(0)
  const undoTimerRef = useRef<number | undefined>(undefined)

  const [fishRecords, setFishRecords] = useState<FishRecord[]>(() => loadFish())
  const [showList, setShowList] = useState(false)
  const [lastDeleted, setLastDeleted] = useState<{ record: FishRecord; index: number } | null>(null)
  const [mutedState, setMutedState] = useState(isMuted())

  // 魚レコードと泳ぎエンティティの同期
  useEffect(() => {
    const map = entitiesRef.current
    const ids = new Set(fishRecords.map((f) => f.id))
    for (const key of [...map.keys()]) {
      if (!ids.has(key)) map.delete(key)
    }
    for (const rec of fishRecords) {
      if (!map.has(rec.id)) {
        const img = new Image()
        const ent: FishEntity = {
          id: rec.id,
          img,
          ready: false,
          x: -1,
          y: -1,
          vx: 0,
          vy: 0,
          face: Math.random() < 0.5 ? 1 : -1,
          targetX: 0,
          targetY: 0,
          wanderWait: 0,
          widthFrac: 0.28 + Math.random() * 0.08,
          phase: Math.random() * Math.PI * 2,
          swimPhase: Math.random() * 10,
          speedMul: 0.85 + Math.random() * 0.35,
          bobY: 0,
        }
        img.onload = () => {
          ent.ready = true
        }
        img.src = rec.dataUrl
        map.set(rec.id, ent)
      }
    }
  }, [fishRecords])

  // 描画ループ
  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return
    const ctx = canvas.getContext('2d')!
    let raf = 0
    let last = performance.now()

    const resize = () => {
      const rect = wrap.getBoundingClientRect()
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      canvas.width = Math.max(1, Math.round(rect.width * dpr))
      canvas.height = Math.max(1, Math.round(rect.height * dpr))
      sizeRef.current = { w: rect.width, h: rect.height }
      const decor = buildDecor(rect.width * dpr, rect.height * dpr)
      decorRef.current = decor
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(wrap)

    const floorY = () => sizeRef.current.h - sizeRef.current.h * 0.055

    const update = (dt: number, time: number) => {
      const { w, h } = sizeRef.current
      if (w === 0) return
      const pellets = pelletsRef.current

      // 餌の更新
      for (const p of pellets) {
        if (p.delay > 0) {
          p.delay -= dt
          continue
        }
        if (p.state === 'falling') {
          p.y += p.sinkSpeed * dt
          p.x += Math.sin(time * 2.2 + p.swayPhase) * 7 * dt
          if (p.y >= floorY()) {
            p.y = floorY()
            p.state = 'resting'
          }
        } else {
          p.restTime += dt
          p.alpha = p.restTime < 3.5 ? 1 : Math.max(0, 1 - (p.restTime - 3.5) / 1.2)
        }
      }
      pelletsRef.current = pellets.filter((p) => p.alpha > 0)

      // 泡の生成
      bubbleTimerRef.current -= dt
      if (bubbleTimerRef.current <= 0 && bubblesRef.current.length < 26) {
        bubbleTimerRef.current = 0.35 + Math.random() * 0.5
        const plant = PLANTS[Math.floor(Math.random() * PLANTS.length)]
        bubblesRef.current.push({
          x: w * plant.xFrac + (Math.random() - 0.5) * 14,
          y: h - h * 0.08,
          r: 2 + Math.random() * 4.5,
          speed: 26 + Math.random() * 34,
          wobblePhase: Math.random() * Math.PI * 2,
        })
      }
      // 泡の更新
      for (const b of bubblesRef.current) {
        b.y -= b.speed * dt
        b.x += Math.sin(time * 3 + b.wobblePhase) * 9 * dt
      }
      const before = bubblesRef.current.length
      bubblesRef.current = bubblesRef.current.filter((b) => b.y > b.r + 2)
      if (bubblesRef.current.length < before && time - bubbleSoundAtRef.current > 1.4) {
        if (Math.random() < 0.4) {
          playBubble()
          bubbleSoundAtRef.current = time
        }
      }

      // 魚の更新
      const activePellets = pelletsRef.current.filter((p) => p.delay <= 0)
      for (const ent of entitiesRef.current.values()) {
        if (ent.x < 0) {
          ent.x = w * (0.25 + Math.random() * 0.5)
          ent.y = h * (0.25 + Math.random() * 0.4)
          ent.targetX = ent.x
          ent.targetY = ent.y
        }
        const dispW = w * ent.widthFrac
        const speed = Math.hypot(ent.vx, ent.vy)
        ent.swimPhase += dt * (6 + speed * 0.05)
        ent.bobY = Math.sin(time * 2 + ent.phase) * 4

        const mouthX = ent.x + ent.face * dispW * 0.42
        const mouthY = ent.y + ent.bobY

        let tx: number
        let ty: number
        let maxSpeed: number
        let chasing: Pellet | null = null
        if (activePellets.length > 0) {
          let best = Infinity
          for (const p of activePellets) {
            const d = Math.hypot(p.x - mouthX, p.y - mouthY)
            if (d < best) {
              best = d
              chasing = p
            }
          }
          tx = chasing!.x
          ty = chasing!.y
          maxSpeed = 155 * ent.speedMul
          // 食べる判定
          if (best < Math.max(15, dispW * 0.075)) {
            pelletsRef.current = pelletsRef.current.filter((p) => p !== chasing)
            playEat()
            for (let i = 0; i < 3; i++) {
              bubblesRef.current.push({
                x: mouthX,
                y: mouthY,
                r: 1.6 + Math.random() * 2.6,
                speed: 34 + Math.random() * 26,
                wobblePhase: Math.random() * Math.PI * 2,
              })
            }
            continue
          }
        } else {
          ent.wanderWait -= dt
          const distT = Math.hypot(ent.targetX - ent.x, ent.targetY - ent.y)
          if (ent.wanderWait <= 0 || distT < 12) {
            ent.wanderWait = 1.5 + Math.random() * 3
            ent.targetX = dispW * 0.55 + Math.random() * (w - dispW * 1.1)
            ent.targetY = h * 0.14 + Math.random() * h * 0.62
          }
          tx = ent.targetX
          ty = ent.targetY
          maxSpeed = 42 * ent.speedMul
        }

        const dx = tx - ent.x
        const dy = ty - ent.y
        const dist = Math.hypot(dx, dy) || 1
        const slow = chasing ? 1 : clamp(dist / 90, 0.25, 1)
        const desVx = (dx / dist) * maxSpeed * slow
        const desVy = (dy / dist) * maxSpeed * slow
        const k = 1 - Math.exp(-dt * 3.2)
        ent.vx += (desVx - ent.vx) * k
        ent.vy += (desVy - ent.vy) * k
        ent.x += ent.vx * dt
        ent.y += ent.vy * dt
        // 水槽内に収める
        const mx = dispW * 0.52
        const top = h * 0.07
        const bottom = floorY() - 6
        if (ent.x < mx) {
          ent.x = mx
          ent.vx = Math.abs(ent.vx)
        }
        if (ent.x > w - mx) {
          ent.x = w - mx
          ent.vx = -Math.abs(ent.vx)
        }
        if (ent.y < top) {
          ent.y = top
          ent.vy = Math.abs(ent.vy)
        }
        if (ent.y > bottom) {
          ent.y = bottom
          ent.vy = -Math.abs(ent.vy)
        }
        if (ent.vx > 5) ent.face = 1
        else if (ent.vx < -5) ent.face = -1
      }
    }

    const drawPlant = (plant: Plant, time: number) => {
      const { w, h } = sizeRef.current
      const baseX = w * plant.xFrac
      const baseY = h - h * 0.045
      const height = h * plant.heightFrac
      for (let b = 0; b < plant.blades; b++) {
        const off = (b - (plant.blades - 1) / 2) * 9
        const sway = Math.sin(time * 1.3 + plant.phase + b * 0.7) * w * 0.02
        ctx.strokeStyle = b % 2 === 0 ? 'rgba(46, 160, 90, 0.9)' : 'rgba(72, 190, 110, 0.9)'
        ctx.lineWidth = 7 - b
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(baseX + off, baseY)
        ctx.quadraticCurveTo(
          baseX + off + sway * 0.4,
          baseY - height * 0.55,
          baseX + off + sway,
          baseY - height * (0.85 + (b % 2) * 0.15),
        )
        ctx.stroke()
      }
    }

    const drawFish = (ent: FishEntity) => {
      if (!ent.ready || ent.x < 0) return
      const { w } = sizeRef.current
      const img = ent.img
      const dispW = w * ent.widthFrac
      const dispH = dispW * (img.naturalHeight / img.naturalWidth)
      const speed = Math.hypot(ent.vx, ent.vy)
      const energy = clamp(0.35 + speed / 120, 0.35, 1.35)
      const tilt = ent.face * clamp(ent.vy * 0.0032, -0.3, 0.3)
      ctx.save()
      ctx.translate(ent.x, ent.y + ent.bobY)
      ctx.rotate(tilt)
      ctx.scale(-ent.face, 1)
      const srcW = img.naturalWidth
      const srcH = img.naturalHeight
      const sliceSrcW = srcW / SLICES
      const sliceDstW = dispW / SLICES
      for (let i = 0; i < SLICES; i++) {
        const u = i / (SLICES - 1)
        const amp = (1.5 + 13 * Math.pow(u, 1.6)) * energy
        const offY = Math.sin(ent.swimPhase - u * 5.2) * amp
        ctx.drawImage(
          img,
          i * sliceSrcW,
          0,
          sliceSrcW + 0.6,
          srcH,
          -dispW / 2 + i * sliceDstW,
          -dispH / 2 + offY,
          sliceDstW + 0.8,
          dispH,
        )
      }
      ctx.restore()
    }

    const render = (time: number) => {
      const { w, h } = sizeRef.current
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      if (decorRef.current) {
        ctx.save()
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.drawImage(decorRef.current, 0, 0)
        ctx.restore()
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      }
      for (const plant of PLANTS) drawPlant(plant, time)
      // 餌
      for (const p of pelletsRef.current) {
        if (p.delay > 0) continue
        ctx.save()
        ctx.globalAlpha = p.alpha
        ctx.fillStyle = '#8a5a22'
        ctx.beginPath()
        ctx.arc(p.x, p.y, 5, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = '#a9742f'
        ctx.beginPath()
        ctx.arc(p.x - 1.5, p.y - 1.5, 2.2, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
      }
      // 魚
      for (const ent of entitiesRef.current.values()) drawFish(ent)
      // 泡
      for (const b of bubblesRef.current) {
        ctx.save()
        ctx.globalAlpha = 0.55
        ctx.strokeStyle = '#e8f8ff'
        ctx.lineWidth = 1.4
        ctx.beginPath()
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2)
        ctx.stroke()
        ctx.globalAlpha = 0.8
        ctx.fillStyle = '#ffffff'
        ctx.beginPath()
        ctx.arc(b.x - b.r * 0.3, b.y - b.r * 0.3, b.r * 0.28, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
      }
    }

    const loop = (t: number) => {
      const dt = Math.min(0.05, (t - last) / 1000)
      last = t
      update(dt, t / 1000)
      render(t / 1000)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [])

  const feed = () => {
    initAudio()
    const { w } = sizeRef.current
    const pellets = pelletsRef.current
    const room = MAX_PELLETS - pellets.length
    if (room <= 0 || w === 0) return
    const n = Math.min(room, 5 + Math.floor(Math.random() * 4))
    for (let i = 0; i < n; i++) {
      pellets.push({
        x: 24 + Math.random() * Math.max(10, w - 48),
        y: 5,
        sinkSpeed: 20 + Math.random() * 15,
        swayPhase: Math.random() * Math.PI * 2,
        state: 'falling',
        restTime: 0,
        delay: i * 0.09,
        alpha: 1,
      })
    }
    playSprinkle()
  }

  const handleDelete = (record: FishRecord, index: number) => {
    const next = fishRecords.filter((f) => f.id !== record.id)
    saveFishList(next)
    setFishRecords(next)
    setShowList(false)
    setLastDeleted({ record, index })
    window.clearTimeout(undoTimerRef.current)
    undoTimerRef.current = window.setTimeout(() => setLastDeleted(null), 5000)
  }

  const undoDelete = () => {
    if (!lastDeleted) return
    const next = [...fishRecords]
    next.splice(Math.min(lastDeleted.index, next.length), 0, lastDeleted.record)
    saveFishList(next)
    setFishRecords(next)
    setLastDeleted(null)
    window.clearTimeout(undoTimerRef.current)
  }

  const toggleMute = () => {
    const v = !mutedState
    setMuted(v)
    setMutedState(v)
  }

  return (
    <div className="tank-screen">
      <div className="tank-canvas-wrap" ref={wrapRef}>
        <canvas ref={canvasRef} />
        {fishRecords.length === 0 && (
          <div className="empty-guide">
            <div className="guide-text">おさかなを かいてね 🐠</div>
            <button className="btn btn-primary btn-big" onClick={onDraw}>
              ✏️ おえかきする
            </button>
          </div>
        )}
        {lastDeleted && (
          <div className="undo-bar">
            <span>おさかなを けしたよ</span>
            <button className="btn btn-primary btn-mid" onClick={undoDelete}>
              もどす
            </button>
          </div>
        )}
      </div>
      <div className="tank-buttons">
        <button className="btn btn-primary btn-big" onClick={feed}>
          🍚 えさやり
        </button>
        <button className="btn btn-water btn-big" onClick={() => setShowList(true)}>
          🐠 いちらん
        </button>
        <button className="btn btn-water btn-big" onClick={onDraw}>
          ✏️ おえかき
        </button>
        <button className="btn icon-btn" onClick={toggleMute} aria-label="おと オン・オフ">
          {mutedState ? '🔇' : '🔊'}
        </button>
      </div>
      {showList && (
        <FishListModal fish={fishRecords} onClose={() => setShowList(false)} onDelete={handleDelete} />
      )}
    </div>
  )
}
