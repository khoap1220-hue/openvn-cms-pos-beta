// src/lib/drive-parser.ts
// Milestone 2 (M2: Google Drive Content Source Engine)
// Động cơ phân tích & đồng bộ Thư mục Google Drive công khai (Hybrid 2-tier: Zero-Key HTML + Drive API v3)
// Hỗ trợ trích xuất Google Docs (.txt), Google Sheets (.csv), ảnh/video CDN, duyệt cây thư mục 3 cấp
// Bảo toàn liên kết thủ công (non-destructive re-sync)

import fs from 'node:fs'
import path from 'node:path'
import { db } from '@/lib/db'
import type { ContentSource, ContentSourceItem } from '@prisma/client'

export const LOCAL_THACH_CAO_FOLDER_ID = 'LOCAL_THACH_CAO_ASSETS_IMAGES_2026'

// ============================================================
// TYPES & CONTRACTS (M2 ↔ M3 CONTRACT)
// ============================================================

export type DriveFileType = 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'SHEET' | 'FOLDER' | 'OTHER'

export interface ParsedDriveUrl {
  id: string
  type: 'folder' | 'file' | 'document' | 'spreadsheet'
  rawUrl: string
  originalInput: string
}

export interface DriveFileItem {
  id: string
  name: string
  mimeType: string
  fileType: DriveFileType
  sizeBytes?: number | null
  webViewLink?: string
  downloadUrl?: string
  thumbnailUrl?: string
  parentFolderId?: string
  path?: string
  textContent?: string | null
  metadata?: Record<string, unknown>
}

export interface DriveFolderTreeNode {
  id: string
  name: string
  path: string
  mimeType: string
  fileType: DriveFileType
  sizeBytes?: number | null
  webViewLink?: string
  thumbnailUrl?: string
  children?: DriveFolderTreeNode[]
}

export interface DriveFolderResult {
  id: string
  name: string
  totalItems: number
  items: DriveFileItem[]
  fileTree: DriveFolderTreeNode
}

export interface SyncDriveFolderInput {
  contentSourceId?: string
  folderUrl: string
  name?: string
  campaignId?: string | null
  productId?: string | null
  description?: string | null
}

export interface SyncDriveFolderOutput {
  contentSource: ContentSource
  items: ContentSourceItem[]
  isUpdated: boolean
}

// ============================================================
// 1. URL PARSER & VALIDATOR (FEAT-DRV-01)
// ============================================================

/**
 * Phân tích đường link Google Drive (thư mục hoặc tập tin)
 * Hỗ trợ các định dạng:
 * - https://drive.google.com/drive/folders/{id}
 * - https://drive.google.com/drive/u/0/folders/{id}
 * - https://drive.google.com/drive/mobile/folders/{id}
 * - https://drive.google.com/open?id={id}
 * - https://drive.google.com/file/d/{id}/view
 * - https://docs.google.com/document/d/{id}/edit
 * - https://docs.google.com/spreadsheets/d/{id}/edit
 * - Bare ID: chuỗi alphanumeric >= 20 ký tự
 */
export function parseDriveUrl(input: string): ParsedDriveUrl {
  if (!input || typeof input !== 'string') {
    throw new Error('Đường dẫn Google Drive không được để trống')
  }

  const trimmed = input.trim()

  // 1. Standard folder URL: drive.google.com/drive/folders/{id} hoặc drive/u/{n}/folders/{id}
  const folderMatch = trimmed.match(
    /(?:drive\.google\.com\/(?:drive\/)?(?:u\/\d+\/)?(?:mobile\/)?folders\/)([a-zA-Z0-9_-]+)/
  )
  if (folderMatch && folderMatch[1]) {
    return {
      id: folderMatch[1],
      type: 'folder',
      rawUrl: trimmed,
      originalInput: input,
    }
  }

  // 2. Open parameter URL: drive.google.com/open?id={id}
  const openMatch = trimmed.match(/drive\.google\.com\/open\?(?:[^&]*&)*id=([a-zA-Z0-9_-]+)/)
  if (openMatch && openMatch[1]) {
    return {
      id: openMatch[1],
      type: 'folder',
      rawUrl: trimmed,
      originalInput: input,
    }
  }

  // 3. Google Docs: docs.google.com/document/d/{id}
  const docMatch = trimmed.match(/docs\.google\.com\/document\/(?:u\/\d+\/)?d\/([a-zA-Z0-9_-]+)/)
  if (docMatch && docMatch[1]) {
    return {
      id: docMatch[1],
      type: 'document',
      rawUrl: trimmed,
      originalInput: input,
    }
  }

  // 4. Google Sheets: docs.google.com/spreadsheets/d/{id}
  const sheetMatch = trimmed.match(/docs\.google\.com\/spreadsheets\/(?:u\/\d+\/)?d\/([a-zA-Z0-9_-]+)/)
  if (sheetMatch && sheetMatch[1]) {
    return {
      id: sheetMatch[1],
      type: 'spreadsheet',
      rawUrl: trimmed,
      originalInput: input,
    }
  }

  // 5. File URL: drive.google.com/file/d/{id}
  const fileMatch = trimmed.match(/drive\.google\.com\/file\/(?:u\/\d+\/)?d\/([a-zA-Z0-9_-]+)/)
  if (fileMatch && fileMatch[1]) {
    return {
      id: fileMatch[1],
      type: 'file',
      rawUrl: trimmed,
      originalInput: input,
    }
  }

  // 5b. Thư mục tài sản Thạch Cao thật cục bộ của Chủ Tiệm (E:\Thạch Cao\assets\images)
  if (/^e:[/\\]th[aạ]ch\s*cao(?:[/\\]assets(?:[/\\]images)?)?[/\\]?$/i.test(trimmed)) {
    return {
      id: LOCAL_THACH_CAO_FOLDER_ID,
      type: 'folder',
      rawUrl: 'E:\\Thạch Cao\\assets\\images',
      originalInput: input,
    }
  }

  // 6. Bare ID nếu người dùng truyền trực tiếp ID
  if (/^[a-zA-Z0-9_-]{20,}$/.test(trimmed)) {
    return {
      id: trimmed,
      type: 'folder',
      rawUrl:
        trimmed === LOCAL_THACH_CAO_FOLDER_ID
          ? 'E:\\Thạch Cao\\assets\\images'
          : `https://drive.google.com/drive/folders/${trimmed}`,
      originalInput: input,
    }
  }

  throw new Error(
    'Định dạng URL Google Drive không hợp lệ. Vui lòng cung cấp liên kết chia sẻ dạng: https://drive.google.com/drive/folders/{id}'
  )
}

