// scripts/verify-m2-drive.ts
// Automated Verification Suite for Milestone 2 (M2: Google Drive Content Source Engine)
// OPENVN · Ưu Đàm Suite (AUTO SOCIAL Module)
// Verifies: URL parsing, Zero-Key _DRIVE_ivd scraper, real public folder ingestion,
// Docs/Sheets text extraction, error handling, non-destructive re-sync, 24-table baseline parity.

import fs from 'node:fs'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'
import {
  parseDriveUrl,
  determineFileType,
  buildDriveLinks,
  extractDocumentText,
  fetchPublicDriveFolder,
  syncDriveFolderToDb,
  getContentSource,
  listContentSources,
  deleteContentSource,
} from '../src/lib/drive-parser'
import { GET as getDriveSources, POST as postDriveSource } from '../src/app/api/social/drive/route'
import {
  GET as getDriveSourceDetail,
  PUT as putDriveSourceDetail,
  DELETE as deleteDriveSourceDetail,
} from '../src/app/api/social/drive/[id]/route'
import { NextRequest } from 'next/server'

const prisma = new PrismaClient()

let passedTests = 0
let failedTests = 0

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`✅ [PASS] ${testName}`)
    passedTests++
  } else {
    console.error(`❌ [FAIL] ${testName}${detail ? ` -> ${detail}` : ''}`)
    failedTests++
    throw new Error(`Assertion failed: ${testName}`)
  }
}

