# Báo Cáo Phân Tích Kỹ Thuật: Cơ Sở Dữ Liệu, ORM & Thiết Kế Module AUTO SOCIAL (OPENVN · Ưu Đàm Suite)

- **Người thực hiện**: Explorer Subagent (`explorer_survey_schema_crm`)
- **Tác nhân điều phối (Parent)**: `3f0d510d-9880-49f5-b710-8d6bfe356311`
- **Thời gian phân tích**: 2026-10-26T13:16:00Z
- **Vị trí làm việc**: `.agents/teamwork/explorer_survey_schema_crm`
- **Chế độ**: Read-Only Technical Survey (Khảo sát và thiết kế kỹ thuật — không trực tiếp chỉnh sửa mã nguồn nghiệp vụ)

---

## 1. TỔNG QUAN HỆ THỐNG & MỤC TIÊU PHÂN TÍCH

Hệ thống **OPENVN · Ưu Đàm Suite** là giải pháp phần mềm quản trị bán hàng đa kênh (OmniSales CMS) kết hợp Quầy POS tại kho, tích hợp Sổ cái kế toán nội bộ (Invoice Pro), Đa kho & Liên kết Shop bán chéo, và Hệ thống Trợ lý Vận hành Tự động (Agent Autopilot).
- **Ngăn xếp công nghệ**: Next.js 16 (`^16.1.1`), React 19 (`^19.0.0`), Prisma ORM (`^6.11.1`), SQLite 3.
- **Môi trường vận hành**: Windows OS, Dev server cổng `3010`, Realtime Socket.io bus cổng `3013`.
- **Cơ sở dữ liệu sản xuất**: `db/custom.db` (kích thước ~4.78 MB, 24 bảng nghiệp vụ cốt lõi + 4 bảng nhật ký runtime).
- **Mục tiêu phân tích**:
  1. Khảo sát chi tiết hiện trạng các mô hình dữ liệu CRM hiện có (Sản phẩm, Voucher, Khuyến mãi/Chương trình, Đơn hàng, Khách hàng).
  2. Thiết kế hoàn chỉnh các thực thể mới cho module **AUTO SOCIAL** (`Campaign`, `ContentSource`, `ContentSourceItem`, `SocialPlan`, `SocialPost`, `SocialChannelConfig`, `AuditLog`) bảo đảm tương thích ngược 100% (Zero Regressions) và giữ bất biến số lượng bản ghi của 24 bảng cốt lõi.
  3. Xây dựng chiến lược di chuyển dữ liệu (DB Migration Strategy) an toàn tuyệt đối trên SQLite WAL mode, quy trình sao lưu và phục hồi trước khi áp dụng thay đổi.
  4. Chuẩn hóa quy ước kiểu dữ liệu, quan hệ ngoại khóa, Enums, Next.js 16 Route Handlers, và cơ chế kiểm toán kép (Module AuditLog + Global LedgerEntry).

---

## 2. HIỆN TRẠNG CÁC MÔ HÌNH DỮ LIỆU CỐT LÕI (CRM & COMMERCE)

### 2.1. Bảng `Product` (Sản phẩm & Combo BOM)
- **Vị trí định nghĩa**: `prisma/schema.prisma` (dòng 18–48).
- **Số lượng bản ghi baseline**: `12` sản phẩm (theo `db/baseline-counts.json`).
- **Cấu trúc trường**:
  - `id`: `String @id @default(cuid())`
  - `sku`: `String @unique` (Mã định danh sản phẩm, vd: `UD-QT-002`, `UD-VL-001`, `UD-DEN-001`)
  - `barcode`: `String? @unique` (Mã vạch CODE128 in nhãn & quét nhanh)
  - `name`: `String` (Tên sản phẩm đầy đủ)
  - `description`: `String?` (Mô tả chi tiết, câu chuyện sản phẩm, công dụng)
  - `categoryId`: `String?` (Khóa ngoại trỏ sang `Category`)
  - `costPrice`: `Float @default(0)` (Giá vốn)
  - `sellPrice`: `Float @default(0)` (Giá bán lẻ niêm yết chung)
  - `stock`: `Int @default(0)` (Tổng tồn kho toàn hệ thống)
  - `lowStockThreshold`: `Int @default(5)` (Ngưỡng cảnh báo sắp hết hàng)
  - `image`: `String?` (Đường dẫn ảnh sản phẩm)
  - `status`: `String @default("ACTIVE")` (`ACTIVE` | `INACTIVE`)
  - `attributes`: `String?` (Đặc tính sản phẩm / thông số kỹ thuật)
  - `unit`: `String @default("sp")` (Đơn vị tính)
  - `type`: `String @default("SIMPLE")` (`SIMPLE` | `COMBO` — Combo dùng cấu hình định mức BOM)
  - `fragile`: `Boolean @default(false)` (Cảnh báo hàng dễ vỡ)
  - `ownerWarehouseId`: `String?` (Kho sở hữu hoặc Shop đối tác liên kết bán chéo)
  - `crossSellRate`: `Float?` (% hoa hồng bán chéo)
