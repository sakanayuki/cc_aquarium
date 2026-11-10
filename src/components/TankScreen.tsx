import { useEffect, useRef, useState } from 'react'
import { loadFish, saveFishList, type FishRecord } from '../lib/storage'
import {
  initAudio,
  isMuted,
  playBubble,
  playEat,
  playSplash,
  playSprinkle,
  playWelcome,
  setMuted,
} from '../lib/sound'
import {
  blitLayer,
  buildScene,
  clamp,
  contourY,
  drawBackPlants,
  drawCaustics,
  drawMidPlants,
  drawParticles,
  drawRays,
  drawSurface,
  type Ripple,
  type Scene,
} from '../tank/scene'
import FishListModal from './FishListModal'
import Icon from './Icon'

const MAX_PELLETS = 60
const SLICES = 26
/** 1つの餌を追いかけてこの秒数たっても食べられなければ、いったんあきらめる */
const CHASE_GIVE_UP_SEC = 7

type FishMode = 'swim' | 'bag' | 'free'

interface FishEntity {
  id: string
  img: HTMLImageElement
  ready: boolean
  mode: FishMode
  x: number
  y: number
  vx: number
  vy: number
  face: 1 | -1
  /** 見た目の向き（-1〜1 をなめらかに動かして、くるっと振り向かせる） */
  faceAnim: number
  targetX: number
  targetY: number
  wanderWait: number
  widthFrac: number
  phase: number
  swimPhase: number
  speedMul: number
  bobY: number
  chase: Pellet | null
  chaseTime: number
  giveUp: Pellet | null
  giveUpUntil: number
  chomp: number
  enterT: number
}

interface Pellet {
  x: number
  y: number
  vy: number
  sinkSpeed: number
  swayPhase: number
  state: 'air' | 'falling' | 'resting'
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
  back: boolean
}

interface Drop {
  x: number
  y: number
  vx: number
  vy: number
  r: number
}

type BagPhase = 'wait' | 'drop' | 'float' | 'pour' | 'lift'

interface Bag {
  fishId: string
  phase: BagPhase
  t: number
  x: number
  y: number
  vy: number
  angle: number
  alpha: number
  splashed: boolean
  released: boolean
  tapRequested: boolean
  dir: 1 | -1
}

interface Props {
  onDraw: () => void
  /** 描いたばかりの魚の id。あれば袋から放流する演出をする */
  releaseId?: string | null
  onReleaseDone?: () => void
}

type ReleaseUi = null | 'arrive' | 'welcome'

function fishAspect(ent: FishEntity) {
  return ent.ready && ent.img.naturalWidth > 0 ? ent.img.naturalHeight / ent.img.naturalWidth : 0.6
}

