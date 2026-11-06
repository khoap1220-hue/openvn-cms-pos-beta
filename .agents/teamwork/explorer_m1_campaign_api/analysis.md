# Kiến Trúc & Thiết Kế Kỹ Thuật: Campaign Service & Next.js 16 API Handlers (Milestone 1)

- **Tác nhân**: Explorer Subagent (`explorer_m1_campaign_api`)
- **Tác nhân điều phối (Parent)**: `3f0d510d-9880-49f5-b710-8d6bfe356311`
- **Thời gian**: 2026-10-26T13:30:00Z
- **Vị trí làm việc**: `y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\explorer_m1_campaign_api`
- **Chế độ**: Read-Only Architecture & Specification (Khảo sát, thiết kế kỹ thuật, đề xuất giải pháp chi tiết cho Worker — không sửa trực tiếp mã nguồn `src/`)

---

## 1. TỔNG QUAN VÀ BỐI CẢNH DỰ ÁN

Hệ thống **OPENVN · Ưu Đàm Suite** đang vận hành sản xuất thực tế trên nền tảng:
- **Ngăn xếp công nghệ**: Next.js 16 (`16.1.1`), React 19, Prisma ORM (`6.11.1`), SQLite (`db/custom.db`, chế độ WAL), Tailwind CSS, Radix UI.
- **Yêu cầu bổ sung**: Module **AUTO SOCIAL** — AI tự động lên kế hoạch nội dung và viết bài từ Google Drive công khai và các chương trình bán hàng/khuyến mãi (CRM Campaigns); chủ tiệm duyệt bài và hệ thống tự xuất bản đa nền tảng.
- **Yêu cầu cốt lõi của Milestone 1 (M1 - CRM Campaigns & DB Safety)**:
  1. Xây dựng tầng dịch vụ `src/lib/campaign-service.ts` quản lý toàn bộ nghiệp vụ CRUD của Chiến dịch/Chương trình khuyến mãi.
  2. Xây dựng thuật toán tính toán trạng thái biên động thời gian thực (`computeCampaignStatus`): `UPCOMING` (sắp chạy), `RUNNING` (đang chạy), `ENDED` (đã kết thúc), hoặc `CANCELLED` (đã hủy).
  3. Bộ quy tắc thẩm định (Validation): chặn nghiêm ngặt $endDate \le startDate$ với mã lỗi HTTP 400; bắt buộc có tên/tiêu đề; kiểm soát tính duy nhất của mã chương trình (`code`) với mã lỗi HTTP 409.
  4. Xây dựng các Route Handler chuẩn Next.js 16:
     - `src/app/api/campaigns/route.ts` (GET danh sách có lọc & phân trang, POST tạo mới)
     - `src/app/api/campaigns/[id]/route.ts` (GET chi tiết, PUT cập nhật, DELETE hủy/xóa)
  5. Tuân thủ nghiêm ngặt các quy ước phá vỡ (breaking changes) của Next.js 16:
     - Tham số động `params` trong Route Context là một `Promise` và **bắt buộc phải `await`**: `const { id } = await params`.
     - Chỉ thị phân đoạn tuyến đường (Route Segment Config): `export const dynamic = 'force-dynamic'`.
  6. Bảo toàn dữ liệu 100%: Hoàn toàn không xâm lấn, không làm giảm hay thay đổi 24 bảng dữ liệu cốt lõi trong `db/custom.db` (bảo toàn theo `db/baseline-counts.json`).

---

## 2. ĐẶC TẢ GIAO DIỆN DỮ LIỆU & KIỂU TYPESCRIPT (CONTRACTS)

Để bảo đảm tính tương thích giữa Tầng dữ liệu (M1), Tầng trí tuệ nhân tạo (M3), và Giao diện người dùng (M7), chúng ta chuẩn hóa bộ hợp đồng kiểu dữ liệu sau:

### 2.1. Hợp đồng dữ liệu `CampaignData` (M1 ↔ M3 ↔ M7 Interface Contract)

```typescript
// src/lib/types.ts hoặc src/lib/campaign-service.ts

export type CampaignStatus = 'UPCOMING' | 'RUNNING' | 'ENDED' | 'CANCELLED'

export interface CampaignProductSummary {
  id: string
  sku: string
  name: string
  sellPrice: number
  campaignPrice: number // Giá sau khi áp dụng chiết khấu chương trình
  discountPercent?: number
  image?: string | null
}

export interface CampaignVoucherSummary {
  id: string
  code: string
  title: string
  discountType: 'PERCENT' | 'FIXED' | 'FREESHIP' | string
  discountValue: number
  maxDiscount?: number | null
  minOrderAmount: number
  expiresAt?: string | null
}

export interface CampaignData {
  id: string
  code: string
  name: string
  title: string // Bí danh (alias) đồng bộ 100% với name để thỏa mãn contract M1 ↔ M3
  description: string | null
  startDate: string // ISO 8601 string
  endDate: string   // ISO 8601 string
  status: CampaignStatus
  discountPercent?: number | null
  discountAmount?: number | null
  appliedProductIds: string[]
  appliedVoucherIds: string[]
  voucherCode?: string | null
  bannerUrl?: string | null
  tags?: string[]
  products: CampaignProductSummary[]
  vouchers: CampaignVoucherSummary[]
  createdAt: string
  updatedAt: string
}
```

### 2.2. DTO Đầu Vào Tạo Mới & Cập Nhật

```typescript
export interface CreateCampaignInput {
  code?: string               // Nếu trống, hệ thống tự động sinh CP-YYYYMMDD-XXXX
  name?: string               // Tên chương trình
  title?: string              // Cho phép truyền title hoặc name (hỗ trợ cả hai)
  description?: string
  startDate: string | Date    // Thời điểm bắt đầu (ISO 8601 hoặc Date)
  endDate: string | Date      // Thời điểm kết thúc
  discountPercent?: number    // % giảm giá (0 - 100)
  discountAmount?: number     // Số tiền giảm trực tiếp (>= 0)
  voucherId?: string          // ID voucher liên kết
  voucherCode?: string        // Mã voucher liên kết (vd: UUDAM10)
  appliedProductIds?: string[] // Danh sách ID sản phẩm áp dụng
  appliedVoucherIds?: string[] // Danh sách ID voucher áp dụng
  bannerUrl?: string
  tags?: string[] | string
}

export interface UpdateCampaignInput {
  code?: string
  name?: string
  title?: string
  description?: string | null
  startDate?: string | Date
  endDate?: string | Date
  status?: CampaignStatus     // Cho phép cập nhật thủ công sang CANCELLED
  discountPercent?: number | null
  discountAmount?: number | null
  voucherId?: string | null
  voucherCode?: string | null
  appliedProductIds?: string[]
  appliedVoucherIds?: string[]
  bannerUrl?: string | null
  tags?: string[] | string | null
}

export interface CampaignFilterParams {
  search?: string
  status?: CampaignStatus | 'ALL'
  productId?: string
  voucherId?: string
  page?: number
  pageSize?: number
  now?: Date // Cho phép tiêm mốc thời gian kiểm thử giả lập
}
```