- **Vai trò đối với AUTO SOCIAL**:
  - Khi AI sinh bài viết cho chiến dịch/sản phẩm (R3), AI cần đọc `name`, `description`, `sellPrice`, `image`, `sku` từ `Product` để tạo nội dung chính xác.
  - **Quy tắc bất biến**: Giá bán trong bài viết AI phải khớp chính xác `sellPrice` hoặc giá sau chiết khấu của chương trình, không được tự bịa giá.

### 2.2. Bảng `Voucher` (Mã Giảm Giá Khuyến Mãi)
- **Vị trí định nghĩa**: `prisma/schema.prisma` (dòng 468–483).
- **Số lượng bản ghi baseline**: `4` voucher bất biến (`UUDAM10`, `PHATDAN50K`, `LIENKET15`, `FREESHIP0D`).
- **Cấu trúc trường**:
  - `id`: `String @id @default(cuid())`
  - `code`: `String @unique` (Mã nhập voucher in hoa, không dấu cách)
  - `title`: `String` (Tên hiển thị voucher)
  - `description`: `String?` (Điều kiện áp dụng)
  - `discountType`: `String @default("PERCENT")` (`PERCENT` | `FIXED` | `FREESHIP`)
  - `discountValue`: `Float @default(10)` (Giá trị giảm: % hoặc số tiền đ)
  - `maxDiscount`: `Float?` (Mức giảm trần tối đa cho loại `PERCENT`)
  - `minOrderAmount`: `Float @default(0)` (Giá trị đơn hàng tối thiểu)
  - `usageLimit`: `Int?` (Giới hạn lượt dùng, null = không giới hạn)
  - `usedCount`: `Int @default(0)` (Số lượt đã áp dụng)
  - `scope`: `String @default("ALL")` (`ALL` | `ALLIANCE`)
  - `active`: `Boolean @default(true)` (Bật/tắt sử dụng)
  - `expiresAt`: `DateTime?` (Hạn sử dụng)
- **Vai trò đối với AUTO SOCIAL**:
  - Phân hệ Chương trình (R1) cho phép liên kết một hoặc nhiều voucher đi kèm chương trình.
  - AI viết bài (R3) bắt buộc phải trích xuất đúng `code`, `discountValue`, `discountType`, và hạn hiệu lực của Voucher để chèn vào nội dung bài đăng.

### 2.3. Hiện Trạng Về Phân Hệ Chương Trình (Promotions / Campaigns)
- **Phát hiện quan trọng**: Trong cơ sở dữ liệu hiện tại, **CHƯA CÓ** bất kỳ bảng nào đại diện cho Chương trình Bán hàng / Chiến dịch Khuyến mãi (`Campaign` hay `Promotion`).
- Hệ thống hiện chỉ có bảng `Voucher` độc lập và bảng `AppSetting`/`ChannelListing` lưu giá riêng từng sàn.
- Do đó, yêu cầu **R1 (Phân hệ Chương trình CRM)** là việc xây dựng một thực thể hoàn toàn mới mang tên `Campaign` trong Prisma schema và giao diện quản lý tương ứng.

### 2.4. Bảng `Customer` (Khách Hàng & Hội Viên)
- **Vị trí định nghĩa**: `prisma/schema.prisma` (dòng 79–101).
- **Số lượng bản ghi baseline**: `34` khách hàng.
- **Trường dữ liệu**: Quản lý thông tin liên hệ, tích điểm thưởng (`points`), hạng hội viên (`isMember`, `memberCode`), và đặc biệt là hệ thống Trí nhớ dài hạn (`contextSummary`, `preferences`, `painPoints`, `inferredProfile`).
- **Tác động**: AUTO SOCIAL không làm thay đổi cấu trúc bảng `Customer`. Khi AI viết bài cho kênh Zalo OA hoặc gửi tin chăm sóc, các phân khúc khách hàng mục tiêu có thể được tham chiếu.

### 2.5. Bảng `Order` (Đơn Hàng Đa Kênh)
- **Vị trí định nghĩa**: `prisma/schema.prisma` (dòng 103–131).
- **Số lượng bản ghi baseline**: `173` đơn hàng.
- **Liên kết**: Sử dụng `voucherCode String?` (lưu mã voucher dạng text nới lỏng để chống vỡ liên kết khi voucher bị xóa) và `discountAmount Float`.
- **Tác động**: AUTO SOCIAL là module tiếp thị và xuất bản nội dung, hoàn toàn độc lập với bảng `Order`, không làm thay đổi bảng `Order`.

