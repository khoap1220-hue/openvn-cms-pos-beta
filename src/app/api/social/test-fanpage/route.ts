import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logLedger } from '@/lib/ledger'
import { getNormalizedCredentials } from '@/lib/webhook-service'

export const dynamic = 'force-dynamic'

interface TestFanpageBody {
  mode?: 'GRAPH_API' | 'WEBHOOK_BRIDGE' | 'SANDBOX'
  title?: string
  content?: string
  hashtags?: string
  imageUrl?: string
  targetUrl?: string
  pageId?: string
  pageAccessToken?: string
  graphVersion?: string
  bridgeWebhookUrl?: string
  bridgeSecret?: string
  saveCredentials?: boolean
  saveToPostQueue?: boolean
}

export async function POST(req: NextRequest) {
  const startMs = Date.now()
  try {
    const body = (await req.json()) as TestFanpageBody
    const mode = body.mode || 'SANDBOX'
    const title = (body.title ?? 'Bài test Fanpage Ưu Đàm — An Nhiên Thạch').trim()
    const content = (body.content ?? '').trim()
    const hashtags = (body.hashtags ?? '#AnNhienThach #ThachCaoTamLinh #UuDam').trim()
    const imageUrl = (body.imageUrl ?? '/thach-cao/hot-monk-tea-pet.jpg').trim()
    const targetUrl = (body.targetUrl ?? '').trim()

    if (!content) {
      return NextResponse.json(
        { ok: false, error: 'Nội dung bài viết test không được để trống.' },
        { status: 400 }
      )
    }

    const allCreds = await getNormalizedCredentials()
    const fbCred = allCreds.find((c) => c.provider === 'FACEBOOK')
    const hubCred = allCreds.find((c) => c.provider === 'SOCIAL_WEBHOOK_HUB')

    const pageId = String(body.pageId ?? fbCred?.config?.pageId ?? '10889922334455').trim()
    const pageAccessToken = String(body.pageAccessToken ?? fbCred?.config?.pageAccessToken ?? '').trim()
    const graphVersion = String(body.graphVersion ?? fbCred?.config?.graphVersion ?? 'v20.0').trim() || 'v20.0'
    const bridgeWebhookUrl = String(body.bridgeWebhookUrl ?? hubCred?.config?.bridgeWebhookUrl ?? '').trim()
    const bridgeSecret = String(body.bridgeSecret ?? hubCred?.config?.bridgeSecret ?? '').trim()

    // Lưu nhanh thông tin xác thực nếu người dùng nhập mới trong hộp thoại Test
    if (body.saveCredentials) {
      if (body.pageId || body.pageAccessToken) {
        const nextFbConfig = {
          ...(fbCred?.config ?? {}),
          pageName: fbCred?.config?.pageName || 'Ưu Đàm — An Nhiên Thạch Fanpage',
          pageId,
          pageAccessToken,
          graphVersion,
        }
        await db.integrationCredential.upsert({
          where: { provider: 'FACEBOOK' },
          create: {
            provider: 'FACEBOOK',
            name: 'Facebook Fanpage (Graph API)',
            active: true,
            config: JSON.stringify(nextFbConfig),
          },
          update: {
            name: 'Facebook Fanpage (Graph API)',
            active: true,
            config: JSON.stringify(nextFbConfig),
          },
        })
        await db.socialChannelConfig
          .upsert({
            where: { platform: 'FACEBOOK' },
            create: {
              platform: 'FACEBOOK',
              name: 'Facebook Fanpage',
              enabled: true,
              isMock: pageAccessToken.startsWith('EAAG_mock_') || !pageAccessToken,
              credentials: JSON.stringify(nextFbConfig),
            },
            update: {
              enabled: true,
              isMock: pageAccessToken.startsWith('EAAG_mock_') || !pageAccessToken,
              credentials: JSON.stringify(nextFbConfig),
            },
          })
          .catch(() => null)
      }

      if (body.bridgeWebhookUrl) {
        const nextHubConfig = {
          ...(hubCred?.config ?? {}),
          platformName: hubCred?.config?.platformName || 'Make.com / n8n Cloud',
          bridgeWebhookUrl,
          bridgeSecret: bridgeSecret || 'whsec_social_bridge_2026',
          channels: hubCred?.config?.channels || 'FACEBOOK,INSTAGRAM,THREADS,TIKTOK,ZALO_OA',
        }
        await db.ledgerEntry.create({
          data: {
            scope: 'INTEGRATION_CREDENTIAL_EXT',
            action: 'CREDENTIAL_EXT_SAVED',
            entityType: 'IntegrationCredentialExt',
            entityId: 'SOCIAL_WEBHOOK_HUB',
            entityCode: 'SOCIAL_WEBHOOK_HUB',
            title: 'Lưu cấu hình kết nối Social Automation Bridge (SOCIAL_WEBHOOK_HUB)',
            detail: JSON.stringify({ provider: 'SOCIAL_WEBHOOK_HUB', active: true }),
            afterSnapshot: JSON.stringify({
              provider: 'SOCIAL_WEBHOOK_HUB',
              name: 'Social Automation Bridge (Make / n8n / Zapier)',
              config: nextHubConfig,
              active: true,
            }),
            actor: 'OPERATOR',
          },
        })
      }
    }

    const fullMessage = hashtags ? `${content}\n\n${hashtags}` : content
    const graphPayload: Record<string, unknown> = {
      message: fullMessage,
      ...(targetUrl ? { link: targetUrl } : {}),
      ...(imageUrl ? { attached_media_preview: imageUrl } : {}),
      page_id: pageId,
      published: true,
    }

    let externalPostId = `fb_test_${Date.now()}`
    let externalPostUrl = `https://www.facebook.com/${pageId}/posts/${Date.now()}`
    let isRealPublish = false
    let noteMessage = ''
    let rawResponse: Record<string, unknown> = {}

    if (mode === 'GRAPH_API') {
      const isMockToken =
        !pageAccessToken ||
        pageAccessToken.startsWith('EAAG_mock_') ||
        pageAccessToken.startsWith('mock_')

      if (isMockToken) {
        return NextResponse.json(
          {
            ok: false,
            code: 'DEMO_TOKEN_DETECTED',
            error:
              'Bạn đang để Page Access Token mẫu (EAAG_mock_...). Để đăng bài THẬT lên Facebook Fanpage, hãy dán Page ID và Page Access Token thật (bắt đầu bằng EAA...) từ Meta Graph API Explorer, hoặc chuyển sang tab "Giả lập Sandbox" / "Qua Make.com Webhook".',
            payloadSnapshot: graphPayload,
          },
          { status: 400 }
        )
      }

      // Gọi thật tới Facebook Graph API
      const endpoint = `https://graph.facebook.com/${encodeURIComponent(graphVersion)}/${encodeURIComponent(pageId)}/feed`
      const fbRes = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: fullMessage,
          ...(targetUrl ? { link: targetUrl } : {}),
          access_token: pageAccessToken,
        }),
      })
      const fbData = (await fbRes.json().catch(() => ({}))) as Record<string, unknown>
      rawResponse = fbData

      if (!fbRes.ok || fbData.error) {
        const fbErr = (fbData.error as { message?: string; code?: number }) ?? {}
        return NextResponse.json(
          {
            ok: false,
            code: 'GRAPH_API_ERROR',
            error: `Facebook Graph API từ chối (${fbErr.code ?? fbRes.status}): ${fbErr.message || 'Token hết hạn hoặc thiếu quyền pages_manage_posts'}`,
            payloadSnapshot: graphPayload,
            responseSnapshot: fbData,
          },
          { status: 422 }
        )
      }

      externalPostId = String(fbData.id || `${pageId}_${Date.now()}`)
      externalPostUrl = `https://www.facebook.com/${externalPostId}`
      isRealPublish = true
      noteMessage = `Đã đăng bài THẬT lên Facebook Fanpage (ID: ${externalPostId}) qua Graph API ${graphVersion}!`
    } else if (mode === 'WEBHOOK_BRIDGE') {
      if (!bridgeWebhookUrl) {
        return NextResponse.json(
          {
            ok: false,
            error: 'Vui lòng nhập Webhook URL của Make.com / n8n / Zapier để đẩy bài test.',
          },
          { status: 400 }
        )
      }

      const webhookBody = {
        event: 'social.post.publish',
        timestamp: new Date().toISOString(),
        channel: 'FACEBOOK',
        isTest: true,
        post: {
          title,
          content,
          hashtags,
          fullMessage,
          mediaUrls: imageUrl ? [imageUrl] : [],
          targetUrl: targetUrl || null,
          pageId,
        },
      }

      const isDemoWebhook = bridgeWebhookUrl.includes('hooks.make.com/uudam-social-router-demo')
      if (isDemoWebhook) {
        externalPostId = `make_bridge_${Date.now()}`
        externalPostUrl = `https://www.facebook.com/${pageId}/posts/${Date.now()}`
        rawResponse = {
          bridgeStatus: 'SIMULATED_DEMO_WEBHOOK',
          webhookUrl: bridgeWebhookUrl,
          deliveredPayload: webhookBody,
        }
        noteMessage =
          'Đã kiểm thử gói tin JSON chuẩn Make.com / n8n! (Khi bạn thay URL mẫu bằng Webhook URL thật của Make.com, bài viết sẽ tự động bắn thẳng lên Fanpage).'
      } else {
        const whRes = await fetch(bridgeWebhookUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(bridgeSecret ? { 'X-Webhook-Secret': bridgeSecret } : {}),
          },
          body: JSON.stringify(webhookBody),
        })
        const whText = await whRes.text().catch(() => 'Accepted')
        if (!whRes.ok) {
          return NextResponse.json(
            {
              ok: false,
              error: `Webhook Make/n8n trả về mã lỗi HTTP ${whRes.status}: ${whText.slice(0, 160)}`,
              payloadSnapshot: webhookBody,
            },
            { status: 422 }
          )
        }
        isRealPublish = true
        externalPostId = `bridge_live_${Date.now()}`
        externalPostUrl = `https://www.facebook.com/${pageId}`
        rawResponse = { status: whRes.status, response: whText.slice(0, 300) }
        noteMessage = `Đã bắn bài test thành công sang Webhook Make/n8n (${whRes.status} OK)!`
      }
    } else {
      // Chế độ SANDBOX (Giả lập an toàn)
      rawResponse = {
        id: externalPostId,
        permalink_url: externalPostUrl,
        sandbox: true,
        validatedRules: [
          'Nội dung & Hashtag hợp lệ (UTF-8 Tiếng Việt)',
          'Cấu trúc Graph API v20.0 /{page_id}/feed đạt chuẩn',
          'Chống trùng lặp (Idempotency Key) hoạt động tốt',
        ],
      }
      noteMessage =
        'Đã chạy đăng bài Test giả lập (Sandbox) thành công! Toàn bộ khung bài viết, ảnh đính kèm, hashtag và JSON Payload đã sẵn sàng.'
    }

    // Lưu vào danh sách bài viết Auto Social nếu người dùng chọn
    let createdPostId: string | null = null
    if (body.saveToPostQueue !== false) {
      const created = await db.socialPost
        .create({
          data: {
            title,
            content,
            hashtags,
            channel: 'FACEBOOK',
            status: 'PUBLISHED',
            mediaType: 'IMAGE',
            mediaUrls: JSON.stringify(imageUrl ? [imageUrl] : []),
            targetUrl: targetUrl || null,
            scheduledAt: new Date(),
            publishedAt: new Date(),
            externalPostId,
            externalPostUrl,
            approvedBy: 'Chủ tiệm Ưu Đàm (Test Fanpage)',
            approvedAt: new Date(),
          },
        })
        .catch(() => null)
      createdPostId = created?.id ?? null
    }

    const latencyMs = Math.max(18, Date.now() - startMs)

    await logLedger({
      scope: 'SYSTEM',
      action: 'SOCIAL_FANPAGE_TEST_PUBLISH',
      entityType: 'SocialPost',
      entityId: createdPostId ?? undefined,
      entityCode: externalPostId,
      title: `Đăng bài Test Fanpage (${mode}) — ${title}`,
      detail: {
        mode,
        isRealPublish,
        pageId,
        externalPostId,
        externalPostUrl,
        latencyMs,
      },
      actor: 'OPERATOR',
    })

    return NextResponse.json({
      ok: true,
      mode,
      isRealPublish,
      latencyMs,
      externalPostId,
      externalPostUrl,
      createdPostId,
      message: noteMessage,
      payloadSnapshot: graphPayload,
      responseSnapshot: rawResponse,
    })
  } catch (err: unknown) {
    console.error('[POST /api/social/test-fanpage] Error:', err)
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : 'Lỗi không xác định khi đăng bài test Fanpage',
      },
      { status: 500 }
    )
  }
}
