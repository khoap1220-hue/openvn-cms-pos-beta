'use client'

// ============================================================
// CLIENT BEHAVIOR TELEMETRY — Ghi nhận hành vi thao tác giao diện (Non-blocking)
// Chuyển màn hình (kèm thời lượng lưu trang), tìm kiếm nhanh, xuất dữ liệu, in chứng từ.
// ============================================================

export interface ClientBehaviorPayload {
  category?: 'NAVIGATION' | 'EXPORT'
  action: 'VIEW_MODULE' | 'QUICK_SEARCH' | 'DATA_EXPORT' | 'PRINT_DOCUMENT' | 'ACCESS_BLOCKED_UI'
  module: string
  path?: string
  targetType?: string
  targetCode?: string
  summary: string
  durationMs?: number
  metadata?: Record<string, unknown>
}

export function trackClientBehavior(payload: ClientBehaviorPayload): void {
  if (typeof window === 'undefined') return
  try {
    const viewport = `${window.innerWidth}x${window.innerHeight}`
    const body = JSON.stringify({
      ...payload,
      path: payload.path ?? `${window.location.pathname}${window.location.search}`,
      metadata: {
        ...(payload.metadata ?? {}),
        viewport,
      },
    })

    void fetch('/api/behavior-logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => null)
  } catch {
    // Telemetry tuyệt đối không bao giờ chặn luồng thao tác người dùng
  }
}
