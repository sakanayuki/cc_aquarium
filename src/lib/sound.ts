// Web Audio 合成だけの簡易効果音。音ファイルは持たない。
let audioCtx: AudioContext | null = null
const MUTE_KEY = 'cc-aquarium-muted'
let muted = false
try {
  muted = localStorage.getItem(MUTE_KEY) === '1'
} catch {
  muted = false
}

export function initAudio() {
  if (!audioCtx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (AC) audioCtx = new AC()
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    void audioCtx.resume()
  }
}

export function isMuted() {
  return muted
}

export function setMuted(v: boolean) {
  muted = v
  try {
    localStorage.setItem(MUTE_KEY, v ? '1' : '0')
  } catch {
    /* ignore */
  }
}

function tone(
  freqFrom: number,
  freqTo: number,
  duration: number,
  type: OscillatorType,
  volume: number,
  delay = 0,
) {
  if (!audioCtx || muted) return
  const t0 = audioCtx.currentTime + delay
  const osc = audioCtx.createOscillator()
  const gain = audioCtx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freqFrom, t0)
  osc.frequency.exponentialRampToValueAtTime(Math.max(freqTo, 1), t0 + duration)
  gain.gain.setValueAtTime(0.0001, t0)
  gain.gain.exponentialRampToValueAtTime(volume, t0 + 0.015)
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration)
  osc.connect(gain)
  gain.connect(audioCtx.destination)
  osc.start(t0)
  osc.stop(t0 + duration + 0.05)
}

/** 餌を食べた音：ぱくっ */
export function playEat() {
  tone(340, 90, 0.12, 'square', 0.06)
  tone(520, 180, 0.08, 'sine', 0.08, 0.02)
}

/** 泡の音：ぽこっ */
export function playBubble() {
  tone(500, 950, 0.09, 'sine', 0.045)
}

/** 餌を撒く音：パラパラ */
export function playSprinkle() {
  for (let i = 0; i < 5; i++) {
    tone(900 + Math.random() * 500, 500, 0.05, 'triangle', 0.035, i * 0.07)
  }
}

/** 「できた！」の音：短いファンファーレ */
export function playFanfare() {
  const notes = [523.25, 659.25, 783.99, 1046.5]
  notes.forEach((f, i) => tone(f, f, 0.16, 'triangle', 0.09, i * 0.11))
}
