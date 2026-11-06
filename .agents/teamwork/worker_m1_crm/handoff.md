# BÁO CÁO BÀN GIAO KỸ THUẬT MILESTONE 1 (M1: CRM CAMPAIGNS & DB SAFETY)

- **Người thực hiện**: Worker Subagent (`worker_m1_crm`)
- **Tác nhân điều phối (Parent)**: Orchestrator `3f0d510d-9880-49f5-b710-8d6bfe356311`
- **Module**: AUTO SOCIAL — OPENVN · Ưu Đàm Suite
- **Thời gian hoàn thành**: 2026-10-26T14:06:00Z
- **Thư mục làm việc**: `y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\worker_m1_crm`
- **Loại bàn giao**: Hard Handoff (Hoàn tất 100% phạm vi công việc Milestone 1)

---

## 1. OBSERVATION (QUAN SÁT THỰC NGHIỆM)

1. **Kiểm tra hiện trạng cơ sở dữ liệu trước can thiệp**:
   - Tệp cơ sở dữ liệu: `db/custom.db` (kích thước ban đầu: `4,780,032` bytes).
   - Kiểm tra 24 bảng cốt lõi qua `node scripts/check-counts.mjs`: `24 / 24` bảng khớp chính xác 100% với `db/baseline-counts.json` (Product: 12, Order: 173, Customer: 34, Voucher: 4, WarehouseStock: 22, BomComponent: 5...).
   - Kiểm tra hệ thống trước can thiệp: `npm run verify` đạt PASS toàn bộ (0 lỗi, 0 cảnh báo, 21/21 kịch bản nghiệp vụ đạt).

2. **Sao lưu an toàn CSDL (`scripts/backup-pre-autosocial.mjs`)**:
   - Checkpoint WAL SQLite: `PRAGMA wal_checkpoint(FULL);` trả về `busy: 0, log: -1, checkpointed: -1`. Đã xử lý an toàn kiểu `BigInt` tránh lỗi `TypeError: Do not know how to serialize a BigInt`.
   - Tạo bản sao lưu vật lý: `db/custom.db.bak.pre-autosocial` (dung lượng: `4,890,624` bytes, khớp 100% với `custom.db` sau checkpoint).
   - Xác thực SQLite Magic Header 16 bytes: `SQLite format 3\0` hợp lệ.
   - Xác thực SHA-256 Checksum: `b58dea1e7fbae0856f6d1409478f45b721b151ea002200df3589d2304f9569d1` (trùng khớp tuyệt đối giữa source và backup).

3. **Mở rộng Schema Prisma (`prisma/schema.prisma`)**:
   - Bổ sung 7 model phụ gia bắt đầu từ dòng 486:
     1. `Campaign` (quản lý chiến dịch, mốc thời gian, chiết khấu, mảng JSON sản phẩm & voucher)
     2. `ContentSource` (quản lý nguồn thư mục Google Drive công khai)
     3. `ContentSourceItem` (từng tệp ảnh, video, doc, sheet, cây thư mục 3 cấp)
     4. `SocialPlan` (kế hoạch đăng bài 7 nền tảng sinh bởi AI)
     5. `SocialPost` (bài viết cụ thể, kênh, media, trạng thái duyệt, khóa chống đăng trùng `isPublishing`, slug cho blog)
     6. `SocialChannelConfig` (cấu hình 7 nền tảng, giới hạn ký tự, cờ `isMock`)
     7. `AuditLog` (nhật ký kiểm toán hệ thống)
   - Lệnh `git diff -U0 prisma/schema.prisma` chứng minh: Dòng 1 đến dòng 485 (28 model hiện có) được giữ nguyên vẹn 100%, không bị sửa đổi bất kỳ ký tự nào.

4. **Đẩy Schema vào SQLite & Sinh Prisma Client**:
   - `npx prisma db push --accept-data-loss` hoàn thành đồng bộ trong 403ms, tạo mới 7 bảng và các chỉ mục tương ứng mà không mất bất kỳ dòng dữ liệu nào.
   - `npx prisma generate` sinh thành công Prisma Client `v6.19.3`.