### 2.6. Bảng `IntegrationCredential` (Quản Lý Thông Tin Xác Thực Đối Tác)
- **Vị trí định nghĩa**: `prisma/schema.prisma` (dòng 423–433).
- **Số lượng bản ghi baseline**: `14` credentials (gồm Zalo OA, Shopee, TikTok Shop, Lazada, Website, Facebook Fanpage, Alliance Hub, 5 ĐVVC, PayOS, Gemini).
- **Cấu trúc trường**: `provider String @unique`, `name String`, `config String (JSON)`, `active Boolean`.
- **Vai trò với AUTO SOCIAL**: Màn hình Kết nối API hiện đã có các provider như `FACEBOOK`, `ZALO_OA`, `WEBSITE`, `GEMINI`. AUTO SOCIAL có thể đọc cấu hình credential từ đây hoặc qua bảng cấu hình chuyên biệt `SocialChannelConfig` đồng bộ 2 chiều.

---

## 3. THIẾT KẾ CHI TIẾT CÁC THỰC THỂ MỚI CHO MODULE AUTO SOCIAL

Để đáp ứng đầy đủ các yêu cầu R1–R6 từ yêu cầu người dùng, chúng ta thiết kế 7 thực thể dữ liệu mới:

```
┌──────────────────────────────────────────────────────────────┐
│                        Campaign (R1)                         │
│  - Thông tin chương trình, thời gian, voucher, sản phẩm     │
└──────────────┬───────────────────────────────┬───────────────┘
               │ 1:N                           │ 1:N
               ▼                               ▼
┌──────────────────────────────┐ ┌─────────────────────────────┐
│      SocialPlan (R3)         │ │     ContentSource (R2)      │
│  - Kế hoạch đăng bài do AI   │ │  - Thư mục Google Drive     │
│    lên lịch & chủ đề         │ │    công khai & liên kết     │
└──────────────┬───────────────┘ └─────────────┬───────────────┘
               │ 1:N                           │ 1:N
               ▼                               ▼
┌──────────────────────────────┐ ┌─────────────────────────────┐
│       SocialPost (R4, R5)    │ │   ContentSourceItem (R2)    │
│  - Bài đăng 7 nền tảng       │ │  - Ảnh, video, Google Doc,  │
│  - Trạng thái duyệt & lịch   │ │    Google Sheet đã quét     │
└──────────────┬───────────────┘ └─────────────────────────────┘
               │
               ▼
┌──────────────────────────────┐ ┌─────────────────────────────┐
│  SocialChannelConfig (R5)    │ │       AuditLog (R4, R6)     │
│  - Cấu hình 7 kênh, giới     │ │  - Truy vết duyệt, đăng,    │
│    hạn ký tự, mock toggle    │ │    lỗi, payload, AI prompt  │
└──────────────────────────────┘ └─────────────────────────────┘
```

### 3.1. Mô hình `Campaign` (Phân Hệ Chương Trình CRM - R1)
Phục vụ quản lý các chiến dịch khuyến mãi, sự kiện theo mùa (Vu Lan, Tết, Phật Đản, Khai trương, Tri ân khách hàng):

```prisma
model Campaign {
  id                 String           @id @default(cuid())
  code               String           @unique // Mã chương trình: CP-VULAN-2026, CP-TRIAN-VIP
  name               String           // Tên chương trình
  description        String?          // Mô tả thông điệp & mục tiêu
  startDate          DateTime         // Thời gian bắt đầu
  endDate            DateTime         // Thời gian kết thúc
  status             String           @default("UPCOMING") // UPCOMING | ACTIVE | ENDED | CANCELLED
  discountPercent    Float?           // % giảm giá chung nếu có (vd 10%)
  discountAmount     Float?           // Số tiền giảm trực tiếp nếu có
  voucherId          String?          // Khóa ngoại trỏ sang Voucher
  voucher            Voucher?         @relation(fields: [voucherId], references: [id], onDelete: SetNull)
  voucherCode        String?          // Snapshot mã voucher (UUDAM10...) để AI đọc nhanh
  appliedProductIds  String?          // JSON mảng ID sản phẩm áp dụng: ["id1", "id2"]
  bannerUrl          String?          // Banner chính của chiến dịch
  tags               String?          // JSON mảng từ khóa: ["vulan", "muavuon", "uudam"]
  createdAt          DateTime         @default(now())
  updatedAt          DateTime         @updatedAt

  // Quan hệ 1-N với kế hoạch và bài viết
  plans              SocialPlan[]
  posts              SocialPost[]
  contentSources     ContentSource[]

  @@index([status])
  @@index([startDate, endDate])
}
```

