// Wrapper gọi LLM (z-ai-web-dev-sdk) cho các Agent — chỉ chạy backend.
// Trả về null khi lỗi/timeout để caller dùng template dự phòng.

import ZAI from 'z-ai-web-dev-sdk'

type ZaiInstance = {
  chat: {
    completions: {
      create: (args: Record<string, unknown>) => Promise<unknown>
    }
  }
}

let zaiPromise: Promise<unknown> | null = null

function getZai(): Promise<ZaiInstance> {
  if (!zaiPromise) {
    zaiPromise = ZAI.create()
  }
  return zaiPromise as Promise<ZaiInstance>
}

export interface LlmMessage {
  role: 'user' | 'assistant'
  content: string
}

export async function llmChat(system: string, user: string, timeoutMs = 20000): Promise<string | null> {
  try {
    const zai = await getZai()
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