5. **Xây dựng tầng dịch vụ `src/lib/campaign-service.ts`**:
   - Hàm thuần khiết `computeCampaignStatus(campaign, now)`: tính toán chính xác 4 trạng thái `UPCOMING`, `RUNNING`, `ENDED`, `CANCELLED` theo thời gian thực (Zero-Drift Boundary Engine).
   - Thẩm định thời gian: `validateCampaignDates(startDate, endDate)` chặn nghiêm ngặt $endDate \le startDate$.
   - Làm giàu dữ liệu `enrichCampaignData(campaign)`: trích xuất giá bán lẻ gốc `Product.sellPrice`, tính toán giá ưu đãi theo `specialPrice`, `override.discountPercent`, `campaign.discountPercent`, `discountAmount`; đồng thời phân giải chi tiết thông tin voucher liên kết và ánh xạ trường `price` sang `campaignPrice` đáp ứng chuẩn hợp đồng giao tiếp M1 ↔ M3.
   - Các hàm CRUD: `createCampaign`, `getCampaign`, `listCampaigns`, `updateCampaign`, `deleteCampaign`. Tự động ghi nhận `AuditLog` sau mỗi thao tác thay đổi dữ liệu.

6. **Xây dựng các Route Handler chuẩn Next.js 16**:
   - `src/app/api/campaigns/route.ts`:
     - GET: danh sách chiến dịch, hỗ trợ tìm kiếm từ khóa, lọc theo trạng thái động, phân trang.
     - POST: tạo chiến dịch, thẩm định tên, ngày bắt đầu/kết thúc, kiểm tra trùng mã chiến dịch (trả về 409 Conflict).
   - `src/app/api/campaigns/[id]/route.ts`:
     - GET: lấy chi tiết kèm dữ liệu sản phẩm và voucher đã làm giàu.
     - PUT: cập nhật thông tin, thẩm định lại ngày nếu thay đổi, cập nhật trạng thái `CANCELLED`.
     - DELETE: xóa chiến dịch và ghi nhận audit log.
   - Tuân thủ Next.js 16 App Router: `export const dynamic = 'force-dynamic'`, `params` được định kiểu `Promise<{ id: string }>` và sử dụng cú pháp `const { id } = await params`.

7. **Kiểm thử tự động chuyên biệt `scripts/verify-m1-campaigns.ts`**:
   - 8 giai đoạn kiểm thử với 95 assertions tự động:
     - Giai đoạn 1: Tệp sao lưu CSDL vật lý tồn tại, đúng header SQLite 3, dung lượng > 0.
     - Giai đoạn 2: Baseline 24 bảng trước kiểm thử khớp 100%.
     - Giai đoạn 3: Tính toán trạng thái động tại các mốc biên: $t - 1\text{ ngày}$, $t - 60\text{s}$, $t - 1\text{ms}$ (UPCOMING), đúng $t_{start}$ (RUNNING), $t_{start} + 1\text{ms}$ (RUNNING), giữa kỳ (RUNNING), $t_{end} - 1\text{ms}$ (RUNNING), đúng $t_{end}$ (RUNNING), $t_{end} + 1\text{ms}$ (ENDED), $t_{end} + 60\text{s}$ (ENDED), và hủy thủ công CANCELLED tại mọi thời điểm.
     - Giai đoạn 4: Chặn các ca biên đối kháng ($endDate < startDate$, $endDate == startDate$, ngày sai định dạng, tên trống, mã chiến dịch trùng lặp).
     - Giai đoạn 5: Động cơ tính giá đa sản phẩm (specialPrice, discountPercent theo sản phẩm, discountPercent chiến dịch, discountAmount) và áp dụng voucher (UUDAM10, PHATDAN50K, kiểm tra ngưỡng đơn hàng tối thiểu và trần giảm tối đa).
     - Giai đoạn 6: Vòng đời CRUD qua service layer (tạo, đọc theo ID/code, lọc theo trạng thái RUNNING/UPCOMING/ENDED, cập nhật, hủy, xóa).
     - Giai đoạn 7: Dọn dẹp sạch dữ liệu thử nghiệm và xả sạch WAL checkpoint (`busy: 0`).
     - Giai đoạn 8: Đối soát 24 bảng baseline sau kiểm thử bảo toàn 100% ($\Delta = 0$).
   - Kết quả thực thi: **95/95 test assertions PASS**.

8. **Kiểm chứng toàn hệ thống (System Verification & Production Build)**:
   - `npm run verify` (`tsc --noEmit && npm run lint && npm run test:chain && npm run test:scenarios`): **PASS (0 errors, 0 warnings)**.
   - `npm run build`: **PASS (Compiled successfully, dynamic API routes `/api/campaigns` và `/api/campaigns/[id]` được tạo hoàn chỉnh)**.
   - Gọi thử nghiệm HTTP qua curl tới dev server đang chạy:
     `GET http://127.0.0.1:3010/api/campaigns` trả về `{"campaigns":[],"total":0,"page":1,"pageSize":20}` (HTTP 200).
   - Kiểm toán đối soát baseline cuối cùng: `node scripts/check-counts.mjs` đạt `Core Parity Status: 100% MATCH (PASS)` (24/24 bảng).