async function main() {
  console.log('======================================================================')
  console.log('🚀 BẮT ĐẦU KIỂM THỬ TỰ ĐỘNG MILESTONE 2 (DRIVE CONTENT SOURCE) 🚀')
  console.log('======================================================================\n')

  // ------------------------------------------------------------------
  // GIAI ĐOẠN 1: ĐỐI SOÁT BASELINE BAN ĐẦU 24 BẢNG NGHIỆP VỤ CỐT LÕI
  // ------------------------------------------------------------------
  console.log('--- [GIAI ĐOẠN 1] Đối soát baseline 24 bảng dữ liệu ban đầu ---')
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
    assert(count === baseline[model], `Bảng baseline ${model}: actual=${count} == baseline=${baseline[model]}`)
  }

  // ------------------------------------------------------------------
  // GIAI ĐOẠN 2: PHÂN TÍCH & KIỂM TRA ĐỊNH DẠNG URL GOOGLE DRIVE (FEAT-DRV-01)
  // ------------------------------------------------------------------
  console.log('\n--- [GIAI ĐOẠN 2] Kiểm thử bộ phân giải URL Google Drive đa định dạng ---')

  // 1. Link thư mục chuẩn
  const url1 = 'https://drive.google.com/drive/folders/1FYLaoscxWBV_BU5sFouf7XCrv7cKktBY'
  const p1 = parseDriveUrl(url1)
  assert(p1.id === '1FYLaoscxWBV_BU5sFouf7XCrv7cKktBY' && p1.type === 'folder', 'Parse chuẩn: drive.google.com/drive/folders/{id}')

  // 2. Link thư mục kèm query usp=sharing
  const url2 = 'https://drive.google.com/drive/folders/1FYLaoscxWBV_BU5sFouf7XCrv7cKktBY?usp=sharing'
  const p2 = parseDriveUrl(url2)
  assert(p2.id === '1FYLaoscxWBV_BU5sFouf7XCrv7cKktBY' && p2.type === 'folder', 'Parse query params: ?usp=sharing')

  // 3. Link thư mục kèm u/0 user index
  const url3 = 'https://drive.google.com/drive/u/0/folders/1FYLaoscxWBV_BU5sFouf7XCrv7cKktBY?usp=drive_link'
  const p3 = parseDriveUrl(url3)
  assert(p3.id === '1FYLaoscxWBV_BU5sFouf7XCrv7cKktBY' && p3.type === 'folder', 'Parse user index: /drive/u/0/folders/{id}')

  // 4. Link tham số open?id
  const url4 = 'https://drive.google.com/open?id=1FYLaoscxWBV_BU5sFouf7XCrv7cKktBY&authuser=0'
  const p4 = parseDriveUrl(url4)
  assert(p4.id === '1FYLaoscxWBV_BU5sFouf7XCrv7cKktBY' && p4.type === 'folder', 'Parse tham số open: drive.google.com/open?id={id}')

  // 5. Link Google Docs
  const url5 = 'https://docs.google.com/document/d/1yJVXtabsP7KrJXSu3XyOh-F2cFoP8Lftr14PtXCLEVU/edit?usp=sharing'
  const p5 = parseDriveUrl(url5)
  assert(p5.id === '1yJVXtabsP7KrJXSu3XyOh-F2cFoP8Lftr14PtXCLEVU' && p5.type === 'document', 'Parse Google Doc: docs.google.com/document/d/{id}')

  // 6. Link Google Sheets
  const url6 = 'https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit#gid=0'
  const p6 = parseDriveUrl(url6)
  assert(p6.id === '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms' && p6.type === 'spreadsheet', 'Parse Google Sheet: docs.google.com/spreadsheets/d/{id}')

  // 7. Link tệp Google Drive file
  const url7 = 'https://drive.google.com/file/d/1rCuD8MxDwX-7o0eNXQTjd7XaWVe1IACV/view?usp=sharing'
  const p7 = parseDriveUrl(url7)
  assert(p7.id === '1rCuD8MxDwX-7o0eNXQTjd7XaWVe1IACV' && p7.type === 'file', 'Parse Google Drive file: drive.google.com/file/d/{id}')

  // 8. Bare ID (chuỗi alphanumeric dài >= 20 ký tự)
  const bareId = '1FYLaoscxWBV_BU5sFouf7XCrv7cKktBY'
  const p8 = parseDriveUrl(bareId)
  assert(p8.id === '1FYLaoscxWBV_BU5sFouf7XCrv7cKktBY' && p8.type === 'folder', 'Parse bare ID trực tiếp')

  // 9. Bắt lỗi URL không hợp lệ
  let invalidCaught = false
  try {
    parseDriveUrl('https://facebook.com/uudamshop')
  } catch (err: unknown) {
    invalidCaught = err instanceof Error && err.message.includes('không hợp lệ')
  }
  assert(invalidCaught, 'Chặn URL không thuộc Google Drive với thông báo tiếng Việt rõ ràng')

  // ------------------------------------------------------------------
  // GIAI ĐOẠN 3: PHÂN LOẠI LOẠI TỆP & TẠO LINK TRUY CẬP CDN (FEAT-DRV-02)
  // ------------------------------------------------------------------
  console.log('\n--- [GIAI ĐOẠN 3] Kiểm thử phân loại MIME type & tạo liên kết CDN ---')
  assert(determineFileType('image/jpeg', 'tram-huong.jpg') === 'IMAGE', 'Nhận diện ảnh: IMAGE')
  assert(determineFileType('video/mp4', 'video-clip.mp4') === 'VIDEO', 'Nhận diện video: VIDEO')
  assert(determineFileType('application/vnd.google-apps.document', 'MoTa.doc') === 'DOCUMENT', 'Nhận diện tài liệu Google Doc: DOCUMENT')
  assert(determineFileType('application/vnd.google-apps.spreadsheet', 'GiaBan.xlsx') === 'SHEET', 'Nhận diện bảng tính Google Sheet: SHEET')
  assert(determineFileType('application/vnd.google-apps.folder', 'ThuMuc1') === 'FOLDER', 'Nhận diện thư mục: FOLDER')

  const links = buildDriveLinks('1rCuD8MxDwX-7o0eNXQTjd7XaWVe1IACV', 'application/pdf', 'DOCUMENT')
  assert(links.thumbnailUrl === 'https://lh3.googleusercontent.com/d/1rCuD8MxDwX-7o0eNXQTjd7XaWVe1IACV', 'Tạo đúng link ảnh thu nhỏ thumbnail lh3 CDN')
  assert(links.webViewLink === 'https://drive.google.com/file/d/1rCuD8MxDwX-7o0eNXQTjd7XaWVe1IACV/view', 'Tạo đúng link xem trực tiếp webViewLink')
  assert(links.downloadUrl === 'https://drive.google.com/uc?export=download&id=1rCuD8MxDwX-7o0eNXQTjd7XaWVe1IACV', 'Tạo đúng link tải trực tiếp downloadUrl')

  // ------------------------------------------------------------------
  // GIAI ĐOẠN 4: TRÍCH XUẤT VĂN BẢN TỪ GOOGLE SHEETS & DOCS (FEAT-DRV-03)
  // ------------------------------------------------------------------
  console.log('\n--- [GIAI ĐOẠN 4] Kiểm thử trích xuất nội dung văn bản Google Sheets & Docs ---')
  // Trích xuất Google Sheets thật từ mẫu Google Sheet công khai
  const publicSheetId = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms'
  const sheetContent = await extractDocumentText(publicSheetId, 'application/vnd.google-apps.spreadsheet')
  assert(sheetContent !== null, 'Trích xuất CSV thành công từ Google Sheet công khai')
  assert(
    typeof sheetContent === 'string' && sheetContent.includes('Student Name') && sheetContent.includes('Major'),
    `Nội dung CSV chứa đúng các trường cột thực tế: ${sheetContent?.substring(0, 80).replace(/\n/g, ' ')}...`
  )

  // Kiểm tra khả năng xử lý an toàn khi tệp không tồn tại
  const invalidDocText = await extractDocumentText('invalid_doc_id_9999999', 'application/vnd.google-apps.document')
  assert(invalidDocText === null, 'Tệp không tồn tại tự động trả về null mà không làm sập tiến trình')

  // ------------------------------------------------------------------
  // GIAI ĐOẠN 5: XỬ LÝ LỖI ĐỐI KHÁNG: 404, PRIVATE FOLDER (FEAT-DRV-05)
  // ------------------------------------------------------------------
  console.log('\n--- [GIAI ĐOẠN 5] Kiểm thử đối kháng: Bắt lỗi 404 và thư mục bị khóa quyền ---')
  // 1. Thư mục không tồn tại (404)
  let notFoundErrorCaught = false
  try {
    await fetchPublicDriveFolder('100000000000000000000000000000000')
  } catch (err: unknown) {
    notFoundErrorCaught = err instanceof Error && err.message.includes('không tồn tại')
  }
  assert(notFoundErrorCaught, 'Bắt lỗi thư mục không tồn tại: "Thư mục không tồn tại"')

  // 2. Thư mục yêu cầu đăng nhập / private
  // Giả lập luồng qua URL sai hoặc folder ID private
  let invalidUrlErrorCaught = false
  try {
    await syncDriveFolderToDb({ folderUrl: 'https://invalid-url.com/something' })
  } catch (err: unknown) {
    invalidUrlErrorCaught = err instanceof Error && err.message.includes('không hợp lệ')
  }
  assert(invalidUrlErrorCaught, 'Chặn URL không hợp lệ trước khi gửi yêu cầu mạng')

  // ------------------------------------------------------------------
  // GIAI ĐOẠN 6: QUÉT & ĐỒNG BỘ THƯ MỤC THẬT VÀO CSDL (FEAT-DRV-02 & FEAT-DRV-04)
  // ------------------------------------------------------------------
  console.log('\n--- [GIAI ĐOẠN 6] Quét & đồng bộ thư mục thật https://drive.google.com/drive/folders/1FYLaoscxWBV_BU5sFouf7XCrv7cKktBY ---')
  const testFolderUrl = 'https://drive.google.com/drive/folders/1FYLaoscxWBV_BU5sFouf7XCrv7cKktBY'

  const syncResult = await syncDriveFolderToDb({
    folderUrl: testFolderUrl,
    name: 'Thư mục kiểm thử tự động M2',
    description: 'Tư liệu kiểm thử Milestone 2 Google Drive Engine',
  })

  assert(syncResult.contentSource.id.length > 0, 'Tạo bản ghi ContentSource thành công trong CSDL')
  assert(syncResult.contentSource.syncStatus === 'SYNCED', 'Trạng thái đồng bộ hoàn tất: SYNCED')
  assert(syncResult.contentSource.itemCount >= 3, `Đã quét được ${syncResult.contentSource.itemCount} tệp (>= 3)`)
  assert(syncResult.items.length >= 3, `Lưu đầy đủ ${syncResult.items.length} bản ghi ContentSourceItem`)

  // Kiểm tra 3 tệp thực tế trong thư mục công khai này
  const fileIds = syncResult.items.map((i) => i.driveFileId)
  assert(fileIds.includes('1rCuD8MxDwX-7o0eNXQTjd7XaWVe1IACV'), 'Chứa tệp 1rCuD8MxDwX-7o0eNXQTjd7XaWVe1IACV (Generated document.pdf)')
  assert(fileIds.includes('1txUBoKtwBEjDm-icR2cpAV-OLK5j7jf_'), 'Chứa tệp 1txUBoKtwBEjDm-icR2cpAV-OLK5j7jf_ (How_to_migrate_from_Lunr_to_Algolia)')
  assert(fileIds.includes('1WmLXx1WarTzyZA0urWkD8ABzz9wfwe3d'), 'Chứa tệp 1WmLXx1WarTzyZA0urWkD8ABzz9wfwe3d (urltopdf.pdf)')

  // Kiểm tra cấu trúc cây thư mục fileTree
  assert(typeof syncResult.contentSource.fileTree === 'string', 'Trường fileTree được lưu dạng chuỗi JSON')
  const parsedTree = JSON.parse(syncResult.contentSource.fileTree!)
  assert(parsedTree.id === '1FYLaoscxWBV_BU5sFouf7XCrv7cKktBY', 'Cây thư mục chứa root folderId chuẩn xác')
  assert(Array.isArray(parsedTree.children) && parsedTree.children.length >= 3, 'Cây thư mục chứa các nút con hợp lệ')

  // ------------------------------------------------------------------
  // GIAI ĐOẠN 7: TÁI ĐỒNG BỘ KHÔNG PHÁ HỦY (NON-DESTRUCTIVE RE-SYNC)
  // ------------------------------------------------------------------
  console.log('\n--- [GIAI ĐOẠN 7] Kiểm thử Non-Destructive Re-Sync: Bảo toàn liên kết SP/Chiến dịch ---')
  const sampleItem = syncResult.items[0]
  const testProduct = await prisma.product.findFirst()
  const testCampaign = await prisma.campaign.findFirst()

  assert(testProduct !== null, 'Tìm thấy sản phẩm kiểm thử trong CSDL')

  // Người dùng gán thủ công sản phẩm và ghi chú vào item thông qua metadata
  const manualMetadata = {
    productId: testProduct!.id,
    campaignId: testCampaign ? testCampaign.id : 'manual-camp-123',
    customTag: 'UUDAM_SPECIAL_ASSET',
    photographer: 'Minh Trí Ưu Đàm',
  }

  await prisma.contentSourceItem.update({
    where: { id: sampleItem.id },
    data: {
      metadata: JSON.stringify(manualMetadata),
    },
  })

  // Cập nhật liên kết cấp nguồn ContentSource
  await prisma.contentSource.update({
    where: { id: syncResult.contentSource.id },
    data: {
      productId: testProduct!.id,
      campaignId: testCampaign ? testCampaign.id : null,
    },
  })

  // Thực hiện Tái đồng bộ (Re-sync)
  const resyncResult = await syncDriveFolderToDb({
    contentSourceId: syncResult.contentSource.id,
    folderUrl: testFolderUrl,
  })

  assert(resyncResult.isUpdated === true, 'Xác nhận cờ isUpdated = true khi re-sync nguồn đã có')
  assert(resyncResult.contentSource.productId === testProduct!.id, 'ContentSource.productId được bảo toàn sau khi re-sync')
  if (testCampaign) {
    assert(resyncResult.contentSource.campaignId === testCampaign.id, 'ContentSource.campaignId được bảo toàn sau khi re-sync')
  }

  // Kiểm tra Item đã gán: metadata thủ công vẫn giữ nguyên 100%
  const recheckedItem = await prisma.contentSourceItem.findUnique({
    where: { id: sampleItem.id },
  })
  assert(recheckedItem !== null, 'Item vẫn tồn tại trong CSDL sau re-sync')
  const restoredMeta = JSON.parse(recheckedItem!.metadata || '{}')
  assert(restoredMeta.productId === testProduct!.id, 'Item.metadata.productId được bảo toàn nguyên vẹn')
  assert(restoredMeta.customTag === 'UUDAM_SPECIAL_ASSET', 'Item.metadata.customTag được bảo toàn')
  assert(restoredMeta.photographer === 'Minh Trí Ưu Đàm', 'Item.metadata.photographer được bảo toàn')

  // ------------------------------------------------------------------
  // GIAI ĐOẠN 8: KIỂM THỬ NEXT.JS 16 ROUTE HANDLERS
  // ------------------------------------------------------------------
  console.log('\n--- [GIAI ĐOẠN 8] Kiểm thử Next.js 16 Route Handlers (/api/social/drive) ---')

  // 1. GET /api/social/drive
  const getReq = new NextRequest('http://localhost:3010/api/social/drive')
  const getRes = await getDriveSources(getReq)
  assert(getRes.status === 200, 'GET /api/social/drive trả về HTTP 200')
  const getData = await getRes.json()
  assert(Array.isArray(getData.sources) && getData.sources.length >= 1, 'Danh sách sources trả về mảng có ít nhất 1 phần tử')

  // 2. GET /api/social/drive/[id]
  const getDetailRes = await getDriveSourceDetail(
    new NextRequest(`http://localhost:3010/api/social/drive/${syncResult.contentSource.id}`),
    { params: Promise.resolve({ id: syncResult.contentSource.id }) }
  )
  assert(getDetailRes.status === 200, 'GET /api/social/drive/[id] trả về HTTP 200')
  const getDetailData = await getDetailRes.json()
  assert(getDetailData.source.id === syncResult.contentSource.id, 'Trả về đúng chi tiết ContentSource')
  assert(Array.isArray(getDetailData.items) && getDetailData.items.length >= 3, 'Trả về danh sách items đầy đủ')
  assert(getDetailData.fileTree !== null, 'Trả về đối tượng cây thư mục phân cấp')

  // 3. PUT /api/social/drive/[id]
  const putReq = new NextRequest(`http://localhost:3010/api/social/drive/${syncResult.contentSource.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Tên thư mục đã cập nhật' }),
  })
  const putRes = await putDriveSourceDetail(putReq, {
    params: Promise.resolve({ id: syncResult.contentSource.id }),
  })
  assert(putRes.status === 200, 'PUT /api/social/drive/[id] trả về HTTP 200')
  const putData = await putRes.json()
  assert(putData.source.name === 'Tên thư mục đã cập nhật', 'Cập nhật tên nguồn qua PUT thành công')

  // 4. DELETE /api/social/drive/[id]
  const deleteReq = new NextRequest(`http://localhost:3010/api/social/drive/${syncResult.contentSource.id}`, {
    method: 'DELETE',
  })
  const deleteRes = await deleteDriveSourceDetail(deleteReq, {
    params: Promise.resolve({ id: syncResult.contentSource.id }),
  })
  assert(deleteRes.status === 200, 'DELETE /api/social/drive/[id] trả về HTTP 200')

  // Kiểm tra cascade deletion của ContentSourceItem
  const remainingItems = await prisma.contentSourceItem.count({
    where: { contentSourceId: syncResult.contentSource.id },
  })
  assert(remainingItems === 0, 'Cascade xóa sạch 100% ContentSourceItem khi xóa ContentSource cha')

  // ------------------------------------------------------------------
  // GIAI ĐOẠN 9: DỌN DẸP DỮ LIỆU & XẢ WAL CHECKPOINT
  // ------------------------------------------------------------------
  console.log('\n--- [GIAI ĐOẠN 9] Dọn dẹp dữ liệu kiểm thử & xả WAL ---')
  await prisma.contentSourceItem.deleteMany({
    where: {
      contentSource: {
        OR: [
          { name: { contains: 'kiểm thử' } },
          { name: { contains: 'Thư mục' } },
          { folderId: '1FYLaoscxWBV_BU5sFouf7XCrv7cKktBY' },
        ],
      },
    },
  })

  await prisma.contentSource.deleteMany({
    where: {
      OR: [
        { name: { contains: 'kiểm thử' } },
        { name: { contains: 'Thư mục' } },
        { folderId: '1FYLaoscxWBV_BU5sFouf7XCrv7cKktBY' },
      ],
    },
  })

  // Flush WAL
  const rawCheckpoint = await prisma.$queryRawUnsafe<Array<{ busy: bigint; log: bigint; checkpointed: bigint }>>('PRAGMA wal_checkpoint(FULL);')
  const busy = Number(rawCheckpoint[0]?.busy ?? BigInt(0))
  assert(busy === 0, 'Xả sạch WAL checkpoint sau kiểm thử: busy=0')

  // ------------------------------------------------------------------
  // GIAI ĐOẠN 10: ĐỐI SOÁT BASELINE SAU KIỂM THỬ (ZERO DRIFT GATE)
  // ------------------------------------------------------------------
  console.log('\n--- [GIAI ĐOẠN 10] Đối soát tuyệt đối 24 bảng baseline sau kiểm thử ---')
  for (const model of coreTables) {
    const delegateName = model.charAt(0).toLowerCase() + model.slice(1)
    const delegate = (prisma as unknown as Record<string, { count: () => Promise<number> }>)[delegateName]
    const count = await delegate.count()
    assert(count === baseline[model], `Bảo toàn 100% bảng ${model.padEnd(20)}: actual=${count} baseline=${baseline[model]} (Delta = 0)`)
  }

  console.log('\n======================================================================')
  console.log(`🎉 TOÀN BỘ ${passedTests} KIỂM THỬ ĐẠT CHUẨN! (FAILED: ${failedTests}) 🎉`)
  console.log('>>> MILESTONE 2 (GOOGLE DRIVE CONTENT SOURCE) HOÀN TẤT XUẤT SẮC <<<')
  console.log('======================================================================')
}

main()
  .catch((err) => {
    console.error('Fatal verification failure:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