---

## 3. CƠ CHẾ TÍNH TRẠNG THÁI BIÊN ĐỘNG THỜI GIAN THỰC (DYNAMIC BOUNDARY STATE ENGINE)

### 3.1. Phân Tích Logic & Ranh Giới Thời Gian

Yêu cầu R1 đặt ra tiêu chí nghiệm thu khắt khe:
> "Trạng thái sắp chạy / đang chạy / đã kết thúc đúng tại các mốc biên (trước bắt đầu 1 phút, đúng giờ bắt đầu, sau kết thúc); chặn ngày kết thúc trước ngày bắt đầu."

Quy tắc phân loại toán học dựa trên mốc thời gian $T_{now}$, thời điểm bắt đầu $T_{start}$, thời điểm kết thúc $T_{end}$, và trạng thái can thiệp thủ công:

$$\text{Status}(T_{now}) = \begin{cases} 
\text{CANCELLED} & \text{nếu } \text{status}_{\text{manual}} = \text{'CANCELLED'} \\
\text{UPCOMING} & \text{nếu } T_{now} < T_{start} \\
\text{RUNNING} & \text{nếu } T_{start} \le T_{now} \le T_{end} \\
\text{ENDED} & \text{nếu } T_{now} > T_{end}
\end{cases}$$

### 3.2. Bảng Ma Trận Kiểm Thử Ranh Giới (Boundary Matrix)

| Kịch Bản Ranh Giới | Thời Điểm Đánh Giá $T_{now}$ | Điều Kiện So Sánh | Kết Quả Mong Đợi | Ghi Chú Nghiệp Vụ |
| :--- | :--- | :--- | :--- | :--- |
| **B1. Trước 1 ngày** | $T_{start} - 86400\,\text{s}$ | $T_{now} < T_{start}$ | `UPCOMING` | Chương trình đang lên kế hoạch |
| **B2. Trước đúng 1 phút** | $T_{start} - 60\,\text{s}$ | $T_{now} < T_{start}$ | `UPCOMING` | Tiêu chí R1: mốc trước 1 phút |
| **B3. Trước 1 mili-giây** | $T_{start} - 1\,\text{ms}$ | $T_{now} < T_{start}$ | `UPCOMING` | Điểm biên mở bên trái |
| **B4. Đúng thời điểm bắt đầu** | $T_{now} = T_{start}$ | $T_{now} \ge T_{start} \land T_{now} \le T_{end}$ | `RUNNING` | Tiêu chí R1: đúng giờ bắt đầu chuyển RUNNING |
| **B5. Trong khoảng diễn ra** | $T_{start} < T_{now} < T_{end}$ | $T_{now} \ge T_{start} \land T_{now} \le T_{end}$ | `RUNNING` | Khách được hưởng ưu đãi, AI sinh bài |
| **B6. Đúng thời điểm kết thúc** | $T_{now} = T_{end}$ | $T_{now} \ge T_{start} \land T_{now} \le T_{end}$ | `RUNNING` | Mili-giây cuối cùng của chương trình |
| **B7. Sau 1 mili-giây kết thúc** | $T_{end} + 1\,\text{ms}$ | $T_{now} > T_{end}$ | `ENDED` | Điểm biên đóng |
| **B8. Sau đúng 1 phút kết thúc** | $T_{end} + 60\,\text{s}$ | $T_{now} > T_{end}$ | `ENDED` | Tiêu chí R1: sau kết thúc |
| **B9. Đã bị hủy trước đó** | Bất kỳ $T_{now}$ | `manualStatus === 'CANCELLED'` | `CANCELLED` | Chủ tiệm chủ động hủy, không bao giờ tự mở lại |

### 3.3. Thuật Toán Cốt Lõi: `computeCampaignStatus`

Hàm được viết dưới dạng **Pure Function**, nhận đối số `now` tùy chọn (mặc định `new Date()`) để phục vụ hoàn hảo cho kiểm thử đơn vị và kịch bản tua nhanh thời gian (Time-travel testing):

```typescript
/**
 * Tính toán trạng thái động của Campaign theo ranh giới thời gian thực
 * @param campaign Đối tượng chứa startDate, endDate và status lưu trữ
 * @param now Mốc thời gian đối chiếu (mặc định là Date.now())
 * @returns 'UPCOMING' | 'RUNNING' | 'ENDED' | 'CANCELLED'
 */
export function computeCampaignStatus(
  campaign: {
    startDate: Date | string | number
    endDate: Date | string | number
    status?: string | null
  },
  now: Date | string | number = new Date()
): CampaignStatus {
  // 1. Nếu chương trình đã bị chủ tiệm hủy thì giữ nguyên trạng thái CANCELLED
  if (campaign.status === 'CANCELLED') {
    return 'CANCELLED'
  }

  const startMs = new Date(campaign.startDate).getTime()
  const endMs = new Date(campaign.endDate).getTime()
  const nowMs = new Date(now).getTime()

  // 2. Bảo vệ dữ liệu: nếu thời gian không hợp lệ, trả về CANCELLED hoặc ENDED an toàn
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    return 'ENDED'
  }

  // 3. Quy tắc ranh giới chuẩn xác từng mili-giây
  if (nowMs < startMs) {
    return 'UPCOMING'
  }
  if (nowMs >= startMs && nowMs <= endMs) {
    return 'RUNNING'
  }
  return 'ENDED'
}
```

### 3.4. Chiến Lược "Zero-Drift" (Chống Lệch Trạng Thái)

- **Vấn đề thực tế**: Nếu chỉ dựa vào Cron job định kỳ ghi DB để đổi từ `UPCOMING` $\rightarrow$ `RUNNING` $\rightarrow$ `ENDED`, hệ thống sẽ luôn bị độ trễ (drift) giữa 2 chu kỳ quét, dẫn đến tình trạng bài đăng tự động bị chặn hoặc áp dụng sai giờ.
- **Giải pháp tối ưu**:
  1. **Dynamic on Read**: Tại mọi thao tác đọc (`listCampaigns`, `getCampaignById`, API `GET /api/campaigns`), trạng thái được tính động thời gian thực bằng `computeCampaignStatus` trước khi trả về cho Client hoặc AI Service.
  2. **Persist on Mutate**: Khi Tạo (`POST`) hoặc Sửa (`PUT`), trạng thái được tính và lưu vào cột `status` trong SQLite.
  3. **SQL Query Helper**: Khi người dùng lọc `status = 'RUNNING'` trên API/UI, hàm truy vấn tự động bổ sung điều kiện thời gian tương ứng:
     ```typescript
     if (filterStatus === 'RUNNING') {
       where.status = { not: 'CANCELLED' }
       where.startDate = { lte: now }
       where.endDate = { gte: now }
     } else if (filterStatus === 'UPCOMING') {
       where.status = { not: 'CANCELLED' }
       where.startDate = { gt: now }
     } else if (filterStatus === 'ENDED') {
       where.OR = [
         { status: 'ENDED' },
         { status: { not: 'CANCELLED' }, endDate: { lt: now } }
       ]
     } else if (filterStatus === 'CANCELLED') {
       where.status = 'CANCELLED'
     }
     ```