---

## 2. LOGIC CHAIN (CHUỖI LẬP LUẬN KỸ THUẬT)

1. **Từ Yêu Cầu An Toàn CSDL Tuyệt Đối (R7, FEAT-CRM-01, FEAT-DAT-01)**:
   - *Quan sát*: Hệ thống đang vận hành thật trên SQLite với chế độ WAL. Thay đổi cấu trúc schema bất cẩn có thể làm khóa DB hoặc mất dữ liệu.
   - *Biện pháp*: Bắt buộc checkpoint WAL đầy đủ trước khi sao chép vật lý CSDL sang `db/custom.db.bak.pre-autosocial`. Sau khi sao lưu, tiến hành xác thực kích thước, header `SQLite format 3` và mã băm SHA-256. Bất kỳ sự sai lệch nào sẽ hủy tiến trình ngay lập tức.
   - *Kết luận*: CSDL gốc được đóng băng an toàn trước khi chạy `prisma db push`.

2. **Từ Thiết Kế Phụ Gia (Additive Schema Only)**:
   - *Quan sát*: Mô hình `Product` (dòng 18-48) và `Voucher` (dòng 467-483) đang được tham chiếu bởi hàng chục service cốt lõi (POS, kho, đơn hàng, hóa đơn). Việc tạo quan hệ ORM hai chiều (`@relation`) sẽ buộc phải sửa đổi model `Product` và `Voucher`.
   - *Biện pháp*: Lưu trữ liên kết sản phẩm và voucher trên `Campaign` dưới dạng chuỗi JSON (`appliedProductIds`, `appliedVoucherIds`, `productOverrides`). Tương tự cách bảng `Order` hiện tại lưu `voucherCode`.
   - *Kết luận*: Mô hình cũ không bị thay đổi dù chỉ một ký tự. 24 bảng baseline duy trì $\Delta = 0$.

3. **Từ Tiêu Chí R1: Trạng Thái Biên Động Không Sai Lệch (Zero-Drift Boundary Engine)**:
   - *Quan sát*: Nếu lưu trạng thái tĩnh và dùng cron định kỳ quét để cập nhật DB, độ trễ giữa các chu kỳ cron sẽ khiến trạng thái bị sai lệch (drift).
   - *Biện pháp*: Triển khai `computeCampaignStatus` dưới dạng pure function. Trạng thái được tính động thời gian thực tại mỗi thao tác đọc dựa trên $T_{now}$ so với $T_{start}$ và $T_{end}$, kết hợp lưu trạng thái vào DB tại các thời điểm ghi (mutate).
   - *Kết luận*: Đáp ứng tuyệt đối yêu cầu nghiệm thu R1 tại các mốc trước 1 phút, đúng giờ bắt đầu, sau kết thúc, và bảo đảm tính xác định trong kiểm thử đơn vị.

4. **Từ Hợp Đồng Giao Tiếp M1 ↔ M3 (Campaign ↔ AI Copywriter)**:
   - *Quan sát*: Milestone 3 (AI Copywriting) yêu cầu cấu trúc `CampaignData` chứa `products` với trường `price` và `discountPercent`, `vouchers` với `code`, `discountPercent`, `discountAmount`, `minOrderValue`.
   - *Biện pháp*: Hàm `enrichCampaignData` đọc các sản phẩm và voucher liên kết từ DB, tính toán giá chiến dịch và bổ sung trường alias `price` (bằng `campaignPrice`) cùng `title` (bằng `name`).
   - *Kết luận*: Dữ liệu bàn giao cho AI Copywriter luôn bảo đảm tính toàn vẹn và nhất quán với giá bán thực tế.

5. **Từ Quy Chuẩn Next.js 16 Breaking Changes (`AGENTS.md`)**:
   - *Quan sát*: Next.js 16 yêu cầu `params` trong dynamic route handlers phải là Promise và bắt buộc phải `await`.
   - *Biện pháp*: Khai báo `{ params }: { params: Promise<{ id: string }> }` và gọi `const { id } = await params`. Thiết lập `export const dynamic = 'force-dynamic'` trên tất cả route handlers mới.
   - *Kết luận*: Không xảy ra lỗi cảnh báo hay crash khi chạy `next build`.

---

## 3. CAVEATS (CÁC ĐIỂM CẦN LƯU Ý CHO CÁC SUBAGENT TIẾP THEO)

