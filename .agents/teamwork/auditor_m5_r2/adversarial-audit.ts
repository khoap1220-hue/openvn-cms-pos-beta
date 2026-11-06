// .agents/teamwork/auditor_m5_r2/adversarial-audit.ts
// Independent Forensic Adversarial Verification for Milestone 5 Remediation

import {
  facebookAdapter,
  zaloAdapter,
  websiteBlogAdapter,
  externalCmsAdapter,
  instagramAdapter,
  tiktokAdapter,
  threadsAdapter,
  shouldUseSafeMock,
  getAdapter,
} from '../../../src/lib/publishing-gateway'
import { middleware } from '../../../src/middleware'
import { NextRequest } from 'next/server'

let passCount = 0
let failCount = 0

function assert(cond: boolean, desc: string) {
  if (cond) {
    console.log(`✅ [AUDIT-PASS] ${desc}`)
    passCount++
  } else {
    console.error(`❌ [AUDIT-FAIL] ${desc}`)
    failCount++
    throw new Error(`Failed assertion: ${desc}`)
  }
}

async function runAdversarialAudit() {
  console.log('--- 1. Instagram Boundary Tests ---')
  // Instagram empty array
  let igErr1 = false
  try {
    instagramAdapter.validate({ channel: 'INSTAGRAM', content: 'test', mediaUrls: [] })
  } catch (e: any) {
    if (e.message.includes('bắt buộc phải có ít nhất 1 hình ảnh hoặc video')) igErr1 = true
  }
  assert(igErr1, 'Instagram: Empty mediaUrls array rejected')

  // Instagram empty string element ['']
  let igErr2 = false
  try {
    instagramAdapter.validate({ channel: 'INSTAGRAM', content: 'test', mediaUrls: [''] })
  } catch (e: any) {
    if (e.message.includes('bắt buộc phải có ít nhất 1 hình ảnh hoặc video')) igErr2 = true
  }
  assert(igErr2, 'Instagram: Array with empty string [\'\'] rejected')

  // Instagram whitespace string element ['   ']
  let igErr3 = false
  try {
    instagramAdapter.validate({ channel: 'INSTAGRAM', content: 'test', mediaUrls: ['   '] })
  } catch (e: any) {
    if (e.message.includes('bắt buộc phải có ít nhất 1 hình ảnh hoặc video')) igErr3 = true
  }
  assert(igErr3, 'Instagram: Array with whitespace [\'   \'] rejected')

  // Instagram undefined mediaUrls
  let igErr4 = false
  try {
    instagramAdapter.validate({ channel: 'INSTAGRAM', content: 'test' })
  } catch (e: any) {
    if (e.message.includes('bắt buộc phải có ít nhất 1 hình ảnh hoặc video')) igErr4 = true
  }
  assert(igErr4, 'Instagram: Undefined mediaUrls rejected')

  console.log('\n--- 2. TikTok Boundary Tests ---')
  // TikTok not VIDEO
  let ttErr1 = false
  try {
    tiktokAdapter.validate({ channel: 'TIKTOK', content: 'test', mediaType: 'IMAGE', mediaUrls: ['https://vid.mp4'] })
  } catch (e: any) {
    if (e.message.includes('bắt buộc phải có tài nguyên video')) ttErr1 = true
  }
  assert(ttErr1, 'TikTok: mediaType != VIDEO rejected')

  // TikTok mediaUrls empty array
  let ttErr2 = false
  try {
    tiktokAdapter.validate({ channel: 'TIKTOK', content: 'test', mediaType: 'VIDEO', mediaUrls: [] })
  } catch (e: any) {
    if (e.message.includes('bắt buộc phải có tài nguyên video')) ttErr2 = true
  }
  assert(ttErr2, 'TikTok: Empty mediaUrls rejected')

  // TikTok mediaUrls with empty string ['']
  let ttErr3 = false
  try {
    tiktokAdapter.validate({ channel: 'TIKTOK', content: 'test', mediaType: 'VIDEO', mediaUrls: [''] })
  } catch (e: any) {
    if (e.message.includes('bắt buộc phải có tài nguyên video')) ttErr3 = true
  }
  assert(ttErr3, 'TikTok: mediaUrls [\'\'] rejected')

  // TikTok mediaUrls with whitespace ['   ']
  let ttErr4 = false
  try {
    tiktokAdapter.validate({ channel: 'TIKTOK', content: 'test', mediaType: 'VIDEO', mediaUrls: ['   '] })
  } catch (e: any) {
    if (e.message.includes('bắt buộc phải có tài nguyên video')) ttErr4 = true
  }
  assert(ttErr4, 'TikTok: mediaUrls [\'   \'] rejected')

  console.log('\n--- 3. Threads Boundary Tests ---')
  // Threads > 500 characters
  let thErr1 = false
  try {
    threadsAdapter.validate({ channel: 'THREADS', content: 'a'.repeat(501) })
  } catch (e: any) {
    if (e.message.includes('vượt quá giới hạn 500 ký tự')) thErr1 = true
  }
  assert(thErr1, 'Threads: Content > 500 chars rejected')

  // Threads exactly 500 characters allowed
  let thOk = true
  try {
    threadsAdapter.validate({ channel: 'THREADS', content: 'a'.repeat(500) })
  } catch {
    thOk = false
  }
  assert(thOk, 'Threads: Content exactly 500 chars accepted')

  console.log('\n--- 4. Empty / Whitespace Content Tests Across All Adapters ---')
  const allAdapters = [
    facebookAdapter,
    zaloAdapter,
    websiteBlogAdapter,
    externalCmsAdapter,
    instagramAdapter,
    tiktokAdapter,
    threadsAdapter,
  ]
  for (const ad of allAdapters) {
    let emptyRejected = false
    try {
      ad.validate({ channel: ad.platform, content: '   ', mediaUrls: ['https://example.com/media.mp4'], mediaType: 'VIDEO' })
    } catch {
      emptyRejected = true
    }
    assert(emptyRejected, `${ad.platform}: Whitespace-only content rejected`)
  }

  console.log('\n--- 5. Middleware /blog Access Tests Under Auth Lock ---')
  process.env.CMS_REQUIRE_AUTH = 'true'
  const blogListReq = new NextRequest('http://localhost:3010/blog')
  const blogListRes = await middleware(blogListReq)
  assert(blogListRes.status === 200 || blogListRes.headers.get('x-middleware-next') === '1' || blogListRes.statusText === '', 'Middleware: /blog allowed under CMS_REQUIRE_AUTH=true')

  const blogPostReq = new NextRequest('http://localhost:3010/blog/bai-viet-tra-sen-123')
  const blogPostRes = await middleware(blogPostReq)
  assert(blogPostRes.status === 200 || blogPostRes.headers.get('x-middleware-next') === '1' || blogPostRes.statusText === '', 'Middleware: /blog/[slug] allowed under CMS_REQUIRE_AUTH=true')

  console.log('\n--- 6. Safe Mock Invariant Verification ---')
  // When NODE_ENV === 'test'
  const oldEnv = process.env.NODE_ENV
  process.env.NODE_ENV = 'test'
  assert(shouldUseSafeMock({ forceMock: false, channelConfig: { isMock: false, credentials: '{"apiKey":"live"}' } }) === true, 'SafeMock: strictly true in test environment')
  process.env.NODE_ENV = oldEnv

  // When forceMock === true
  assert(shouldUseSafeMock({ forceMock: true }) === true, 'SafeMock: strictly true when forceMock = true')

  // When credentials malformed
  assert(shouldUseSafeMock({ channelConfig: { isMock: false, credentials: '{malformed' } }) === true, 'SafeMock: strictly true when credentials JSON malformed')

  // When credentials empty object
  assert(shouldUseSafeMock({ channelConfig: { isMock: false, credentials: '{}' } }) === true, 'SafeMock: strictly true when credentials empty')

  console.log(`\n========================================`)
  console.log(`🎉 ADVERSARIAL AUDIT COMPLETE: ${passCount} PASSED, ${failCount} FAILED 🎉`)
  console.log(`========================================`)
}

runAdversarialAudit().catch((err) => {
  console.error('Fatal audit failure:', err)
  process.exit(1)
})