---

## 4. BỘ QUY TẮC THẨM ĐỊNH DỮ LIỆU & BẢO VỆ NGHIỆP VỤ (VALIDATION RULES)

Tầng service và API route handler phải áp dụng nghiêm ngặt các quy tắc thẩm định sau:

### 4.1. Thẩm Định Khoảng Thời Gian ($endDate > startDate$)
- **Quy tắc**: `endDate` bắt buộc phải lớn hơn `startDate` strictly ($T_{end} > T_{start}$).
- **Trường hợp vi phạm**:
  - `endDate < startDate`: Ngày kết thúc diễn ra trước ngày bắt đầu $\rightarrow$ Lỗi HTTP 400.
  - `endDate === startDate`: Thời lượng chiến dịch bằng 0 mili-giây $\rightarrow$ Lỗi HTTP 400.
  - Định dạng thời gian không thể phân tích (Invalid Date) $\rightarrow$ Lỗi HTTP 400.
- **Thông điệp lỗi chuẩn tiếng Việt**:
  ```json
  { "error": "Ngày kết thúc phải diễn ra sau ngày bắt đầu" }
  ```

### 4.2. Thẩm Định Tên / Tiêu Đề Chương Trình
- **Quy tắc**: Cho phép nhận qua trường `name` hoặc `title`. Sau khi `.trim()`, chuỗi phải có độ dài từ 2 đến 200 ký tự.
- **Trường hợp vi phạm**: Trống, chỉ chứa khoảng trắng, hoặc dài quá 200 ký tự $\rightarrow$ Lỗi HTTP 400.
- **Thông điệp lỗi**:
  ```json
  { "error": "Vui lòng nhập tên chương trình (tối đa 200 ký tự)" }
  ```

### 4.3. Thẩm Định & Tự Động Sinh Mã Chương Trình (`code`)
- **Trường hợp người dùng tự nhập**:
  - Chuẩn hóa: `.trim().toUpperCase()`.
  - Định dạng regex: `^[A-Z0-9_\-\.]{3,50}$` (chỉ gồm chữ hoa, chữ số, dấu gạch nối, gạch dưới, chấm; 3-50 ký tự).
  - Kiểm tra trùng lặp: Tra cứu trong DB `db.campaign.findUnique({ where: { code } })`. Nếu đã tồn tại (khác ID hiện tại khi update) $\rightarrow$ Lỗi HTTP 409 Conflict.
- **Trường hợp không nhập mã**:
  - Hệ thống tự động sinh mã duy nhất theo định dạng: `CP-YYYYMMDD-XXXX` (với `XXXX` là chuỗi 4 ký tự ngẫu nhiên uppercase).
  - Kiểm tra đảm bảo không trùng lặp trước khi lưu.
- **Thông điệp lỗi trùng lặp**:
  ```json
  { "error": "Mã chương trình \"CP-VULAN-2026\" đã tồn tại" }
  ```

### 4.4. Thẩm Định Chiết Khấu (Discount)
- `discountPercent`: Nếu có giá trị, phải là số thuộc đoạn $[0, 100]$. Nếu ngoài khoảng $\rightarrow$ Lỗi HTTP 400: `"Phần trăm giảm giá phải từ 0% đến 100%"`.
- `discountAmount`: Nếu có giá trị, phải là số không âm ($discountAmount \ge 0$). Nếu âm $\rightarrow$ Lỗi HTTP 400: `"Số tiền giảm giá không được âm"`.

### 4.5. Thẩm Định Liên Kết Sản Phẩm & Voucher
- **Bảo toàn dữ liệu**: Sản phẩm (`Product`) và Voucher (`Voucher`) đã có sẵn trong cơ sở dữ liệu (`12` sản phẩm, `4` voucher theo baseline).
- Khi người dùng gửi danh sách `appliedProductIds` (mảng chuỗi):
  - Kiểm tra trong `db.product.findMany({ where: { id: { in: ids } }, select: { id: true } })`.
  - Nếu có ID sản phẩm không tồn tại trong hệ thống $\rightarrow$ Lỗi HTTP 400: `"Các sản phẩm sau không tồn tại: prod_xxx"`.
- Khi người dùng gửi `voucherCode` hoặc `voucherId`:
  - Kiểm tra trong `db.voucher.findUnique`.
  - Nếu không tìm thấy $\rightarrow$ Lỗi HTTP 400: `"Mã voucher \"${voucherCode}\" không tồn tại trong hệ thống"`.

### 4.6. Thẩm Định Xóa & Hủy An Toàn (Safe Deletion Policy)
- Khi gọi `DELETE /api/campaigns/[id]`:
  - Nếu chương trình đang ở trạng thái `RUNNING` hoặc đã có bài viết `SocialPost` / kế hoạch `SocialPlan` phụ thuộc:
    - **Không thực hiện Hard Delete** (không xóa vật lý khỏi SQLite để tránh mồ côi dữ liệu lịch sử).
    - Tự động chuyển trạng thái sang `CANCELLED`.
    - Trả về HTTP 200 kèm thông báo rõ ràng: `"Chương trình đã được chuyển sang trạng thái ĐÃ HỦY (CANCELLED) để bảo toàn dữ liệu liên kết"`.
  - Nếu chương trình ở trạng thái `UPCOMING` và hoàn toàn chưa có liên kết phụ thuộc:
    - Cho phép xóa cứng bản ghi khỏi bảng `Campaign`.
    - Trả về HTTP 200: `"Đã xóa chương trình thành công"`.

---

## 5. THIẾT KẾ CHI TIẾT TẦNG DỊCH VỤ (`src/lib/campaign-service.ts`)

Tầng dịch vụ là đơn vị thực thi nghiệp vụ độc lập, có thể gọi từ Route Handlers, Server Actions, AI Copywriter (M3), hoặc Cron Job (M4).

### 5.1. Cấu Trúc Toàn Diện Của `src/lib/campaign-service.ts`

