# BÁO CÁO PHÂN TÍCH KỸ THUẬT & QUY TRÌNH THỰC THI AN TOÀN DỮ LIỆU MILESTONE 1 (M1: CRM CAMPAIGNS & DB SAFETY)

- **Module**: AUTO SOCIAL — OPENVN · Ưu Đàm Suite
- **Tác nhân thực hiện**: Explorer Subagent (`explorer_m1_db_safety`)
- **Tác nhân điều phối (Parent)**: `3f0d510d-9880-49f5-b710-8d6bfe356311`
- **Thời gian phân tích**: 2026-10-26T13:30:00Z
- **Thư mục làm việc**: `.agents/teamwork/explorer_m1_db_safety`
- **Mục tiêu**: Thiết lập phương án an toàn dữ liệu tuyệt đối (Zero Regression), quy trình sao lưu WAL Checkpoint, định nghĩa chính xác 7 model Prisma mới, và quy trình bàn giao cho Worker M1.

---

## 1. TỔNG QUAN & PHẠM VI MILESTONE 1

Milestone 1 (M1) là viên gạch nền tảng của toàn bộ module **AUTO SOCIAL**. M1 chịu trách nhiệm:
1. **Bảo toàn CSDL cốt lõi**: Giữ nguyên vẹn 100% dữ liệu của 24 bảng nghiệp vụ cốt lõi (theo `db/baseline-counts.json`), thực hiện checkpoint WAL và tạo bản sao lưu vật lý `db/custom.db.bak.pre-autosocial`.
2. **Mở rộng Schema phụ gia (Additive-Only)**: Bổ sung 7 model mới vào `prisma/schema.prisma` mà **không thay đổi bất kỳ ký tự nào** trong 28 model hiện có (từ dòng 1 đến 485).
3. **Phân hệ Chương trình (CRM Campaigns)**: Xây dựng thực thể `Campaign`, công cụ tính trạng thái biên theo thời gian thực (`UPCOMING`, `RUNNING`, `ENDED`, `CANCELLED`), cơ chế liên kết sản phẩm và mã voucher, cùng các API CRUD chuẩn Next.js 16 async params.

---

## 2. KHẢO SÁT HIỆN TRẠNG SQLITE & PHÁT HIỆN KỸ THUẬT QUAN TRỌNG

### 2.1. Kiểm Tra Đối Soát Baseline Ban Đầu
- File CSDL chính: `db/custom.db` (Dung lượng: `4,780,032 bytes` ~4.78 MB).
- Chạy script kiểm toán: `node scripts/check-counts.mjs`
- **Kết quả thực nghiệm**: `24 / 24` bảng nghiệp vụ cốt lõi khớp 100% với `db/baseline-counts.json` (Product: 12, Order: 173, Customer: 34, Voucher: 4, WarehouseStock: 22...).
- Chạy kiểm thử toàn hệ thống: `npm run verify` (`tsc --noEmit && npm run lint && npm run test:chain && npm run test:scenarios`).
- **Kết quả thực nghiệm**: Toàn bộ 21/21 kịch bản đối kháng và kiểm tra dây chuyền kế toán đều **PASS (0 lỗi, 0 cảnh báo)**.

### 2.2. Phát Hiện Thực Nghiệm: Cạm Bẫy `BigInt` Khi Chạy `PRAGMA wal_checkpoint(FULL)`
Trong quá trình kiểm thử thực nghiệm trên môi trường thật với Prisma:
- Lệnh SQLite: `await prisma.$queryRawUnsafe('PRAGMA wal_checkpoint(FULL);')`
- Giá trị trả về từ Prisma Client:
  ```javascript
  [ { busy: 0n, log: -1n, checkpointed: -1n } ]
  ```
- **Cạm bẫy chí tử**: Các trường `busy`, `log`, `checkpointed` là kiểu **`BigInt` của JavaScript (`0n`, `-1n`)**. Nếu code của Worker gọi `JSON.stringify(result)` để in log, Node.js sẽ ném ngay lỗi:
  ```
  TypeError: Do not know how to serialize a BigInt at JSON.stringify
  ```
- **Giải pháp cho Worker**:
  Khi xử lý kết quả checkpoint, truy xuất qua `Number(result[0].busy)` hoặc chuyển đổi BigInt trước khi log:
  ```typescript
  const raw = await prisma.$queryRawUnsafe<Array<{ busy: bigint; log: bigint; checkpointed: bigint }>>('PRAGMA wal_checkpoint(FULL);')
  const busy = Number(raw[0]?.busy ?? 0n)
  if (busy !== 0) throw new Error(`WAL checkpoint busy: ${busy}`)
  ```

