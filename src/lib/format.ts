// Format helpers dùng chung toàn CMS

export function formatVND(value: number): string {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(value)
}

export function formatCompactVND(value: number): string {
  if (Math.abs(value) >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)} tỷ`
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} tr`
  if (Math.abs(value) >= 1_000) return `${Math.round(value / 1_000)}k`
  return String(value)
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('vi-VN').format(value)
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