```typescript
// src/lib/campaign-service.ts

import { db } from '@/lib/db'
import { broadcast } from '@/lib/realtime'
import { logLedger } from '@/lib/ledger'

export type CampaignStatus = 'UPCOMING' | 'RUNNING' | 'ENDED' | 'CANCELLED'

export interface CampaignData {
  id: string
  code: string
  name: string
  title: string
  description: string | null
  startDate: string
  endDate: string
  status: CampaignStatus
  discountPercent?: number | null
  discountAmount?: number | null
  appliedProductIds: string[]
  appliedVoucherIds: string[]
  voucherCode?: string | null
  bannerUrl?: string | null
  tags?: string[]
  products: Array<{
    id: string
    sku: string
    name: string
    sellPrice: number
    campaignPrice: number
    discountPercent?: number
    image?: string | null
  }>
  vouchers: Array<{
    id: string
    code: string
    title: string
    discountType: string
    discountValue: number
    maxDiscount?: number | null
    minOrderAmount: number
    expiresAt?: string | null
  }>
  createdAt: string
  updatedAt: string
}

export interface CreateCampaignInput {
  code?: string
  name?: string
  title?: string
  description?: string
  startDate: string | Date
  endDate: string | Date
  discountPercent?: number
  discountAmount?: number
  voucherId?: string
  voucherCode?: string
  appliedProductIds?: string[]
  appliedVoucherIds?: string[]
  bannerUrl?: string
  tags?: string[] | string
}

export interface UpdateCampaignInput {
  code?: string
  name?: string
  title?: string
  description?: string | null
  startDate?: string | Date
  endDate?: string | Date
  status?: CampaignStatus
  discountPercent?: number | null
  discountAmount?: number | null
  voucherId?: string | null
  voucherCode?: string | null
  appliedProductIds?: string[]
  appliedVoucherIds?: string[]
  bannerUrl?: string | null
  tags?: string[] | string | null
}

export interface CampaignFilterParams {
  search?: string
  status?: CampaignStatus | 'ALL'
  productId?: string
  voucherId?: string
  page?: number
  pageSize?: number
  now?: Date
}

// ==========================================
// 1. DYNAMIC BOUNDARY STATE COMPUTATION
// ==========================================

export function computeCampaignStatus(
  campaign: {
    startDate: Date | string | number
    endDate: Date | string | number
    status?: string | null
  },
  now: Date | string | number = new Date()
): CampaignStatus {
  if (campaign.status === 'CANCELLED') return 'CANCELLED'

  const startMs = new Date(campaign.startDate).getTime()
  const endMs = new Date(campaign.endDate).getTime()
  const nowMs = new Date(now).getTime()

  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return 'ENDED'

  if (nowMs < startMs) return 'UPCOMING'
  if (nowMs >= startMs && nowMs <= endMs) return 'RUNNING'
  return 'ENDED'
}

// ==========================================
// 2. ENRICHMENT HELPER (PRODUCTS & VOUCHERS)
// ==========================================

export async function enrichCampaign(
  rawCampaign: any,
  now = new Date()
): Promise<CampaignData> {
  const dynamicStatus = computeCampaignStatus(rawCampaign, now)
  const name = rawCampaign.name || rawCampaign.title || 'Chương trình chưa đặt tên'

  // Parse JSON fields an toàn
  let productIds: string[] = []
  if (Array.isArray(rawCampaign.appliedProductIds)) {
    productIds = rawCampaign.appliedProductIds
  } else if (typeof rawCampaign.appliedProductIds === 'string') {
    try {
      productIds = JSON.parse(rawCampaign.appliedProductIds)
    } catch {
      productIds = []
    }
  }

  let voucherIds: string[] = []
  if (Array.isArray(rawCampaign.appliedVoucherIds)) {
    voucherIds = rawCampaign.appliedVoucherIds
  } else if (typeof rawCampaign.appliedVoucherIds === 'string') {
    try {
      voucherIds = JSON.parse(rawCampaign.appliedVoucherIds)
    } catch {
      voucherIds = []
    }
  }

  let tagsArray: string[] = []
  if (Array.isArray(rawCampaign.tags)) {
    tagsArray = rawCampaign.tags
  } else if (typeof rawCampaign.tags === 'string') {
    try {
      tagsArray = JSON.parse(rawCampaign.tags)
    } catch {
      tagsArray = rawCampaign.tags.split(',').map((t: string) => t.trim()).filter(Boolean)
    }
  }

  // Tra cứu chi tiết sản phẩm và tính giá khuyến mãi
  let enrichedProducts: CampaignData['products'] = []
  if (productIds.length > 0) {
    const dbProducts = await db.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, sku: true, name: true, sellPrice: true, image: true },
    })

    enrichedProducts = dbProducts.map((p) => {
      let campaignPrice = p.sellPrice
      const pct = rawCampaign.discountPercent ?? 0
      const amt = rawCampaign.discountAmount ?? 0

      if (pct > 0) {
        campaignPrice = Math.round(p.sellPrice * (1 - pct / 100))
      } else if (amt > 0) {
        campaignPrice = Math.max(0, p.sellPrice - amt)
      }

      return {
        id: p.id,
        sku: p.sku,
        name: p.name,
        sellPrice: p.sellPrice,
        campaignPrice,
        discountPercent: pct > 0 ? pct : undefined,
        image: p.image,
      }
    })
  }

  // Tra cứu chi tiết voucher
  let enrichedVouchers: CampaignData['vouchers'] = []
  const voucherQueryConditions: any[] = []
  if (voucherIds.length > 0) voucherQueryConditions.push({ id: { in: voucherIds } })
  if (rawCampaign.voucherId) voucherQueryConditions.push({ id: rawCampaign.voucherId })
  if (rawCampaign.voucherCode) voucherQueryConditions.push({ code: rawCampaign.voucherCode })

  if (voucherQueryConditions.length > 0) {
    const dbVouchers = await db.voucher.findMany({
      where: { OR: voucherQueryConditions },
      select: {
        id: true,
        code: true,
        title: true,
        discountType: true,
        discountValue: true,
        maxDiscount: true,
        minOrderAmount: true,
        expiresAt: true,
      },
    })

    enrichedVouchers = dbVouchers.map((v) => ({
      id: v.id,
      code: v.code,
      title: v.title,
      discountType: v.discountType,
      discountValue: v.discountValue,
      maxDiscount: v.maxDiscount,
      minOrderAmount: v.minOrderAmount,
      expiresAt: v.expiresAt ? v.expiresAt.toISOString() : null,
    }))
  }

  return {
    id: rawCampaign.id,
    code: rawCampaign.code,
    name,
    title: name,
    description: rawCampaign.description ?? null,
    startDate: new Date(rawCampaign.startDate).toISOString(),
    endDate: new Date(rawCampaign.endDate).toISOString(),
    status: dynamicStatus,
    discountPercent: rawCampaign.discountPercent ?? null,
    discountAmount: rawCampaign.discountAmount ?? null,
    appliedProductIds: productIds,
    appliedVoucherIds: voucherIds,
    voucherCode: rawCampaign.voucherCode ?? (enrichedVouchers[0]?.code ?? null),
    bannerUrl: rawCampaign.bannerUrl ?? null,
    tags: tagsArray,
    products: enrichedProducts,
    vouchers: enrichedVouchers,
    createdAt: new Date(rawCampaign.createdAt).toISOString(),
    updatedAt: new Date(rawCampaign.updatedAt).toISOString(),
  }
}

// ==========================================
// 3. CRUD SERVICE FUNCTIONS
// ==========================================

export async function listCampaigns(params: CampaignFilterParams = {}) {
  const { search, status, productId, voucherId, page = 1, pageSize = 20, now = new Date() } = params
  const skip = (Math.max(1, page) - 1) * Math.min(100, Math.max(1, pageSize))
  const take = Math.min(100, Math.max(1, pageSize))

  const where: any = {}

  if (search) {
    where.OR = [
      { name: { contains: search } },
      { code: { contains: search } },
      { description: { contains: search } },
    ]
  }

  // Xử lý bộ lọc trạng thái động chuẩn SQL
  if (status && status !== 'ALL') {
    if (status === 'RUNNING') {
      where.status = { not: 'CANCELLED' }
      where.startDate = { lte: now }
      where.endDate = { gte: now }
    } else if (status === 'UPCOMING') {
      where.status = { not: 'CANCELLED' }
      where.startDate = { gt: now }
    } else if (status === 'ENDED') {
      where.OR = [
        { status: 'ENDED' },
        { status: { not: 'CANCELLED' }, endDate: { lt: now } },
      ]
    } else if (status === 'CANCELLED') {
      where.status = 'CANCELLED'
    }
  }

  if (productId) {
    where.appliedProductIds = { contains: productId }
  }

  if (voucherId) {
    where.OR = [
      { voucherId },
      { appliedVoucherIds: { contains: voucherId } },
    ]
  }

  const [total, rawCampaigns] = await Promise.all([
    (db as any).campaign.count({ where }),
    (db as any).campaign.findMany({
      where,
      skip,
      take,
      orderBy: { startDate: 'desc' },
    }),
  ])

  const campaigns = await Promise.all(rawCampaigns.map((c: any) => enrichCampaign(c, now)))

  return {
    campaigns,
    total,
    page: Math.max(1, page),
    pageSize: take,
    totalPages: Math.ceil(total / take) || 1,
  }
}

export async function getCampaignById(id: string, now = new Date()): Promise<CampaignData | null> {
  const rawCampaign = await (db as any).campaign.findUnique({
    where: { id },
  })
  if (!rawCampaign) return null
  return enrichCampaign(rawCampaign, now)
}

export async function createCampaign(input: CreateCampaignInput): Promise<CampaignData> {
  const name = (input.name || input.title || '').trim()
  if (!name) {
    throw new Error('Vui lòng nhập tên chương trình')
  }

  if (!input.startDate || !input.endDate) {
    throw new Error('Vui lòng chọn thời gian bắt đầu và kết thúc')
  }

  const startDate = new Date(input.startDate)
  const endDate = new Date(input.endDate)

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    throw new Error('Thời gian bắt đầu hoặc kết thúc không hợp lệ')
  }

  if (endDate.getTime() <= startDate.getTime()) {
    throw new Error('Ngày kết thúc phải diễn ra sau ngày bắt đầu')
  }

  // Xử lý mã code
  let code = (input.code || '').trim().toUpperCase()
  if (code) {
    if (!/^[A-Z0-9_\-\.]{3,50}$/.test(code)) {
      throw new Error('Mã chương trình chỉ được chứa chữ cái, số, gạch ngang (3-50 ký tự)')
    }
    const existing = await (db as any).campaign.findUnique({ where: { code } })
    if (existing) {
      const err: any = new Error(`Mã chương trình "${code}" đã tồn tại`)
      err.code = 'DUPLICATE_CODE'
      throw err
    }
  } else {
    // Tự sinh mã duy nhất
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const rand = Math.random().toString(36).substring(2, 6).toUpperCase()
    code = `CP-${dateStr}-${rand}`
  }

  // Validate discount
  if (input.discountPercent !== undefined && input.discountPercent !== null) {
    const pct = Number(input.discountPercent)
    if (pct < 0 || pct > 100) {
      throw new Error('Phần trăm giảm giá phải từ 0% đến 100%')
    }
  }

  if (input.discountAmount !== undefined && input.discountAmount !== null) {
    const amt = Number(input.discountAmount)
    if (amt < 0) {
      throw new Error('Số tiền giảm giá không được âm')
    }
  }

  // Validate products exist
  const productIds = Array.isArray(input.appliedProductIds) ? input.appliedProductIds.filter(Boolean) : []
  if (productIds.length > 0) {
    const found = await db.product.findMany({ where: { id: { in: productIds } }, select: { id: true } })
    const foundSet = new Set(found.map((p) => p.id))
    const missing = productIds.filter((pid) => !foundSet.has(pid))
    if (missing.length > 0) {
      throw new Error(`Sản phẩm không tồn tại: ${missing.join(', ')}`)
    }
  }

  const initialStatus = computeCampaignStatus({ startDate, endDate, status: 'UPCOMING' })

  const raw = await (db as any).campaign.create({
    data: {
      code,
      name,
      description: input.description?.trim() || null,
      startDate,
      endDate,
      status: initialStatus,
      discountPercent: input.discountPercent != null ? Number(input.discountPercent) : null,
      discountAmount: input.discountAmount != null ? Number(input.discountAmount) : null,
      voucherId: input.voucherId || null,
      voucherCode: input.voucherCode?.trim() || null,
      appliedProductIds: JSON.stringify(productIds),
      appliedVoucherIds: JSON.stringify(Array.isArray(input.appliedVoucherIds) ? input.appliedVoucherIds : []),
      bannerUrl: input.bannerUrl?.trim() || null,
      tags: typeof input.tags === 'string' ? input.tags : JSON.stringify(input.tags || []),
    },
  })

  // Ghi nhật ký hệ thống & broadcast realtime
  await logLedger({
    scope: 'SETTINGS',
    action: 'CAMPAIGN_CREATED',
    title: `Tạo chương trình ${code}: ${name}`,
    entityType: 'Campaign',
    entityId: raw.id,
    entityCode: code,
    actor: 'OPERATOR',
    detail: { code, name, startDate, endDate, initialStatus },
  })

  broadcast('settings.updated', { scope: 'CAMPAIGN', action: 'CREATED', campaignId: raw.id })

  return enrichCampaign(raw)
}

export async function updateCampaign(id: string, input: UpdateCampaignInput): Promise<CampaignData> {
  const existing = await (db as any).campaign.findUnique({ where: { id } })
  if (!existing) {
    const err: any = new Error('Không tìm thấy chương trình')
    err.code = 'NOT_FOUND'
    throw err
  }

  const name = input.name !== undefined || input.title !== undefined
    ? (input.name || input.title || '').trim()
    : existing.name

  if (!name) {
    throw new Error('Tên chương trình không được để trống')
  }

  const startDate = input.startDate !== undefined ? new Date(input.startDate) : new Date(existing.startDate)
  const endDate = input.endDate !== undefined ? new Date(input.endDate) : new Date(existing.endDate)

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    throw new Error('Thời gian bắt đầu hoặc kết thúc không hợp lệ')
  }

  if (endDate.getTime() <= startDate.getTime()) {
    throw new Error('Ngày kết thúc phải diễn ra sau ngày bắt đầu')
  }

  let code = existing.code
  if (input.code !== undefined) {
    const cleanCode = input.code.trim().toUpperCase()
    if (!/^[A-Z0-9_\-\.]{3,50}$/.test(cleanCode)) {
      throw new Error('Mã chương trình chỉ được chứa chữ cái, số, gạch ngang (3-50 ký tự)')
    }
    if (cleanCode !== existing.code) {
      const dup = await (db as any).campaign.findUnique({ where: { code: cleanCode } })
      if (dup && dup.id !== id) {
        const err: any = new Error(`Mã chương trình "${cleanCode}" đã tồn tại`)
        err.code = 'DUPLICATE_CODE'
        throw err
      }
      code = cleanCode
    }
  }

  const nextStatus = input.status === 'CANCELLED'
    ? 'CANCELLED'
    : computeCampaignStatus({ startDate, endDate, status: existing.status })

  const updateData: any = {
    code,
    name,
    startDate,
    endDate,
    status: nextStatus,
  }

  if (input.description !== undefined) updateData.description = input.description?.trim() || null
  if (input.discountPercent !== undefined) updateData.discountPercent = input.discountPercent != null ? Number(input.discountPercent) : null
  if (input.discountAmount !== undefined) updateData.discountAmount = input.discountAmount != null ? Number(input.discountAmount) : null
  if (input.voucherId !== undefined) updateData.voucherId = input.voucherId || null
  if (input.voucherCode !== undefined) updateData.voucherCode = input.voucherCode?.trim() || null
  if (input.appliedProductIds !== undefined) updateData.appliedProductIds = JSON.stringify(input.appliedProductIds)
  if (input.appliedVoucherIds !== undefined) updateData.appliedVoucherIds = JSON.stringify(input.appliedVoucherIds)
  if (input.bannerUrl !== undefined) updateData.bannerUrl = input.bannerUrl?.trim() || null
  if (input.tags !== undefined) updateData.tags = typeof input.tags === 'string' ? input.tags : JSON.stringify(input.tags || [])

  const updated = await (db as any).campaign.update({
    where: { id },
    data: updateData,
  })

  await logLedger({
    scope: 'SETTINGS',
    action: 'CAMPAIGN_UPDATED',
    title: `Cập nhật chương trình ${code}: ${name}`,
    entityType: 'Campaign',
    entityId: id,
    entityCode: code,
    actor: 'OPERATOR',
    detail: { before: existing, after: updated },
  })

  broadcast('settings.updated', { scope: 'CAMPAIGN', action: 'UPDATED', campaignId: id })

  return enrichCampaign(updated)
}

export async function deleteCampaign(id: string, options: { force?: boolean } = {}) {
  const existing = await (db as any).campaign.findUnique({
    where: { id },
    include: {
      posts: { select: { id: true } },
      plans: { select: { id: true } },
    },
  })

  if (!existing) {
    const err: any = new Error('Không tìm thấy chương trình')
    err.code = 'NOT_FOUND'
    throw err
  }

  const hasDependencies = (existing.posts?.length || 0) > 0 || (existing.plans?.length || 0) > 0
  const isRunning = computeCampaignStatus(existing) === 'RUNNING'

  // Nếu có phụ thuộc hoặc đang chạy và không ép buộc xóa cứng -> chuyển trạng thái CANCELLED
  if ((hasDependencies || isRunning) && !options.force) {
    const cancelled = await (db as any).campaign.update({
      where: { id },
      data: { status: 'CANCELLED' },
    })

    await logLedger({
      scope: 'SETTINGS',
      action: 'CAMPAIGN_CANCELLED',
      title: `Hủy chương trình ${existing.code}: ${existing.name}`,
      entityType: 'Campaign',
      entityId: id,
      entityCode: existing.code,
      actor: 'OPERATOR',
      detail: { reason: 'Has active dependencies or is running' },
    })

    broadcast('settings.updated', { scope: 'CAMPAIGN', action: 'CANCELLED', campaignId: id })

    return {
      success: true,
      action: 'CANCELLED' as const,
      message: 'Chương trình đã được chuyển sang trạng thái ĐÃ HỦY (CANCELLED) để bảo toàn dữ liệu liên kết',
      campaign: await enrichCampaign(cancelled),
    }
  }

  // Xóa cứng khi an toàn
  await (db as any).campaign.delete({ where: { id } })

  await logLedger({
    scope: 'SETTINGS',
    action: 'CAMPAIGN_DELETED',
    title: `Xóa chương trình ${existing.code}: ${existing.name}`,
    entityType: 'Campaign',
    entityId: id,
    entityCode: existing.code,
    actor: 'OPERATOR',
  })

  broadcast('settings.updated', { scope: 'CAMPAIGN', action: 'DELETED', campaignId: id })

  return {
    success: true,
    action: 'DELETED' as const,
    message: 'Đã xóa chương trình thành công',
  }
}
```