#### Quy tắc nghiệp vụ tính trạng thái biên của `Campaign` (R1 Acceptance Criteria):
- **Chặn thời gian không hợp lệ**: Khi tạo/sửa, kiểm tra bắt buộc `endDate > startDate`. Nếu `endDate <= startDate` trả về lỗi HTTP `400 Bad Request`.
- **Hàm xác định trạng thái tự động (`computeCampaignStatus(campaign, now = new Date())`)**:
  ```typescript
  export function computeCampaignStatus(campaign: { startDate: Date | string; endDate: Date | string; status: string }, now = new Date()): 'UPCOMING' | 'ACTIVE' | 'ENDED' | 'CANCELLED' {
    if (campaign.status === 'CANCELLED') return 'CANCELLED'
    const start = new Date(campaign.startDate).getTime()
    const end = new Date(campaign.endDate).getTime()
    const current = now.getTime()
    if (current < start) return 'UPCOMING'
    if (current >= start && current <= end) return 'ACTIVE'
    return 'ENDED'
  }
  ```
  - Trước giờ bắt đầu 1 phút: `UPCOMING`.
  - Đúng giờ bắt đầu (`current === start`): `ACTIVE`.
  - Sau giờ kết thúc (`current > end`): `ENDED`.

### 3.2. Mô hình `ContentSource` & `ContentSourceItem` (Nguồn Google Drive - R2)
Chủ tiệm cấu hình một hoặc nhiều link thư mục Google Drive công khai chứa tư liệu ảnh, video, tài liệu content:

```prisma
model ContentSource {
  id              String              @id @default(cuid())
  name            String              // Tên nguồn tài nguyên (vd: Kho ảnh Vu Lan 2026)
  driveFolderUrl  String              // URL gốc thư mục Drive công khai
  folderId        String?             // ID thư mục bóc tách từ URL
  description     String?             // Ghi chú về nguồn tư liệu
  campaignId      String?             // Liên kết với Campaign (nếu có)
  campaign        Campaign?           @relation(fields: [campaignId], references: [id], onDelete: SetNull)
  productId       String?             // Liên kết với Product cụ thể (nếu có)
  syncStatus      String              @default("IDLE") // IDLE | SYNCING | SYNCED | ERROR
  lastSyncedAt    DateTime?           // Thời điểm đồng bộ gần nhất
  syncError       String?             // Thông báo lỗi nếu sync thất bại
  itemCount       Int                 @default(0) // Tổng số tệp/thư mục con quét được
  fileTree        String?             // JSON cấu trúc cây thư mục & metadata tóm tắt
  active          Boolean             @default(true)
  createdAt       DateTime            @default(now())
  updatedAt       DateTime            @updatedAt

  items           ContentSourceItem[]

  @@index([campaignId])
}

model ContentSourceItem {
  id              String         @id @default(cuid())
  contentSourceId String
  contentSource   ContentSource  @relation(fields: [contentSourceId], references: [id], onDelete: Cascade)
  driveFileId     String         // ID tệp trên Google Drive
  name            String         // Tên tệp
  mimeType        String         // Loại MIME (image/jpeg, video/mp4, application/vnd.google-apps.document...)
  fileType        String         // IMAGE | VIDEO | DOCUMENT | SHEET | FOLDER | OTHER
  sizeBytes       Int?           // Dung lượng tệp
  webViewLink     String?        // Link xem trên trình duyệt
  downloadUrl     String?        // Link tải trực tiếp
  thumbnailUrl    String?        // Link ảnh thu nhỏ
  parentFolderId  String?        // ID thư mục cha (hỗ trợ phân cấp)
  path            String?        // Đường dẫn tương đối: /VuLan/HinhAnh/Anh1.jpg
  textContent     String?        // Nội dung text trích xuất từ Google Docs / Docx / Sheet / txt
  metadata        String?        // JSON chứa thông số bổ sung (chiều rộng, cao, số sheet...)
  createdAt       DateTime       @default(now())

  @@index([contentSourceId])
  @@index([fileType])
}
```

### 3.3. Mô hình `SocialPlan` (Kế Hoạch Nội Dung Do AI Đề Xuất - R3)
Lập kế hoạch tổng thể cho một chiến dịch hoặc chuỗi bài đăng:

```prisma
model SocialPlan {
  id             String       @id @default(cuid())
  campaignId     String?
  campaign       Campaign?    @relation(fields: [campaignId], references: [id], onDelete: Cascade)
  title          String       // Tiêu đề kế hoạch: Lịch đăng tuần 1 Vu Lan
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
}
```

### 3.4. Mô hình `SocialPost` (Bài Viết Đa Kênh, Duyệt & Lịch Đăng - R3, R4, R5)
Trung tâm của module AUTO SOCIAL, đại diện cho từng bài viết trên từng nền tảng:

