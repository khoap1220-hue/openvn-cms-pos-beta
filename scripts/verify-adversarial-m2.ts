// scripts/verify-adversarial-m2.ts
// Adversarial Stress-Test Suite for M2 (Google Drive Content Source Engine)
// Conducted by Reviewer & Adversarial Critic

import fs from 'node:fs'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'
import {
  parseDriveUrl,
  determineFileType,
  buildDriveLinks,
  extractDocumentText,
  syncDriveFolderToDb,
  getContentSource,
  listContentSources,
  deleteContentSource,
} from '../src/lib/drive-parser'
import { GET as getSources, POST as postSource } from '../src/app/api/social/drive/route'
import {
  GET as getSourceDetail,
  PUT as putSourceDetail,
  DELETE as deleteSourceDetail,
} from '../src/app/api/social/drive/[id]/route'
import { NextRequest } from 'next/server'

const prisma = new PrismaClient()

let passed = 0
let failed = 0

function assert(condition: boolean, msg: string) {
  if (condition) {
    console.log(`🛡️ [ADV-PASS] ${msg}`)
    passed++
  } else {
    console.error(`💥 [ADV-FAIL] ${msg}`)
    failed++
    throw new Error(`Adversarial assertion failed: ${msg}`)
  }
}

async function runAdversarialAudit() {
  console.log('======================================================================')
  console.log('⚔️  BẮT ĐẦU ADVERSARIAL STRESS TEST & INTEGRITY AUDIT (M2 DRIVE)  ⚔️')
  console.log('======================================================================\n')

  // --- 1. Edge-Case URL Parsing & Attack Vectors ---
  console.log('--- 1. Kiểm thử góc cạnh URL & Vector tấn công ---')

  // URL có khoảng trắng đầu/cuối
  const pSpaces = parseDriveUrl('   https://drive.google.com/drive/folders/1FYLaoscxWBV_BU5sFouf7XCrv7cKktBY   \n')
  assert(pSpaces.id === '1FYLaoscxWBV_BU5sFouf7XCrv7cKktBY' && pSpaces.type === 'folder', 'Xử lý khoảng trắng/newline an toàn')

  // URL có nhiều query params phức tạp
  const pQuery = parseDriveUrl('https://drive.google.com/drive/folders/1FYLaoscxWBV_BU5sFouf7XCrv7cKktBY?usp=sharing&authuser=2&hl=vi#sub')
  assert(pQuery.id === '1FYLaoscxWBV_BU5sFouf7XCrv7cKktBY', 'Xử lý chuỗi query phức tạp & hash fragment an toàn')

  // Google Sheets có gid và subpath
  const pSheet = parseDriveUrl('https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit?gid=12345#gid=12345')
  assert(pSheet.id === '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms' && pSheet.type === 'spreadsheet', 'Parse Sheet có gid')

  // Attack inputs: SQL injection, XSS, Path traversal
  const attackInputs = [
    "' OR 1=1 --",
    '<script>alert(1)</script>',
    '../../../etc/passwd',
    'https://attacker-domain.com/drive/folders/12345678901234567890',
    'javascript:alert(1)',
    '',
  ]
  for (const attack of attackInputs) {
    let blocked = false
    try {
      parseDriveUrl(attack)
    } catch (err: unknown) {
      blocked = err instanceof Error && (err.message.includes('không hợp lệ') || err.message.includes('không được để trống'))
    }
    assert(blocked, `Chặn an toàn đầu vào độc hại: ${JSON.stringify(attack)}`)
  }

  // --- 2. MIME & Extension Edge Cases ---
  console.log('\n--- 2. Kiểm thử phần mở rộng file phức tạp & hoa/thường ---')
  assert(determineFileType('application/octet-stream', 'BaoCao.2026.FINAL.XLSX') === 'SHEET', 'File nhiều dấu chấm + hoa chữ: XLSX')
  assert(determineFileType('application/octet-stream', 'IMAGE_HERO.JPEG') === 'IMAGE', 'File hoa chữ: JPEG')
  assert(determineFileType('application/octet-stream', 'clip_uudam.WEBM') === 'VIDEO', 'File hoa chữ: WEBM')
  assert(determineFileType('application/octet-stream', 'guide.MARKDOWN') === 'DOCUMENT', 'File hoa chữ: MARKDOWN')
  assert(determineFileType('application/octet-stream', 'UNKNOWN_FILE_NO_EXT') === 'OTHER', 'File không đuôi và MIME chung -> OTHER')

  // --- 3. Corrupted Metadata Recovery & Re-Sync Resilience ---
  console.log('\n--- 3. Khả năng chịu lỗi metadata hỏng & Bảo toàn liên kết thủ công ---')
  const testSource = await prisma.contentSource.create({
    data: {
      name: 'Nguồn tư liệu stress-test',
      driveFolderUrl: 'https://drive.google.com/drive/folders/1FYLaoscxWBV_BU5sFouf7XCrv7cKktBY',
      folderId: '1FYLaoscxWBV_BU5sFouf7XCrv7cKktBY',
      syncStatus: 'SYNCING',
    },
  })

  // Tạo một item với metadata chuỗi hỏng (không phải JSON hợp lệ)
  const corruptedItem = await prisma.contentSourceItem.create({
    data: {
      contentSourceId: testSource.id,
      driveFileId: '1rCuD8MxDwX-7o0eNXQTjd7XaWVe1IACV',
      name: 'Old Corrupted Document.pdf',
      mimeType: 'application/pdf',
      fileType: 'DOCUMENT',
      metadata: 'THIS_IS_CORRUPTED_JSON_NOT_AN_OBJECT',
    },
  })

  // Chạy re-sync qua syncDriveFolderToDb: không được văng lỗi do JSON.parse hỏng
  let resyncSucceeded = false
  try {
    const res = await syncDriveFolderToDb({
      contentSourceId: testSource.id,
      folderUrl: 'https://drive.google.com/drive/folders/1FYLaoscxWBV_BU5sFouf7XCrv7cKktBY',
    })
    resyncSucceeded = res.contentSource.syncStatus === 'SYNCED'
  } catch (e) {
    console.error('Re-sync failed on corrupted item:', e)
  }
  assert(resyncSucceeded, 'syncDriveFolderToDb xử lý ngoại lệ JSON parse mượt mà, không crash server')

  // Kiểm tra metadata của corruptedItem sau re-sync: không bị null
  const itemAfter = await prisma.contentSourceItem.findUnique({
    where: { id: corruptedItem.id },
  })
  assert(itemAfter !== null && itemAfter.metadata !== null, 'Item metadata được bảo toàn kể cả khi chuỗi cũ dị thường')

  // --- 4. Chống mất dữ liệu khi Google Drive trả lỗi trong lúc re-sync ---
  console.log('\n--- 4. Kiểm thử chống mất dữ liệu khi Re-sync gặp lỗi mạng/404 ---')
  // Cố tình re-sync vào folder không tồn tại
  let syncFailedAsExpected = false
  try {
    await syncDriveFolderToDb({
      contentSourceId: testSource.id,
      folderUrl: 'https://drive.google.com/drive/folders/100000000000000000000000000000000',
    })
  } catch (err: unknown) {
    syncFailedAsExpected = err instanceof Error && err.message.includes('không tồn tại')
  }
  assert(syncFailedAsExpected, 'syncDriveFolderToDb ném lỗi khi thư mục 404')

  // Kiểm tra trạng thái ContentSource trong DB: phải là ERROR và syncError được cập nhật
  const sourceAfterError = await prisma.contentSource.findUnique({
    where: { id: testSource.id },
  })
  assert(sourceAfterError?.syncStatus === 'ERROR', 'Trạng thái syncStatus chuyển thành ERROR')
  assert(Boolean(sourceAfterError?.syncError?.includes('không tồn tại')), 'syncError ghi nhận lý do lỗi rõ ràng')

  // Quan trọng nhất: Items cũ không hề bị xóa sạch!
  const itemCountAfterError = await prisma.contentSourceItem.count({
    where: { contentSourceId: testSource.id },
  })
  assert(itemCountAfterError >= 1, `Các items cũ vẫn được bảo toàn nguyên vẹn trong DB (${itemCountAfterError} items)`)

  // --- 5. Next.js 16 Route Handlers Adversarial Request Payload Tests ---
  console.log('\n--- 5. Kiểm thử Route Handlers với Payload lỗi & Không tồn tại ---')

  // POST /api/social/drive với body rỗng / malformed JSON
  const badPostReq = new NextRequest('http://localhost:3010/api/social/drive', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'MALFORMED_JSON_STRING',
  })
  const badPostRes = await postSource(badPostReq)
  assert(badPostRes.status === 400, 'POST /api/social/drive với body hỏng trả về HTTP 400')

  // POST /api/social/drive thiếu folderUrl
  const missingUrlReq = new NextRequest('http://localhost:3010/api/social/drive', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Chỉ có tên' }),
  })
  const missingUrlRes = await postSource(missingUrlReq)
  assert(missingUrlRes.status === 400, 'POST /api/social/drive thiếu folderUrl trả về HTTP 400')

  // GET /api/social/drive/[id] với ID không tồn tại
  const notFoundGet = await getSourceDetail(
    new NextRequest('http://localhost:3010/api/social/drive/non_existent_id_999'),
    { params: Promise.resolve({ id: 'non_existent_id_999' }) }
  )
  assert(notFoundGet.status === 404, 'GET /api/social/drive/[id] không tồn tại trả về HTTP 404')

  // PUT /api/social/drive/[id] với ID không tồn tại
  const notFoundPut = await putSourceDetail(
    new NextRequest('http://localhost:3010/api/social/drive/non_existent_id_999', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Update' }),
    }),
    { params: Promise.resolve({ id: 'non_existent_id_999' }) }
  )
  assert(notFoundPut.status === 404, 'PUT /api/social/drive/[id] không tồn tại trả về HTTP 404')

  // DELETE /api/social/drive/[id] với ID không tồn tại
  const notFoundDelete = await deleteSourceDetail(
    new NextRequest('http://localhost:3010/api/social/drive/non_existent_id_999', { method: 'DELETE' }),
    { params: Promise.resolve({ id: 'non_existent_id_999' }) }
  )
  assert(notFoundDelete.status === 404, 'DELETE /api/social/drive/[id] không tồn tại trả về HTTP 404')

  // --- 6. Cleanup & WAL Checkpoint ---
  console.log('\n--- 6. Dọn dẹp & Xả WAL ---')
  await prisma.contentSourceItem.deleteMany({
    where: { contentSourceId: testSource.id },
  })
  await prisma.contentSource.delete({
    where: { id: testSource.id },
  })

  const rawCheckpoint = await prisma.$queryRawUnsafe<Array<{ busy: bigint; log: bigint; checkpointed: bigint }>>('PRAGMA wal_checkpoint(FULL);')
  const busy = Number(rawCheckpoint[0]?.busy ?? BigInt(0))
  assert(busy === 0, 'WAL xả sạch busy=0')

  // --- 7. Baseline Parity ---
  console.log('\n--- 7. Đối soát baseline 24 bảng sau Adversarial Test ---')
  const baseline = JSON.parse(fs.readFileSync(path.resolve('db/baseline-counts.json'), 'utf8'))
  const coreTables = [
    'Product', 'Category', 'Order', 'OrderItem', 'Customer',
    'SalesInvoice', 'PurchaseInvoice', 'StockMovement', 'Warehouse', 'WarehouseStock',
    'Voucher', 'BomComponent', 'AccountingPeriod', 'Partner', 'Channel',
    'ChannelListing', 'Shipment', 'AfterSalesCase', 'AppSetting', 'IntegrationCredential',
    'ApiKey', 'WebhookEndpoint', 'AutomationSetting', 'OrderEvent'
  ]
  for (const model of coreTables) {
    const delegateName = model.charAt(0).toLowerCase() + model.slice(1)
    const delegate = (prisma as unknown as Record<string, { count: () => Promise<number> }>)[delegateName]
    const count = await delegate.count()
    assert(count === baseline[model], `Bảng ${model}: actual=${count} == baseline=${baseline[model]} (Delta = 0)`)
  }

  console.log('\n======================================================================')
  console.log(`🛡️  HOÀN TẤT ${passed} KIỂM THỬ ĐỐI KHÁNG THÀNH CÔNG! (FAILED: ${failed}) 🛡️`)
  console.log('======================================================================')
}

runAdversarialAudit()
  .catch((err) => {
    console.error('Adversarial audit failed:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
