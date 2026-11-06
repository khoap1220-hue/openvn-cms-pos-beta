// Format helpers dùng chung toàn CMS

export function formatVND(value: number | null | undefined): string {
  const safe = Number.isFinite(Number(value)) ? Number(value) : 0
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(safe)
}

export function formatCompactVND(value: number | null | undefined): string {
  const safe = Number.isFinite(Number(value)) ? Number(value) : 0
  if (Math.abs(safe) >= 1_000_000_000) return `${(safe / 1_000_000_000).toFixed(1)} tỷ`
  if (Math.abs(safe) >= 1_000_000) return `${(safe / 1_000_000).toFixed(1)} tr`
  if (Math.abs(safe) >= 1_000) return `${Math.round(safe / 1_000)}k`
  return String(safe)
}

export function formatNumber(value: number | null | undefined): string {
  const safe = Number.isFinite(Number(value)) ? Number(value) : 0
  return new Intl.NumberFormat('vi-VN').format(safe)
}

export function formatDate(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso
  return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export function formatDateTime(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso
  return d.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export function percentDiff(current: number, previous: number): number | null {
  if (previous === 0) return current > 0 ? 100 : null
  return Math.round(((current - previous) / previous) * 1000) / 10
}

export function timeAgo(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000)
  if (seconds < 10) return 'vừa xong'
  if (seconds < 60) return `${seconds} giây trước`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} phút trước`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} giờ trước`
  return `${Math.floor(hours / 24)} ngày trước`
}

export function formatAttributesReadable(raw: string | null | undefined): { text: string; tags: string[] } {
  const s = (raw ?? '').trim()
  if (!s) return { text: '', tags: [] }
  if (s.startsWith('{') && s.endsWith('}')) {
    try {
      const obj = JSON.parse(s) as Record<string, unknown>
      if (typeof obj.customSummary === 'string' && obj.customSummary.trim()) {
        const customText = obj.customSummary.trim()
        const customTags = customText
          .split(/[;,/·]/)
          .map((t) => t.trim())
          .filter(Boolean)
          .slice(0, 4)
        return { text: customText, tags: customTags }
      }
      const parts: string[] = []
      const labelMap: Record<string, string> = {
        brandLine: 'Dòng',
        intentionLabel: 'Định vị',
        intent: 'Công năng',
        material: 'Chất liệu',
        scent: 'Hương',
        scentPairing: 'Hương phối',
        dimensions: 'KT',
        weight: 'KL',
        weightGram: 'KL',
        burnTime: 'Thời gian đốt',
        color: 'Màu',
        size: 'Cỡ',
        placementTip: 'Bài trí',
        oilDropsGuide: 'Hướng dẫn',
        original1688Sku: 'Mã nguồn',
      }
      const priorityKeys = [
        'brandLine',
        'material',
        'dimensions',
        'weight',
        'weightGram',
        'scent',
        'scentPairing',
        'burnTime',
        'color',
        'size',
        'intentionLabel',
        'intent',
      ]
      const seen = new Set<string>()
      for (const k of [...priorityKeys, ...Object.keys(obj)]) {
        if (seen.has(k)) continue
        seen.add(k)
        if (k === 'placementTip' || k === 'oilDropsGuide' || k === 'original1688Sku') continue
        const v = obj[k]
        if (v === null || v === undefined || v === '') continue
        if (typeof v === 'object') continue
        const valStr = k === 'weightGram' ? `${v}g` : String(v).trim()
        if (!valStr) continue
        const lbl = labelMap[k] || k
        parts.push(`${lbl}: ${valStr}`)
      }
      if (parts.length > 0) {
        return { text: parts.slice(0, 5).join('; '), tags: parts.slice(0, 4) }
      }
    } catch {
      // Fallback to plain string
    }
  }
  const tags = s
    .split(/[;,/·]/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 4)
  return { text: s, tags }
}
