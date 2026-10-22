// Khởi động Agent Autopilot Engine khi server Next.js start (nodejs runtime)
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { ensureEngine } = await import('@/lib/agent-engine')
    ensureEngine()
  }
}
