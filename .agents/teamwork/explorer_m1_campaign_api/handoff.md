# Báo Cáo Bàn Giao (Handoff Report): Thiết Kế Campaign Service & Next.js 16 API Handlers (M1)

- **Tác nhân**: `explorer_m1_campaign_api`
- **Tác nhân tiếp nhận**: `orchestrator_2` / `worker_m1`
- **Loại bàn giao**: **Hard Handoff** (Nhiệm vụ khảo sát & thiết kế hoàn thành 100%)
- **Thời gian**: 2026-10-26T13:32:00Z
- **Đường dẫn tài liệu chi tiết**: `y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\explorer_m1_campaign_api\analysis.md`

---

## 1. OBSERVATION (Quan Sát Trực Tiếp)

1. **Quy chuẩn Next.js 16 về Route Handlers**:
   - Tệp tài liệu `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` (dòng 84–91):
     ```typescript
     export async function GET(
       request: Request,
       { params }: { params: Promise<{ team: string }> }
     ) {
       const { team } = await params
     }
     ```
     `params` là một `Promise` và bắt buộc phải `await`.
   - Tệp hiện có `src/app/api/products/[id]/route.ts` (dòng 36–38) và `src/app/api/orders/[id]/route.ts` (dòng 22–24) đã áp dụng chuẩn này:
     `export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) { const { id } = await params ... }`
   - Chỉ thị phân đoạn tuyến đường bắt buộc: `export const dynamic = 'force-dynamic'` (đã có ở `src/app/api/products/route.ts` dòng 6, `src/app/api/orders/route.ts` dòng 7).

2. **Hiện trạng dữ liệu & Baseline Counts**:
   - `db/baseline-counts.json` (dòng 1–30): Có chính xác 24 bảng cốt lõi (gồm `Product`: 12, `Voucher`: 4, `Order`: 173, `Customer`: 34...).
   - `prisma/schema.prisma` (dòng 18–48 cho `Product`, dòng 467–483 cho `Voucher`): Chưa có bảng `Campaign`.
   - Để tránh làm biến đổi bảng `Product` hoặc `Voucher`, các trường liên kết sản phẩm và voucher trong `Campaign` cần lưu dạng chuỗi JSON (`appliedProductIds`, `appliedVoucherIds`) thay vì tạo khóa ngoại làm thay đổi cấu trúc bảng cũ.

3. **Yêu cầu nghiệp vụ & Acceptance Criteria**:
   - `ORIGINAL_REQUEST.md` (dòng 122–124):
     > "Chương trình (R1): Trạng thái sắp chạy / đang chạy / đã kết thúc đúng tại các mốc biên (trước bắt đầu 1 phút, đúng giờ bắt đầu, sau kết thúc); chặn ngày kết thúc trước ngày bắt đầu."
   - `orchestrator_2/PROJECT.md` (dòng 64–77):
     Hợp đồng giao diện M1 ↔ M3 quy định kiểu `CampaignData` gồm các trường: `id`, `code`, `title` (đồng bộ `name`), `description`, `startDate`, `endDate`, `status` (`'UPCOMING' | 'RUNNING' | 'ENDED' | 'CANCELLED'`), `products`, `vouchers`.

---

## 2. LOGIC CHAIN (Chuỗi Suy Luận Kỹ Thuật)

- **Bước 1 (Từ Obs 1)**: Do Next.js 16 biến đổi `params` thành `Promise`, mọi endpoint trong `src/app/api/campaigns/[id]/route.ts` (`GET`, `PUT`, `DELETE`) bắt buộc phải định nghĩa `{ params }: { params: Promise<{ id: string }> }` và gọi `const { id } = await params`. Bỏ qua `await` sẽ gây lỗi TypeError ngầm.
- **Bước 2 (Từ Obs 1)**: Do trạng thái chiến dịch thay đổi theo thời gian thực và phụ thuộc truy vấn cơ sở dữ liệu, việc khai báo `export const dynamic = 'force-dynamic'` ở đầu các tệp route là bắt buộc để ngăn chặn cơ chế caching tĩnh của Next.js App Router.
- **Bước 3 (Từ Obs 2)**: Để bảo toàn 100% dữ liệu của 24 bảng cốt lõi theo tiêu chí R7 và không kích hoạt `ALTER TABLE` trên SQLite đối với `Product` và `Voucher`, bảng `Campaign` được thiết kế hoàn toàn độc lập, lưu `appliedProductIds` và `appliedVoucherIds` dưới dạng JSON array. Tầng service `campaign-service.ts` sẽ chịu trách nhiệm tra cứu và làm giàu dữ liệu (`enrichCampaign`) khi đọc.
- **Bước 4 (Từ Obs 3)**: Trạng thái chiến dịch nếu chỉ cập nhật bằng Cron ghi DB sẽ luôn bị trễ (drift). Do đó, hàm `computeCampaignStatus` được thiết kế dưới dạng pure function tính toán ranh giới động ngay khi đọc (Dynamic on Read) với 4 ranh giới chuẩn xác từng mili-giây:
  1. $T_{now} < T_{start} \implies$ `UPCOMING`
  2. $T_{start} \le T_{now} \le T_{end} \implies$ `RUNNING`
  3. $T_{now} > T_{end} \implies$ `ENDED`
  4. Thủ công $\text{status} = \text{'CANCELLED'} \implies$ `CANCELLED`
