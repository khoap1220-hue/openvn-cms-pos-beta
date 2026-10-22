// Helper fetch API phía client

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error((json as { error?: string }).error || `Lỗi ${res.status}`)
  }
  return json as T
}

export function apiGet<T>(url: string): Promise<T> {
  return request<T>(url)
}

export function apiPost<T>(url: string, body: unknown): Promise<T> {
  return request<T>(url, { method: 'POST', body: JSON.stringify(body) })
}

export function apiPut<T>(url: string, body: unknown): Promise<T> {
  return request<T>(url, { method: 'PUT', body: JSON.stringify(body) })
}

export function apiPatch<T>(url: string, body: unknown): Promise<T> {
  return request<T>(url, { method: 'PATCH', body: JSON.stringify(body) })
}

export function apiDelete<T>(url: string): Promise<T> {
  return request<T>(url, { method: 'DELETE' })
}