// ============================================================
// 2. FILE TYPE DETECTION & CDN LINK BUILDER
// ============================================================

export function determineFileType(mimeType: string, fileName?: string): DriveFileType {
  const mime = (mimeType || '').toLowerCase()
  const name = (fileName || '').toLowerCase()

  if (mime === 'application/vnd.google-apps.folder') {
    return 'FOLDER'
  }

  if (
    mime.startsWith('image/') ||
    /\.(jpe?g|png|gif|webp|svg|bmp|ico|heic)$/i.test(name)
  ) {
    return 'IMAGE'
  }

  if (
    mime.startsWith('video/') ||
    /\.(mp4|mov|avi|mkv|webm|m4v|3gp)$/i.test(name)
  ) {
    return 'VIDEO'
  }

  if (
    mime === 'application/vnd.google-apps.spreadsheet' ||
    mime.includes('spreadsheet') ||
    mime.includes('excel') ||
    /\.(xlsx?|csv|tsv)$/i.test(name)
  ) {
    return 'SHEET'
  }

  if (
    mime === 'application/vnd.google-apps.document' ||
    mime.includes('word') ||
    mime.includes('document') ||
    mime === 'application/pdf' ||
    mime.startsWith('text/') ||
    /\.(docx?|pdf|txt|md|markdown|rtf|odt)$/i.test(name)
  ) {
    return 'DOCUMENT'
  }

  return 'OTHER'
}

export function buildDriveLinks(fileId: string, mimeType: string, fileType: DriveFileType) {
  let webViewLink = `https://drive.google.com/file/d/${fileId}/view`
  let downloadUrl = `https://drive.google.com/uc?export=download&id=${fileId}`

  if (fileType === 'FOLDER') {
    webViewLink = `https://drive.google.com/drive/folders/${fileId}`
    downloadUrl = webViewLink
  } else if (mimeType === 'application/vnd.google-apps.document') {
    webViewLink = `https://docs.google.com/document/d/${fileId}/edit`
    downloadUrl = `https://docs.google.com/document/d/${fileId}/export?format=txt`
  } else if (mimeType === 'application/vnd.google-apps.spreadsheet') {
    webViewLink = `https://docs.google.com/spreadsheets/d/${fileId}/edit`
    downloadUrl = `https://docs.google.com/spreadsheets/d/${fileId}/export?format=csv`
  }

  // CDN Thumbnail tốc độ cao (không CORS khi render thẻ img)
  const thumbnailUrl = fileType !== 'FOLDER' ? `https://lh3.googleusercontent.com/d/${fileId}` : undefined

  return {
    webViewLink,
    downloadUrl,
    thumbnailUrl,
  }
}

// ============================================================
// 3. TEXT & DOCUMENT EXTRACTION (FEAT-DRV-03)
// ============================================================

/**
 * Trích xuất nội dung văn bản từ Google Docs (.txt), Google Sheets (.csv), hoặc text file
 */
export async function extractDocumentText(
  fileId: string,
  mimeType: string,
  options?: { timeoutMs?: number }
): Promise<string | null> {
  const timeoutMs = options?.timeoutMs ?? 15000

  try {
    let exportUrl: string | null = null

    if (mimeType === 'application/vnd.google-apps.document') {
      exportUrl = `https://docs.google.com/document/d/${fileId}/export?format=txt`
    } else if (mimeType === 'application/vnd.google-apps.spreadsheet') {
      exportUrl = `https://docs.google.com/spreadsheets/d/${fileId}/export?format=csv`
    } else if (
      mimeType.startsWith('text/') ||
      mimeType === 'application/json' ||
      mimeType === 'text/markdown'
    ) {
      exportUrl = `https://drive.google.com/uc?export=download&id=${fileId}`
    }

    if (!exportUrl) {
      return null
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    const res = await fetch(exportUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Uu Dam Suite/2.0',
      },
      redirect: 'follow',
    })
    clearTimeout(timer)

    if (!res.ok) {
      return null
    }

    const contentType = res.headers.get('content-type') || ''
    // Nếu bị chuyển hướng về trang HTML đăng nhập thì không phải nội dung text hợp lệ
    if (contentType.includes('text/html') && (exportUrl.includes('export?format=txt') || exportUrl.includes('export?format=csv'))) {
      const htmlPeek = await res.text()
      if (htmlPeek.includes('accounts.google.com') || htmlPeek.includes('ServiceLogin')) {
        return null
      }
      return htmlPeek
    }

    const text = await res.text()
    return text.trim()
  } catch (err) {
    console.warn(`[DriveParser] Không thể trích xuất văn bản từ tệp ${fileId}:`, err)
    return null
  }
}

// ============================================================
// 4. API KEY RESOLUTION (TIER 1 SUPPORT)
// ============================================================

export async function resolveGoogleApiKey(): Promise<string | null> {
  try {
    const setting = await db.appSetting.findFirst({
      where: {
        key: { in: ['google_drive_api_key', 'google_api_key', 'gemini_api_key'] },
      },
    })
    if (setting?.value && setting.value.trim().length > 0) {
      return setting.value.trim()
    }
  } catch {
    // DB có thể chưa khởi tạo
  }

  try {
    const cred = await db.integrationCredential.findFirst({
      where: {
        provider: { in: ['GOOGLE_DRIVE', 'GOOGLE', 'GEMINI'] },
        active: true,
      },
    })
    if (cred?.config) {
      const parsed = JSON.parse(cred.config) as { apiKey?: string; key?: string }
      const key = (parsed.apiKey ?? parsed.key ?? '').trim()
      if (key.length > 0) return key
    }
  } catch {
    // Bỏ qua lỗi JSON
  }

  const envKey = process.env.GOOGLE_DRIVE_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim()
  return envKey && envKey.length > 0 ? envKey : null
}

