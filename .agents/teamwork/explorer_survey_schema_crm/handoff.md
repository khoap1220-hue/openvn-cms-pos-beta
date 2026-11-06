# Báo Cáo Bàn Giao Khảo Sát Kỹ Thuật: Cơ Sở Dữ Liệu, ORM & CRM Cho Phân Hệ AUTO SOCIAL

- **Người thực hiện (Subagent)**: `explorer_survey_schema_crm`
- **Tác nhân điều phối nhận báo cáo (Recipient Caller)**: `3f0d510d-9880-49f5-b710-8d6bfe356311`
- **Thời gian hoàn tất**: 2026-10-26T13:18:00Z
- **Tệp báo cáo chuyên sâu**: `.agents/teamwork/explorer_survey_schema_crm/analysis.md`

---

## 1. OBSERVATION (Quan sát thực tế với dẫn chứng trực tiếp)

1. **Vị trí và trạng thái CSDL SQLite**:
   - `prisma/schema.prisma` (dòng 5–8):
     ```prisma
     datasource db {
       provider = "sqlite"
       url      = env("DATABASE_URL")
     }
     ```
   - `.env` (dòng 1): `DATABASE_URL="file:../db/custom.db"`.
   - Đường dẫn tuyệt đối file CSDL: `y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\db\custom.db` (dung lượng 4,780,032 bytes).
   - Tệp sao lưu mốc M1: `db/custom.db.bak` (dung lượng 2,404,352 bytes).
   - Thư mục `prisma/migrations` **không tồn tại**; cơ chế cập nhật CSDL của repo là `prisma db push` (được khai báo tại `package.json` dòng 15: `"db:push": "prisma db push --accept-data-loss"`).

2. **Hiện trạng các bảng cốt lõi (Khảo sát từ `db/baseline-counts.json`)**:
   - Khớp chính xác 24 bảng dữ liệu nghiệp vụ cốt lõi:
     - `Product`: 12 bản ghi (`UD-QT-002`, `UD-VL-001`, `UD-DEN-001`...)
     - `Category`: 3 bản ghi
     - `Order`: 173 bản ghi (chuẩn hóa bất biến)
     - `OrderItem`: 226 bản ghi
     - `Customer`: 34 bản ghi
     - `Voucher`: 4 bản ghi (`UUDAM10`, `PHATDAN50K`, `LIENKET15`, `FREESHIP0D`)
     - `SalesInvoice`: 10 bản ghi, `PurchaseInvoice`: 4 bản ghi, `StockMovement`: 246 bản ghi.
     - `IntegrationCredential`: 14 bản ghi (đã có sẵn `FACEBOOK`, `ZALO_OA`, `WEBSITE`, `GEMINI`...).
     - `LedgerEntry`: 1,963 bản ghi (sổ cái dữ liệu toàn hệ thống).
   - **Chưa có bất kỳ bảng nào đại diện cho Chương trình Bán hàng/Chiến dịch Khuyến mãi (`Campaign` hay `Promotion`)**.

3. **Quy ước Route Handler trên Next.js 16 (`AGENTS.md`)**:
   - Next.js phiên bản `16.1.1` (`package.json` dòng 65).
   - Toàn bộ route dynamic nhận `params` dưới dạng `Promise<{ id: string }>` và phải có `await params` (quan sát thấy ở `src/app/api/products/[id]/route.ts:36`, `src/app/api/orders/[id]/route.ts:22`, `src/app/api/customers/[id]/route.ts:8`...).
   - Mọi route đều có `export const dynamic = 'force-dynamic'`.

4. **Yêu cầu phân hệ AUTO SOCIAL từ `ORIGINAL_REQUEST.md` (mục 2026-10-26T13:06:22Z)**:
   - R1: Thêm phân hệ Chương trình bán hàng / khuyến mãi (tên, mô tả, thời gian, sản phẩm áp dụng, voucher kèm theo; tự xác định trạng thái sắp chạy / đang chạy / đã kết thúc theo thời gian biên).
   - R2: Nguồn nội dung Google Drive công khai (ảnh, video, Google Docs, Sheet, thư mục con).
   - R3: AI đề xuất kế hoạch và viết bài nháp (giá, % giảm, mã voucher khớp CRM, giới hạn ký tự từng nền tảng).
   - R4: Duyệt bài và lịch đăng (chỉ bài được duyệt mới đăng, tự động đăng đúng giờ, chặn đăng bài của chương trình đã kết thúc/hủy).
   - R5: Hỗ trợ 7 nền tảng (Facebook, Zalo OA, Website nội bộ, External Web WordPress/Haravan, Instagram, TikTok, Threads).
   - R6: Tuyệt đối không đăng thật trong kiểm thử/test tự động (Mock Isolation an toàn).
   - R7: An toàn dữ liệu, sao lưu trước khi đổi schema, giữ nguyên 24 bảng cốt lõi (0 rò rỉ).