---

## 6. THIẾT KẾ CHI TIẾT ROUTE HANDLERS CHUẨN NEXT.JS 16

### 6.1. Route Handler: `src/app/api/campaigns/route.ts`

```typescript
// src/app/api/campaigns/route.ts

import { NextRequest, NextResponse } from 'next/server'
import {
  listCampaigns,
  createCampaign,
  type CampaignStatus,
} from '@/lib/campaign-service'

// BẮT BUỘC theo quy chuẩn Next.js 16 và AGENTS.md
export const dynamic = 'force-dynamic'

/**
 * GET /api/campaigns
 * Lấy danh sách chương trình khuyến mãi có bộ lọc, tìm kiếm và phân trang
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const search = searchParams.get('search')?.trim() || undefined
    const status = (searchParams.get('status')?.trim().toUpperCase() as CampaignStatus | 'ALL') || 'ALL'
    const productId = searchParams.get('productId')?.trim() || undefined
    const voucherId = searchParams.get('voucherId')?.trim() || undefined
    const page = Math.max(1, Number(searchParams.get('page')) || 1)
    const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize')) || 20))

    const result = await listCampaigns({
      search,
      status,
      productId,
      voucherId,
      page,
      pageSize,
    })

    return NextResponse.json(result, { status: 200 })
  } catch (error: any) {
    console.error('API /api/campaigns GET error:', error)
    return NextResponse.json(
      { error: error?.message || 'Không thể tải danh sách chương trình' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/campaigns
 * Tạo mới một chương trình khuyến mãi
 */
export async function POST(req: NextRequest) {
  try {
    let body: any
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Dữ liệu JSON không hợp lệ' }, { status: 400 })
    }

    const campaign = await createCampaign(body)
    return NextResponse.json({ campaign }, { status: 201 })
  } catch (error: any) {
    console.error('API /api/campaigns POST error:', error)

    if (error?.code === 'DUPLICATE_CODE') {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }

    return NextResponse.json(
      { error: error?.message || 'Không thể tạo chương trình' },
      { status: 400 }
    )
  }
}
```