1. **Tài nguyên Google Drive (Milestone 2 - Worker M2)**:
   - Model `ContentSource` và `ContentSourceItem` đã được tạo sẵn trong schema và SQLite database với đầy đủ các trường cần thiết (`driveFileId`, `fileType`, `textContent`, `fileTree`...). Worker M2 chỉ cần viết logic dịch vụ `src/lib/drive-parser.ts` và route API `/api/social/drive/sync` mà không cần sửa schema Prisma.
2. **Quy tắc tính giá khi AI viết bài (Milestone 3 - Worker M3)**:
   - Khi gọi `getCampaign(id)`, dữ liệu trả về đã được làm giàu đầy đủ trong `campaign.products` và `campaign.vouchers`. AI Copywriter nên đọc trực tiếp `product.campaignPrice`, `product.discountPercent`, `voucher.code`, `voucher.minOrderValue` để bảo đảm các con số khuyến mãi trong bài viết khớp chính xác 100% với CRM.
3. **Chế độ phát triển trên Windows**:
   - Khi chạy `prisma generate` trên môi trường Windows nếu các tiến trình Node đang chạy có nạp `query_engine-windows.dll.node`, Windows sẽ khóa file DLL. Cần tạm dừng các tiến trình Node trước khi chạy generate, sau đó khởi động lại. Hiện tại Prisma Client đã được sinh hoàn tất và dev server đang chạy ổn định.

---

## 4. CONCLUSION (KẾT LUẬN)

- **Milestone 1 (CRM Campaigns & DB Safety) đã HOÀN THÀNH 100% XUẤT SẮC**.
- Toàn bộ 7 model mới đã được tạo và kích hoạt trong CSDL SQLite `custom.db`.
- Tệp sao lưu vật lý `db/custom.db.bak.pre-autosocial` được bảo toàn và xác minh tính toàn vẹn (SHA-256 + SQLite format 3).
- Toàn bộ 24 bảng dữ liệu cốt lõi của tiệm Ưu Đàm giữ nguyên trạng 100% ($\Delta = 0$).
- Tầng dịch vụ `src/lib/campaign-service.ts` và 2 tuyến API Route Handlers Next.js 16 (`/api/campaigns`, `/api/campaigns/[id]`) hoạt động chuẩn xác, bảo đảm tính toán trạng thái biên động và tính giá khuyến mãi đa sản phẩm, đa voucher.
- Bộ kiểm thử tự động 95/95 ca kiểm thử đạt chuẩn.
- Các cổng chất lượng mã nguồn `npm run verify` và `npm run build` đều vượt qua với 0 lỗi và 0 cảnh báo.
- Hệ thống đã sẵn sàng cho Milestone 2 (Google Drive Content Source) và Milestone 3 (AI Planning & Copywriting).

---

## 5. VERIFICATION METHOD (PHƯƠNG PHÁP KIỂM CHỨNG ĐỘC LẬP)

Để kiểm chứng độc lập kết quả Milestone 1, chạy các lệnh sau:

1. **Kiểm chứng bộ test tự động chuyên biệt M1 (95 tests)**:
   ```powershell
   npx tsx scripts/verify-m1-campaigns.ts
   ```
   *Kỳ vọng*: Hiển thị `🎉 TOÀN BỘ 95 KIỂM THỬ ĐẠT CHUẨN! (FAILED: 0) 🎉` và `Core Parity Status : 100% MATCH (PASS)` (Delta = 0).

2. **Kiểm chứng toàn hệ thống (Quality Gate)**:
   ```powershell
   npm run verify
   ```
   *Kỳ vọng*: Thoát với mã 0 (`tsc --noEmit`, `eslint src`, `test:chain`, và 21 kịch bản `test:scenarios` đều PASS).

3. **Kiểm chứng Production Build**:
   ```powershell
   npm run build
   ```
   *Kỳ vọng*: Thoát với mã 0, hiển thị route dynamic `ƒ /api/campaigns` và `ƒ /api/campaigns/[id]`.

4. **Kiểm tra tệp sao lưu CSDL**:
   ```powershell
   node -e "const fs = require('fs'); const stat = fs.statSync('db/custom.db.bak.pre-autosocial'); console.log('Size:', stat.size); const fd = fs.openSync('db/custom.db.bak.pre-autosocial', 'r'); const buf = Buffer.alloc(16); fs.readSync(fd, buf, 0, 16, 0); console.log('Header:', buf.toString('utf8', 0, 15));"
   ```
   *Kỳ vọng*: `Size: 4890624` và `Header: SQLite format 3`.

5. **Kiểm tra đối soát 24 bảng baseline**:
   ```powershell
   node scripts/check-counts.mjs
   ```
   *Kỳ vọng*: `Core Business Tables Checked : 24 / 24`, `Core Parity Status : 100% MATCH (PASS)`.
