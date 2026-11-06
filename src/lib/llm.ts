// Wrapper gọi LLM đa nguồn cho các Agent & Phân tích Tài chính AI — chỉ chạy backend.
// Ưu tiên 1: Google Gemini API thật (đọc key từ AppSetting 'gemini_api_key' / IntegrationCredential 'GEMINI' / env GEMINI_API_KEY).
// Ưu tiên 2: Fallback ZAI SDK (nếu chạy trong sandbox Z.ai).
// Trả về null khi lỗi/timeout để caller dùng template dự phòng giọng chủ tiệm Ưu Đàm.

import { db } from '@/lib/db'

const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash'] as const

export async function resolveGeminiApiKey(): Promise<string | null> {
  try {
    const setting = await db.appSetting.findUnique({ where: { key: 'gemini_api_key' } })
    if (setting?.value && setting.value.trim().length > 0) {
      return setting.value.trim()
    }
  } catch {
    // bỏ qua nếu DB chưa sẵn sàng
  }

  try {
    const cred = await db.integrationCredential.findUnique({ where: { provider: 'GEMINI' } })
    if (cred?.active && cred.config) {
      const parsed = JSON.parse(cred.config) as { apiKey?: string; key?: string }
      const k = (parsed.apiKey ?? parsed.key ?? '').trim()
      if (k.length > 0) return k
    }
  } catch {
    // bỏ qua lỗi parse JSON
  }

  const envKey = process.env.GEMINI_API_KEY?.trim()
  return envKey && envKey.length > 0 ? envKey : null
}

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>
    }
  }>
}

async function callGeminiText(
  apiKey: string,
  system: string,
  user: string,
  timeoutMs: number,
): Promise<string | null> {
  for (const model of GEMINI_MODELS) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: system }],
          },
          contents: [
            {
              role: 'user',
              parts: [{ text: user }],
            },
          ],
          generationConfig: {
            temperature: 0.4,
          },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      })

      if (!res.ok) continue
      const data = (await res.json()) as GeminiResponse
      const text = data.candidates?.[0]?.content?.parts
        ?.map((p) => p.text ?? '')
        .join('')
        .trim()
      if (text && text.length > 0) return text
    } catch {
      // thử model kế tiếp
    }
  }
  return null
}

async function parseImageToInlineData(
  imageUrl: string,
  timeoutMs: number,
): Promise<{ mimeType: string; data: string } | null> {
  if (imageUrl.startsWith('data:')) {
    const commaIdx = imageUrl.indexOf(',')
    if (commaIdx === -1) return null
    const header = imageUrl.slice(5, commaIdx) // vd: image/jpeg;base64
    const mimeType = header.split(';')[0] || 'image/jpeg'
    const data = imageUrl.slice(commaIdx + 1).trim()
    return data.length > 0 ? { mimeType, data } : null
  }

  if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
    try {
      const res = await fetch(imageUrl, { signal: AbortSignal.timeout(Math.min(10000, timeoutMs)) })
      if (!res.ok) return null
      const mimeType = res.headers.get('content-type')?.split(';')[0] || 'image/jpeg'
      const buf = await res.arrayBuffer()
      const data = Buffer.from(buf).toString('base64')
      return data.length > 0 ? { mimeType, data } : null
    } catch {
      return null
    }
  }

  return null
}

async function callGeminiVision(
  apiKey: string,
  prompt: string,
  imageUrl: string,
  timeoutMs: number,
): Promise<string | null> {
  const inlineData = await parseImageToInlineData(imageUrl, timeoutMs)
  if (!inlineData) return null

  for (const model of GEMINI_MODELS) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                { text: prompt },
                { inlineData },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.3,
          },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      })

      if (!res.ok) continue
      const data = (await res.json()) as GeminiResponse
      const text = data.candidates?.[0]?.content?.parts
        ?.map((p) => p.text ?? '')
        .join('')
        .trim()
      if (text && text.length > 0) return text
    } catch {
      // thử model kế tiếp
    }
  }
  return null
}

export interface LlmMessage {
  role: 'user' | 'assistant'
  content: string
}

export async function llmChat(system: string, user: string, timeoutMs = 20000): Promise<string | null> {
  // 1. Ưu tiên gọi Google Gemini API thật nếu đã cấu hình key
  const geminiKey = await resolveGeminiApiKey()
  if (geminiKey) {
    const geminiText = await callGeminiText(geminiKey, system, user, timeoutMs)
    if (geminiText) return geminiText
  }

  // 2. Fallback sang ZAI SDK (nếu đang chạy trong sandbox Z.ai)
  try {
    const ZAI = (await import('z-ai-web-dev-sdk')).default
    const zai = (await ZAI.create()) as unknown as {
      chat: { completions: { create: (args: Record<string, unknown>) => Promise<unknown> } }
    }
    const result = (await Promise.race([
      zai.chat.completions.create({
        messages: [
          { role: 'assistant', content: system },
          { role: 'user', content: user },
        ] satisfies LlmMessage[],
        thinking: { type: 'disabled' },
      }),
      new Promise((_resolve, reject) => setTimeout(() => reject(new Error('LLM timeout')), timeoutMs)),
    ])) as { choices?: Array<{ message?: { content?: string | null } }> }

    const text = result?.choices?.[0]?.message?.content?.trim()
    return text && text.length > 0 ? text : null
  } catch {
    return null
  }
}

// ===== VISION — đọc ảnh khách gửi (multimodal) =====
export async function llmVision(prompt: string, imageUrl: string, timeoutMs = 25000): Promise<string | null> {
  // 1. Ưu tiên gọi Google Gemini Vision thật nếu đã cấu hình key
  const geminiKey = await resolveGeminiApiKey()
  if (geminiKey) {
    const geminiText = await callGeminiVision(geminiKey, prompt, imageUrl, timeoutMs)
    if (geminiText) return geminiText
  }

  // 2. Fallback sang ZAI SDK
  try {
    const ZAI = (await import('z-ai-web-dev-sdk')).default
    const zai = (await ZAI.create()) as unknown as {
      chat: { completions: { create: (args: Record<string, unknown>) => Promise<unknown> } }
    }
    const result = (await Promise.race([
      zai.chat.completions.create({
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: imageUrl } },
            ],
          },
        ],
        thinking: { type: 'disabled' },
      }),
      new Promise((_resolve, reject) => setTimeout(() => reject(new Error('Vision timeout')), timeoutMs)),
    ])) as { choices?: Array<{ message?: { content?: string | null } }> }

    const text = result?.choices?.[0]?.message?.content?.trim()
    return text && text.length > 0 ? text : null
  } catch {
    return null
  }
}
