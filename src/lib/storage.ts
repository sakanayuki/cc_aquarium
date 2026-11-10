import { createSampleFishDataUrls } from './sampleFish'

export interface FishRecord {
  id: string
  dataUrl: string
  createdAt: number
}

const FISH_KEY = 'cc-aquarium-fish'
const INIT_KEY = 'cc-aquarium-initialized-v1'
export const MAX_FISH = 30

function newId(): string {
  return `fish-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** 魚の一覧を読む。初回だけサンプル魚2匹を登録する。 */
export function loadFish(): FishRecord[] {
  try {
    const raw = localStorage.getItem(FISH_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as FishRecord[]
      if (Array.isArray(parsed)) return parsed
    }
  } catch {
    /* fall through */
  }
  try {
    if (!localStorage.getItem(INIT_KEY)) {
      const now = Date.now()
      const samples: FishRecord[] = createSampleFishDataUrls().map((dataUrl, i) => ({
        id: `sample-${i + 1}`,
        dataUrl,
        createdAt: now + i,
      }))
      localStorage.setItem(FISH_KEY, JSON.stringify(samples))
      localStorage.setItem(INIT_KEY, '1')
      return samples
    }
  } catch {
    /* ignore */
  }
  return []
}

export function saveFishList(list: FishRecord[]) {
  try {
    localStorage.setItem(FISH_KEY, JSON.stringify(list))
  } catch {
    /* 容量オーバー時は黙って失敗（呼び出し側で上限管理） */
  }
}

/** 追加できたら新しい一覧、満杯なら null を返す。 */
export function addFish(dataUrl: string): FishRecord[] | null {
  const list = loadFish()
  if (list.length >= MAX_FISH) return null
  const next = [...list, { id: newId(), dataUrl, createdAt: Date.now() }]
  saveFishList(next)
  return next
}