```prisma
model SocialPost {
  id              String        @id @default(cuid())
  planId          String?
  plan            SocialPlan?   @relation(fields: [planId], references: [id], onDelete: Cascade)
  campaignId      String?
  campaign        Campaign?     @relation(fields: [campaignId], references: [id], onDelete: SetNull)
  
  // Nền tảng đăng bài: FACEBOOK | ZALO_OA | WEBSITE | EXTERNAL_WEB | INSTAGRAM | TIKTOK | THREADS
  channel         String
  
  title           String?       // Tiêu đề bài viết (dành cho Website / Blog / Email)
  content         String        // Nội dung chính (caption / post copy / kịch bản)
  excerpt         String?       // Tóm tắt ngắn hiển thị ở card hoặc SEO
  mediaUrls       String?       // JSON mảng URL ảnh/video: ["https://..."]
  mediaType       String?       @default("IMAGE") // NONE | IMAGE | VIDEO | CAROUSEL
  hashtags        String?       // JSON mảng hoặc chuỗi hashtag: "#uudam #vulan"
  targetUrl       String?       // Liên kết đích (kêu gọi mua hàng / chi tiết SP)
  
  // Trạng thái vòng đời bài viết:
  // DRAFT: Bản nháp do AI sinh
  // PENDING_APPROVAL: Chờ chủ tiệm duyệt trên lịch
  // APPROVED: Chủ tiệm đã duyệt, sẵn sàng lên lịch
  // SCHEDULED: Đã lên lịch hẹn giờ đăng
  // PUBLISHING: Đang gọi adapter đăng bài
  // PUBLISHED: Đã đăng thành công
  // FAILED: Đăng thất bại, có lý do lỗi
  // REJECTED: Chủ tiệm từ chối
  status          String        @default("DRAFT")
  
  scheduledAt     DateTime?     // Thời gian hẹn giờ đăng
  publishedAt     DateTime?     // Thời gian thực tế đăng thành công
  
  // Thông tin duyệt bài (R4)
  approvalNote    String?       // Ý kiến phản hồi / lý do từ chối của chủ tiệm
  approvedBy      String?       // Người duyệt: Quản trị viên Ưu Đàm
  approvedAt      DateTime?
  
  // Thông tin kết quả đăng từ nền tảng
  externalPostId  String?       // ID bài viết trả về từ MXH (fb_post_123, zalo_msg_456...)
  externalPostUrl String?       // Link xem bài viết thật trên MXH
  publishError    String?       // Lý do lỗi nếu thất bại (hết token, mạng, quá giới hạn...)
  retryCount      Int           @default(0) // Số lần thử lại
  isMock          Boolean       @default(true) // Cờ đánh dấu đăng qua adapter Mock hay Live
  payloadSnapshot String?       // JSON lưu toàn bộ payload gửi đi
  responseSnapshot String?      // JSON lưu response trả về từ nền tảng
  
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt

  @@index([campaignId])
  @@index([channel])
  @@index([status])
  @@index([scheduledAt])
}
```

### 3.5. Mô hình `SocialChannelConfig` (Cấu Hình 7 Kênh & Credentials - R5)
Quản lý tham số kỹ thuật, giới hạn ký tự và chế độ Mock/Live cho 7 nền tảng:

```prisma
model SocialChannelConfig {
  id              String   @id @default(cuid())
  // Nền tảng: FACEBOOK | ZALO_OA | WEBSITE | EXTERNAL_WEB | INSTAGRAM | TIKTOK | THREADS
  platform        String   @unique
  name            String   // Tên hiển thị: Fanpage Facebook Ưu Đàm, Zalo OA Chính Thức
  enabled         Boolean  @default(true)
  isMock          Boolean  @default(true) // false khi chủ tiệm đã nhập credential hợp lệ
  credentials     String?  // JSON lưu tokens, page IDs, webhooks (được mã hóa/bảo vệ)
  characterLimit  Int      @default(2000) // Giới hạn ký tự tối đa của nền tảng
  supportsVideo   Boolean  @default(true)
  supportsImages  Boolean  @default(true)
  maxImages       Int      @default(10)
  autoPublish     Boolean  @default(false) // Tự động phát lệnh khi tới giờ hẹn
  defaultHashtags String?  // Hashtag mặc định cho kênh
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}
```

#### Ma trận thông số kỹ thuật 7 nền tảng (R5 Specification):