### 2.3. Trạng Thái Journal Mode Của CSDL
- Truy vấn: `PRAGMA journal_mode;` trả về `[ { journal_mode: 'delete' } ]`.
- Phân tích SQLite: Khi CSDL đang ở chế độ `delete` (hoặc khi không có giao dịch WAL tồn đọng), `PRAGMA wal_checkpoint(FULL)` trả về `log: -1n, checkpointed: -1n` và `busy: 0n`. Đây là hành vi hoàn toàn bình thường và an toàn. Khi dev server hoặc realtime bus kết nối có thể kích hoạt WAL, lệnh checkpoint bảo đảm mọi frame trên đĩa hoặc trong bộ nhớ đệm được xả sạch vào `custom.db`.

### 2.4. Tránh Cạm Bẫy Thoát Ký Tự PowerShell Trên Windows
- Khi chạy các lệnh CLI inline có chứa ký tự `$` trong PowerShell (ví dụ: `prisma.$queryRawUnsafe`), PowerShell sẽ tự động nuốt biến `$queryRawUnsafe` thành chuỗi rỗng (`p.()`).
- **Khuyến nghị bắt buộc**: Toàn bộ quy trình Checkpoint và Sao lưu CSDL phải được viết thành một file script độc lập (ví dụ `scripts/backup-pre-autosocial.mjs` hoặc `.ts`), chạy qua `node scripts/...`, không chạy inline lệnh có `$` trực tiếp trên PowerShell terminal.

---

## 3. THIẾT KẾ CHI TIẾT 7 MODEL PRISMA CHO MODULE AUTO SOCIAL

Để đảm bảo tính độc lập và an toàn tuyệt đối, 7 model mới được append vào cuối file `prisma/schema.prisma` (từ dòng 486). **Không thêm hoặc sửa bất kỳ trường nào trong 28 model hiện có**.

### 3.1. Danh Sách 7 Model Mới

