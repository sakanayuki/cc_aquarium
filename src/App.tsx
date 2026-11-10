import { useEffect, useState } from 'react'
import DrawScreen from './components/DrawScreen'
import TankScreen from './components/TankScreen'
import { initAudio } from './lib/sound'

type Screen = 'tank' | 'draw'

export default function App() {
  const [screen, setScreen] = useState<Screen>(() =>
    typeof window !== 'undefined' && window.location.hash === '#draw' ? 'draw' : 'tank',
  )
  // 描きおえたばかりの魚。水槽画面で「放流」演出をする
  const [releaseId, setReleaseId] = useState<string | null>(null)

  // AudioContext は初回ユーザー操作で初期化する（ブラウザの自動再生制限）
  useEffect(() => {
    const kick = () => initAudio()
    window.addEventListener('pointerdown', kick)
    return () => window.removeEventListener('pointerdown', kick)
  }, [])

  return (
    <div className="app">
      {screen === 'tank' ? (
        <TankScreen
          key="tank"
          onDraw={() => setScreen('draw')}
          releaseId={releaseId}
          onReleaseDone={() => setReleaseId(null)}
        />
      ) : (
        <DrawScreen
          key="draw"
          onDone={(id) => {
            setReleaseId(id)
            setScreen('tank')
          }}
          onBack={() => setScreen('tank')}
        />
      )}
    </div>
  )
}