| Nền tảng (`platform`) | Giới hạn ký tự (`characterLimit`) | Bắt buộc Media | Chế độ Live Credential | Chế độ Giả Lập (Mock) |
|---|---|---|---|---|
| **FACEBOOK** | 63,206 ký tự (chuẩn 2,000) | Tùy chọn (Ảnh/Video) | `IntegrationCredential.FACEBOOK` (`pageAccessToken`, `pageId`) | Mock Facebook Graph API v19.0, trả về `fb_post_mock_<timestamp>` |
| **ZALO_OA** | 2,000 ký tự | Tùy chọn (Ảnh/Article) | `IntegrationCredential.ZALO_OA` (`oaSecret`, `accessToken`) | Mock Zalo Open API v3.0, trả về `zalo_msg_mock_<timestamp>` |
| **WEBSITE** | Không giới hạn (HTML/Markdown) | Khuyên dùng Banner | Website nội bộ hệ thống Ưu Đàm (bảng `SocialPost` hoặc bài viết blog công khai) | Đăng trực tiếp vào hệ thống, hiển thị trên route công khai `/news` hoặc `/blog` |
| **EXTERNAL_WEB** | Không giới hạn | Khuyên dùng Feature Image | WordPress REST API / Haravan / Sapo credentials | Mock WP REST API `/wp/v2/posts`, trả về mock post ID |
| **INSTAGRAM** | 2,200 ký tự (30 hashtags) | **Bắt buộc** (Ảnh hoặc Video) | Instagram Graph API (liên kết FB Page) | Mock Instagram Container API |
| **TIKTOK** | 2,200 ký tự (video caption) | **Bắt buộc** (Video ngắn) | TikTok Content Posting API (`open.tiktokapis.com`) | Mock TikTok Video Upload API |
| **THREADS** | 500 ký tự | Tùy chọn (Ảnh/Video/Text) | Meta Threads API (`graph.threads.net`) | Mock Threads Post API |

### 3.6. Mô hình `AuditLog` (Nhật Ký Kiểm Toán Tác Vụ - R4, R6)
Đáp ứng yêu cầu kiểm toán độc lập, lưu lại lịch sử duyệt, thay đổi giờ, lệnh dispatch, và vết AI:

