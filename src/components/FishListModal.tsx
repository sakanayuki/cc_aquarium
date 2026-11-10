import { useEffect, useRef, useState } from 'react'
import type { FishRecord } from '../lib/storage'
import Icon from './Icon'

const LONG_PRESS_MS = 1000
const RING_R = 44
const RING_C = 2 * Math.PI * RING_R

function FishCell({
  record,
  index,
  onDelete,
}: {
  record: FishRecord
  index: number
  onDelete: (record: FishRecord, index: number) => void
}) {
  const [progress, setProgress] = useState(0)
  const rafRef = useRef<number | undefined>(undefined)
  const startRef = useRef(0)
  const firedRef = useRef(false)

  const cancel = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = undefined
    setProgress(0)
  }

  useEffect(() => cancel, [])

  const tick = () => {
    const p = (performance.now() - startRef.current) / LONG_PRESS_MS
    if (p >= 1) {
      if (!firedRef.current) {
        firedRef.current = true
        onDelete(record, index)
      }
      cancel()
      return
    }
    setProgress(p)
    rafRef.current = requestAnimationFrame(tick)
  }

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault()
    firedRef.current = false
    startRef.current = performance.now()
    rafRef.current = requestAnimationFrame(tick)
  }

  return (
    <div
      className={`fish-cell${progress > 0 ? ' pressing' : ''}`}
      style={{ animationDelay: `${Math.min(index, 12) * 30}ms` }}
      onPointerDown={onPointerDown}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onContextMenu={(e) => e.preventDefault()}
    >
      <img src={record.dataUrl} alt="おさかな" draggable={false} />
      {progress > 0 && (
        <div className="delete-ring">
          <svg className="ring" viewBox="0 0 100 100" aria-hidden>
            <circle cx="50" cy="50" r={RING_R} fill="none" stroke="rgba(186,26,26,0.2)" strokeWidth="7" />
            <circle
              cx="50"
              cy="50"
              r={RING_R}
              fill="none"
              stroke="currentColor"
              strokeWidth="7"
              strokeLinecap="round"
              strokeDasharray={RING_C}
              strokeDashoffset={RING_C * (1 - progress)}
              transform="rotate(-90 50 50)"
            />
          </svg>
          <Icon name="delete" size={28} />
        </div>
      )}
    </div>
  )
}

interface Props {
  fish: FishRecord[]
  onClose: () => void
  onDelete: (record: FishRecord, index: number) => void
}

export default function FishListModal({ fish, onClose, onDelete }: Props) {
  return (
    <div className="m3-scrim" onClick={onClose}>
      <div
        className="m3-bottom-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="おさかな いちらん"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="m3-drag-handle" />
        <div className="sheet-header">
          <div className="sheet-title">おさかな いちらん（{fish.length}ひき）</div>
          <button className="m3-icon-btn" onClick={onClose} aria-label="とじる">
            <Icon name="close" />
          </button>
        </div>
        <p className="sheet-hint">けしたい おさかなを ながおし してね（1びょう）</p>
        <div className="sheet-body">
          {fish.length === 0 ? (
            <p className="no-fish-text">おさかなは いないよ</p>
          ) : (
            <div className="fish-grid">
              {fish.map((f, i) => (
                <FishCell key={f.id} record={f} index={i} onDelete={onDelete} />
              ))}
            </div>
          )}
        </div>
        <div className="sheet-footer">
          <button className="m3-btn tonal" onClick={onClose}>
            とじる
          </button>
        </div>
      </div>
    </div>
  )
}