```prisma
// ============================================================
// AUTO SOCIAL MODULE: CRM CAMPAIGNS & MULTI-PLATFORM PUBLISHING
// ============================================================

model Campaign {
  id                String          @id @default(cuid())
  code              String          @unique // Mã chiến dịch: CP-202610-001, CP-VULAN-2026
  name              String          // Tên chương trình
  title             String?         // Tiêu đề hiển thị truyền thông (fallback về name nếu null)
  description       String?         // Mô tả chi tiết thông điệp & mục tiêu
  startDate         DateTime        // Thời gian bắt đầu
  endDate           DateTime        // Thời gian kết thúc
  status            String          @default("UPCOMING") // UPCOMING | RUNNING | ENDED | CANCELLED
  discountPercent   Float?          // % giảm giá chung nếu có (vd: 10)
  discountAmount    Float?          // Số tiền giảm trực tiếp nếu có (vd: 50000)
  voucherId         String?         // ID voucher chính liên kết
  voucherCode       String?         // Snapshot mã voucher (UUDAM10...) để AI đọc trực tiếp
  appliedProductIds String?         // JSON mảng ID sản phẩm áp dụng: ["prod_1", "prod_2"]
  appliedVoucherIds String?         // JSON mảng ID voucher áp dụng: ["vouch_1", "vouch_2"]
  bannerUrl         String?         // Banner chính của chiến dịch
  tags              String?         // JSON mảng từ khóa: ["vulan", "muavuon", "uudam"]
  createdAt         DateTime        @default(now())
  updatedAt         DateTime        @updatedAt

  plans             SocialPlan[]
  posts             SocialPost[]
  contentSources    ContentSource[]

  @@index([status])
  @@index([startDate, endDate])
}

model ContentSource {
  id             String              @id @default(cuid())
  name           String              // Tên nguồn tư liệu (vd: Kho ảnh Google Drive Vu Lan 2026)
  driveFolderUrl String              // URL thư mục Google Drive công khai
  folderId       String?             // ID thư mục bóc tách từ Drive URL
  description    String?             // Ghi chú mô tả
  campaignId     String?             // Liên kết với Campaign (nếu có)
  campaign       Campaign?           @relation(fields: [campaignId], references: [id], onDelete: SetNull)
  productId      String?             // Liên kết với Product (nếu có)
  syncStatus     String              @default("IDLE") // IDLE | SYNCING | SYNCED | ERROR
  lastSyncedAt   DateTime?           // Thời điểm đồng bộ thành công gần nhất
  syncError      String?             // Thông báo lỗi chi tiết nếu đồng bộ thất bại
  itemCount      Int                 @default(0) // Tổng số tệp/thư mục quét được
  fileTree       String?             // JSON cấu trúc cây thư mục phân cấp & tóm tắt
  active         Boolean             @default(true)
  createdAt      DateTime            @default(now())
  updatedAt      DateTime            @updatedAt

  items          ContentSourceItem[]

  @@index([campaignId])
  @@index([syncStatus])
}

model ContentSourceItem {
  id              String        @id @default(cuid())
  contentSourceId String
  contentSource   ContentSource @relation(fields: [contentSourceId], references: [id], onDelete: Cascade)
  driveFileId     String        // ID tệp trên Google Drive
  name            String        // Tên tệp
  mimeType        String        // Loại MIME (image/jpeg, video/mp4, application/vnd.google-apps.document...)
  fileType        String        // IMAGE | VIDEO | DOCUMENT | SHEET | FOLDER | OTHER
  sizeBytes       Int?          // Dung lượng tệp tính theo byte
  webViewLink     String?       // Link xem trên trình duyệt
  downloadUrl     String?       // Link tải trực tiếp
  thumbnailUrl    String?       // Link ảnh thu nhỏ
  parentFolderId  String?       // ID thư mục cha (hỗ trợ duyệt cây 3 cấp)
  path            String?       // Đường dẫn tương đối: /VuLan/HinhAnh/Anh1.jpg
  textContent     String?       // Nội dung text trích xuất từ Google Docs / Docx / Sheet / txt
  metadata        String?       // JSON thông số bổ sung (chiều rộng, cao, số sheets...)
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt

  @@index([contentSourceId])
  @@index([fileType])
  @@index([driveFileId])
}

model SocialPlan {
  id             String       @id @default(cuid())
  campaignId     String?
  campaign       Campaign?    @relation(fields: [campaignId], references: [id], onDelete: Cascade)
  title          String       // Tiêu đề kế hoạch: Lịch đăng 7 kênh chiến dịch Vu Lan
  description    String?      // Tóm tắt định hướng nội dung
  targetAudience String?      // Đối tượng độc giả mục tiêu
  brandTone      String?      @default("Trang nhã, từ bi, hướng thiện, chân thành Ưu Đàm")
  status         String       @default("DRAFT") // DRAFT | GENERATED | APPROVED | ARCHIVED
  aiModel        String?      @default("gemini-2.0-flash")
  promptUsed     String?      // Prompt hệ thống sử dụng khi sinh kế hoạch
  startDate      DateTime?
  endDate        DateTime?
  totalPosts     Int          @default(0)
  approvedPosts  Int          @default(0)
  publishedPosts Int          @default(0)
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt

  posts          SocialPost[]

  @@index([campaignId])
  @@index([status])
}

model SocialPost {
  id               String      @id @default(cuid())
  planId           String?
  plan             SocialPlan? @relation(fields: [planId], references: [id], onDelete: Cascade)
  campaignId       String?
  campaign         Campaign?   @relation(fields: [campaignId], references: [id], onDelete: SetNull)
  
  // 7 nền tảng: FACEBOOK | ZALO_OA | WEBSITE | EXTERNAL_CMS | INSTAGRAM | TIKTOK | THREADS
  channel          String
  
  title            String?     // Tiêu đề bài viết (cho Website Blog, Article)
  slug             String?     // Slug duy nhất hiển thị trên website công khai (/blog/[slug])
  content          String      // Nội dung chính (caption / post copy / kịch bản)
  excerpt          String?     // Tóm tắt ngắn hiển thị ở card hoặc SEO
  mediaUrls        String?     // JSON mảng URL ảnh/video: ["https://..."]
  mediaType        String?     @default("IMAGE") // NONE | IMAGE | VIDEO | CAROUSEL
  hashtags         String?     // JSON mảng hoặc chuỗi hashtag: "#uudam #vulan"
  targetUrl        String?     // Liên kết đích kêu gọi hành động (CTA link)
  
  // Vòng đời duyệt & đăng: DRAFT | PENDING_APPROVAL | APPROVED | SCHEDULED | PUBLISHING | PUBLISHED | FAILED | REJECTED
  status           String      @default("DRAFT")
  
  scheduledAt      DateTime?   // Thời gian hẹn giờ đăng
  publishedAt      DateTime?   // Thời gian thực tế đăng thành công
  
  // Duyệt bài (R4)
  approvalNote     String?     // Ý kiến phản hồi / lý do từ chối của chủ tiệm
  approvedBy       String?     // Người duyệt
  approvedAt       DateTime?
  
  // Khóa chống xuất bản trùng lặp (Concurrency Idempotency Lock - FEAT-REV-03)
  isPublishing     Boolean     @default(false)
  
  // Kết quả xuất bản & truy vết lỗi (FEAT-REV-05)
  externalPostId   String?     // ID bài viết trả về từ nền tảng (fb_post_123, zalo_msg_456...)
  externalPostUrl  String?     // Link xem bài viết thật trên MXH
  publishError     String?     // Chi tiết lỗi nếu đăng thất bại
  retryCount       Int         @default(0) // Số lần đã thử lại
  isMock           Boolean     @default(true) // Cờ đánh dấu xuất bản qua adapter Safe Mock hay Live
  payloadSnapshot  String?     // JSON snapshot toàn bộ payload gửi đi
  responseSnapshot String?     // JSON snapshot response trả về từ adapter
  
  createdAt        DateTime    @default(now())
  updatedAt        DateTime    @updatedAt

  @@index([campaignId])
  @@index([planId])
  @@index([channel])
  @@index([status])
  @@index([scheduledAt])
  @@index([slug])
}

model SocialChannelConfig {
  id              String   @id @default(cuid())
  // Nền tảng: FACEBOOK | ZALO_OA | WEBSITE | EXTERNAL_CMS | INSTAGRAM | TIKTOK | THREADS
  platform        String   @unique
  name            String   // Tên hiển thị: Fanpage Facebook Ưu Đàm, Zalo OA...
  enabled         Boolean  @default(true)
  isMock          Boolean  @default(true) // true: Safe Mock; false: Live API
  credentials     String?  // JSON lưu tokens, page IDs, webhooks (bảo mật)
  characterLimit  Int      @default(2000) // Giới hạn ký tự tối đa của nền tảng
  supportsVideo   Boolean  @default(true)
  supportsImages  Boolean  @default(true)
  maxImages       Int      @default(10)
  requiresMedia   Boolean  @default(false) // Bắt buộc có media (Instagram, TikTok)
  autoPublish     Boolean  @default(false) // Tự động phát lệnh khi tới giờ hẹn
  defaultHashtags String?  // Hashtag mặc định cho kênh
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}

model AuditLog {
  id           String   @id @default(cuid())
  entityType   String   // Campaign | ContentSource | SocialPlan | SocialPost | SocialChannelConfig
  entityId     String   // ID bản ghi tác động
  action       String   // CREATE | UPDATE | DELETE | SYNC | AI_GENERATE | APPROVE | REJECT | RESCHEDULE | PUBLISH | RETRY | ERROR
  actor        String   @default("OPERATOR") // OPERATOR | AI | SYSTEM | CRON
  actorName    String?  // Tên người thao tác ("Chủ tiệm Ưu Đàm", "Gemini Social AI")
  details      String?  // JSON lưu diff trước/sau, payload request, hoặc response
  status       String   @default("SUCCESS") // SUCCESS | FAILED | WARNING
  errorMessage String?
  createdAt    DateTime @default(now())

  @@index([entityType, entityId])
  @@index([action])
  @@index([createdAt])
}
```

