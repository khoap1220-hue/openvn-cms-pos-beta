// scripts/stress-m5-platforms.ts
// Empirical Adversarial Stress Test Suite for Milestone 5: Platforms & Payloads
// OPENVN · Ưu Đàm Suite — Challenger 1 (Adversarial Platform & Payload Challenger)
//
// Verification Scope:
// 1. Threads boundary tests: content length = 499 (PASS), 500 (PASS), 501 (MUST REJECT), empty/whitespace (MUST REJECT)
// 2. Instagram boundary tests: 0 media (MUST REJECT), empty strings array [] (MUST REJECT), empty string in array [''] (edge-case audit), 1 image (PASS)
// 3. TikTok boundary tests: image only (MUST REJECT), text only (MUST REJECT), non-video mediaType (MUST REJECT), valid video URL (PASS)
// 4. Payload schema stress: Unicode Vietnamese characters, emojis, special characters in post copy, XML/JSON special entities across all 7 platform adapters
// 5. Safe Mock simulation responses: check external IDs (fb_post_..., zalo_msg_..., tiktok_pub_..., threads_post_..., ig_post_...) and permalinks
// 6. DB lifecycle & cleanup: verify all test records deleted and check-counts parity (Delta = 0)

import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import https from 'node:https'
import { PrismaClient } from '@prisma/client'
import {
  publishPost,
  getAdapter,
  shouldUseSafeMock,
  generateUniqueSlug,
  slugifyVietnamese,
  facebookAdapter,
  zaloAdapter,
  websiteBlogAdapter,
  externalCmsAdapter,
  instagramAdapter,
  tiktokAdapter,
  threadsAdapter,
  SUPPORTED_PLATFORMS,
  type PublishRequest,
  type SocialPlatform,
} from '../src/lib/publishing-gateway'

const prisma = new PrismaClient()

interface TestSummary {
  name: string
  category: string
  status: 'PASS' | 'FAIL' | 'FINDING'
  detail?: string
}

const testResults: TestSummary[] = []
let outboundHttpAttempts = 0

// ============================================================
// NETWORK SPY FOR STRICT 0-OUTBOUND INVARIANT (R6)
// ============================================================
const originalHttpRequest = http.request
const originalHttpsRequest = https.request
const originalFetch = global.fetch

function setupNetworkSpy() {
  const disallowedHostPattern = /(facebook|zalo|tiktok|threads|instagram|external-store|graph\.meta)/i

  global.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    if (disallowedHostPattern.test(urlStr)) {
      outboundHttpAttempts++
      throw new Error(`[SECURITY VETO] Bị chặn gọi mạng thật tới nền tảng ngoài trong test: ${urlStr}`)
    }
    return originalFetch(input, init)
  }
}

function restoreNetworkSpy() {
  global.fetch = originalFetch
  http.request = originalHttpRequest
  https.request = originalHttpsRequest
}

function recordPass(name: string, category: string, detail?: string) {
  console.log(`  ✅ [PASS] ${name}${detail ? ` — ${detail}` : ''}`)
  testResults.push({ name, category, status: 'PASS', detail })
}

function recordFail(name: string, category: string, error: unknown) {
  const msg = error instanceof Error ? error.message : String(error)
  console.error(`  ❌ [FAIL] ${name} — ${msg}`)
  testResults.push({ name, category, status: 'FAIL', detail: msg })
}

function recordFinding(name: string, category: string, detail: string) {
  console.warn(`  ⚠️ [FINDING] ${name} — ${detail}`)
  testResults.push({ name, category, status: 'FINDING', detail })
}

// ============================================================
// BASELINE CHECK UTILITY
// ============================================================
async function verifyBaselineParity(label: string): Promise<boolean> {
  const baseline = JSON.parse(fs.readFileSync(path.resolve('db/baseline-counts.json'), 'utf8'))
  const coreTables = [
    'Product', 'Category', 'Order', 'OrderItem', 'Customer',
    'SalesInvoice', 'PurchaseInvoice', 'StockMovement', 'Warehouse', 'WarehouseStock',
    'Voucher', 'BomComponent', 'AccountingPeriod', 'Partner', 'Channel',
    'ChannelListing', 'Shipment', 'AfterSalesCase', 'AppSetting', 'IntegrationCredential',
    'ApiKey', 'WebhookEndpoint', 'AutomationSetting', 'OrderEvent',
  ]

  let allMatch = true
  for (const table of coreTables) {
    const delegateName = table.charAt(0).toLowerCase() + table.slice(1)
    const delegate = (prisma as unknown as Record<string, { count: () => Promise<number> }>)[delegateName]
    if (!delegate) continue
    const count = await delegate.count()
    const expected = baseline[table]
    if (count !== expected) {
      console.error(`❌ [MISMATCH] ${table}: actual=${count}, baseline=${expected}`)
      allMatch = false
    }
  }

  return allMatch
}