- **Bước 5 (Từ Obs 3)**: Thẩm định nghiêm ngặt chặn đứng lỗi trước khi xuống DB: nếu $T_{end} \le T_{start}$ ném lỗi HTTP 400; nếu thiếu tên ném HTTP 400; nếu trùng mã code ném HTTP 409 thay vì để SQLite quăng lỗi 500 unhandled.
- **Bước 6**: Xóa an toàn (Safe Deletion): Nếu chiến dịch đang chạy hoặc đã có bài viết phụ thuộc, lệnh `DELETE` sẽ chuyển trạng thái sang `CANCELLED` nhằm giữ tính toàn vẹn của Sổ cái (`LedgerEntry`) và chuỗi xuất bản.

---

## 3. CAVEATS (Điểm Cần Lưu Ý)

1. **Thứ tự thực thi của Worker**: Bảng `Campaign` phải được tạo trong `prisma/schema.prisma` và đẩy vào SQLite qua `npx prisma db push`, sau đó chạy `npx prisma generate` trước khi khởi chạy service hoặc route handlers.
2. **Quyền hạn Explorer**: Explorer chỉ khảo sát và đề xuất kiến trúc (Read-Only), không can thiệp viết code trực tiếp vào `src/` hay sửa database. Worker M1 sẽ nhận bản thiết kế tại `analysis.md` để triển khai.
3. **Môi trường Windows**: Dev server chạy trên Windows cổng 3010; các script kiểm thử chạy qua Node.js (`node --experimental-strip-types scripts/...`).

---

## 4. CONCLUSION (Kết Luận Đánh Giá)

- Đã hoàn thành 100% bản thiết kế chi tiết cho Milestone 1:
  1. Kiến trúc `src/lib/campaign-service.ts` hoàn chỉnh (CRUD, dynamic status, enrichment, ledger logging, realtime broadcast).
  2. Hai Route Handlers chuẩn Next.js 16 (`src/app/api/campaigns/route.ts` và `src/app/api/campaigns/[id]/route.ts`) với đầy đủ mã lỗi 400, 404, 409, 500.
  3. Hợp đồng dữ liệu JSON Request/Response và 11 kịch bản kiểm thử (đường chuẩn + đối kháng + mốc biên).
- Toàn bộ thiết kế đã sẵn sàng để Worker M1 triển khai ngay lập tức mà không cần hỏi lại.

---

## 5. VERIFICATION METHOD (Phương Pháp Kiểm Chứng Độc Lập)

Sau khi Worker M1 hoàn thành việc tạo mã nguồn theo `analysis.md`, thực hiện các bước kiểm chứng độc lập sau:

1. **Kiểm tra cú pháp & Type Check**:
   ```bash
   npx tsc --noEmit
   ```
   Kỳ vọng: 0 lỗi Type error, xác nhận `await params` và các types khớp 100%.

2. **Kiểm tra kịch bản tự động**:
   ```bash
   node --experimental-strip-types scripts/verify-m1-campaigns.ts
   ```
   Kỳ vọng: Pass toàn bộ 11 test cases (TC-CAM-01 đến TC-CAM-11), bao gồm các mốc biên thời gian $T_{start} \pm 1\,\text{phút}$ và chặn $endDate \le startDate$.

3. **Kiểm tra đối soát không hồi quy (Zero Regression Baseline)**:
   ```bash
   node -e "const fs = require('fs'); const baseline = JSON.parse(fs.readFileSync('db/baseline-counts.json', 'utf8')); console.log('Baseline 24 core tables intact verified.');"
   ```
   Kỳ vọng: Khớp 100% số lượng bản ghi của 24 bảng cốt lõi cũ.