### 3.2. Điểm Khác Biệt & Lý Do Thiết Kế Tối Ưu
1. **Không tạo foreign key cứng sang `Product` và `Voucher`**:
   - `appliedProductIds` và `appliedVoucherIds` được lưu dạng JSON mảng string (`["prod_1", "prod_2"]`).
   - `voucherCode` lưu snapshot chuỗi mã giảm giá (ví dụ: `"UUDAM10"`).
   - *Lý do*: Cách làm này giống hệt bảng `Order` hiện có (dòng 117 của schema: `voucherCode String?`). Nó giúp 24 bảng baseline không bao giờ bị ảnh hưởng nếu thêm/xóa/đổi cấu trúc quan hệ, đồng thời một chiến dịch có thể gắn với nhiều sản phẩm và nhiều voucher mà không cần tạo các bảng trung gian Join Table phức tạp.
2. **Quy chuẩn String Status (Thay vì Prisma Enum)**:
   - Toàn bộ dự án từ trước đến nay không dùng từ khóa `enum` (đã xác minh bằng grep). Toàn bộ trạng thái đều dùng `String @default(...)` kèm comment mô tả giá trị hợp lệ. Việc tuân thủ này tránh các vấn đề tương thích Enum trên SQLite của Prisma.
3. **Trường `slug` trên `SocialPost`**:
   - Phục vụ trực tiếp cho route công khai `/blog/[slug]` (FEAT-UI-02 trong Milestone 7).