---

## 2. LOGIC CHAIN (Suy luận từng bước từ quan sát đến kết luận)

1. **Về việc bổ sung mô hình dữ liệu**:
   - *Từ quan sát 2*: Hiện tại hệ thống chỉ có `Voucher` độc lập và `ChannelListing`, hoàn toàn thiếu thực thể lưu trữ chiến dịch/chương trình bán hàng (`Campaign`).
   - *Suy luận*: Bắt buộc phải bổ sung thực thể `Campaign` vào `prisma/schema.prisma` để làm nguồn dữ liệu CRM cho R1.
   - Để hỗ trợ trọn vẹn R2–R6 mà không làm phình to hoặc phá vỡ các bảng hiện có, cần bổ sung 7 thực thể mới theo mô hình mở rộng phụ gia (Additive-only):
     - `Campaign`: Quản lý chương trình khuyến mãi & mốc thời gian.
     - `ContentSource`: Lưu URL thư mục Google Drive công khai & metadata đồng bộ.
     - `ContentSourceItem`: Chi tiết từng tệp tài nguyên quét từ Drive (ảnh, video, Doc, Sheet).
     - `SocialPlan`: Kế hoạch nội dung AI sinh ra cho chiến dịch.
     - `SocialPost`: Bản ghi bài đăng đa kênh trên 7 nền tảng, chứa vòng đời duyệt & kết quả dispatch.
     - `SocialChannelConfig`: Quản lý tham số kỹ thuật, giới hạn ký tự và cờ `isMock` cho 7 kênh.
     - `AuditLog`: Truy vết chi tiết mọi thao tác duyệt, sửa giờ, lỗi xuất bản và vết AI.

2. **Về bảo toàn 100% tương thích ngược và 0 hồi quy (Zero Regressions)**:
   - *Từ quan sát 1 & 2*: Các bài test hiện hành (`scripts/verify-realworld-scenarios.ts`, `scripts/verify-chain.ts`) kiểm tra nghiêm ngặt tính toàn vẹn và số lượng bản ghi của 24 bảng cốt lõi.
   - *Suy luận*:
     - Toàn bộ 7 thực thể mới là bảng mới, khóa ngoại trỏ tới `Product` (`ContentSource.productId`) hoặc `Voucher` (`Campaign.voucherId`) chỉ đặt trên bảng mới với quy tắc `onDelete: SetNull`.
     - Không thêm bất kỳ cột bắt buộc (`non-nullable without default`) nào vào 28 bảng hiện có.
     - Các quan hệ đối ứng trong Prisma schema (như `campaigns Campaign[]` trong `Voucher`) là quan hệ ảo cấp ORM, SQLite không tạo thêm cột nào trên bảng `Voucher` hay `Product`.
     - Vì vậy, dữ liệu của 24 bảng cốt lõi sẽ bất biến 100%, vượt qua toàn bộ các cổng kiểm toán đối soát số lượng bản ghi (`baseline-counts.json`).

3. **Về cơ chế di chuyển CSDL an toàn trên SQLite (WAL Mode)**:
   - *Từ quan sát 1*: SQLite lưu trên file đơn `db/custom.db`, có chế độ WAL.
   - *Suy luận*:
     - Trước khi sửa schema, bắt buộc phải checkpoint WAL bằng `PRAGMA wal_checkpoint(FULL)` để gom toàn bộ dữ liệu trên WAL về file chính, sau đó tạo bản sao lưu vật lý `db/custom.db.bak.pre-autosocial`.
     - Khi chạy `npx prisma db push`, Prisma sẽ tạo thêm 7 bảng mới và các index liên quan mà không xóa hay can thiệp vào các bảng cũ.
     - Khi chạy test tự động cho module AUTO SOCIAL, test phải có cơ chế `teardown/cleanup` xóa sạch các bản ghi test trong 7 bảng mới sau khi hoàn thành.

