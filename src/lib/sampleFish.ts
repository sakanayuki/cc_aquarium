// 初期サンプル魚2匹を Canvas で描いて dataURL 化する（頭は左向き）。
function makeCanvas(w: number, h: number) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

function drawEye(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.arc(x, y, 21, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#263238'
  ctx.beginPath()
  ctx.arc(x - 3, y, 10.5, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.arc(x - 7, y - 4, 3.5, 0, Math.PI * 2)
  ctx.fill()
}

function drawMouth(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.strokeStyle = 'rgba(120, 40, 0, 0.55)'
  ctx.lineWidth = 6
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.arc(x, y, 14, Math.PI * 0.15, Math.PI * 0.75)
  ctx.stroke()
}

/** 橙色の魚：白いしま模様 */
function sampleFishA(): string {
  const c = makeCanvas(512, 320)
  const ctx = c.getContext('2d')!
  // 尾びれ
  ctx.fillStyle = '#ef7d1a'
  ctx.beginPath()
  ctx.moveTo(330, 160)
  ctx.lineTo(472, 62)
  ctx.quadraticCurveTo(448, 160, 472, 258)
  ctx.closePath()
  ctx.fill()
  // 背びれ
  ctx.beginPath()
  ctx.moveTo(190, 62)
  ctx.quadraticCurveTo(260, 6, 330, 56)
  ctx.quadraticCurveTo(260, 84, 190, 62)
  ctx.fill()
  // 体
  const grad = ctx.createLinearGradient(0, 40, 0, 280)
  grad.addColorStop(0, '#ffb74d')
  grad.addColorStop(1, '#fb8c00')
  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.ellipse(235, 160, 195, 118, 0, 0, Math.PI * 2)
  ctx.fill()
  // しま模様（体でクリップ）
  ctx.save()
  ctx.beginPath()
  ctx.ellipse(235, 160, 195, 118, 0, 0, Math.PI * 2)
  ctx.clip()
  ctx.fillStyle = 'rgba(255,255,255,0.75)'
  for (const bx of [150, 235, 320]) {
    ctx.beginPath()
    ctx.ellipse(bx, 160, 20, 125, 0.12, 0, Math.PI * 2)
    ctx.fill()
  }
  // おなか
  ctx.fillStyle = 'rgba(255, 236, 200, 0.8)'
  ctx.beginPath()
  ctx.ellipse(210, 232, 130, 42, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
  // 胸びれ
  ctx.fillStyle = 'rgba(239, 125, 26, 0.9)'
  ctx.beginPath()
  ctx.ellipse(215, 205, 42, 20, 0.7, 0, Math.PI * 2)
  ctx.fill()
  drawEye(ctx, 108, 128)
  drawMouth(ctx, 52, 178)
  return c.toDataURL('image/png')
}

/** 水色の魚：水玉模様 */
function sampleFishB(): string {
  const c = makeCanvas(512, 320)
  const ctx = c.getContext('2d')!
  // 尾びれ
  ctx.fillStyle = '#7e57c2'
  ctx.beginPath()
  ctx.moveTo(330, 160)
  ctx.lineTo(472, 62)
  ctx.quadraticCurveTo(448, 160, 472, 258)
  ctx.closePath()
  ctx.fill()
  // 背びれ
  ctx.beginPath()
  ctx.moveTo(190, 62)
  ctx.quadraticCurveTo(260, 6, 330, 56)
  ctx.quadraticCurveTo(260, 84, 190, 62)
  ctx.fill()
  // 体
  const grad = ctx.createLinearGradient(0, 40, 0, 280)
  grad.addColorStop(0, '#81d4fa')
  grad.addColorStop(1, '#29b6f6')
  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.ellipse(235, 160, 195, 118, 0, 0, Math.PI * 2)
  ctx.fill()
  // 水玉模様
  ctx.save()
  ctx.beginPath()
  ctx.ellipse(235, 160, 195, 118, 0, 0, Math.PI * 2)
  ctx.clip()
  ctx.fillStyle = 'rgba(255,255,255,0.65)'
  const dots: Array<[number, number, number]> = [
    [180, 105, 15],
    [255, 90, 11],
    [300, 140, 17],
    [205, 175, 12],
    [330, 205, 13],
    [255, 225, 10],
    [150, 220, 11],
  ]
  for (const [x, y, r] of dots) {
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.fillStyle = 'rgba(255, 249, 196, 0.85)'
  ctx.beginPath()
  ctx.ellipse(210, 232, 130, 42, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
  // 胸びれ
  ctx.fillStyle = 'rgba(126, 87, 194, 0.85)'
  ctx.beginPath()
  ctx.ellipse(215, 205, 42, 20, 0.7, 0, Math.PI * 2)
  ctx.fill()
  drawEye(ctx, 108, 128)
  drawMouth(ctx, 52, 178)
  return c.toDataURL('image/png')
}

export function createSampleFishDataUrls(): string[] {
  return [sampleFishA(), sampleFishB()]
}