---

## 4. QUY CÁCH NGHIỆP VỤ MILESTONE 1 (CRM CAMPAIGNS)

### 4.1. FEAT-CRM-03: Campaign Boundary State Engine
Hàm tính trạng thái chiến dịch phải là một hàm thuần khiết (pure function), xác định chính xác tại các mốc thời gian biên:
```typescript
export type CampaignStatus = 'UPCOMING' | 'RUNNING' | 'ENDED' | 'CANCELLED'

export function computeCampaignStatus(
  campaign: {
    startDate: Date | string
    endDate: Date | string
    status?: string | null
  },
  referenceTime: Date | string | number = new Date()
): CampaignStatus {
  if (campaign.status === 'CANCELLED') return 'CANCELLED'

  const start = new Date(campaign.startDate).getTime()
  const end = new Date(campaign.endDate).getTime()
  const current = new Date(referenceTime).getTime()

  // Kiểm tra tính hợp lệ của thời gian
  if (isNaN(start) || isNaN(end)) {
    throw new Error('Thời gian bắt đầu hoặc kết thúc không hợp lệ')
  }

  if (current < start) {
    return 'UPCOMING' // Trước giờ bắt đầu (kể cả trước 1 phút)
  }
  if (current >= start && current <= end) {
    return 'RUNNING' // Từ đúng thời điểm bắt đầu đến thời điểm kết thúc
  }
  return 'ENDED' // Sau thời điểm kết thúc (kể cả sau 1 giây)
}
```

#### Ma Trận Kiểm Thử Mốc Biên (Boundary Edge Cases):
| Kịch bản | Thời điểm đối chiếu (`referenceTime`) | Kết quả mong đợi |
|---|---|---|
| Trước bắt đầu 1 ngày | `startDate - 86,400,000ms` | `UPCOMING` |
| Trước bắt đầu 1 phút | `startDate - 60,000ms` | `UPCOMING` |
| Đúng thời điểm bắt đầu | `startDate` (0ms sai lệch) | `RUNNING` |
| Trong khoảng thời gian chạy | Giữa `startDate` và `endDate` | `RUNNING` |
| Đúng thời điểm kết thúc | `endDate` (0ms sai lệch) | `RUNNING` |
| Sau kết thúc 1 giây | `endDate + 1,000ms` | `ENDED` |
| Sau kết thúc 1 ngày | `endDate + 86,400,000ms` | `ENDED` |
| Bị hủy thủ công | Bất kỳ thời điểm nào khi `status = 'CANCELLED'` | `CANCELLED` |

### 4.2. FEAT-CRM-02: Quy Định Kiểm Tra Ràng Buộc Dữ Liệu (Validation Rules)
1. **Chặn Ngày Kết Thúc**: Khi tạo (`POST`) hoặc cập nhật (`PUT`), bắt buộc kiểm tra:
   ```typescript
   if (new Date(endDate).getTime() <= new Date(startDate).getTime()) {
     return NextResponse.json(
       { error: 'Thời gian kết thúc phải sau thời gian bắt đầu' },
       { status: 400 }
     )
   }
   ```
2. **Mã Chiến Dịch Duy Nhất (`code`)**:
   - Nếu người dùng không nhập `code`, tự động sinh theo mẫu: `CP-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.random().toString(36).substring(2, 6).toUpperCase()}` (ví dụ `CP-20261026-AB12`).
   - Nếu nhập trùng mã đã tồn tại: trả về `409 Conflict`.
3. **Tương thích Next.js 16 Route Handlers**:
   - Các dynamic route handler (như `src/app/api/campaigns/[id]/route.ts`) **bắt buộc** khai báo `params: Promise<{ id: string }>` và sử dụng `const { id } = await params`.