// ============================================================
// 5. HYBRID 2-TIER DRIVE FOLDER FETCHER (FEAT-DRV-02 & FEAT-DRV-05)
// ============================================================

interface RawIvdItem {
  id: string
  parents: string[]
  name: string
  mimeType: string
  sizeBytes?: number | null
}

/**
 * Giải mã chuỗi hex \xHH nhúng trong window['_DRIVE_ivd'] của Google Drive
 */
function decodeDriveIvdHex(hexString: string): unknown {
  const jsonStr = hexString.replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16))
  )
  return JSON.parse(jsonStr)
}

/**
 * Trích xuất danh sách file từ Tier 2 (Zero-Key HTML Scraper)
 */
async function fetchFolderViaZeroKeyHtml(
  folderId: string,
  timeoutMs: number
): Promise<{ folderName: string; rawItems: RawIvdItem[] }> {
  const folderUrl = `https://drive.google.com/drive/folders/${folderId}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  let res: Response
  try {
    res = await fetch(folderUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'vi,en-US;q=0.9,en;q=0.8',
      },
      redirect: 'follow',
    })
  } catch (err: unknown) {
    clearTimeout(timer)
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Quá thời gian kết nối tới Google Drive (${timeoutMs}ms)`)
    }
    throw err
  }
  clearTimeout(timer)

  // Kiểm tra 404
  if (res.status === 404) {
    throw new Error('Thư mục không tồn tại')
  }

  // Kiểm tra chuyển hướng hoặc chặn quyền
  if (
    res.status === 401 ||
    res.status === 403 ||
    res.url.includes('accounts.google.com') ||
    res.url.includes('ServiceLogin')
  ) {
    throw new Error(
      "Thư mục chưa được mở quyền công khai ('Bất kỳ ai có đường liên kết đều có thể xem')"
    )
  }

  const html = await res.text()

  // Kiểm tra trang HTML có chứa form đăng nhập Google không
  if (
    html.includes('Sign in - Google Accounts') ||
    html.includes('Đăng nhập - Tài khoản Google') ||
    html.includes('accounts.google.com/v3/signin')
  ) {
    throw new Error(
      "Thư mục chưa được mở quyền công khai ('Bất kỳ ai có đường liên kết đều có thể xem')"
    )
  }

  // Trích xuất Tên thư mục từ thẻ <title>
  let folderName = 'Thư mục Google Drive'
  const titleMatch = html.match(/<title>([^<]+)<\/title>/i)
  if (titleMatch && titleMatch[1]) {
    const rawTitle = titleMatch[1].trim()
    folderName = rawTitle.replace(/\s*-\s*Google Drive\s*$/i, '').trim() || folderName
  }

  // Trích xuất chuỗi hex window['_DRIVE_ivd']
  const ivdMatch =
    html.match(/_DRIVE_ivd['"]?\]\s*=\s*'([^']+)'/) ||
    html.match(/_DRIVE_ivd.*?=\s*'([^']+)'/)

  if (!ivdMatch || !ivdMatch[1]) {
    // Nếu không tìm thấy biến _DRIVE_ivd và cũng không có lỗi quyền, kiểm tra xem có thông báo lỗi trong HTML
    if (html.includes('File not found') || html.includes('Không tìm thấy tệp')) {
      throw new Error('Thư mục không tồn tại')
    }
    return { folderName, rawItems: [] }
  }

  const rawHex = ivdMatch[1]
  const parsedData = decodeDriveIvdHex(rawHex) as unknown[]

  const rawItems: RawIvdItem[] = []
  if (Array.isArray(parsedData) && Array.isArray(parsedData[0])) {
    const itemsArray = parsedData[0] as unknown[][]
    for (const raw of itemsArray) {
      if (Array.isArray(raw) && raw.length >= 4 && raw[0]) {
        const id = String(raw[0])
        const parents = Array.isArray(raw[1]) ? (raw[1] as string[]) : [folderId]
        const name = String(raw[2] || 'Tệp không tên')
        const mimeType = String(raw[3] || 'application/octet-stream')
        const sizeBytes = typeof raw[13] === 'number' ? raw[13] : null

        rawItems.push({
          id,
          parents,
          name,
          mimeType,
          sizeBytes,
        })
      }
    }
  }

  return { folderName, rawItems }
}

/**
 * Trích xuất danh sách file qua Tier 1 (Google Drive API v3)
 */
async function fetchFolderViaApiV3(
  folderId: string,
  apiKey: string,
  timeoutMs: number
): Promise<{ folderName: string; rawItems: RawIvdItem[] }> {
  const url = `https://www.googleapis.com/drive/v3/files?q='${encodeURIComponent(
    folderId
  )}'+in+parents+and+trashed=false&key=${encodeURIComponent(
    apiKey
  )}&fields=files(id,name,mimeType,size,modifiedTime,parents)&pageSize=100`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  const res = await fetch(url, { signal: controller.signal })
  clearTimeout(timer)

  if (!res.ok) {
    if (res.status === 404) {
      throw new Error('Thư mục không tồn tại')
    }
    if (res.status === 403 || res.status === 401) {
      throw new Error(
        "Thư mục chưa được mở quyền công khai ('Bất kỳ ai có đường liên kết đều có thể xem')"
      )
    }
    throw new Error(`Lỗi Google Drive API v3 (HTTP ${res.status})`)
  }

  const data = (await res.json()) as {
    files?: Array<{ id: string; name: string; mimeType: string; size?: string; parents?: string[] }>
  }

  const rawItems: RawIvdItem[] = (data.files || []).map((f) => ({
    id: f.id,
    parents: f.parents || [folderId],
    name: f.name,
    mimeType: f.mimeType,
    sizeBytes: f.size ? parseInt(f.size, 10) : null,
  }))

  return { folderName: 'Thư mục Google Drive', rawItems }
}

interface ThachCaoProductRaw {
  id: string
  sku: string
  name: string
  category?: string
  intentionLabel?: string
  scentPairing?: string
  price: number
  stock_ready?: number
  storyQuote?: string
  conversionHook?: string
  dimensions?: string
  weight?: string
  material?: string
  image: string
  shortDesc?: string
  placementTip?: string
  oilDropsGuide?: string
  review_images?: Array<{
    url: string
    shortTag?: string
    title?: string
    reviewer?: string
    comment?: string
  }>
  ad_banners?: Array<{
    url: string
    still_url?: string
    shortTag?: string
    title?: string
    model_id?: string
    kol_handle?: string
    kol_followers?: string
    kol_platform?: string
    kol_score?: string
    kol_verdict?: string
    reviewer?: string
    role?: string
    comment?: string
  }>
}

function buildLocalThachCaoFolderResult(): DriveFolderResult {
  const rootName = 'An Nhiên Thạch — Bộ Ảnh & Tư Liệu Dòng Thạch Cao Thật (E:\\Thạch Cao\\assets\\images)'
  const rootPath = `/${rootName}`

  const externalAssetRoot = process.env.THACH_CAO_ASSETS_DIR?.trim() || ''
  const jsonCandidates = [
    path.join(process.cwd(), 'public', 'thach-cao', 'data', 'hot_products_1688.json'),
    path.join(process.cwd(), '..', '..', 'public', 'thach-cao', 'data', 'hot_products_1688.json'),
    ...(externalAssetRoot ? [`${externalAssetRoot}/data/hot_products_1688.json`] : []),
  ]
  let rawData: { products?: ThachCaoProductRaw[]; asian_models?: Array<Record<string, unknown>> } = {}
  for (const candidate of jsonCandidates) {
    if (fs.existsSync(/*turbopackIgnore: true*/ candidate)) {
      try {
        rawData = JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ candidate, 'utf8'))
        break
      } catch {
        // continue
      }
    }
  }

  const products = rawData.products ?? []
  const items: DriveFileItem[] = []

  const heroFolderId = 'tc_folder_01_hero'
  const kolFolderId = 'tc_folder_02_kol'
  const reviewFolderId = 'tc_folder_03_reviews'
  const docFolderId = 'tc_folder_04_docs'

  const heroFolderPath = `${rootPath}/01-Anh-Goc-San-Pham-Thach-Cao`
  const kolFolderPath = `${rootPath}/02-KOL-Review-Chau-A-695K-Followers`
  const reviewFolderPath = `${rootPath}/03-Anh-Can-Canh-Review-Khach-Hang`
  const docFolderPath = `${rootPath}/04-Tai-Lieu-Mo-Ta-San-Pham-KOL`

  const heroChildren: DriveFolderTreeNode[] = []
  const kolChildren: DriveFolderTreeNode[] = []
  const reviewChildren: DriveFolderTreeNode[] = []
  const docChildren: DriveFolderTreeNode[] = []

  items.push(
    {
      id: heroFolderId,
      name: '01-Anh-Goc-San-Pham-Thach-Cao',
      mimeType: 'application/vnd.google-apps.folder',
      fileType: 'FOLDER',
      parentFolderId: LOCAL_THACH_CAO_FOLDER_ID,
      path: heroFolderPath,
      webViewLink: '/thach-cao',
    },
    {
      id: kolFolderId,
      name: '02-KOL-Review-Chau-A-695K-Followers',
      mimeType: 'application/vnd.google-apps.folder',
      fileType: 'FOLDER',
      parentFolderId: LOCAL_THACH_CAO_FOLDER_ID,
      path: kolFolderPath,
      webViewLink: '/thach-cao/models',
    },
    {
      id: reviewFolderId,
      name: '03-Anh-Can-Canh-Review-Khach-Hang',
      mimeType: 'application/vnd.google-apps.folder',
      fileType: 'FOLDER',
      parentFolderId: LOCAL_THACH_CAO_FOLDER_ID,
      path: reviewFolderPath,
      webViewLink: '/thach-cao/reviews',
    },
    {
      id: docFolderId,
      name: '04-Tai-Lieu-Mo-Ta-San-Pham-KOL',
      mimeType: 'application/vnd.google-apps.folder',
      fileType: 'FOLDER',
      parentFolderId: LOCAL_THACH_CAO_FOLDER_ID,
      path: docFolderPath,
      webViewLink: '/thach-cao/data',
    }
  )

  const toPublicUrl = (relUrl: string) => {
    const cleaned = relUrl.replace(/^assets\/images\//i, '')
    return `/thach-cao/${cleaned}`
  }

  const getFileSizeSafe = (publicUrl: string, fallback = 185000): number => {
    const rel = publicUrl.replace(/^\/thach-cao\//, '')
    const candidates = [
      `${process.cwd()}/public/thach-cao/${rel}`,
      `${process.cwd()}/../../public/thach-cao/${rel}`,
      ...(externalAssetRoot ? [`${externalAssetRoot}/images/${rel}`] : []),
    ]
    for (const c of candidates) {
      if (fs.existsSync(/*turbopackIgnore: true*/ c)) {
        try {
          return fs.statSync(/*turbopackIgnore: true*/ c).size
        } catch {
          // ignore
        }
      }
    }
    return fallback
  }

  products.forEach((prod, idx) => {
    const codeNum = String(idx + 1).padStart(2, '0')
    const skuCode = `UD-TC-0${codeNum}`.replace('010', '010')
    const heroUrl = toPublicUrl(prod.image)
    const heroFileName = path.basename(heroUrl)
    const heroExt = path.extname(heroFileName).toLowerCase()
    const heroMime = heroExt === '.png' ? 'image/png' : 'image/jpeg'
    const heroSize = getFileSizeSafe(heroUrl, 240000)
    const heroId = `tc_hero_${codeNum}_${heroFileName.replace(/[^a-zA-Z0-9_-]/g, '_')}`

    const heroItem: DriveFileItem = {
      id: heroId,
      name: `${codeNum}-${heroFileName}`,
      mimeType: heroMime,
      fileType: 'IMAGE',
      sizeBytes: heroSize,
      webViewLink: heroUrl,
      downloadUrl: heroUrl,
      thumbnailUrl: heroUrl,
      parentFolderId: heroFolderId,
      path: `${heroFolderPath}/${codeNum}-${heroFileName}`,
      metadata: {
        sku: skuCode,
        productName: prod.name,
        price: prod.price,
        intentionLabel: prod.intentionLabel,
        scentPairing: prod.scentPairing,
        material: prod.material,
        dimensions: prod.dimensions,
        assetCategory: 'HERO_PRODUCT_IMAGE',
      },
    }
    items.push(heroItem)
    heroChildren.push({
      id: heroItem.id,
      name: heroItem.name,
      path: heroItem.path!,
      mimeType: heroItem.mimeType,
      fileType: 'IMAGE',
      sizeBytes: heroItem.sizeBytes,
      webViewLink: heroUrl,
      thumbnailUrl: heroUrl,
    })

    // KOL Ad Banners (4 KOLs per product)
    for (const [bIdx, banner] of (prod.ad_banners ?? []).entries()) {
      const kolUrl = toPublicUrl(banner.url)
      const kolFileName = path.basename(kolUrl)
      const kolSize = getFileSizeSafe(kolUrl, 195000)
      const kolId = `tc_kol_${codeNum}_${bIdx + 1}_${kolFileName.replace(/[^a-zA-Z0-9_-]/g, '_')}`
      const kolItem: DriveFileItem = {
        id: kolId,
        name: kolFileName,
        mimeType: 'image/jpeg',
        fileType: 'IMAGE',
        sizeBytes: kolSize,
        webViewLink: kolUrl,
        downloadUrl: kolUrl,
        thumbnailUrl: kolUrl,
        parentFolderId: kolFolderId,
        path: `${kolFolderPath}/${kolFileName}`,
        textContent: `${banner.title || ''} — ${banner.kol_verdict || ''}\n${banner.comment || ''}`,
        metadata: {
          sku: skuCode,
          productName: prod.name,
          kolHandle: banner.kol_handle,
          kolFollowers: banner.kol_followers,
          kolPlatform: banner.kol_platform,
          kolScore: banner.kol_score,
          kolVerdict: banner.kol_verdict,
          reviewer: banner.reviewer,
          shortTag: banner.shortTag,
          assetCategory: 'KOL_PORTRAIT_REVIEW',
        },
      }
      items.push(kolItem)
      kolChildren.push({
        id: kolItem.id,
        name: kolItem.name,
        path: kolItem.path!,
        mimeType: kolItem.mimeType,
        fileType: 'IMAGE',
        sizeBytes: kolItem.sizeBytes,
        webViewLink: kolUrl,
        thumbnailUrl: kolUrl,
      })
    }

    // Close-up Review Images (4 per product)
    for (const [rIdx, rev] of (prod.review_images ?? []).entries()) {
      const revUrl = toPublicUrl(rev.url)
      const revFileName = path.basename(revUrl)
      const revSize = getFileSizeSafe(revUrl, 165000)
      const revId = `tc_rev_${codeNum}_${rIdx + 1}_${revFileName.replace(/[^a-zA-Z0-9_-]/g, '_')}`
      const revItem: DriveFileItem = {
        id: revId,
        name: revFileName,
        mimeType: 'image/jpeg',
        fileType: 'IMAGE',
        sizeBytes: revSize,
        webViewLink: revUrl,
        downloadUrl: revUrl,
        thumbnailUrl: revUrl,
        parentFolderId: reviewFolderId,
        path: `${reviewFolderPath}/${revFileName}`,
        textContent: `${rev.title || ''} (${rev.reviewer || ''}): ${rev.comment || ''}`,
        metadata: {
          sku: skuCode,
          productName: prod.name,
          reviewer: rev.reviewer,
          shortTag: rev.shortTag,
          title: rev.title,
          assetCategory: 'CLOSEUP_CUSTOMER_REVIEW',
        },
      }
      items.push(revItem)
      reviewChildren.push({
        id: revItem.id,
        name: revItem.name,
        path: revItem.path!,
        mimeType: revItem.mimeType,
        fileType: 'IMAGE',
        sizeBytes: revItem.sizeBytes,
        webViewLink: revUrl,
        thumbnailUrl: revUrl,
      })
    }

    // Rich Vietnamese Product Story & KOL Document (Zero raw 1688 URL / CNY exposure)
    const kolSummaryLines = (prod.ad_banners ?? [])
      .map((b) => `- ${b.reviewer} (${b.kol_platform} • Điểm ${b.kol_score}): "${b.kol_verdict}" — ${b.comment}`)
      .join('\n')

    const docContent = [
      `TÀI LIỆU SẢN PHẨM AN NHIÊN THẠCH — DÒNG THẠCH CAO VI KHOÁNG & NẾN BẤC GỖ CHỮA LÀNH`,
      `Mã SKU: ${skuCode}`,
      `Tên tác phẩm: ${prod.name}`,
      `Định vị & Ý niệm: ${prod.intentionLabel || 'Thạch Cao Chữa Lành Wabi-Sabi'}`,
      `Phối hương & Phiên bản: ${prod.scentPairing || 'Đàn Hương & Bạch Trà'}`,
      `Giá niêm yết: ${prod.price.toLocaleString('vi-VN')} ₫`,
      `Chất liệu: ${prod.material || 'Thạch cao vi khoáng trắng ngà không bọt khí'}`,
      `Kích thước & Trọng lượng: ${prod.dimensions || ''} (${prod.weight || ''})`,
      `Câu chuyện cảm hứng: ${prod.storyQuote || ''}`,
      `Điểm chạm chuyển đổi: ${prod.conversionHook || ''}`,
      `Mô tả chi tiết: ${prod.shortDesc || ''}`,
      `Gợi ý bài trí không gian: ${prod.placementTip || ''}`,
      `Hướng dẫn thưởng hương & tái sử dụng làm đá khuếch tán tinh dầu: ${prod.oilDropsGuide || ''}`,
      `Cam kết vận hành: Đóng gói hộp chống sốc EPE 4 lớp bảo toàn nguyên vẹn 100%, gửi ảnh chụp thật qua Zalo trước khi giao.`,
      `Bảo chứng từ 4 KOL Châu Á:`,
      kolSummaryLines,
    ].join('\n')

    const docId = `tc_doc_${codeNum}_story`
    const docName = `Ho-So-San-Pham-${skuCode}.txt`
    const docItem: DriveFileItem = {
      id: docId,
      name: docName,
      mimeType: 'application/vnd.google-apps.document',
      fileType: 'DOCUMENT',
      sizeBytes: Buffer.byteLength(docContent, 'utf8'),
      webViewLink: heroUrl,
      downloadUrl: heroUrl,
      parentFolderId: docFolderId,
      path: `${docFolderPath}/${docName}`,
      textContent: docContent,
      metadata: {
        sku: skuCode,
        productName: prod.name,
        price: prod.price,
      },
    }
    items.push(docItem)
    docChildren.push({
      id: docItem.id,
      name: docItem.name,
      path: docItem.path!,
      mimeType: docItem.mimeType,
      fileType: 'DOCUMENT',
      sizeBytes: docItem.sizeBytes,
      webViewLink: heroUrl,
    })
  })

  // Master CSV Sheet summarizing all 10 Thạch Cao products
  const sheetLines = [
    'SKU,Tên Sản Phẩm,Ý Niệm,Phối Hương,Giá Bán (VNĐ),Tồn Sẵn,Chất Liệu,Ảnh Gốc',
    ...products.map((p, idx) => {
      const skuCode = `UD-TC-${String(idx + 1).padStart(3, '0')}`
      const cleanName = p.name.replace(/"/g, '""')
      const cleanIntention = (p.intentionLabel || '').replace(/"/g, '""')
      const cleanScent = (p.scentPairing || '').replace(/"/g, '""')
      const cleanMat = (p.material || '').replace(/"/g, '""')
      return `${skuCode},"${cleanName}","${cleanIntention}","${cleanScent}",${p.price},${p.stock_ready ?? 10},"${cleanMat}",${toPublicUrl(p.image)}`
    }),
  ].join('\n')

  const sheetItem: DriveFileItem = {
    id: 'tc_sheet_master_catalog_2026',
    name: 'Bang-Gia-Va-Thong-So-10-Tuyet-Tac-Thach-Cao-An-Nhien-Thach.csv',
    mimeType: 'application/vnd.google-apps.spreadsheet',
    fileType: 'SHEET',
    sizeBytes: Buffer.byteLength(sheetLines, 'utf8'),
    webViewLink: '/thach-cao/real-lotus-woodwick-hero.jpg',
    downloadUrl: '/thach-cao/real-lotus-woodwick-hero.jpg',
    parentFolderId: docFolderId,
    path: `${docFolderPath}/Bang-Gia-Va-Thong-So-10-Tuyet-Tac-Thach-Cao-An-Nhien-Thach.csv`,
    textContent: sheetLines,
    metadata: {
      totalProducts: products.length,
      brand: 'An Nhiên Thạch · Ưu Đàm Suite',
    },
  }
  items.push(sheetItem)
  docChildren.push({
    id: sheetItem.id,
    name: sheetItem.name,
    path: sheetItem.path!,
    mimeType: sheetItem.mimeType,
    fileType: 'SHEET',
    sizeBytes: sheetItem.sizeBytes,
    webViewLink: sheetItem.webViewLink,
  })

  const fileTree: DriveFolderTreeNode = {
    id: LOCAL_THACH_CAO_FOLDER_ID,
    name: rootName,
    path: rootPath,
    mimeType: 'application/vnd.google-apps.folder',
    fileType: 'FOLDER',
    children: [
      {
        id: heroFolderId,
        name: '01-Anh-Goc-San-Pham-Thach-Cao',
        path: heroFolderPath,
        mimeType: 'application/vnd.google-apps.folder',
        fileType: 'FOLDER',
        children: heroChildren,
      },
      {
        id: kolFolderId,
        name: '02-KOL-Review-Chau-A-695K-Followers',
        path: kolFolderPath,
        mimeType: 'application/vnd.google-apps.folder',
        fileType: 'FOLDER',
        children: kolChildren,
      },
      {
        id: reviewFolderId,
        name: '03-Anh-Can-Canh-Review-Khach-Hang',
        path: reviewFolderPath,
        mimeType: 'application/vnd.google-apps.folder',
        fileType: 'FOLDER',
        children: reviewChildren,
      },
      {
        id: docFolderId,
        name: '04-Tai-Lieu-Mo-Ta-San-Pham-KOL',
        path: docFolderPath,
        mimeType: 'application/vnd.google-apps.folder',
        fileType: 'FOLDER',
        children: docChildren,
      },
    ],
  }

  return {
    id: LOCAL_THACH_CAO_FOLDER_ID,
    name: rootName,
    totalItems: items.length,
    items,
    fileTree,
  }
}

/**
 * Quét toàn bộ thư mục công khai (hỗ trợ đệ quy thư mục con lên tới 3 cấp)
 */
export async function fetchPublicDriveFolder(
  folderId: string,
  options?: {
    maxDepth?: number
    currentDepth?: number
    currentPath?: string
    apiKey?: string | null
    timeoutMs?: number
    extractText?: boolean
  }
): Promise<DriveFolderResult> {
  if (folderId === LOCAL_THACH_CAO_FOLDER_ID) {
    return buildLocalThachCaoFolderResult()
  }

  const maxDepth = options?.maxDepth ?? 3
  const currentDepth = options?.currentDepth ?? 1
  const currentPath = options?.currentPath ?? ''
  const timeoutMs = options?.timeoutMs ?? 20000
  const extractText = options?.extractText ?? true

  // Giải quyết Google API Key nếu chưa truyền
  let apiKey = options?.apiKey
  if (apiKey === undefined) {
    apiKey = await resolveGoogleApiKey()
  }

  let folderName = 'Thư mục Google Drive'
  let rawItems: RawIvdItem[] = []

  // Thử Tier 1 nếu có API Key
  if (apiKey) {
    try {
      const apiResult = await fetchFolderViaApiV3(folderId, apiKey, timeoutMs)
      folderName = apiResult.folderName
      rawItems = apiResult.rawItems
    } catch (apiErr) {
      console.warn(
        `[DriveParser] Tier 1 (API v3) thất bại, tự động chuyển sang Tier 2 (Zero-Key Scraper):`,
        apiErr
      )
      // Fallback sang Tier 2
      const scrapeResult = await fetchFolderViaZeroKeyHtml(folderId, timeoutMs)
      folderName = scrapeResult.folderName
      rawItems = scrapeResult.rawItems
    }
  } else {
    // Chạy trực tiếp Tier 2 (Zero-Key Scraper)
    const scrapeResult = await fetchFolderViaZeroKeyHtml(folderId, timeoutMs)
    folderName = scrapeResult.folderName
    rawItems = scrapeResult.rawItems
  }

  const rootPath = currentPath || `/${folderName}`
  const items: DriveFileItem[] = []
  const childNodes: DriveFolderTreeNode[] = []

  for (const raw of rawItems) {
    const fileType = determineFileType(raw.mimeType, raw.name)
    const filePath = `${rootPath}/${raw.name}`
    const links = buildDriveLinks(raw.id, raw.mimeType, fileType)

    let textContent: string | null = null
    // Trích xuất văn bản từ Docs hoặc Sheets
    if (extractText && (fileType === 'DOCUMENT' || fileType === 'SHEET')) {
      textContent = await extractDocumentText(raw.id, raw.mimeType, { timeoutMs: 8000 })
    }

    const driveItem: DriveFileItem = {
      id: raw.id,
      name: raw.name,
      mimeType: raw.mimeType,
      fileType,
      sizeBytes: raw.sizeBytes,
      webViewLink: links.webViewLink,
      downloadUrl: links.downloadUrl,
      thumbnailUrl: links.thumbnailUrl,
      parentFolderId: folderId,
      path: filePath,
      textContent,
      metadata: {
        sizeBytes: raw.sizeBytes,
        parentFolderId: folderId,
      },
    }

    items.push(driveItem)

    const treeNode: DriveFolderTreeNode = {
      id: raw.id,
      name: raw.name,
      path: filePath,
      mimeType: raw.mimeType,
      fileType,
      sizeBytes: raw.sizeBytes,
      webViewLink: links.webViewLink,
      thumbnailUrl: links.thumbnailUrl,
    }

    // Đệ quy quét thư mục con nếu chưa vượt quá maxDepth
    if (fileType === 'FOLDER' && currentDepth < maxDepth) {
      try {
        const subResult = await fetchPublicDriveFolder(raw.id, {
          maxDepth,
          currentDepth: currentDepth + 1,
          currentPath: filePath,
          apiKey,
          timeoutMs,
          extractText,
        })
        treeNode.children = subResult.fileTree.children
        items.push(...subResult.items)
      } catch (subErr) {
        console.warn(`[DriveParser] Không thể quét thư mục con ${raw.name} (${raw.id}):`, subErr)
      }
    }

    childNodes.push(treeNode)
  }

  const fileTree: DriveFolderTreeNode = {
    id: folderId,
    name: folderName,
    path: rootPath,
    mimeType: 'application/vnd.google-apps.folder',
    fileType: 'FOLDER',
    children: childNodes,
  }

  return {
    id: folderId,
    name: folderName,
    totalItems: items.length,
    items,
    fileTree,
  }
}

// ============================================================
// 6. DATABASE SYNCHRONIZATION & NON-DESTRUCTIVE RE-SYNC (FEAT-DRV-04)
// ============================================================

/**
 * Đồng bộ toàn bộ nội dung thư mục Google Drive vào CSDL
 * Non-destructive re-sync: bảo toàn liên kết Product & Campaign và metadata thủ công
 */
export async function syncDriveFolderToDb(
  input: SyncDriveFolderInput
): Promise<SyncDriveFolderOutput> {
  const parsed = parseDriveUrl(input.folderUrl)
  const folderId = parsed.id

  // 1. Kiểm tra ContentSource hiện có
  let existingSource: ContentSource | null = null
  if (input.contentSourceId) {
    existingSource = await db.contentSource.findUnique({
      where: { id: input.contentSourceId },
    })
  }

  if (!existingSource) {
    existingSource = await db.contentSource.findFirst({
      where: {
        OR: [{ folderId }, { driveFolderUrl: input.folderUrl.trim() }],
      },
    })
  }

  // Bảo toàn các trường khóa ngoại khi re-sync nếu người dùng không truyền giá trị mới
  const targetCampaignId =
    input.campaignId !== undefined ? input.campaignId : existingSource?.campaignId ?? null
  const targetProductId =
    input.productId !== undefined ? input.productId : existingSource?.productId ?? null
  const targetName =
    input.name?.trim() || existingSource?.name || 'Thư mục Google Drive'
  const targetDesc =
    input.description !== undefined ? input.description : existingSource?.description ?? null

  // 2. Tạo mới hoặc cập nhật trạng thái SYNCING
  let sourceRecord: ContentSource
  if (existingSource) {
    sourceRecord = await db.contentSource.update({
      where: { id: existingSource.id },
      data: {
        name: targetName,
        syncStatus: 'SYNCING',
        syncError: null,
        campaignId: targetCampaignId,
        productId: targetProductId,
        description: targetDesc,
      },
    })
  } else {
    sourceRecord = await db.contentSource.create({
      data: {
        name: targetName,
        driveFolderUrl: input.folderUrl.trim(),
        folderId,
        description: targetDesc,
        campaignId: targetCampaignId,
        productId: targetProductId,
        syncStatus: 'SYNCING',
      },
    })
  }

  // 3. Tiến hành quét thư mục từ Google Drive
  let folderResult: DriveFolderResult
  try {
    folderResult = await fetchPublicDriveFolder(folderId)
  } catch (err: unknown) {
    const errorMsg =
      err instanceof Error
        ? err.message
        : 'Đã xảy ra lỗi không xác định khi kết nối tới Google Drive'

    // Ghi nhận lỗi vào DB nhưng giữ nguyên dữ liệu các file cũ (non-destructive)
    await db.contentSource.update({
      where: { id: sourceRecord.id },
      data: {
        syncStatus: 'ERROR',
        syncError: errorMsg,
      },
    })
    throw err
  }

  // 4. Lấy danh sách ContentSourceItem hiện có để thực hiện non-destructive re-sync
  const existingItems = await db.contentSourceItem.findMany({
    where: { contentSourceId: sourceRecord.id },
  })

  const existingMap = new Map<string, ContentSourceItem>()
  for (const item of existingItems) {
    existingMap.set(item.driveFileId, item)
  }

  // 5. Cập nhật hoặc tạo mới từng Item, bảo toàn metadata và liên kết thủ công
  const syncedItems: ContentSourceItem[] = []

  for (const driveItem of folderResult.items) {
    const existing = existingMap.get(driveItem.id)

    // Hợp nhất metadata: giữ lại các thuộc tính do người dùng gán (như productId, campaignId, tags, notes...)
    let mergedMetadataStr = JSON.stringify(driveItem.metadata ?? {})
    if (existing?.metadata) {
      try {
        const oldMeta = JSON.parse(existing.metadata) as Record<string, unknown>
        const newMeta = driveItem.metadata ?? {}
        mergedMetadataStr = JSON.stringify({ ...newMeta, ...oldMeta })
      } catch {
        mergedMetadataStr = existing.metadata
      }
    }

    if (existing) {
      const updated = await db.contentSourceItem.update({
        where: { id: existing.id },
        data: {
          name: driveItem.name,
          mimeType: driveItem.mimeType,
          fileType: driveItem.fileType,
          sizeBytes: driveItem.sizeBytes,
          webViewLink: driveItem.webViewLink,
          downloadUrl: driveItem.downloadUrl,
          thumbnailUrl: driveItem.thumbnailUrl,
          parentFolderId: driveItem.parentFolderId,
          path: driveItem.path,
          textContent: driveItem.textContent ?? existing.textContent,
          metadata: mergedMetadataStr,
        },
      })
      syncedItems.push(updated)
    } else {
      const created = await db.contentSourceItem.create({
        data: {
          contentSourceId: sourceRecord.id,
          driveFileId: driveItem.id,
          name: driveItem.name,
          mimeType: driveItem.mimeType,
          fileType: driveItem.fileType,
          sizeBytes: driveItem.sizeBytes,
          webViewLink: driveItem.webViewLink,
          downloadUrl: driveItem.downloadUrl,
          thumbnailUrl: driveItem.thumbnailUrl,
          parentFolderId: driveItem.parentFolderId,
          path: driveItem.path,
          textContent: driveItem.textContent,
          metadata: mergedMetadataStr,
        },
      })
      syncedItems.push(created)
    }
  }

  // 6. Hoàn tất cập nhật ContentSource với trạng thái SYNCED
  // Nếu ban đầu tên nguồn là mặc định và thư mục Drive có tên cụ thể, cập nhật tên
  const resolvedName =
    targetName === 'Thư mục Google Drive' && folderResult.name !== 'Thư mục Google Drive'
      ? folderResult.name
      : targetName

  const updatedSource = await db.contentSource.update({
    where: { id: sourceRecord.id },
    data: {
      name: resolvedName,
      folderId,
      itemCount: syncedItems.length,
      fileTree: JSON.stringify(folderResult.fileTree),
      syncStatus: 'SYNCED',
      syncError: null,
      lastSyncedAt: new Date(),
    },
  })

  return {
    contentSource: updatedSource,
    items: syncedItems,
    isUpdated: !!existingSource,
  }
}

// ============================================================
// 7. QUERY & LIFECYCLE HELPERS
// ============================================================

export async function getContentSource(id: string) {
  return db.contentSource.findUnique({
    where: { id },
    include: {
      items: {
        orderBy: [{ fileType: 'asc' }, { name: 'asc' }],
      },
      campaign: {
        select: {
          id: true,
          code: true,
          name: true,
          title: true,
          status: true,
        },
      },
    },
  })
}

export async function listContentSources(options?: {
  search?: string
  status?: string
  campaignId?: string
}) {
  const where: Record<string, unknown> = {}

  if (options?.search) {
    where.OR = [
      { name: { contains: options.search } },
      { description: { contains: options.search } },
      { driveFolderUrl: { contains: options.search } },
    ]
  }

  if (options?.status && options.status !== 'ALL') {
    where.syncStatus = options.status
  }

  if (options?.campaignId) {
    where.campaignId = options.campaignId
  }

  return db.contentSource.findMany({
    where,
    include: {
      campaign: {
        select: {
          id: true,
          code: true,
          name: true,
          title: true,
          status: true,
        },
      },
      _count: {
        select: { items: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  })
}

export async function deleteContentSource(id: string) {
  const existing = await db.contentSource.findUnique({ where: { id } })
  if (!existing) {
    throw new Error('Nguồn dữ liệu không tồn tại')
  }

  await db.contentSource.delete({
    where: { id },
  })

  return { success: true, id }
}