/** 魚の絵を、尾ほど大きく波打たせて描く */
function drawFishImage(
  ctx: CanvasRenderingContext2D,
  ent: FishEntity,
  x: number,
  y: number,
  dispW: number,
  energy: number,
  tilt: number,
) {
  const img = ent.img
  const dispH = dispW * fishAspect(ent)
  const chompScale = ent.chomp > 0 ? 1 + Math.sin((ent.chomp / 0.3) * Math.PI) * 0.06 : 1
  let fx = ent.faceAnim
  if (Math.abs(fx) < 0.12) fx = fx < 0 ? -0.12 : 0.12
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(tilt)
  ctx.scale(-fx * chompScale, chompScale)
  const srcW = img.naturalWidth
  const srcH = img.naturalHeight
  const sliceSrcW = srcW / SLICES
  const sliceDstW = dispW / SLICES
  for (let i = 0; i < SLICES; i++) {
    const u = i / (SLICES - 1)
    const amp = (1.5 + 13 * Math.pow(u, 1.6)) * energy * (dispW / 120)
    const offY = Math.sin(ent.swimPhase - u * 5.2) * Math.min(amp, 13 * energy)
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

/** 運搬用のビニール袋（local 座標：原点は袋の中心） */
function bagPath(ctx: CanvasRenderingContext2D, W: number, H: number) {
  const top = -H / 2
  const nw = W * 0.1
  ctx.beginPath()
  ctx.moveTo(-nw, top + H * 0.1)
  ctx.bezierCurveTo(-W * 0.52, top + H * 0.28, -W * 0.56, H * 0.32, -W * 0.32, H * 0.47)
  ctx.quadraticCurveTo(0, H * 0.58, W * 0.32, H * 0.47)
  ctx.bezierCurveTo(W * 0.56, H * 0.32, W * 0.52, top + H * 0.28, nw, top + H * 0.1)
  ctx.closePath()
}

export default function TankScreen({ onDraw, releaseId = null, onReleaseDone }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const entitiesRef = useRef<Map<string, FishEntity>>(new Map())
  const pelletsRef = useRef<Pellet[]>([])
  const bubblesRef = useRef<Bubble[]>([])
  const dropsRef = useRef<Drop[]>([])
  const ripplesRef = useRef<Ripple[]>([])
  const sceneRef = useRef<Scene | null>(null)
  const bagRef = useRef<Bag | null>(null)
  const bubbleTimerRef = useRef(0)
  const bubbleSoundAtRef = useRef(0)
  const undoTimerRef = useRef<number | undefined>(undefined)
  const welcomeTimerRef = useRef<number | undefined>(undefined)
  const releaseDoneRef = useRef(onReleaseDone)
  releaseDoneRef.current = onReleaseDone
  const releaseIdRef = useRef(releaseId)

  const [fishRecords, setFishRecords] = useState<FishRecord[]>(() => loadFish())
  const [showList, setShowList] = useState(false)
  const [lastDeleted, setLastDeleted] = useState<{ record: FishRecord; index: number } | null>(null)
  const [mutedState, setMutedState] = useState(isMuted())
  const [releaseUi, setReleaseUi] = useState<ReleaseUi>(null)
  const setReleaseUiRef = useRef(setReleaseUi)

  useEffect(
    () => () => {
      window.clearTimeout(undoTimerRef.current)
      window.clearTimeout(welcomeTimerRef.current)
    },
    [],
  )

  // 魚レコードと泳ぎエンティティの同期
  useEffect(() => {
    const map = entitiesRef.current
    const ids = new Set(fishRecords.map((f) => f.id))
    for (const key of [...map.keys()]) {
      if (!ids.has(key)) map.delete(key)
    }
    if (bagRef.current && !ids.has(bagRef.current.fishId)) bagRef.current = null
    for (const rec of fishRecords) {
      if (map.has(rec.id)) continue
      const img = new Image()
      const releasing = releaseIdRef.current === rec.id
      const ent: FishEntity = {
        id: rec.id,
        img,
        ready: false,
        mode: releasing ? 'bag' : 'swim',
        x: -1,
        y: -1,
        vx: 0,
        vy: 0,
        face: releasing ? 1 : Math.random() < 0.5 ? 1 : -1,
        faceAnim: 1,
        targetX: 0,
        targetY: 0,
        wanderWait: 0,
        widthFrac: 0.28 + Math.random() * 0.08,
        phase: Math.random() * Math.PI * 2,
        swimPhase: Math.random() * 10,
        speedMul: 0.85 + Math.random() * 0.35,
        bobY: 0,
        chase: null,
        chaseTime: 0,
        giveUp: null,
        giveUpUntil: 0,
        chomp: 0,
        enterT: 0,
      }
      ent.faceAnim = ent.face
      img.onload = () => {
        ent.ready = true
      }
      img.src = rec.dataUrl
      map.set(rec.id, ent)
      if (releasing) {
        releaseIdRef.current = null
        bagRef.current = {
          fishId: rec.id,
          phase: 'wait',
          t: 0,
          x: 0,
          y: 0,
          vy: 0,
          angle: 0,
          alpha: 1,
          splashed: false,
          released: false,
          tapRequested: false,
          dir: 1,
        }
        setReleaseUi('arrive')
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
    let dpr = Math.min(2, window.devicePixelRatio || 1)

    const resize = () => {
      const rect = wrap.getBoundingClientRect()
      dpr = Math.min(2, window.devicePixelRatio || 1)
      canvas.width = Math.max(1, Math.round(rect.width * dpr))
      canvas.height = Math.max(1, Math.round(rect.height * dpr))
      if (rect.width > 0 && rect.height > 0) sceneRef.current = buildScene(rect.width, rect.height, dpr)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(wrap)

    const dispWOf = (ent: FishEntity) => {
      const s = sceneRef.current!
      const H = s.L.frontY - s.L.waterY
      return Math.min(s.L.w * ent.widthFrac, H * 0.5)
    }

    const addRipple = (x: number, size: number) => {
      ripplesRef.current.push({ x, age: 0, size })
      if (ripplesRef.current.length > 16) ripplesRef.current.shift()
    }

    const splash = (x: number, strength: number) => {
      const s = sceneRef.current!
      addRipple(x, strength)
      addRipple(x, strength * 0.6)
      const n = Math.round(8 + strength * 10)
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.9
        const sp = (120 + Math.random() * 200) * Math.min(1.4, strength)
        dropsRef.current.push({
          x: x + (Math.random() - 0.5) * 20,
          y: s.L.waterY - 1,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp,
          r: 1.5 + Math.random() * 2.5,
        })
      }
      for (let i = 0; i < 6; i++) {
        bubblesRef.current.push({
          x: x + (Math.random() - 0.5) * 30,
          y: s.L.waterY + 10 + Math.random() * 30,
          r: 1.5 + Math.random() * 3,
          speed: 30 + Math.random() * 30,
          wobblePhase: Math.random() * Math.PI * 2,
          back: false,
        })
      }
      playSplash(strength)
    }

    const update = (dt: number, time: number) => {
      const s = sceneRef.current
      if (!s) return
      const L = s.L
      const { w } = L
      const H = L.frontY - L.waterY

      // ---- 餌
      for (const p of pelletsRef.current) {
        if (p.delay > 0) {
          p.delay -= dt
          continue
        }
        if (p.state === 'air') {
          p.vy += 900 * dt
          p.y += p.vy * dt
          if (p.y >= L.waterY) {
            p.y = L.waterY
            p.state = 'falling'
            addRipple(p.x, 0.3)
          }
        } else if (p.state === 'falling') {
          p.y += p.sinkSpeed * dt
          p.x += Math.sin(time * 2.2 + p.swayPhase) * 7 * dt
          p.x = clamp(p.x, w * 0.08, w * 0.92)
          if (p.y >= L.restY) {
            p.y = L.restY
            p.state = 'resting'
          }
        } else {
          p.restTime += dt
          p.alpha = p.restTime < 4 ? 1 : Math.max(0, 1 - (p.restTime - 4) / 1.2)
        }
      }
      pelletsRef.current = pelletsRef.current.filter((p) => p.alpha > 0)

      // ---- 泡（エアストーンから）
      bubbleTimerRef.current -= dt
      if (bubbleTimerRef.current <= 0 && bubblesRef.current.length < 40) {
        bubbleTimerRef.current = 0.12 + Math.random() * 0.22
        bubblesRef.current.push({
          x: s.airStoneX + (Math.random() - 0.5) * 6,
          y: contourY(L, s.airStoneX) + 6,
          r: 1.6 + Math.random() * 3.6,
          speed: 40 + Math.random() * 40,
          wobblePhase: Math.random() * Math.PI * 2,
          back: true,
        })
      }
      for (const b of bubblesRef.current) {
        b.y -= b.speed * dt
        b.speed = Math.min(b.speed + dt * 18, 110)
        b.x += Math.sin(time * 3 + b.wobblePhase) * 10 * dt
      }
      let popped = false
      bubblesRef.current = bubblesRef.current.filter((b) => {
        if (b.y > L.waterY + b.r) return true
        popped = true
        if (Math.random() < 0.25) addRipple(b.x, 0.18)
        return false
      })
      if (popped && time - bubbleSoundAtRef.current > 2.2 && Math.random() < 0.3) {
        playBubble()
        bubbleSoundAtRef.current = time
      }

      // ---- しぶき・波紋
      for (const d of dropsRef.current) {
        d.vy += 900 * dt
        d.x += d.vx * dt
        d.y += d.vy * dt
      }
      dropsRef.current = dropsRef.current.filter((d) => !(d.vy > 0 && d.y > L.waterY))
      for (const r of ripplesRef.current) r.age += dt
      ripplesRef.current = ripplesRef.current.filter((r) => r.age < 1.2)

      // ---- 袋（放流演出）
      const bag = bagRef.current
      if (bag) {
        const ent = entitiesRef.current.get(bag.fishId)
        if (!ent) {
          bagRef.current = null
        } else {
          const dispW = dispWOf(ent)
          const bagW = dispW * 1.4
          const bagH = bagW * 1.12
          const restY = L.waterY + bagH * 0.2
          bag.t += dt
          if (bag.phase === 'wait') {
            bag.x = w * 0.5
            bag.y = -bagH
            if (bag.t > 0.45) {
              bag.phase = 'drop'
              bag.t = 0
            }
          } else if (bag.phase === 'drop' || bag.phase === 'float') {
            if (!bag.splashed) {
              bag.vy += 1500 * dt
              if (bag.y + bagH * 0.45 >= L.waterY) {
                bag.splashed = true
                splash(bag.x, 1.1)
              }
            } else {
              // 浮力：ばねで水面にぷかぷか
              const acc = -120 * (bag.y - restY) - 7 * bag.vy
              bag.vy += acc * dt
            }
            bag.y += bag.vy * dt
            bag.y = Math.min(bag.y, restY + bagH * 0.35)
            bag.angle = Math.sin(time * 1.7) * 0.07
            if (bag.phase === 'drop' && bag.splashed && bag.t > 1.0) {
              bag.phase = 'float'
              bag.t = 0
            }
            if (bag.phase === 'float') {
              bag.y += Math.sin(time * 2.3) * 0.12
              if ((bag.tapRequested && bag.t > 0.3) || bag.t > 6) {
                bag.phase = 'pour'
                bag.t = 0
              }
            }
          } else if (bag.phase === 'pour') {
            const k = clamp(bag.t / 0.55, 0, 1)
            const ease = 1 - Math.pow(1 - k, 3)
            bag.angle = bag.dir * ease * 1.25
            if (!bag.released && bag.t > 0.3) {
              bag.released = true
              // 袋の口から、魚が水の中へ
              const lx = 0
              const ly = bagH * 0.12
              ent.x = bag.x + lx * Math.cos(bag.angle) - ly * Math.sin(bag.angle)
              ent.y = Math.max(L.waterY + 4, bag.y + lx * Math.sin(bag.angle) + ly * Math.cos(bag.angle))
              ent.vx = bag.dir * 170
              ent.vy = 90
              ent.face = bag.dir
              ent.faceAnim = bag.dir
              ent.mode = 'free'
              ent.enterT = 0
              splash(bag.x + bag.dir * bagW * 0.3, 0.8)
              for (let i = 0; i < 12; i++) {
                bubblesRef.current.push({
                  x: ent.x + (Math.random() - 0.5) * dispW * 0.6,
                  y: ent.y + (Math.random() - 0.5) * 20,
                  r: 1.5 + Math.random() * 3.5,
                  speed: 30 + Math.random() * 40,
                  wobblePhase: Math.random() * Math.PI * 2,
                  back: false,
                })
              }
              playWelcome()
              setReleaseUiRef.current('welcome')
              window.clearTimeout(welcomeTimerRef.current)
              welcomeTimerRef.current = window.setTimeout(() => setReleaseUiRef.current(null), 2200)
            }
            if (bag.t > 0.75) {
              bag.phase = 'lift'
              bag.t = 0
              bag.vy = -60
            }
          } else if (bag.phase === 'lift') {
            bag.vy -= 900 * dt
            bag.y += bag.vy * dt
            bag.angle += bag.dir * dt * 0.8
            bag.alpha = Math.max(0, 1 - bag.t / 0.6)
            if (bag.t > 0.6) {
              bagRef.current = null
              releaseDoneRef.current?.()
            }
          }
        }
      }

      // ---- 魚
      const ents = [...entitiesRef.current.values()]
      const swimmers = ents.filter((e) => e.mode === 'swim')
      const avail = pelletsRef.current.filter((p) => p.delay <= 0 && p.state !== 'air')

      // 餌の割り当て：1粒を追うのは1匹だけ（取り合いで止まらないように）。
      // 近い組み合わせから順に決め、いま追っている餌は少し優先して、毎フレームの乗りかえを防ぐ。
      const claims = new Map<FishEntity, Pellet>()
      if (avail.length > 0 && swimmers.length > 0) {
        const pairs: { d: number; f: FishEntity; p: Pellet }[] = []
        for (const f of swimmers) {
          const fw = dispWOf(f)
          const mx = f.x + f.face * fw * 0.42
          const my = f.y + f.bobY
          for (const p of avail) {
            if (f.giveUp === p && time < f.giveUpUntil) continue
            let d = Math.hypot(p.x - mx, p.y - my)
            if (f.chase === p) d *= 0.7
            pairs.push({ d, f, p })
          }
        }
        pairs.sort((a, b) => a.d - b.d)
        const taken = new Set<Pellet>()
        for (const { f, p } of pairs) {
          if (claims.has(f) || taken.has(p)) continue
          claims.set(f, p)
          taken.add(p)
        }
      }

      const eaten = new Set<Pellet>()
      for (const ent of ents) {
        if (ent.mode === 'bag') {
          ent.swimPhase += dt * 7
          continue
        }
        const dispW = dispWOf(ent)
        const dispH = dispW * fishAspect(ent)
        if (ent.x < 0) {
          ent.x = w * (0.25 + Math.random() * 0.5)
          ent.y = L.waterY + H * (0.2 + Math.random() * 0.45)
          ent.targetX = ent.x
          ent.targetY = ent.y
        }
        if (ent.chomp > 0) ent.chomp = Math.max(0, ent.chomp - dt)
        const speed = Math.hypot(ent.vx, ent.vy)
        ent.swimPhase += dt * (6 + speed * 0.05)
        ent.bobY = Math.sin(time * 2 + ent.phase) * 4
        ent.faceAnim += (ent.face - ent.faceAnim) * Math.min(1, dt * 9)

        if (ent.mode === 'free') {
          // 袋から出たばかり：勢いで水中へ入り、だんだん落ち着く
          ent.enterT += dt
          ent.swimPhase += dt * 8
          const prevY = ent.y
          if (ent.y < L.waterY) ent.vy += 1300 * dt
          else {
            const drag = Math.exp(-dt * 2.4)
            ent.vx *= drag
            ent.vy *= drag
          }
          ent.x += ent.vx * dt
          ent.y += ent.vy * dt
          if (prevY < L.waterY && ent.y >= L.waterY) splash(ent.x, 0.6)
          ent.x = clamp(ent.x, dispW * 0.5, w - dispW * 0.5)
          ent.y = Math.min(ent.y, L.frontY - dispH * 0.3 - 4)
          if (ent.enterT > 1.2 && ent.y > L.waterY + dispH * 0.4) {
            ent.mode = 'swim'
            ent.wanderWait = 2
            ent.targetX = clamp(ent.x + ent.face * w * 0.25, dispW * 0.6, w - dispW * 0.6)
            ent.targetY = L.waterY + H * 0.45
            // ほかの魚が「だれかな？」と見に来る
            for (const o of swimmers) {
              if (o === ent) continue
              const ow = dispWOf(o)
              o.targetX = clamp(ent.x + (o.x < ent.x ? -1 : 1) * (dispW + ow) * 0.45, ow * 0.6, w - ow * 0.6)
              o.targetY = clamp(ent.y + (Math.random() - 0.5) * H * 0.2, L.waterY + H * 0.12, L.frontY - H * 0.15)
              o.wanderWait = 2.2 + Math.random()
            }
          }
          continue
        }

        const mouthOff = dispW * 0.42
        let tx: number
        let ty: number
        let maxSpeed: number
        let chasing = false
        let arriveR = 90
        let minSlow = 0.25
        const p = claims.get(ent) ?? null
        if (p !== ent.chase) {
          ent.chase = p
          ent.chaseTime = 0
        }
        if (p) {
          chasing = true
          ent.chaseTime += dt
          if (ent.chaseTime > CHASE_GIVE_UP_SEC) {
            // どうしても届かない餌はしばらく無視する（スタック防止の保険）
            ent.giveUp = p
            ent.giveUpUntil = time + 4
          }
          // 振り向きにはヒステリシスをつけ、餌の真上・真下で向きがぱたぱた変わらないようにする
          const rel = p.x - ent.x
          if (ent.face === 1 && rel < -dispW * 0.12) ent.face = -1
          else if (ent.face === -1 && rel > dispW * 0.12) ent.face = 1
          // 体の中心ではなく「口」を餌に合わせる
          tx = p.x - ent.face * mouthOff
          ty = p.y - ent.bobY
          maxSpeed = 150 * ent.speedMul
          arriveR = 60
          minSlow = 0.12
          const mouthX = ent.x + ent.face * mouthOff
          const mouthY = ent.y + ent.bobY
          if (Math.hypot(p.x - mouthX, p.y - mouthY) < Math.max(14, dispW * 0.1)) {
            eaten.add(p)
            ent.chase = null
            ent.chaseTime = 0
            ent.chomp = 0.3
            playEat()
            for (let i = 0; i < 3; i++) {
              bubblesRef.current.push({
                x: mouthX,
                y: mouthY,
                r: 1.6 + Math.random() * 2.6,
                speed: 34 + Math.random() * 26,
                wobblePhase: Math.random() * Math.PI * 2,
                back: false,
              })
            }
          }
        } else if (avail.length > 0) {
          // 餌はあるけれど、ほかの魚が先に取りに行っている：近くで順番待ち
          let best: Pellet | null = null
          let bd = Infinity
          for (const q of avail) {
            const d = Math.hypot(q.x - ent.x, q.y - ent.y)
            if (d < bd) {
              bd = d
              best = q
            }
          }
          const keep = dispW * 0.95
          if (best && bd > keep) {
            tx = best.x + ((ent.x - best.x) / bd) * keep
            ty = best.y + ((ent.y - best.y) / bd) * keep
          } else {
            tx = ent.x + Math.sin(time * 0.7 + ent.phase) * 10
            ty = ent.y
          }
          maxSpeed = 75 * ent.speedMul
        } else {
          ent.wanderWait -= dt
          const distT = Math.hypot(ent.targetX - ent.x, ent.targetY - ent.y)
          if (ent.wanderWait <= 0 || distT < 12) {
            ent.wanderWait = 1.5 + Math.random() * 3
            const loY = L.waterY + H * 0.1 + dispH * 0.4
            const hiY = Math.max(loY + 1, L.frontY - H * 0.12 - dispH * 0.3)
            ent.targetX = dispW * 0.6 + Math.random() * Math.max(1, w - dispW * 1.2)
            ent.targetY = loY + Math.random() * (hiY - loY)
          }
          tx = ent.targetX
          ty = ent.targetY
          maxSpeed = 42 * ent.speedMul
        }

        const dx = tx - ent.x
        const dy = ty - ent.y
        const dist = Math.hypot(dx, dy) || 1
        const slow = clamp(dist / arriveR, minSlow, 1)
        const desVx = (dx / dist) * maxSpeed * slow
        const desVy = (dy / dist) * maxSpeed * slow
        const k = 1 - Math.exp(-dt * (chasing ? 5 : 3.2))
        ent.vx += (desVx - ent.vx) * k
        ent.vy += (desVy - ent.vy) * k

        // 重なりすぎないように、ゆるく押し合う（餌を追っている魚は対象外）
        if (!chasing) {
          for (const o of swimmers) {
            if (o === ent) continue
            const ox = ent.x - o.x
            const oy = (ent.y - o.y) * 1.6
            const d = Math.hypot(ox, oy)
            const minD = (dispW + dispWOf(o)) * 0.32
            if (d > 0.01 && d < minD) {
              const push = (1 - d / minD) * 260
              ent.vx += (ox / d) * push * dt
              ent.vy += (oy / d) * push * dt * 0.6
            }
          }
        }

        ent.x += ent.vx * dt
        ent.y += ent.vy * dt

        // 水槽の中に収める（はみ出したら、なめらかに押し戻す）
        const mx = dispW * 0.5
        const top = L.waterY + dispH * 0.45
        const bottom = chasing && p && p.state === 'resting' ? L.frontY - 3 : L.frontY - dispH * 0.3 - 4
        const ease = Math.min(1, dt * 6)
        if (ent.x < mx) {
          ent.x += (mx - ent.x) * ease
          ent.vx = Math.max(ent.vx, 0)
        }
        if (ent.x > w - mx) {
          ent.x += (w - mx - ent.x) * ease
          ent.vx = Math.min(ent.vx, 0)
        }
        ent.x = clamp(ent.x, dispW * 0.3, w - dispW * 0.3)
        if (ent.y < top) {
          ent.y += (top - ent.y) * ease
          ent.vy = Math.max(ent.vy, 0)
        }
        if (ent.y > bottom) {
          ent.y += (bottom - ent.y) * ease
          ent.vy = Math.min(ent.vy, 0)
        }
        if (!chasing) {
          if (ent.vx > 8) ent.face = 1
          else if (ent.vx < -8) ent.face = -1
        }
      }
      if (eaten.size > 0) pelletsRef.current = pelletsRef.current.filter((p) => !eaten.has(p))
    }

    const drawBubble = (b: Bubble) => {
      ctx.strokeStyle = 'rgba(232,248,255,0.6)'
      ctx.lineWidth = 1.3
      ctx.beginPath()
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2)
      ctx.stroke()
      ctx.fillStyle = 'rgba(255,255,255,0.12)'
      ctx.fill()
      ctx.fillStyle = 'rgba(255,255,255,0.85)'
      ctx.beginPath()
      ctx.arc(b.x - b.r * 0.3, b.y - b.r * 0.3, b.r * 0.28, 0, Math.PI * 2)
      ctx.fill()
    }

    const drawPellet = (p: Pellet) => {
      ctx.globalAlpha = p.alpha
      ctx.fillStyle = '#7a4a1c'
      ctx.beginPath()
      ctx.arc(p.x, p.y, 4.2, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#b07a3a'
      ctx.beginPath()
      ctx.arc(p.x - 1.2, p.y - 1.3, 2, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalAlpha = 1
    }

    const drawSwimFish = (ent: FishEntity) => {
      if (!ent.ready || ent.x < 0 || ent.mode === 'bag') return
      const dispW = dispWOf(ent)
      const speed = Math.hypot(ent.vx, ent.vy)
      const energy = clamp(0.35 + speed / 120, 0.35, ent.mode === 'free' ? 1.6 : 1.35)
      const tilt = ent.face * clamp(ent.vy * 0.0032, -0.3, 0.3)
      drawFishImage(ctx, ent, ent.x, ent.y + ent.bobY, dispW, energy, tilt)
    }

    const drawBag = (bag: Bag) => {
      const s = sceneRef.current!
      const ent = entitiesRef.current.get(bag.fishId)
      if (!ent || bag.phase === 'wait') return
      const dispW = dispWOf(ent)
      const W = dispW * 1.4
      const Hh = W * 1.12
      ctx.save()
      ctx.globalAlpha = bag.alpha
      ctx.translate(bag.x, bag.y)
      ctx.rotate(bag.angle)
      // 中の水（水平を保つ）＋ 魚
      ctx.save()
      bagPath(ctx, W, Hh)
      ctx.clip()
      ctx.rotate(-bag.angle)
      const lvl = s.L.waterY - bag.y + 2
      ctx.fillStyle = 'rgba(150,215,240,0.28)'
      ctx.fillRect(-W * 1.5, -Hh * 1.5, W * 3, Hh * 3)
      if (!bag.released) {
        ctx.fillStyle = 'rgba(90,180,225,0.42)'
        ctx.fillRect(-W * 1.5, Math.min(lvl, -Hh * 0.05), W * 3, Hh * 3)
      }
      ctx.restore()
      if (!bag.released && ent.ready) {
        ctx.save()
        bagPath(ctx, W, Hh)
        ctx.clip()
        drawFishImage(ctx, ent, 0, Hh * 0.16 + Math.sin(ent.swimPhase * 0.3) * 2, dispW * 0.9, 0.7, 0)
        ctx.restore()
      }
      // ビニールのつや
      bagPath(ctx, W, Hh)
      ctx.fillStyle = 'rgba(255,255,255,0.08)'
      ctx.fill()
      ctx.strokeStyle = 'rgba(255,255,255,0.85)'
      ctx.lineWidth = 2
      ctx.stroke()
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'
      ctx.lineWidth = 3.5
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(-W * 0.36, -Hh * 0.08)
      ctx.quadraticCurveTo(-W * 0.42, Hh * 0.18, -W * 0.28, Hh * 0.36)
      ctx.stroke()
      // 結び目と輪ゴム（あけたら消える）
      const top = -Hh / 2
      if (!bag.released) {
        ctx.fillStyle = 'rgba(255,255,255,0.55)'
        ctx.strokeStyle = 'rgba(255,255,255,0.9)'
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.moveTo(-W * 0.1, top + Hh * 0.1)
        ctx.lineTo(-W * 0.2, top - Hh * 0.08)
        ctx.quadraticCurveTo(0, top - Hh * 0.02, W * 0.2, top - Hh * 0.08)
        ctx.lineTo(W * 0.1, top + Hh * 0.1)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = '#ff8a3d'
        ctx.beginPath()
        ctx.roundRect(-W * 0.11, top + Hh * 0.05, W * 0.22, Hh * 0.05, 3)
        ctx.fill()
      } else {
        ctx.strokeStyle = 'rgba(255,255,255,0.85)'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(-W * 0.1, top + Hh * 0.1)
        ctx.lineTo(-W * 0.16, top - Hh * 0.02)
        ctx.moveTo(W * 0.1, top + Hh * 0.1)
        ctx.lineTo(W * 0.16, top - Hh * 0.02)
        ctx.stroke()
      }
      ctx.restore()
      // 水に浸かっている部分は水の色を重ねる
      if (bag.alpha > 0.5) {
        ctx.save()
        ctx.translate(bag.x, bag.y)
        ctx.rotate(bag.angle)
        bagPath(ctx, W, Hh)
        ctx.clip()
        ctx.rotate(-bag.angle)
        ctx.fillStyle = 'rgba(40,140,190,0.22)'
        ctx.fillRect(-W * 1.5, s.L.waterY - bag.y, W * 3, Hh * 3)
        ctx.restore()
      }
    }

    const render = (time: number) => {
      const s = sceneRef.current
      if (!s) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, s.L.w, s.L.h)
      blitLayer(ctx, s.back, dpr)
      drawRays(ctx, s, time)
      drawBackPlants(ctx, s, time)
      for (const b of bubblesRef.current) if (b.back) drawBubble(b)
      blitLayer(ctx, s.hard, dpr)
      drawCaustics(ctx, s, time)
      drawMidPlants(ctx, s, time)
      drawParticles(ctx, s, time)
      drawSurface(ctx, s, time, ripplesRef.current)
      for (const p of pelletsRef.current) if (p.delay <= 0 && p.state !== 'resting') drawPellet(p)
      for (const ent of entitiesRef.current.values()) drawSwimFish(ent)
      for (const b of bubblesRef.current) if (!b.back) drawBubble(b)
      blitLayer(ctx, s.front, dpr)
      for (const p of pelletsRef.current) if (p.state === 'resting') drawPellet(p)
      ctx.fillStyle = 'rgba(225,245,255,0.9)'
      for (const d of dropsRef.current) {
        ctx.beginPath()
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2)
        ctx.fill()
      }
      if (bagRef.current) drawBag(bagRef.current)
    }

    const loop = (t: number) => {
      const dt = Math.min(0.05, (t - last) / 1000)
      last = t
      update(dt, t / 1000)
      render(t / 1000)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    if (import.meta.env.DEV) {
      // 動作確認用（開発時のみ）
      ;(window as unknown as Record<string, unknown>).__tank = { pelletsRef, entitiesRef, bagRef}
    }
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [])

  const feed = () => {
    initAudio()
    const s = sceneRef.current
    if (!s) return
    const { w } = s.L
    const pellets = pelletsRef.current
    const room = MAX_PELLETS - pellets.length
    if (room <= 0) return
    const n = Math.min(room, 5 + Math.floor(Math.random() * 4))
    for (let i = 0; i < n; i++) {
      pellets.push({
        x: w * 0.1 + Math.random() * w * 0.8,
        y: s.L.lidH + 2 + Math.random() * 6,
        vy: 0,
        sinkSpeed: 20 + Math.random() * 15,
        swayPhase: Math.random() * Math.PI * 2,
        state: 'air',
        restTime: 0,
        delay: i * 0.09,
        alpha: 1,
      })
    }
    playSprinkle()
  }

  const onStagePointerDown = () => {
    const bag = bagRef.current
    if (bag && (bag.phase === 'float' || bag.phase === 'drop')) bag.tapRequested = true
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
    <div className="screen tank-screen">
      <div className="tank-stage">
        <div className="tank-canvas-wrap" ref={wrapRef} onPointerDown={onStagePointerDown}>
          <canvas ref={canvasRef} />
        </div>
        <div className="tank-top">
          <div className="m3-chip" aria-label={`おさかな ${fishRecords.length}ひき`}>
            <Icon name="fish" size={20} />
            {fishRecords.length}ひき
          </div>
          <button
            className={`m3-icon-btn on-glass${mutedState ? ' toggle-off' : ''}`}
            onClick={toggleMute}
            aria-label="おと オン・オフ"
            aria-pressed={!mutedState}
          >
            <Icon name={mutedState ? 'volume_off' : 'volume_up'} />
          </button>
        </div>
        {releaseUi && (
          <div className="release-banner" aria-live="polite">
            {releaseUi === 'arrive' ? (
              <div className="release-card" key="arrive">
                <span className="title">あたらしい なかまが きたよ！</span>
                <span className="sub pulse">タップして すいそうに はなそう</span>
              </div>
            ) : (
              <div className="release-card welcome" key="welcome">
                <span className="title">ようこそ！ よろしくね</span>
              </div>
            )}
          </div>
        )}
        {fishRecords.length === 0 && (
          <div className="empty-guide">
            <div className="empty-card">
              <div className="headline">おさかなを かいてね</div>
              <div className="supporting">かいた おさかなが ここで およぐよ</div>
              <button className="m3-fab tertiary" onClick={onDraw}>
                <Icon name="brush" size={28} />
                おえかきする
              </button>
            </div>
          </div>
        )}
        {lastDeleted && (
          <div className="m3-snackbar" role="status">
            <span className="msg">おさかなを けしたよ</span>
            <button className="m3-btn inverse-text size-s" onClick={undoDelete}>
              もどす
            </button>
          </div>
        )}
      </div>
      <nav className="m3-docked-toolbar" aria-label="すいそうの ボタン">
        <button className="m3-toolbar-item" onClick={() => setShowList(true)}>
          <span className="indicator">
            <Icon name="collection" />
          </span>
          <span className="label">いちらん</span>
        </button>
        <button className="m3-fab primary" onClick={feed}>
          <Icon name="food" size={30} />
          えさやり
        </button>
        <button className="m3-toolbar-item" onClick={onDraw}>
          <span className="indicator">
            <Icon name="brush" />
          </span>
          <span className="label">おえかき</span>
        </button>
      </nav>
      {showList && (
        <FishListModal fish={fishRecords} onClose={() => setShowList(false)} onDelete={handleDelete} />
      )}
    </div>
  )
}