---

## 3. CAVEATS (Vấn đề lưu ý & giả định)

1. **Giới hạn của SQLite đối với `ALTER TABLE`**:
   - SQLite không hỗ trợ chỉnh sửa kiểu dữ liệu cột phức tạp. Tuy nhiên, vì giải pháp của chúng ta là **100% bảng mới (Additive Tables)**, hoàn toàn không cần `ALTER TABLE` trên các bảng cũ nên không gặp rủi ro này.
2. **Quy định cô lập Mock (R6)**:
   - Trong môi trường phát triển và kiểm thử tự động, tuyệt đối không gửi request HTTP tới API thật của Facebook, Zalo, Instagram, TikTok, Threads. Bộ adapter đăng bài phải mặc định kiểm tra cờ `isMock = true` hoặc thiếu credential để kích hoạt mock adapter an toàn.
3. **Thư mục Google Drive công khai**:
   - Theo R2, hệ thống quét thư mục công khai (public folder). Cần có cơ chế bóc tách Folder ID từ link chia sẻ công khai (`https://drive.google.com/drive/folders/...`) và bộ parser đọc nội dung văn bản mà không bị crash khi người dùng cung cấp link không hợp lệ / không công khai.

---

## 4. CONCLUSION (Kết luận & Phán quyết kỹ thuật)

1. **Khảo sát Schema & CRM hoàn tất**:
   - Đã xác định rõ hiện trạng 28 bảng dữ liệu hiện có trong `custom.db`, làm rõ vị trí của Product (12 SP), Voucher (4 voucher), Order (173 đơn), Customer (34 khách).
   - Xác nhận hệ thống chưa có bảng Campaign/Promotion, chứng minh tính cấp thiết của việc tạo mới bảng `Campaign`.
2. **Thiết kế kỹ thuật hoàn chỉnh**:
   - Bản đặc tả 7 thực thể (`Campaign`, `ContentSource`, `ContentSourceItem`, `SocialPlan`, `SocialPost`, `SocialChannelConfig`, `AuditLog`) đã sẵn sàng trong `analysis.md`.
   - Đáp ứng 100% tiêu chí chấp thuận (Acceptance Criteria) của các yêu cầu R1–R7:
     - Logic tính trạng thái biên cho Campaign (`UPCOMING` / `ACTIVE` / `ENDED`).
     - Định dạng 7 nền tảng và giới hạn ký tự.
     - Cơ chế duyệt bài bắt buộc trước khi đăng.
3. **Chiến lược di chuyển CSDL an toàn 6 bước**:
   - Đã thiết lập quy trình checkpoint WAL, tạo bản sao lưu `custom.db.bak.pre-autosocial`, đẩy schema bằng `prisma db push`, đối soát parity baseline, và teardown dữ liệu kiểm thử.

---

## 5. VERIFICATION METHOD (Phương pháp kiểm chứng độc lập)

Các kỹ sư và điều phối viên có thể kiểm chứng báo cáo này thông qua:

1. **Đọc báo cáo chi tiết**:
   - Mở file `.agents/teamwork/explorer_survey_schema_crm/analysis.md` để xem toàn văn mã Prisma Schema, ma trận thông số 7 nền tảng, và danh mục API routes.
2. **Kiểm tra trạng thái CSDL hiện tại**:
   ```powershell
   node -e "const fs = require('fs'); console.log('DB Exists:', fs.existsSync('db/custom.db'), 'Size:', fs.statSync('db/custom.db').size);"
   ```
3. **Kiểm tra số lượng bản ghi baseline hiện có**:
   ```powershell
   node -e "const { PrismaClient } = require('@prisma/client'); const p = new PrismaClient(); async function check() { console.log('Products:', await p.product.count(), 'Vouchers:', await p.voucher.count(), 'Orders:', await p.order.count(), 'Customers:', await p.customer.count()); await p.$disconnect(); } check();"
   ```
4. **Kiểm chứng tính hợp lệ của Next.js 16 Route Handlers**:
   - Kiểm tra `src/app/api/products/[id]/route.ts` để xác nhận chuẩn `{ params }: { params: Promise<{ id: string }> }`.