```prisma
model AuditLog {
  id           String   @id @default(cuid())
  entityType   String   // Campaign | ContentSource | SocialPlan | SocialPost | SocialChannelConfig
  entityId     String   // ID bản ghi tác động
  action       String   // CREATE | UPDATE | SYNC | AI_GENERATE | APPROVE | REJECT | RESCHEDULE | PUBLISH | RETRY | ERROR
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

*Ghi chú*: Bên cạnh bảng `AuditLog` riêng để phục vụ truy vấn nhanh trên giao diện Lịch nội dung, mọi thay đổi mang tính biến động cấu hình hoặc phát sinh xuất bản vẫn được đẩy đồng thời sang Sổ cái tổng `LedgerEntry` với `scope: 'SOCIAL'` để bảo toàn tính toàn vẹn kiểm toán toàn hệ thống.

---

## 4. CHIẾN LƯỢC DI CHUYỂN DỮ LIỆU AN TOÀN TRÊN SQLITE (MIGRATION RUNBOOK)

### 4.1. Phân Tích Hiện Trạng SQLite & Prisma
- **Vị trí tệp CSDL**: `DATABASE_URL="file:../db/custom.db"`.
  - Đường dẫn tuyệt đối: `y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\db\custom.db`.
  - Kích thước hiện tại: `4,780,032 bytes` (~4.78 MB).
  - Tệp sao lưu gốc: `db/custom.db.bak` (`2,404,352 bytes`).
- **Thư mục `prisma/migrations`**: Hiện tại thư mục này **KHÔNG TỒN TẠI** trong repo. Dự án sử dụng lệnh `prisma db push` (được cấu hình trong `package.json` với script `"db:push": "prisma db push --accept-data-loss"`).
- **Nguyên lý tương thích của SQLite**:
  - SQLite lưu trữ động (dynamic typing).
  - Thao tác tạo bảng mới (`CREATE TABLE IF NOT EXISTS`) là an toàn 100%, không chạm vào dữ liệu của các bảng cũ.
  - Các quan hệ ảo trong Prisma (`Campaign` liên kết với `Voucher`, `Product`) chỉ đặt khóa ngoại trên bảng mới (`Campaign.voucherId`, `ContentSource.productId`), **hoàn toàn không thêm cột bắt buộc nào vào các bảng cũ**.
  - Do đó, số lượng bản ghi của 24 bảng cốt lõi (Sản phẩm: 12, Đơn hàng: 173, Voucher: 4, Khách hàng: 34...) được bảo toàn tuyệt đối 100%.

### 4.2. Quy Trình 6 Bước Di Chuyển CSDL An Toàn (Zero-Loss Migration Runbook)

Trước khi kỹ sư triển khai thực hiện bất kỳ lệnh can thiệp nào vào schema hoặc CSDL, bắt buộc phải tuân thủ nghiêm ngặt 6 bước sau:

#### Bước 1: Flush WAL Checkpoint sang đĩa
Do SQLite chạy ở chế độ WAL (`Write-Ahead Logging`), các giao dịch gần nhất có thể đang nằm trong file `-wal` hoặc bộ nhớ đệm. Chạy lệnh checkpoint để toàn bộ dữ liệu được ghi trọn vẹn vào `custom.db`:
```typescript
import { db } from '@/lib/db'
await db.$queryRawUnsafe('PRAGMA wal_checkpoint(FULL)')
```

#### Bước 2: Tạo Bản Sao Lưu Đóng Băng (Frozen Physical Backup)
Tạo tệp sao lưu vật lý trước thời điểm cập nhật schema:
- Tên tệp đề xuất: `db/custom.db.bak.pre-autosocial-20261026`
- Kiểm tra tính hợp lệ của tệp sao lưu: Header tệp phải bắt đầu bằng 16 bytes `SQLite format 3\0`.
- Ghi lại mã băm SHA-256 của file sao lưu để đối soát.

#### Bước 3: Cập nhật `prisma/schema.prisma`
Bổ sung 7 model mới (`Campaign`, `ContentSource`, `ContentSourceItem`, `SocialPlan`, `SocialPost`, `SocialChannelConfig`, `AuditLog`) vào cuối tệp `prisma/schema.prisma`.
*Lưu ý cốt tử*: Tuyệt đối KHÔNG sửa đổi, xóa hoặc đổi tên bất kỳ trường nào trong 28 model hiện có!

#### Bước 4: Thực thi `prisma db push` & `prisma generate`
Chạy lệnh đẩy schema và sinh client:
```powershell
npx prisma db push --skip-generate
npx prisma generate
```
*Lưu ý*: Lệnh này chỉ thực thi các câu lệnh `CREATE TABLE` cho 7 bảng mới và tạo chỉ mục `CREATE INDEX`. Không có lệnh `DROP` hay `ALTER` nào trên 28 bảng cũ.

#### Bước 5: Kiểm toán Đối soát Số Lượng Bản Ghi Baseline (Post-Migration Audit Gate)
Chạy script kiểm tra số lượng bản ghi 24 bảng cốt lõi so sánh với `db/baseline-counts.json`:
- `Product`: phải đúng `12`
- `Category`: phải đúng `3`
- `Order`: phải đúng `173`
- `OrderItem`: phải đúng `226`
- `Customer`: phải đúng `34`
- `SalesInvoice`: phải đúng `10`
- `PurchaseInvoice`: phải đúng `4`
- `StockMovement`: phải đúng `246`
- `Warehouse`: phải đúng `4`
- `WarehouseStock`: phải đúng `22`
- `Voucher`: phải đúng `4`
- `BomComponent`: phải đúng `5`
- `AccountingPeriod`: phải đúng `5`
- `Partner`: phải đúng `1`
- `Channel`: phải đúng `10`
- `ChannelListing`: phải đúng `110`
- `Shipment`: phải đúng `85`
- `AfterSalesCase`: phải đúng `2`
- `AppSetting`: phải đúng `16`
- `IntegrationCredential`: phải đúng `14`
- `ApiKey`: phải đúng `1`
- `WebhookEndpoint`: phải đúng `2`
- `AutomationSetting`: phải đúng `6`
- `OrderEvent`: phải đúng `392`
Nếu bất kỳ bảng nào có số lượng chênh lệch: lập tức khôi phục từ tệp sao lưu ở Bước 2.

#### Bước 6: Khởi tạo Dữ liệu Mặc định (Seed Default Channel Configs)
Thực thi khởi tạo an toàn 7 cấu hình mặc định cho bảng `SocialChannelConfig` (Facebook, Zalo OA, Website, External Web, Instagram, TikTok, Threads) ở trạng thái `isMock = true`.

---

## 5. QUY ƯỚC LẬP TRÌNH & TƯƠNG THÍCH NEXT.JS 16

### 5.1. Breaking Change của Next.js 16 về Route Handlers
Theo `AGENTS.md` và tài liệu chính thức trong `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`:
- Trong Next.js 16, tham số dynamic route `params` không còn là object đồng bộ mà là một `Promise`!
- **Mã nguồn cũ (sai trên Next.js 16)**:
  ```typescript
  export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
    const id = params.id // ❌ Sẽ gây cảnh báo hoặc lỗi runtime
  }
  ```
- **Mã nguồn chuẩn hóa (bắt buộc tuân thủ trên toàn bộ API mới)**:
  ```typescript
  export const dynamic = 'force-dynamic'

  export async function GET(
    _req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) {
    const { id } = await params // ✅ Bắt buộc await params
    // ...
  }
  ```

### 5.2. Danh Mục Các API Routes Cần Triển Khai Cho AUTO SOCIAL

1. **Phân hệ Chương trình (CRM Campaign - R1)**:
   - `GET /api/campaigns` — Danh sách chương trình kèm bộ lọc trạng thái & từ khóa
   - `POST /api/campaigns` — Tạo mới chương trình (chặn `endDate <= startDate`)
   - `GET /api/campaigns/[id]` — Chi tiết chương trình, danh sách sản phẩm & bài đăng
   - `PUT /api/campaigns/[id]` — Cập nhật chương trình
   - `DELETE /api/campaigns/[id]` — Xóa chương trình (chỉ cho phép khi chưa có bài đã đăng)

2. **Nguồn Google Drive (R2)**:
   - `GET /api/content-sources` — Danh sách nguồn Drive công khai
   - `POST /api/content-sources` — Thêm nguồn Drive mới
   - `POST /api/content-sources/[id]/sync` — Kích hoạt quét & đồng bộ thư mục Drive công khai
   - `GET /api/content-sources/[id]/items` — Danh sách tệp, ảnh, video, Doc, Sheet đã quét

3. **AI Lên Kế Hoạch & Viết Bài (R3)**:
   - `POST /api/social/ai/generate-plan` — AI đề xuất lịch đăng từ Campaign + Drive
   - `POST /api/social/ai/generate-post` — AI viết nháp bài cho 1 nền tảng cụ thể (đối chiếu giá/voucher)

4. **Lịch Nội Dung, Duyệt & Đăng (R4, R5)**:
   - `GET /api/social/posts` — Danh sách bài viết theo lịch (lọc theo kênh, trạng thái, ngày)
   - `POST /api/social/posts` — Tạo bài viết thủ công hoặc lưu nháp
   - `GET /api/social/posts/[id]` — Chi tiết bài viết, lịch sử duyệt, preview
   - `PATCH /api/social/posts/[id]` — Cập nhật nội dung, đổi ngày giờ hẹn đăng
   - `POST /api/social/posts/[id]/approve` — Phê duyệt bài (`PENDING_APPROVAL` ➔ `APPROVED` ➔ `SCHEDULED`)
   - `POST /api/social/posts/[id]/reject` — Từ chối bài (`REJECTED`) kèm lý do
   - `POST /api/social/posts/[id]/publish-now` — Đăng ngay (thực hiện qua Mock Adapter an toàn)
   - `POST /api/social/cron/dispatch-scheduled` — Worker tự động quét bài đến giờ hẹn và đăng

5. **Kênh & Cấu hình (R5)**:
   - `GET /api/social/channels` — Danh sách cấu hình 7 kênh
   - `PUT /api/social/channels/[platform]` — Cập nhật cấu hình kênh / bật tắt mock

6. **Website Công Khai (Public Blog / News)**:
   - `GET /api/public/posts` — Danh sách bài viết đã xuất bản cho website của shop (`channel = 'WEBSITE'` và `status = 'PUBLISHED'`)
   - `GET /api/public/posts/[id]` — Chi tiết bài viết công khai

---

## 6. KẾT LUẬN & ĐỀ XUẤT CHO CÁC TIỂU BAN TIẾP THEO

1. **Khẳng định tính tương thích**:
   - Thiết kế 7 thực thể dữ liệu mới cho AUTO SOCIAL là hoàn toàn độc lập, mở rộng theo hướng phụ gia (additive-only), không làm thay đổi bất kỳ bảng dữ liệu nghiệp vụ nào đang chạy.
   - Cơ sở dữ liệu SQLite trong `db/custom.db` giữ nguyên vẹn 100% dữ liệu 24 bảng cốt lõi.
2. **Khuyến nghị cho Worker triển khai Schema**:
   - Tuân thủ nghiêm ngặt quy trình 6 bước tại Mục 4.2.
   - Luôn sao lưu `db/custom.db` trước khi chạy `prisma db push`.
   - Sử dụng `db.$queryRawUnsafe('PRAGMA wal_checkpoint(FULL)')` trước khi đọc hoặc sao lưu DB.
3. **Khuyến nghị cho Test Writer & QA**:
   - Mọi bài kiểm thử tự động tạo dữ liệu `Campaign`, `SocialPost`... phải có hook dọn dẹp (`cleanup`) sạch sẽ sau khi test xong.
   - Tuyệt đối không để rò rỉ bất kỳ bản ghi test nào vào cơ sở dữ liệu làm sai lệch `baseline-counts.json`.
   - Nghiêm cấm mọi lệnh gọi mạng ra API thật của Facebook, Zalo, TikTok trong test (tuân thủ R6 Safe Mock Isolation).
