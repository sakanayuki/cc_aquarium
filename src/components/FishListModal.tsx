import { useEffect, useRef, useState } from 'react'
import type { FishRecord } from '../lib/storage'

const LONG_PRESS_MS = 1000

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
      className="fish-cell"
      onPointerDown={onPointerDown}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onContextMenu={(e) => e.preventDefault()}
    >
      <img src={record.dataUrl} alt="おさかな" draggable={false} />
      {progress > 0 && (
        <div
          className="ring"
          style={{
            background: `conic-gradient(rgba(255, 82, 82, 0.5) ${progress * 360}deg, transparent 0deg)`,
          }}
        />
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
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">🐠 おさかな いちらん</div>
        <p className="modal-hint">けしたい おさかなを ながおし してね（1びょう）</p>
        {fish.length === 0 ? (
          <p className="no-fish-text">おさかなは いないよ</p>
        ) : (
          <div className="fish-grid">
            {fish.map((f, i) => (
              <FishCell key={f.id} record={f} index={i} onDelete={onDelete} />
            ))}
          </div>
        )}
        <div className="modal-close-row">
          <button className="btn btn-water btn-big" onClick={onClose}>
            とじる
          </button>
        </div>
      </div>
    </div>
  )
}