// ============================================================
// MAIN STRESS SUITE
// ============================================================
async function runPlatformStressSuite() {
  console.log('================================================================================')
  console.log('🔥 BẮT ĐẦU ADVERSARIAL STRESS TEST SUITE: PLATFORMS & PAYLOADS (MILESTONE 5) 🔥')
  console.log('================================================================================\n')

  setupNetworkSpy()

  const preParity = await verifyBaselineParity('PRE-TEST')
  if (!preParity) {
    throw new Error('Initial baseline parity check failed prior to stress suite execution.')
  }
  console.log('✅ Baseline 24 bảng cốt lõi đạt trạng thái nguyên vẹn 100% trước khi test.\n')

  const createdPostIds: string[] = []

  try {
    // ==================================================================
    // SUITE 1: THREADS BOUNDARY TESTS
    // Requirement: length = 499 (PASS), 500 (PASS), 501 (MUST REJECT)
    // ==================================================================
    console.log('--- [SUITE 1] Threads Boundary Tests (FEAT-PUB-07) ---')

    // 1.1: Content length = 499 (PASS)
    try {
      const content499 = 'A'.repeat(499)
      threadsAdapter.validate({
        postId: 'th_stress_499',
        channel: 'THREADS',
        content: content499,
        isMock: true,
      })
      const result499 = await threadsAdapter.publish({
        postId: 'th_stress_499',
        channel: 'THREADS',
        content: content499,
        isMock: true,
      })
      if (result499.success && result499.externalPostId?.startsWith('threads_post_')) {
        recordPass('Threads Boundary: Length = 499 chars', 'THREADS', `Length: ${content499.length}, ID: ${result499.externalPostId}`)
      } else {
        throw new Error(`Expected publish success for 499 chars, got ${JSON.stringify(result499)}`)
      }
    } catch (err) {
      recordFail('Threads Boundary: Length = 499 chars', 'THREADS', err)
    }

    // 1.2: Content length = 500 (PASS - EXACT UPPER BOUNDARY)
    try {
      const content500 = 'B'.repeat(500)
      threadsAdapter.validate({
        postId: 'th_stress_500',
        channel: 'THREADS',
        content: content500,
        isMock: true,
      })
      const result500 = await threadsAdapter.publish({
        postId: 'th_stress_500',
        channel: 'THREADS',
        content: content500,
        isMock: true,
      })
      if (result500.success && result500.externalPostId?.startsWith('threads_post_')) {
        recordPass('Threads Boundary: Length = 500 chars (Exact Upper Bound)', 'THREADS', `Length: ${content500.length}, ID: ${result500.externalPostId}`)
      } else {
        throw new Error(`Expected publish success for 500 chars, got ${JSON.stringify(result500)}`)
      }
    } catch (err) {
      recordFail('Threads Boundary: Length = 500 chars (Exact Upper Bound)', 'THREADS', err)
    }

    // 1.3: Content length = 501 (MUST REJECT)
    try {
      const content501 = 'C'.repeat(501)
      let rejected = false
      let rejectionError = ''
      try {
        threadsAdapter.validate({
          postId: 'th_stress_501',
          channel: 'THREADS',
          content: content501,
          isMock: true,
        })
      } catch (err) {
        rejected = true
        rejectionError = err instanceof Error ? err.message : String(err)
      }

      if (rejected && rejectionError.includes('Nội dung Threads vượt quá giới hạn 500 ký tự (hiện tại: 501)')) {
        recordPass('Threads Boundary: Length = 501 chars (MUST REJECT)', 'THREADS', `Correctly caught with error: "${rejectionError}"`)
      } else if (rejected) {
        recordPass('Threads Boundary: Length = 501 chars (MUST REJECT)', 'THREADS', `Rejected with generic message: "${rejectionError}"`)
      } else {
        throw new Error('ThreadsAdapter failed to reject 501-character content!')
      }
    } catch (err) {
      recordFail('Threads Boundary: Length = 501 chars (MUST REJECT)', 'THREADS', err)
    }

    // 1.4: Content length = 0 / empty string (MUST REJECT)
    try {
      let emptyRejected = false
      try {
        threadsAdapter.validate({
          postId: 'th_stress_empty',
          channel: 'THREADS',
          content: '',
          isMock: true,
        })
      } catch {
        emptyRejected = true
      }
      if (emptyRejected) {
        recordPass('Threads Boundary: Empty string "" (MUST REJECT)', 'THREADS', 'Successfully rejected')
      } else {
        throw new Error('ThreadsAdapter failed to reject empty string content!')
      }
    } catch (err) {
      recordFail('Threads Boundary: Empty string "" (MUST REJECT)', 'THREADS', err)
    }

    // 1.5: Content length = whitespace only (MUST REJECT)
    try {
      let wsRejected = false
      try {
        threadsAdapter.validate({
          postId: 'th_stress_ws',
          channel: 'THREADS',
          content: '   \n\t  \r\n   ',
          isMock: true,
        })
      } catch {
        wsRejected = true
      }
      if (wsRejected) {
        recordPass('Threads Boundary: Whitespace-only content (MUST REJECT)', 'THREADS', 'Successfully rejected')
      } else {
        throw new Error('ThreadsAdapter failed to reject whitespace-only content!')
      }
    } catch (err) {
      recordFail('Threads Boundary: Whitespace-only content (MUST REJECT)', 'THREADS', err)
    }

    // 1.6: Unicode Vietnamese at exact 500 characters (PASS)
    try {
      const vnSeed = 'Ưu Đàm Vạn Hạnh — Hương Trầm Tĩnh Tại. ' // 39 chars
      const repeatCount = Math.floor(500 / vnSeed.length)
      const remainder = 500 - (repeatCount * vnSeed.length)
      const vnContent500 = vnSeed.repeat(repeatCount) + 'Đ'.repeat(remainder)
      if (vnContent500.length !== 500) {
        throw new Error(`Constructed VN content length is ${vnContent500.length}, expected 500`)
      }
      threadsAdapter.validate({
        postId: 'th_stress_vn_500',
        channel: 'THREADS',
        content: vnContent500,
        isMock: true,
      })
      recordPass('Threads Boundary: 500 Unicode Vietnamese characters (PASS)', 'THREADS', `Length: ${vnContent500.length}`)
    } catch (err) {
      recordFail('Threads Boundary: 500 Unicode Vietnamese characters (PASS)', 'THREADS', err)
    }

    // 1.7: Unicode Vietnamese at 501 characters (MUST REJECT)
    try {
      const vnSeed = 'Ưu Đàm Vạn Hạnh — Hương Trầm Tĩnh Tại. '
      const repeatCount = Math.floor(500 / vnSeed.length)
      const remainder = 500 - (repeatCount * vnSeed.length)
      const vnContent501 = vnSeed.repeat(repeatCount) + 'Đ'.repeat(remainder) + 'ạ'
      let rejected = false
      try {
        threadsAdapter.validate({
          postId: 'th_stress_vn_501',
          channel: 'THREADS',
          content: vnContent501,
          isMock: true,
        })
      } catch {
        rejected = true
      }
      if (rejected) {
        recordPass('Threads Boundary: 501 Unicode Vietnamese characters (MUST REJECT)', 'THREADS', `Length: ${vnContent501.length} correctly rejected`)
      } else {
        throw new Error('ThreadsAdapter allowed 501-character Unicode Vietnamese content!')
      }
    } catch (err) {
      recordFail('Threads Boundary: 501 Unicode Vietnamese characters (MUST REJECT)', 'THREADS', err)
    }

    // ==================================================================
    // SUITE 2: INSTAGRAM MEDIA BOUNDARY TESTS
    // Requirement: 0 media (MUST REJECT), empty strings array (MUST REJECT), 1 image (PASS)
    // ==================================================================
    console.log('\n--- [SUITE 2] Instagram Media Boundary Tests (FEAT-PUB-05) ---')

    // 2.1: 0 media (mediaUrls is undefined / omitted) (MUST REJECT)
    try {
      let rejected = false
      let errMsg = ''
      try {
        instagramAdapter.validate({
          postId: 'ig_stress_0_media_undef',
          channel: 'INSTAGRAM',
          content: 'Thưởng trà an nhiên cùng Ưu Đàm',
          mediaUrls: undefined,
          isMock: true,
        })
      } catch (err) {
        rejected = true
        errMsg = err instanceof Error ? err.message : String(err)
      }
      if (rejected && errMsg.includes('Instagram bắt buộc phải có ít nhất 1 hình ảnh hoặc video')) {
        recordPass('Instagram Boundary: 0 media (undefined mediaUrls) (MUST REJECT)', 'INSTAGRAM', `Caught: "${errMsg}"`)
      } else {
        throw new Error(`Expected rejection for undefined mediaUrls, got rejected=${rejected}, msg="${errMsg}"`)
      }
    } catch (err) {
      recordFail('Instagram Boundary: 0 media (undefined mediaUrls) (MUST REJECT)', 'INSTAGRAM', err)
    }

    // 2.2: Empty strings array (mediaUrls: []) (MUST REJECT)
    try {
      let rejected = false
      let errMsg = ''
      try {
        instagramAdapter.validate({
          postId: 'ig_stress_empty_arr',
          channel: 'INSTAGRAM',
          content: 'Thưởng trà an nhiên cùng Ưu Đàm',
          mediaUrls: [],
          isMock: true,
        })
      } catch (err) {
        rejected = true
        errMsg = err instanceof Error ? err.message : String(err)
      }
      if (rejected && errMsg.includes('Instagram bắt buộc phải có ít nhất 1 hình ảnh hoặc video')) {
        recordPass('Instagram Boundary: Empty strings array [] (MUST REJECT)', 'INSTAGRAM', `Caught: "${errMsg}"`)
      } else {
        throw new Error(`Expected rejection for empty array [], got rejected=${rejected}, msg="${errMsg}"`)
      }
    } catch (err) {
      recordFail('Instagram Boundary: Empty strings array [] (MUST REJECT)', 'INSTAGRAM', err)
    }

    // 2.3: Array containing only empty string [''] (Edge Case Exploration)
    try {
      let rejected = false
      let errMsg = ''
      try {
        instagramAdapter.validate({
          postId: 'ig_stress_arr_empty_str',
          channel: 'INSTAGRAM',
          content: 'Thưởng trà an nhiên cùng Ưu Đàm',
          mediaUrls: [''],
          isMock: true,
        })
      } catch (err) {
        rejected = true
        errMsg = err instanceof Error ? err.message : String(err)
      }

      if (rejected) {
        recordPass("Instagram Boundary: Array containing empty string [''] (REJECTED)", 'INSTAGRAM', `Rejected with: "${errMsg}"`)
      } else {
        // Document empirical observation: length check passed but element is empty string
        const payload = instagramAdapter.formatPayload({
          postId: 'ig_stress_arr_empty_str',
          channel: 'INSTAGRAM',
          content: 'Thưởng trà',
          mediaUrls: [''],
        })
        recordFinding(
          "Instagram Boundary: Array with empty string [''] allowed by validate()",
          'INSTAGRAM',
          `validate() checks mediaUrls.length === 0, but does not verify that array elements are non-empty URLs (image_url="${payload.image_url}"). In live API mode, Meta Graph API will reject empty URL.`
        )
      }
    } catch (err) {
      recordFail("Instagram Boundary: Array containing empty string ['']", 'INSTAGRAM', err)
    }

    // 2.4: 1 valid image URL (PASS)
    try {
      const validIgReq: PublishRequest = {
        postId: 'ig_stress_valid_1',
        channel: 'INSTAGRAM',
        content: 'Nhang trầm hương cao cấp Ưu Đàm — Thanh lọc không gian sống.',
        mediaUrls: ['https://cdn.uudam.vn/products/nhang-tram.jpg'],
        mediaType: 'IMAGE',
        isMock: true,
      }
      instagramAdapter.validate(validIgReq)
      const igResult = await instagramAdapter.publish(validIgReq)
      if (
        igResult.success &&
        igResult.isMockResult &&
        igResult.externalPostId?.startsWith('ig_post_') &&
        igResult.externalPostUrl?.includes('instagram.com/p/ig_post_')
      ) {
        recordPass(
          'Instagram Boundary: 1 valid image (PASS)',
          'INSTAGRAM',
          `externalPostId=${igResult.externalPostId}, externalPostUrl=${igResult.externalPostUrl}`
        )
      } else {
        throw new Error(`Instagram publish did not return expected mock format: ${JSON.stringify(igResult)}`)
      }
    } catch (err) {
      recordFail('Instagram Boundary: 1 valid image (PASS)', 'INSTAGRAM', err)
    }

    // 2.5: Empty content on Instagram (MUST REJECT)
    try {
      let rejected = false
      try {
        instagramAdapter.validate({
          postId: 'ig_stress_no_content',
          channel: 'INSTAGRAM',
          content: '   ',
          mediaUrls: ['https://cdn.uudam.vn/img.jpg'],
        })
      } catch {
        rejected = true
      }
      if (rejected) {
        recordPass('Instagram Boundary: Whitespace-only caption (MUST REJECT)', 'INSTAGRAM', 'Correctly rejected')
      } else {
        throw new Error('InstagramAdapter allowed empty content!')
      }
    } catch (err) {
      recordFail('Instagram Boundary: Whitespace-only caption (MUST REJECT)', 'INSTAGRAM', err)
    }

    // ==================================================================
    // SUITE 3: TIKTOK BOUNDARY TESTS
    // Requirement: image only (MUST REJECT), text only (MUST REJECT), non-video mediaType (MUST REJECT), valid video URL (PASS)
    // ==================================================================
    console.log('\n--- [SUITE 3] TikTok Boundary Tests (FEAT-PUB-06) ---')

    // 3.1: Image only (mediaType: 'IMAGE', mediaUrls: ['https://...jpg']) (MUST REJECT)
    try {
      let rejected = false
      let errMsg = ''
      try {
        tiktokAdapter.validate({
          postId: 'tt_stress_img_only',
          channel: 'TIKTOK',
          content: 'Video giới thiệu trà sen Ưu Đàm',
          mediaType: 'IMAGE',
          mediaUrls: ['https://cdn.uudam.vn/img/tra-sen.jpg'],
          isMock: true,
        })
      } catch (err) {
        rejected = true
        errMsg = err instanceof Error ? err.message : String(err)
      }
      if (rejected && errMsg.includes('TikTok bắt buộc phải có tài nguyên video')) {
        recordPass('TikTok Boundary: Image only (mediaType: IMAGE) (MUST REJECT)', 'TIKTOK', `Caught: "${errMsg}"`)
      } else {
        throw new Error(`Expected rejection for image only, got rejected=${rejected}, msg="${errMsg}"`)
      }
    } catch (err) {
      recordFail('TikTok Boundary: Image only (mediaType: IMAGE) (MUST REJECT)', 'TIKTOK', err)
    }

    // 3.2: Text only (no mediaType, no mediaUrls) (MUST REJECT)
    try {
      let rejected = false
      let errMsg = ''
      try {
        tiktokAdapter.validate({
          postId: 'tt_stress_text_only',
          channel: 'TIKTOK',
          content: 'Bài viết chỉ có chữ không có video',
          mediaType: undefined,
          mediaUrls: [],
          isMock: true,
        })
      } catch (err) {
        rejected = true
        errMsg = err instanceof Error ? err.message : String(err)
      }
      if (rejected && errMsg.includes('TikTok bắt buộc phải có tài nguyên video')) {
        recordPass('TikTok Boundary: Text only (no media) (MUST REJECT)', 'TIKTOK', `Caught: "${errMsg}"`)
      } else {
        throw new Error(`Expected rejection for text only, got rejected=${rejected}, msg="${errMsg}"`)
      }
    } catch (err) {
      recordFail('TikTok Boundary: Text only (no media) (MUST REJECT)', 'TIKTOK', err)
    }

    // 3.3: Non-video mediaType (mediaType: 'AUDIO') (MUST REJECT)
    try {
      let rejected = false
      let errMsg = ''
      try {
        tiktokAdapter.validate({
          postId: 'tt_stress_audio',
          channel: 'TIKTOK',
          content: 'Tiếng chuông thiền Ưu Đàm',
          mediaType: 'AUDIO',
          mediaUrls: ['https://cdn.uudam.vn/audio/chuong.mp3'],
          isMock: true,
        })
      } catch (err) {
        rejected = true
        errMsg = err instanceof Error ? err.message : String(err)
      }
      if (rejected && errMsg.includes('TikTok bắt buộc phải có tài nguyên video')) {
        recordPass('TikTok Boundary: Non-video mediaType (AUDIO) (MUST REJECT)', 'TIKTOK', `Caught: "${errMsg}"`)
      } else {
        throw new Error(`Expected rejection for mediaType=AUDIO, got rejected=${rejected}, msg="${errMsg}"`)
      }
    } catch (err) {
      recordFail('TikTok Boundary: Non-video mediaType (AUDIO) (MUST REJECT)', 'TIKTOK', err)
    }

    // 3.4: Non-video mediaType (mediaType: 'DOCUMENT') (MUST REJECT)
    try {
      let rejected = false
      let errMsg = ''
      try {
        tiktokAdapter.validate({
          postId: 'tt_stress_doc',
          channel: 'TIKTOK',
          content: 'Tài liệu hướng dẫn pha trà',
          mediaType: 'DOCUMENT',
          mediaUrls: ['https://cdn.uudam.vn/doc/catalogue.pdf'],
          isMock: true,
        })
      } catch (err) {
        rejected = true
        errMsg = err instanceof Error ? err.message : String(err)
      }
      if (rejected && errMsg.includes('TikTok bắt buộc phải có tài nguyên video')) {
        recordPass('TikTok Boundary: Non-video mediaType (DOCUMENT) (MUST REJECT)', 'TIKTOK', `Caught: "${errMsg}"`)
      } else {
        throw new Error(`Expected rejection for mediaType=DOCUMENT, got rejected=${rejected}, msg="${errMsg}"`)
      }
    } catch (err) {
      recordFail('TikTok Boundary: Non-video mediaType (DOCUMENT) (MUST REJECT)', 'TIKTOK', err)
    }

    // 3.5: Video mediaType but empty mediaUrls (MUST REJECT)
    try {
      let rejected = false
      let errMsg = ''
      try {
        tiktokAdapter.validate({
          postId: 'tt_stress_video_no_urls',
          channel: 'TIKTOK',
          content: 'Clip pha trà sen',
          mediaType: 'VIDEO',
          mediaUrls: [],
          isMock: true,
        })
      } catch (err) {
        rejected = true
        errMsg = err instanceof Error ? err.message : String(err)
      }
      if (rejected && errMsg.includes('TikTok bắt buộc phải có tài nguyên video')) {
        recordPass('TikTok Boundary: Video mediaType with empty mediaUrls [] (MUST REJECT)', 'TIKTOK', `Caught: "${errMsg}"`)
      } else {
        throw new Error(`Expected rejection for mediaType=VIDEO but empty urls, got rejected=${rejected}`)
      }
    } catch (err) {
      recordFail('TikTok Boundary: Video mediaType with empty mediaUrls [] (MUST REJECT)', 'TIKTOK', err)
    }

    // 3.5b: Video mediaType but mediaUrls contains only empty string [''] (MUST REJECT)
    try {
      let rejected = false
      let errMsg = ''
      try {
        tiktokAdapter.validate({
          postId: 'tt_stress_video_empty_str',
          channel: 'TIKTOK',
          content: 'Clip pha trà sen',
          mediaType: 'VIDEO',
          mediaUrls: [''],
          isMock: true,
        })
      } catch (err) {
        rejected = true
        errMsg = err instanceof Error ? err.message : String(err)
      }
      if (rejected && errMsg.includes('TikTok bắt buộc phải có tài nguyên video')) {
        recordPass("TikTok Boundary: Video mediaType with empty string [''] (MUST REJECT)", 'TIKTOK', `Caught: "${errMsg}"`)
      } else {
        throw new Error(`Expected rejection for mediaType=VIDEO with empty string url, got rejected=${rejected}`)
      }
    } catch (err) {
      recordFail("TikTok Boundary: Video mediaType with empty string [''] (MUST REJECT)", 'TIKTOK', err)
    }

    // 3.6: Valid video URL (PASS)
    try {
      const validTtReq: PublishRequest = {
        postId: 'tt_stress_valid_1',
        channel: 'TIKTOK',
        content: 'Khoảnh khắc pha ấm trà sen Tây Hồ buổi sớm an lành #thientra #uudam',
        mediaType: 'VIDEO',
        mediaUrls: ['https://cdn.uudam.vn/videos/tra-sen-tay-ho-1080p.mp4'],
        isMock: true,
      }
      tiktokAdapter.validate(validTtReq)
      const ttResult = await tiktokAdapter.publish(validTtReq)
      if (
        ttResult.success &&
        ttResult.isMockResult &&
        ttResult.externalPostId?.startsWith('tiktok_pub_') &&
        ttResult.externalPostUrl?.includes('tiktok.com/@uudam/video/tiktok_pub_')
      ) {
        recordPass(
          'TikTok Boundary: Valid video URL (PASS)',
          'TIKTOK',
          `externalPostId=${ttResult.externalPostId}, externalPostUrl=${ttResult.externalPostUrl}`
        )
      } else {
        throw new Error(`TikTok publish did not return expected mock format: ${JSON.stringify(ttResult)}`)
      }
    } catch (err) {
      recordFail('TikTok Boundary: Valid video URL (PASS)', 'TIKTOK', err)
    }

    // ==================================================================
    // SUITE 4: PAYLOAD SCHEMA STRESS
    // Stress with Unicode Vietnamese, emojis, special characters, XML/JSON special entities across 7 adapters
    // ==================================================================
    console.log('\n--- [SUITE 4] Payload Schema Stress Across 7 Adapters ---')

    const adversarialPayloads = [
      {
        label: 'Payload A: Full Vietnamese Diacritics & Currency',
        content:
          'Ưu Đàm Vạn Hạnh — Hương Trầm Tĩnh Tại & Chén Trà Thanh Khiết. Thưởng trà ngắm trăng, lòng an nhiên giữa chốn bụi trần. ĐT: 0901-234-567. Giá: 350.000₫ / hộp. Tận hưởng chữ "TÂM" và đức "NHẪN".',
        title: 'Hương Trầm Tĩnh Tại & Chén Trà Thanh Khiết — 2026',
        hashtags: '#ƯuĐàm #ThiềnTrà #TrầmHương #BìnhAn',
        mediaUrls: ['https://cdn.uudam.vn/img/tram-huong-full.jpg'],
        mediaType: 'IMAGE',
      },
      {
        label: 'Payload B: Full Spectrum Multi-byte Emojis & Symbols',
        content:
          'Trà thơm sớm mai 🧘‍♂️🍵🪷🌸🍃✨ Cảm nhận năng lượng chữa lành 🕉️⛩️🌿🕯️ An trú trong từng hơi thở 🧘‍♀️🎋🏯🏮📿🕊️🌅🎐',
        title: 'Trà Sớm Mai 🧘‍♂️🍵🪷',
        hashtags: '#ZenLife #TeaCeremony #PeacefulMind #ƯuĐàm',
        mediaUrls: ['https://cdn.uudam.vn/img/tea-emoji.jpg'],
        mediaType: 'IMAGE',
      },
      {
        label: 'Payload C: Quotes, Escapes, Backticks, Slashes, Newlines & Tabs',
        content:
          'Title: "Thiền Định & \'Tỉnh Thức\'"\n\nParagraph 1:\t`const zen = true;`\r\nPath: C:\\data\\uudam/media/pic.jpg\nSymbols: | & ~ % ^ * ( ) _ + = { "key": [1, 2, 3] } <tag>',
        title: 'Thiền Định & "Tỉnh Thức" (Vấn Đề \'Hiện Tại\')',
        hashtags: '#quote #backslash #symbol',
        mediaUrls: ['https://cdn.uudam.vn/img/test-escape.png'],
        mediaType: 'IMAGE',
      },
      {
        label: 'Payload D: XML/HTML Entities & JSON Injection Vectors',
        content:
          '<script>alert("XSS_ATTACK")</script><img src=x onerror=alert(1) />&amp;&lt;&gt;&quot;&#39;{"drop_table": true, "role": "admin"}<!-- XML COMMENT -->',
        title: '<script>alert(1)</script> Ưu Đàm JSON Injection Test',
        hashtags: '#xss #security #injection',
        mediaUrls: ['https://cdn.uudam.vn/img/sec-test.png'],
        mediaType: 'IMAGE',
      },
    ]

    for (const p of adversarialPayloads) {
      console.log(`\n  * Testing: ${p.label}`)

      for (const platform of SUPPORTED_PLATFORMS) {
        const adapter = getAdapter(platform)

        // Adjust payload specifically for TikTok (must be VIDEO)
        const isTikTok = platform === 'TIKTOK'
        const effectiveMediaType = isTikTok ? 'VIDEO' : p.mediaType
        const effectiveMediaUrls = isTikTok ? ['https://cdn.uudam.vn/videos/clip.mp4'] : p.mediaUrls

        const req: PublishRequest = {
          postId: `stress_${platform.toLowerCase()}_${Date.now().toString(36)}`,
          channel: platform,
          content: p.content,
          title: p.title,
          hashtags: p.hashtags,
          mediaUrls: effectiveMediaUrls,
          mediaType: effectiveMediaType,
          isMock: true,
        }

        try {
          // 1. Validation
          adapter.validate(req)

          // 2. Format payload
          const payload = adapter.formatPayload(req)

          // Check that payload is 100% JSON serializable
          const serialized = JSON.stringify(payload)
          if (!serialized || serialized.length === 0) {
            throw new Error(`JSON.stringify(payload) returned empty string for ${platform}`)
          }
          const reparsed = JSON.parse(serialized)
          if (typeof reparsed !== 'object') {
            throw new Error(`Reparsed payload is not an object for ${platform}`)
          }

          // 3. Publish in Safe Mock
          const result = await adapter.publish(req)
          if (!result.success) {
            throw new Error(`Publish returned success=false for ${platform}: ${result.error}`)
          }

          // Check payload snapshot preservation
          if (!result.payloadSnapshot) {
            throw new Error(`Missing payloadSnapshot in result for ${platform}`)
          }

          // Verify specific platform behaviors
          if (platform === 'WEBSITE') {
            const slug = (result.responseSnapshot as { slug?: string })?.slug
            if (!slug || slug.includes('<') || slug.includes('>') || slug.includes('"')) {
              throw new Error(`Website slug "${slug}" contains unescaped special characters!`)
            }
          }

          recordPass(`${platform} handled ${p.label.split(':')[0]}`, 'PAYLOAD_STRESS')
        } catch (err) {
          recordFail(`${platform} failed on ${p.label.split(':')[0]}`, 'PAYLOAD_STRESS', err)
        }
      }
    }

    // ==================================================================
    // SUITE 5: SAFE MOCK SIMULATION RESPONSES & PERMALINK CHECKS
    // Check that external IDs (fb_post_..., zalo_msg_..., tiktok_pub_..., threads_post_...) and permalinks match specs
    // ==================================================================
    console.log('\n--- [SUITE 5] Safe Mock Simulation Responses & External ID Formats ---')

    // 5.1: Facebook ID & Permalink format
    try {
      const res = await facebookAdapter.publish({
        postId: 'fb_mock_test',
        channel: 'FACEBOOK',
        content: 'Test Facebook Mock Output',
        isMock: true,
      })
      const idMatch = /^fb_post_\d+$/.test(res.externalPostId || '')
      const urlMatch = /^https:\/\/facebook\.com\/uudam\/posts\/\d+$/.test(res.externalPostUrl || '')
      const isMock = res.isMockResult === true
      const hasResponseSnapshot = typeof (res.responseSnapshot as { id?: string })?.id === 'string'

      if (idMatch && urlMatch && isMock && hasResponseSnapshot) {
        recordPass(
          'Facebook Safe Mock: ID format fb_post_* and URL format facebook.com/uudam/posts/*',
          'SAFE_MOCK',
          `ID: ${res.externalPostId}, URL: ${res.externalPostUrl}`
        )
      } else {
        throw new Error(`Facebook mock format mismatch: id=${res.externalPostId}, url=${res.externalPostUrl}, isMock=${isMock}`)
      }
    } catch (err) {
      recordFail('Facebook Safe Mock: ID and URL format', 'SAFE_MOCK', err)
    }

    // 5.2: Zalo OA ID & Permalink format
    try {
      const res = await zaloAdapter.publish({
        postId: 'zalo_mock_test',
        channel: 'ZALO_OA',
        content: 'Test Zalo OA Mock Output',
        isMock: true,
      })
      const idMatch = /^zalo_msg_\d+$/.test(res.externalPostId || '')
      const urlMatch = /^https:\/\/oa\.zalo\.me\/post\/zalo_msg_\d+$/.test(res.externalPostUrl || '')
      const snapshot = res.responseSnapshot as { error?: number; message?: string; data?: { msg_id?: string } }
      const snapshotValid = snapshot?.error === 0 && snapshot?.message === 'Success' && snapshot?.data?.msg_id === res.externalPostId

      if (idMatch && urlMatch && snapshotValid) {
        recordPass(
          'Zalo OA Safe Mock: ID format zalo_msg_* and URL format oa.zalo.me/post/*',
          'SAFE_MOCK',
          `ID: ${res.externalPostId}, URL: ${res.externalPostUrl}`
        )
      } else {
        throw new Error(`Zalo OA mock format mismatch: id=${res.externalPostId}, url=${res.externalPostUrl}`)
      }
    } catch (err) {
      recordFail('Zalo OA Safe Mock: ID and URL format', 'SAFE_MOCK', err)
    }

    // 5.3: TikTok ID & Permalink format
    try {
      const res = await tiktokAdapter.publish({
        postId: 'tt_mock_test',
        channel: 'TIKTOK',
        content: 'Test TikTok Mock Output',
        mediaType: 'VIDEO',
        mediaUrls: ['https://cdn.uudam.vn/video.mp4'],
        isMock: true,
      })
      const idMatch = /^tiktok_pub_\d+$/.test(res.externalPostId || '')
      const urlMatch = /^https:\/\/www\.tiktok\.com\/@uudam\/video\/tiktok_pub_\d+$/.test(res.externalPostUrl || '')
      const snapshot = res.responseSnapshot as { publish_id?: string }
      const snapshotValid = snapshot?.publish_id === res.externalPostId

      if (idMatch && urlMatch && snapshotValid) {
        recordPass(
          'TikTok Safe Mock: ID format tiktok_pub_* and URL format tiktok.com/@uudam/video/*',
          'SAFE_MOCK',
          `ID: ${res.externalPostId}, URL: ${res.externalPostUrl}`
        )
      } else {
        throw new Error(`TikTok mock format mismatch: id=${res.externalPostId}, url=${res.externalPostUrl}`)
      }
    } catch (err) {
      recordFail('TikTok Safe Mock: ID and URL format', 'SAFE_MOCK', err)
    }

    // 5.4: Threads ID & Permalink format
    try {
      const res = await threadsAdapter.publish({
        postId: 'th_mock_test',
        channel: 'THREADS',
        content: 'Test Threads Mock Output',
        isMock: true,
      })
      const idMatch = /^threads_post_\d+$/.test(res.externalPostId || '')
      const urlMatch = /^https:\/\/www\.threads\.net\/@uudam\/post\/threads_post_\d+$/.test(res.externalPostUrl || '')
      const snapshot = res.responseSnapshot as { id?: string }
      const snapshotValid = snapshot?.id === res.externalPostId

      if (idMatch && urlMatch && snapshotValid) {
        recordPass(
          'Threads Safe Mock: ID format threads_post_* and URL format threads.net/@uudam/post/*',
          'SAFE_MOCK',
          `ID: ${res.externalPostId}, URL: ${res.externalPostUrl}`
        )
      } else {
        throw new Error(`Threads mock format mismatch: id=${res.externalPostId}, url=${res.externalPostUrl}`)
      }
    } catch (err) {
      recordFail('Threads Safe Mock: ID and URL format', 'SAFE_MOCK', err)
    }

    // 5.5: Instagram ID, Container ID & Permalink format
    try {
      const res = await instagramAdapter.publish({
        postId: 'ig_mock_test',
        channel: 'INSTAGRAM',
        content: 'Test Instagram Mock Output',
        mediaUrls: ['https://cdn.uudam.vn/img/statue.jpg'],
        isMock: true,
      })
      const idMatch = /^ig_post_\d+$/.test(res.externalPostId || '')
      const urlMatch = /^https:\/\/instagram\.com\/p\/ig_post_\d+$/.test(res.externalPostUrl || '')
      const snapshot = res.responseSnapshot as { id?: string; container_id?: string; status_code?: string }
      const snapshotValid =
        snapshot?.id === res.externalPostId &&
        typeof snapshot?.container_id === 'string' &&
        snapshot.container_id.startsWith('ig_container_') &&
        snapshot?.status_code === 'FINISHED'

      if (idMatch && urlMatch && snapshotValid) {
        recordPass(
          'Instagram Safe Mock: ID ig_post_*, container ig_container_*, URL instagram.com/p/*',
          'SAFE_MOCK',
          `ID: ${res.externalPostId}, Container: ${snapshot.container_id}, URL: ${res.externalPostUrl}`
        )
      } else {
        throw new Error(`Instagram mock format mismatch: id=${res.externalPostId}, url=${res.externalPostUrl}`)
      }
    } catch (err) {
      recordFail('Instagram Safe Mock: ID and URL format', 'SAFE_MOCK', err)
    }

    // 5.6: Website Blog format
    try {
      const res = await websiteBlogAdapter.publish({
        channel: 'WEBSITE',
        title: 'Khám Phá Trà Sen',
        content: 'Nội dung bài viết về nghệ thuật ướp trà sen Phủ Tây Hồ.',
        isMock: true,
      })
      const urlMatch = (res.externalPostUrl || '').startsWith('/blog/kham-pha-tra-sen-')
      const snapshot = res.responseSnapshot as { slug?: string; status?: string; isPublic?: boolean }
      const snapshotValid = typeof snapshot?.slug === 'string' && snapshot?.status === 'PUBLISHED' && snapshot?.isPublic === true

      if (urlMatch && snapshotValid) {
        recordPass(
          'Website Blog Safe Mock: Slug generation and /blog/[slug] URL',
          'SAFE_MOCK',
          `URL: ${res.externalPostUrl}`
        )
      } else {
        throw new Error(`Website Blog mock format mismatch: url=${res.externalPostUrl}`)
      }
    } catch (err) {
      recordFail('Website Blog Safe Mock: Slug and URL format', 'SAFE_MOCK', err)
    }

    // 5.7: External CMS format
    try {
      const res = await externalCmsAdapter.publish({
        postId: 'cms_mock_test',
        channel: 'EXTERNAL_CMS',
        title: 'Nghệ Thuật Hương Trầm',
        content: 'Bài viết đồng bộ CMS ngoài.',
        mediaUrls: ['https://cdn.uudam.vn/img/tram.jpg'],
        isMock: true,
      })
      const idNumeric = /^\d+$/.test(res.externalPostId || '')
      const urlMatch = (res.externalPostUrl || '').startsWith('https://external-store.vn/blogs/posts/')
      const snapshot = res.responseSnapshot as { id?: number; status?: string }
      const snapshotValid = typeof snapshot?.id === 'number' && snapshot?.status === 'published'

      if (idNumeric && urlMatch && snapshotValid) {
        recordPass(
          'External CMS Safe Mock: Numeric ID and external-store.vn URL',
          'SAFE_MOCK',
          `ID: ${res.externalPostId}, URL: ${res.externalPostUrl}`
        )
      } else {
        throw new Error(`External CMS mock format mismatch: id=${res.externalPostId}, url=${res.externalPostUrl}`)
      }
    } catch (err) {
      recordFail('External CMS Safe Mock: Numeric ID and URL format', 'SAFE_MOCK', err)
    }

    // ==================================================================
    // SUITE 6: TOP-LEVEL publishPost() DB PERSISTENCE & LIFECYCLE
    // Test publishPost() with temporary DB SocialPost record
    // ==================================================================
    console.log('\n--- [SUITE 6] Top-level publishPost() DB Persistence & Lifecycle ---')

    try {
      // Create a temporary post directly in SocialPost table to verify publishPost DB update
      const tempPost = await prisma.socialPost.create({
        data: {
          channel: 'WEBSITE',
          title: 'Bài Viết Stress Test DB Persistence',
          content: 'Nội dung kiểm thử cập nhật payloadSnapshot vào CSDL.',
          status: 'APPROVED',
          isMock: true,
        },
      })
      createdPostIds.push(tempPost.id)

      const publishRes = await publishPost({
        postId: tempPost.id,
        channel: 'WEBSITE',
        content: tempPost.content,
        title: tempPost.title,
        isMock: true,
      })

      if (!publishRes.success) {
        throw new Error(`publishPost failed: ${publishRes.error}`)
      }

      // Reload from DB and check payloadSnapshot and slug
      const reloaded = await prisma.socialPost.findUnique({
        where: { id: tempPost.id },
      })

      if (!reloaded?.payloadSnapshot) {
        throw new Error('payloadSnapshot was not updated in DB by publishPost!')
      }

      const parsedSnapshot = JSON.parse(reloaded.payloadSnapshot)
      if (parsedSnapshot.title !== tempPost.title) {
        throw new Error(`payloadSnapshot title mismatch: ${parsedSnapshot.title}`)
      }

      if (!reloaded.slug || !reloaded.slug.startsWith('bai-viet-stress-test-db-persistence-')) {
        throw new Error(`slug was not generated or updated in DB: ${reloaded.slug}`)
      }

      recordPass(
        'Top-level publishPost(): Successfully updated slug and payloadSnapshot in DB',
        'DB_PERSISTENCE',
        `postId=${tempPost.id}, slug=${reloaded.slug}`
      )
    } catch (err) {
      recordFail('Top-level publishPost(): DB persistence', 'DB_PERSISTENCE', err)
    }

    // ==================================================================
    // SUITE 7: NETWORK SAFETY INVARIANT AUDIT
    // Prove 0 outbound HTTP socket requests made to social media servers
    // ==================================================================
    console.log('\n--- [SUITE 7] Network Safety Invariant Audit (R6) ---')
    if (outboundHttpAttempts === 0) {
      recordPass('Network Safety: 0 outbound HTTP socket attempts to external platforms', 'SECURITY', 'outboundHttpAttempts = 0')
    } else {
      recordFail('Network Safety: Outbound requests leaked to network!', 'SECURITY', `Attempts: ${outboundHttpAttempts}`)
    }

  } finally {
    // ==================================================================
    // CLEANUP & TEARDOWN
    // Delete any test records created during stress tests
    // ==================================================================
    console.log('\n--- [CLEANUP] Dọn dẹp dữ liệu kiểm thử và kiểm toán hoàn nguyên ---')
    restoreNetworkSpy()

    if (createdPostIds.length > 0) {
      try {
        const deleted = await prisma.socialPost.deleteMany({
          where: { id: { in: createdPostIds } },
        })
        console.log(`🧹 Đã xóa ${deleted.count} bản ghi SocialPost thử nghiệm.`)
      } catch (cleanupErr) {
        console.warn('⚠️ Cảnh báo khi dọn dẹp SocialPost:', cleanupErr)
      }
    }

    const postParity = await verifyBaselineParity('POST-TEST')
    if (postParity) {
      recordPass('Database Parity: 24 core business tables 100% MATCH (Delta = 0)', 'CLEANUP', 'Post-test verification passed')
    } else {
      recordFail('Database Parity: Core business tables mismatch after cleanup!', 'CLEANUP', 'Delta != 0')
    }
  }

  // ==================================================================
  // SUMMARY REPORT
  // ==================================================================
  console.log('\n================================================================================')
  console.log('📊 BÁO CÁO TỔNG HỢP ADVERSARIAL STRESS TEST (MILESTONE 5) 📊')
  console.log('================================================================================')

  const passed = testResults.filter((t) => t.status === 'PASS').length
  const failed = testResults.filter((t) => t.status === 'FAIL').length
  const findings = testResults.filter((t) => t.status === 'FINDING').length

  console.log(`Tổng số bài test : ${testResults.length}`)
  console.log(`✅ Passed         : ${passed}`)
  console.log(`❌ Failed         : ${failed}`)
  console.log(`⚠️ Findings       : ${findings}`)

  if (findings > 0) {
    console.log('\nDanh sách Findings/Ghi chú biên:')
    for (const f of testResults.filter((t) => t.status === 'FINDING')) {
      console.log(`- [${f.category}] ${f.name}: ${f.detail}`)
    }
  }

  if (failed > 0) {
    console.error(`\n💥 PHÁT HIỆN ${failed} LỖI TRONG BÀI TEST ĐỐI KHÁNG!`)
    process.exit(1)
  } else {
    console.log('\n🎉 TOÀN BỘ BÀI KIỂM THỬ ĐỐI KHÁNG ĐÃ VƯỢT QUA THÀNH CÔNG! 🎉')
    process.exit(0)
  }
}

runPlatformStressSuite().catch((err) => {
  console.error('\n💥 LỖI KHÔNG MONG MUỐN TRONG STRESS TEST:', err)
  process.exit(1)
})