### 6.2. Route Handler: `src/app/api/campaigns/[id]/route.ts`

```typescript
// src/app/api/campaigns/[id]/route.ts

import { NextRequest, NextResponse } from 'next/server'
import {
  getCampaignById,
  updateCampaign,
  deleteCampaign,
} from '@/lib/campaign-service'

// BẮT BUỘC theo quy chuẩn Next.js 16 và AGENTS.md
export const dynamic = 'force-dynamic'

interface RouteContext {
  params: Promise<{ id: string }>
}

/**
 * GET /api/campaigns/[id]
 * Lấy chi tiết chương trình theo ID (kèm trạng thái tính động và chi tiết SP/Voucher)
 */
export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    // Next.js 16 breaking change: params BẮT BUỘC phải await
    const { id } = await params

    if (!id || typeof id !== 'string') {
      return NextResponse.json({ error: 'Mã định danh ID không hợp lệ' }, { status: 400 })
    }

    const campaign = await getCampaignById(id)
    if (!campaign) {
      return NextResponse.json({ error: 'Không tìm thấy chương trình' }, { status: 404 })
    }

    return NextResponse.json({ campaign }, { status: 200 })
  } catch (error: any) {
    console.error(`API /api/campaigns/[id] GET error:`, error)
    return NextResponse.json(
      { error: error?.message || 'Không thể tải chi tiết chương trình' },
      { status: 500 }
    )
  }
}

/**
 * PUT /api/campaigns/[id]
 * Cập nhật thông tin chương trình
 */
export async function PUT(req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params

    if (!id || typeof id !== 'string') {
      return NextResponse.json({ error: 'Mã định danh ID không hợp lệ' }, { status: 400 })
    }

    let body: any
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Dữ liệu JSON không hợp lệ' }, { status: 400 })
    }

    const campaign = await updateCampaign(id, body)
    return NextResponse.json({ campaign }, { status: 200 })
  } catch (error: any) {
    console.error(`API /api/campaigns/[id] PUT error:`, error)

    if (error?.code === 'NOT_FOUND') {
      return NextResponse.json({ error: error.message }, { status: 404 })
    }
    if (error?.code === 'DUPLICATE_CODE') {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }

    return NextResponse.json(
      { error: error?.message || 'Không thể cập nhật chương trình' },
      { status: 400 }
    )
  }
}

/**
 * DELETE /api/campaigns/[id]
 * Xóa hoặc hủy an toàn chương trình (chuyển CANCELLED nếu có ràng buộc)
 */
export async function DELETE(req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params

    if (!id || typeof id !== 'string') {
      return NextResponse.json({ error: 'Mã định danh ID không hợp lệ' }, { status: 400 })
    }

    const { searchParams } = new URL(req.url)
    const force = searchParams.get('force') === 'true'

    const result = await deleteCampaign(id, { force })
    return NextResponse.json(result, { status: 200 })
  } catch (error: any) {
    console.error(`API /api/campaigns/[id] DELETE error:`, error)

    if (error?.code === 'NOT_FOUND') {
      return NextResponse.json({ error: error.message }, { status: 404 })
    }

    return NextResponse.json(
      { error: error?.message || 'Không thể xóa hoặc hủy chương trình' },
      { status: 400 }
    )
  }
}
```