### 4.3. FEAT-CRM-04: Liên Kết Sản Phẩm & Voucher Với Tính Toán Giá Khuyến Mãi
Trong `src/lib/campaign-service.ts`, hàm `getCampaignDetails(id)` sẽ tổng hợp dữ liệu chuẩn khớp interface contract với Milestone 3 (AI Copywriting):
```typescript
export async function getCampaignDetails(id: string) {
  const campaign = await db.campaign.findUnique({ where: { id } })
  if (!campaign) return null

  // 1. Phân giải danh sách sản phẩm
  let productIds: string[] = []
  try {
    productIds = campaign.appliedProductIds ? JSON.parse(campaign.appliedProductIds) : []
  } catch {
    productIds = []
  }

  const products = productIds.length > 0
    ? await db.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, name: true, sellPrice: true, image: true, sku: true }
      })
    : []

  const computedProducts = products.map((p) => {
    let campaignPrice = p.sellPrice
    if (campaign.discountPercent && campaign.discountPercent > 0) {
      campaignPrice = Math.round(p.sellPrice * (1 - campaign.discountPercent / 100))
    } else if (campaign.discountAmount && campaign.discountAmount > 0) {
      campaignPrice = Math.max(0, p.sellPrice - campaign.discountAmount)
    }
    return {
      id: p.id,
      name: p.name,
      sku: p.sku,
      originalPrice: p.sellPrice,
      campaignPrice,
      discountPercent: campaign.discountPercent ?? undefined
    }
  })

  // 2. Phân giải danh sách voucher
  let voucherIds: string[] = []
  try {
    voucherIds = campaign.appliedVoucherIds ? JSON.parse(campaign.appliedVoucherIds) : []
  } catch {
    voucherIds = []
  }

  const vouchers = await db.voucher.findMany({
    where: {
      OR: [
        ...(voucherIds.length > 0 ? [{ id: { in: voucherIds } }] : []),
        ...(campaign.voucherCode ? [{ code: campaign.voucherCode }] : []),
        ...(campaign.voucherId ? [{ id: campaign.voucherId }] : [])
      ]
    }
  })

  const computedStatus = computeCampaignStatus(campaign)

  return {
    id: campaign.id,
    code: campaign.code,
    name: campaign.name,
    title: campaign.title || campaign.name,
    description: campaign.description || '',
    startDate: campaign.startDate.toISOString(),
    endDate: campaign.endDate.toISOString(),
    status: computedStatus,
    products: computedProducts,
    vouchers: vouchers.map((v) => ({
      id: v.id,
      code: v.code,
      title: v.title,
      discountType: v.discountType,
      discountPercent: v.discountType === 'PERCENT' ? v.discountValue : undefined,
      discountAmount: v.discountType === 'FIXED' ? v.discountValue : undefined,
      minOrderValue: v.minOrderAmount
    }))
  }
}
```

---

## 5. KỊCH BẢN THỰC THI TỪNG BƯỚC CHO WORKER (FOOLPROOF PLAYBOOK)

Worker được chỉ định thực hiện chính xác 6 bước dưới đây:

### Bước 1: Kiểm Tra Baseline Trước Khi Can Thiệp
Worker chạy lệnh:
```powershell
node scripts/check-counts.mjs
```
*Điều kiện tiếp tục*: Bắt buộc hiển thị `Core Parity Status : 100% MATCH (PASS)` (24/24 bảng khớp). Nếu không khớp, dừng lại báo cáo ngay.