---

## 7. ĐẶC TẢ YÊU CẦU & PHẢN HỒI JSON (API CONTRACTS)

### 7.1. POST `/api/campaigns`

#### Request Payload:
```json
{
  "code": "CP-VULAN-2026",
  "name": "Đại Lễ Vu Lan Báo Hiếu 2026",
  "description": "Ưu đãi 15% cho dòng nến thơm và thạch an nhiên",
  "startDate": "2026-08-15T00:00:00.000Z",
  "endDate": "2026-08-30T23:59:59.000Z",
  "discountPercent": 15,
  "voucherCode": "UUDAM10",
  "appliedProductIds": [
    "cuid_prod_01",
    "cuid_prod_02"
  ],
  "bannerUrl": "https://example.com/banners/vulan.jpg",
  "tags": ["vulan", "uudam", "chualanh"]
}
```

#### Success Response (201 Created):
```json
{
  "campaign": {
    "id": "cuid_camp_123",
    "code": "CP-VULAN-2026",
    "name": "Đại Lễ Vu Lan Báo Hiếu 2026",
    "title": "Đại Lễ Vu Lan Báo Hiếu 2026",
    "description": "Ưu đãi 15% cho dòng nến thơm và thạch an nhiên",
    "startDate": "2026-08-15T00:00:00.000Z",
    "endDate": "2026-08-30T23:59:59.000Z",
    "status": "UPCOMING",
    "discountPercent": 15,
    "discountAmount": null,
    "appliedProductIds": ["cuid_prod_01", "cuid_prod_02"],
    "appliedVoucherIds": [],
    "voucherCode": "UUDAM10",
    "bannerUrl": "https://example.com/banners/vulan.jpg",
    "tags": ["vulan", "uudam", "chualanh"],
    "products": [
      {
        "id": "cuid_prod_01",
        "sku": "UD-QT-002",
        "name": "Hộp Quà Bình An",
        "sellPrice": 450000,
        "campaignPrice": 382500,
        "discountPercent": 15,
        "image": "https://..."
      }
    ],
    "vouchers": [
      {
        "id": "cuid_vouch_01",
        "code": "UUDAM10",
        "title": "Ưu đãi Mừng bạn mới 10%",
        "discountType": "PERCENT",
        "discountValue": 10,
        "maxDiscount": 50000,
        "minOrderAmount": 200000,
        "expiresAt": null
      }
    ],
    "createdAt": "2026-10-26T13:30:00.000Z",
    "updatedAt": "2026-10-26T13:30:00.000Z"
  }
}
```

#### Error Response: Ngày kết thúc trước ngày bắt đầu (400 Bad Request):
```json
{
  "error": "Ngày kết thúc phải diễn ra sau ngày bắt đầu"
}
```

#### Error Response: Trùng mã chương trình (409 Conflict):
```json
{
  "error": "Mã chương trình \"CP-VULAN-2026\" đã tồn tại"
}
```