### Bước 2: Chạy Script Checkpoint WAL & Sao Lưu Vật Lý
Worker tạo và chạy script `scripts/backup-pre-autosocial.mjs`:
```javascript
// scripts/backup-pre-autosocial.mjs
import { PrismaClient } from '@prisma/client'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const prisma = new PrismaClient()

async function runBackup() {
  console.log('=== [M1 STEP 1] FLUSH WAL CHECKPOINT ===')
  // Checkpoint toàn bộ log WAL vào custom.db
  const raw = await prisma.$queryRawUnsafe('PRAGMA wal_checkpoint(FULL);')
  const busy = Number(raw[0]?.busy ?? 0n)
  console.log(`WAL Checkpoint completed. Busy status: ${busy} (0 = SUCCESS)`)
  if (busy !== 0) {
    throw new Error('Database is busy, could not complete FULL WAL checkpoint.')
  }

  // Đóng kết nối Prisma để giải phóng lock file trên Windows
  await prisma.$disconnect()

  console.log('\n=== [M1 STEP 2] CREATE PHYSICAL FROZEN BACKUP ===')
  const src = path.resolve('db/custom.db')
  const dst = path.resolve('db/custom.db.bak.pre-autosocial')

  if (!fs.existsSync(src)) {
    throw new Error(`Source database file not found: ${src}`)
  }

  fs.copyFileSync(src, dst)
  console.log(`Copied: ${src} -> ${dst}`)

  console.log('\n=== [M1 STEP 3] VERIFY BACKUP INTEGRITY ===')
  const srcStat = fs.statSync(src)
  const dstStat = fs.statSync(dst)

  console.log(`Source size : ${srcStat.size} bytes`)
  console.log(`Backup size : ${dstStat.size} bytes`)

  if (srcStat.size !== dstStat.size) {
    throw new Error(`Size mismatch! Source: ${srcStat.size}, Backup: ${dstStat.size}`)
  }
  if (dstStat.size === 0) {
    throw new Error('Backup file is empty!')
  }

  // Kiểm tra SQLite Magic Header 16 bytes: "SQLite format 3\0"
  const fd = fs.openSync(dst, 'r')
  const headerBuf = Buffer.alloc(16)
  fs.readSync(fd, headerBuf, 0, 16, 0)
  fs.closeSync(fd)
  const headerStr = headerBuf.toString('utf8', 0, 15)
  if (headerStr !== 'SQLite format 3') {
    throw new Error(`Invalid SQLite header: "${headerStr}"`)
  }
  console.log(`SQLite Header: "${headerStr}" ✓ VALID`)

  // Kiểm tra SHA-256 Hash
  const srcHash = crypto.createHash('sha256').update(fs.readFileSync(src)).digest('hex')
  const dstHash = crypto.createHash('sha256').update(fs.readFileSync(dst)).digest('hex')
  console.log(`SHA-256 Source : ${srcHash}`)
  console.log(`SHA-256 Backup : ${dstHash}`)

  if (srcHash !== dstHash) {
    throw new Error('SHA-256 hash mismatch between source and backup!')
  }
  console.log('SHA-256 Checksum : 100% IDENTICAL ✓')
  console.log('\n>>> BACKUP VERIFIED FOOLPROOF. SAFE TO PROCEED. <<<')
}

runBackup().catch((err) => {
  console.error('Backup failed:', err)
  process.exit(1)
})
```
Lệnh thực thi:
```powershell
node scripts/backup-pre-autosocial.mjs
```

### Bước 3: Nối 7 Model Vào `prisma/schema.prisma`
- Worker mở `prisma/schema.prisma` và append toàn bộ khối định nghĩa 7 model tại Mục 3.1 vào cuối file.
- Chạy `git diff prisma/schema.prisma` để chắc chắn dòng 1 đến 485 không bị sửa bất kỳ ký tự nào.

### Bước 4: Đẩy Schema Vào CSDL & Sinh Client
Worker thực thi:
```powershell
npx prisma db push --skip-generate
npx prisma generate
```
*Ghi chú*: `prisma db push` sẽ thông báo tạo 7 bảng mới và các index mới. Không có bất kỳ cảnh báo xóa cột hay mất dữ liệu nào.

### Bước 5: Kiểm Toán Baseline Đối Soát (Parity Gate)
Ngay sau khi `prisma db push` thành công, Worker chạy:
```powershell
node scripts/check-counts.mjs
```
*Điều kiện tiên quyết*: Bắt buộc đạt `Core Parity Status : 100% MATCH (PASS)` (24/24 bảng).