### 7.2. GET `/api/campaigns`

#### Query Parameters:
- `search`: Chuỗi tìm kiếm (theo tên, mã code, mô tả).
- `status`: `ALL` | `UPCOMING` | `RUNNING` | `ENDED` | `CANCELLED`.
- `productId`: ID sản phẩm để lọc các chương trình áp dụng sản phẩm này.
- `voucherId`: ID voucher liên kết.
- `page`: Số trang (mặc định: 1).
- `pageSize`: Kích thước trang (mặc định: 20, tối đa: 100).

#### Success Response (200 OK):
```json
{
  "campaigns": [ ... ],
  "total": 3,
  "page": 1,
  "pageSize": 20,
  "totalPages": 1
}
```

---

## 8. MA TRẬN KỊCH BẢN KIỂM THỬ (TEST SCENARIOS)

Để Worker kiểm tra toàn diện mã nguồn trước khi tích hợp vào bộ kiểm thử chung (`npm run verify`), cần đảm bảo 100% các kịch bản sau:

### 8.1. Nhóm Kịch Bản Đường Chuẩn (Happy Path)
1. **TC-CAM-01: Tạo chương trình hợp lệ**:
   - Gửi payload với tên hợp lệ, $endDate > startDate$, liên kết 2 sản phẩm và 1 voucher có sẵn.
   - Kỳ vọng: HTTP 201 Created; trường `status` tính đúng theo thời gian hiện tại; các trường `products` và `vouchers` được enrich đầy đủ giá và chiết khấu.
2. **TC-CAM-02: Lấy chi tiết chương trình**:
   - `GET /api/campaigns/[id]`.
   - Kỳ vọng: HTTP 200 OK; kiểm tra Next.js 16 `await params` hoạt động chuẩn xác, không sinh cảnh báo console.
3. **TC-CAM-03: Cập nhật chương trình**:
   - `PUT /api/campaigns/[id]` đổi tên và tăng % chiết khấu từ 15% lên 20%.
   - Kỳ vọng: HTTP 200 OK; `campaignPrice` của các sản phẩm tự động cập nhật xuống mức giảm 20%.
4. **TC-CAM-04: Lọc theo trạng thái**:
   - `GET /api/campaigns?status=UPCOMING` và `GET /api/campaigns?status=RUNNING`.
   - Kỳ vọng: Trả về chính xác các chương trình có thời gian tương ứng.

### 8.2. Nhóm Kịch Bản Đối Kháng & Ranh Giới (Adversarial & Boundary Tests)
5. **TC-CAM-05: Chặn $endDate < startDate$**:
   - Gửi `startDate: "2026-08-30"` và `endDate: "2026-08-15"`.
   - Kỳ vọng: HTTP 400 Bad Request; thông điệp `"Ngày kết thúc phải diễn ra sau ngày bắt đầu"`.
6. **TC-CAM-06: Chặn $endDate == startDate$**:
   - Gửi `startDate: "2026-08-15T10:00:00.000Z"` và `endDate: "2026-08-15T10:00:00.000Z"`.
   - Kỳ vọng: HTTP 400 Bad Request; không cho phép tạo chiến dịch 0 giây.
7. **TC-CAM-07: Chặn thiếu Tên / Tiêu đề**:
   - Gửi payload không có `name` hoặc `title` rỗng `""`.
   - Kỳ vọng: HTTP 400 Bad Request; thông điệp `"Vui lòng nhập tên chương trình"`.
8. **TC-CAM-08: Chặn trùng mã Code**:
   - Tạo chiến dịch 1 với `code: "CP-TEST-DUP"`.
   - Tạo tiếp chiến dịch 2 với cùng `code: "CP-TEST-DUP"`.
   - Kỳ vọng: HTTP 409 Conflict; không ghi đè hay sinh lỗi 500 SQLite constraint error.
9. **TC-CAM-09: Kiểm thử ranh giới thời gian (Mốc biên R1)**:
   - Tạo chiến dịch có $T_{start}$ và $T_{end}$.
   - Dùng hàm `computeCampaignStatus(campaign, now)` kiểm tra:
     - Tại $T_{start} - 60\,\text{s}$: Trả về `UPCOMING`.
     - Tại $T_{start} - 1\,\text{ms}$: Trả về `UPCOMING`.
     - Tại đúng $T_{start}$: Trả về `RUNNING`.
     - Tại đúng $T_{end}$: Trả về `RUNNING`.
     - Tại $T_{end} + 1\,\text{ms}$: Trả về `ENDED`.
     - Tại $T_{end} + 60\,\text{s}$: Trả về `ENDED`.
   - Kỳ vọng: Khớp 100% tiêu chí nghiệm thu R1.
10. **TC-CAM-10: Chặn xóa cứng khi đang có liên kết hoặc đang chạy**:
    - Gọi `DELETE /api/campaigns/[id]` trên chiến dịch đang ở trạng thái `RUNNING`.
    - Kỳ vọng: HTTP 200 OK với `action: 'CANCELLED'`; bản ghi vẫn được lưu trong DB với `status: 'CANCELLED'`.
11. **TC-CAM-11: Tự dọn sạch dữ liệu kiểm thử (Clean Teardown)**:
    - Mọi bản ghi test tạo ra trong script kiểm thử phải có tiền tố `CP-TEST-` và được xóa sạch sau khi hoàn tất.
    - Đối soát 24 bảng baseline trong `db/baseline-counts.json` giữ nguyên 100%.

---

## 9. KHUYẾN NGHỊ THỰC HIỆN CHO WORKER M1

1. **Thứ tự thực thi**:
   - Bước 1: Phối hợp cùng `explorer_m1_db_safety` để đảm bảo WAL checkpoint và backup `custom.db.bak.pre-autosocial` đã sẵn sàng.
   - Bước 2: Bổ sung model `Campaign` vào `prisma/schema.prisma` và chạy `npx prisma db push`.
   - Bước 3: Tạo mới file `src/lib/campaign-service.ts` theo đúng đặc tả mục 5.
   - Bước 4: Tạo mới file `src/app/api/campaigns/route.ts` theo mục 6.1.
   - Bước 5: Tạo mới file `src/app/api/campaigns/[id]/route.ts` theo mục 6.2 (nhớ `await params`).
   - Bước 6: Chạy script kiểm thử độc lập `scripts/verify-m1-campaigns.ts` và kiểm tra `tsc --noEmit`.
2. **Ghi chú về kiểu dữ liệu**:
   - Do Prisma Client được sinh lại sau khi thêm model `Campaign`, cần chạy `npx prisma generate` để TypeScript nhận diện `db.campaign`.
3. **An toàn kiểm toán**:
   - Mọi thao tác thay đổi trạng thái chiến dịch đều được ghi vào `db.ledgerEntry` thông qua `logLedger` và phát sóng realtime qua `broadcast('settings.updated')`.