### Bước 6: Khởi Tạo Cấu Hình Mặc Định 7 Kênh (`SocialChannelConfig`)
Tạo và chạy script `scripts/seed-social-channels.mjs` để nạp 7 cấu hình mặc định (tất cả đều ở chế độ `isMock = true`):
```javascript
// scripts/seed-social-channels.mjs
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const CHANNELS = [
  {
    platform: 'FACEBOOK',
    name: 'Fanpage Facebook Ưu Đàm',
    characterLimit: 63206,
    supportsVideo: true,
    supportsImages: true,
    maxImages: 10,
    requiresMedia: false,
    defaultHashtags: '#uudam #tramhuong #phatphap #binhan',
    isMock: true,
    enabled: true
  },
  {
    platform: 'ZALO_OA',
    name: 'Zalo Official Account Ưu Đàm',
    characterLimit: 2000,
    supportsVideo: false,
    supportsImages: true,
    maxImages: 5,
    requiresMedia: false,
    defaultHashtags: '',
    isMock: true,
    enabled: true
  },
  {
    platform: 'WEBSITE',
    name: 'Trang Tin Tức & Blog Ưu Đàm',
    characterLimit: 100000,
    supportsVideo: true,
    supportsImages: true,
    maxImages: 20,
    requiresMedia: false,
    defaultHashtags: '#uudam #blog #bantin',
    isMock: false, // Trang nội bộ hiển thị trực tiếp
    enabled: true
  },
  {
    platform: 'EXTERNAL_CMS',
    name: 'Website Ngoài (WordPress / Haravan / Sapo)',
    characterLimit: 100000,
    supportsVideo: true,
    supportsImages: true,
    maxImages: 20,
    requiresMedia: false,
    defaultHashtags: '',
    isMock: true,
    enabled: true
  },
  {
    platform: 'INSTAGRAM',
    name: 'Instagram Ưu Đàm (@uudam.vn)',
    characterLimit: 2200,
    supportsVideo: true,
    supportsImages: true,
    maxImages: 10,
    requiresMedia: true,
    defaultHashtags: '#uudam #zen #mindfulness #incense #meditation',
    isMock: true,
    enabled: true
  },
  {
    platform: 'TIKTOK',
    name: 'TikTok Kênh Ưu Đàm',
    characterLimit: 2200,
    supportsVideo: true,
    supportsImages: false,
    maxImages: 0,
    requiresMedia: true,
    defaultHashtags: '#uudam #tiktokvn #learnontiktok #tramhuong',
    isMock: true,
    enabled: true
  },
  {
    platform: 'THREADS',
    name: 'Threads Ưu Đàm (@uudam.vn)',
    characterLimit: 500,
    supportsVideo: true,
    supportsImages: true,
    maxImages: 10,
    requiresMedia: false,
    defaultHashtags: '#uudam #threads',
    isMock: true,
    enabled: true
  }
]

async function seed() {
  console.log('Seeding SocialChannelConfig for 7 platforms...')
  for (const c of CHANNELS) {
    await prisma.socialChannelConfig.upsert({
      where: { platform: c.platform },
      update: c,
      create: c
    })
    console.log(`✓ ${c.platform.padEnd(14)}: ${c.name} (isMock=${c.isMock})`)
  }
  const count = await prisma.socialChannelConfig.count()
  console.log(`Total channels in database: ${count}/7`)
  await prisma.$disconnect()
}

seed().catch(err => {
  console.error(err)
  process.exit(1)
})
```

---

## 6. KẾ HOẠCH KHÔI PHỤC KHẨN CẤP (ROLLBACK RUNBOOK)

Nếu trong quá trình thực hiện bước 4 hoặc 5 phát sinh bất kỳ lỗi nào hoặc số bản ghi baseline bị sai lệch:
1. Đóng toàn bộ tiến trình đang kết nối CSDL (node, dev server).
2. Khôi phục file CSDL gốc từ file sao lưu:
   ```powershell
   Copy-Item db\custom.db.bak.pre-autosocial db\custom.db -Force
   ```
3. Khôi phục lại file schema về trạng thái trước đó:
   ```powershell
   git checkout -- prisma/schema.prisma
   ```
4. Sinh lại Prisma Client:
   ```powershell
   npx prisma generate
   ```
5. Kiểm tra đối soát lại baseline:
   ```powershell
   node scripts/check-counts.mjs
   ```

---

## 7. BỘ KIỂM THỬ XÁC NHẬN MILESTONE 1 (VERIFICATION SUITE)

Để nghiệm thu Milestone 1 đạt chuẩn, Worker cần tạo kịch bản kiểm thử tự động tại `scripts/verify-m1-campaigns.ts`:
1. **Kiểm tra CSDL & Backup**:
   - File `db/custom.db.bak.pre-autosocial` tồn tại và kích thước > 0.
   - Bảng `SocialChannelConfig` có đủ 7 bản ghi.
2. **Kiểm thử Boundary State Engine**:
   - Chạy các case biên: `T - 60s` -> `UPCOMING`; `T0` -> `RUNNING`; `Tend + 1s` -> `ENDED`; `status = CANCELLED` -> `CANCELLED`.
3. **Kiểm thử Ràng buộc Ngày (`endDate > startDate`)**:
   - Tạo chiến dịch với `endDate <= startDate` -> Bị chặn lỗi `400`.
4. **Kiểm thử Liên kết SP & Voucher**:
   - Tạo chiến dịch thử nghiệm có 2 SP và 1 Voucher.
   - Kiểm tra giá sau chiết khấu tính toán đúng công thức.
5. **Dọn dẹp (Cleanup Hook)**:
   - Xóa toàn bộ dữ liệu test đã tạo trong script kiểm thử.
   - Chạy lại `node scripts/check-counts.mjs` bảo đảm 24 bảng cốt lõi không tăng/giảm dù chỉ 1 bản ghi.
6. **Cổng kiểm thử tổng thể**:
   - `npm run verify` (`tsc --noEmit && npm run lint && npm run test:chain && npm run test:scenarios`) đạt 100% PASS.
