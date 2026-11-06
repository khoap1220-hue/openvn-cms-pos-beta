# FORENSIC AUDIT & HANDOFF REPORT — MILESTONE M2 (R1 SYSTEM HARDENING)

**Work Product**: Milestone M2 (System Hardening & Defect Rectification — R1)  
**Profile**: General Project (Integrity Mode: `development` / Development Mode with Strict Verification)  
**Auditor**: `auditor_m2` (Forensic Integrity Auditor)  
**Target Agent**: `worker_m2`  
**Parent Conversation ID**: `7124d145-f8bf-4670-a0d0-13114c2b24e3`  
**Audit Timestamp**: 2026-10-26T08:20:30Z  

---

## FORENSIC AUDIT REPORT

**Verdict**: **CLEAN**

### Phase Results
- **Hardcoded test results detection**: **PASS** — Quét toàn bộ `src/` không phát hiện bất kỳ chuỗi hardcode nào liên quan đến test fixtures (`R1-`, `DH-R1`, `TRA-R1`, `097999`, v.v.).
- **Facade implementations detection**: **PASS** — Mọi xử lý trong `orders/[id]`, `shipments/[id]`, `customers`, `system/backup` đều thực hiện logic nghiệp vụ thực chất thông qua Prisma ORM và hệ thống tệp.
- **Pre-populated / fabricated outputs detection**: **PASS** — Kiểm thử trực tiếp và độc lập xác nhận mọi kết quả chạy đều sinh động và khớp với trạng thái cơ sở dữ liệu thời gian thực.
- **Self-certifying / mocked tests detection**: **PASS** — Kịch bản `scripts/verify-r1-regressions.ts` gửi request HTTP thực tế qua `fetch` tới máy chủ Next.js tại `http://localhost:3010`, kiểm tra status code/JSON và đối chiếu độc lập với dữ liệu trong SQLite thông qua Prisma Client.
- **Database preservation & baseline integrity**: **PASS** — Số lượng bản ghi của toàn bộ 20 bảng cơ sở dữ liệu cốt lõi sau khi hoàn tất kiểm thử khớp 100% với `db/baseline-counts.json`.

---

## 1. OBSERVATION (QUAN SÁT THỰC NGHIỆM ĐỘC LẬP)

1. **Kiểm tra `src/app/api/orders/[id]/route.ts`**:
   - Dòng 66–72: Chặn mở lại đơn đã hủy:
     ```ts
     if (order.status === 'CANCELLED' && data.status && data.status !== 'CANCELLED') {
       return NextResponse.json(
         { error: 'Đơn hàng đã hủy (đã hoàn kho), không thể chuyển lại trạng thái khác' },
         { status: 400 }
       )
     }
     ```
   - Dòng 74–82: Chặn hủy lại đơn đã hủy và chặn hủy đơn đã hoàn tất:
     ```ts
     if (data.status === 'CANCELLED') {
       if (order.status === 'CANCELLED') return NextResponse.json({ error: 'Đơn hàng đã bị hủy trước đó' }, { status: 400 })
       if (order.status === 'COMPLETED') return NextResponse.json({ error: 'Không thể hủy đơn hàng đã hoàn tất' }, { status: 400 })
     }
     ```
   - Dòng 87–141: Bọc toàn bộ quy trình cập nhật trạng thái đơn sang `CANCELLED`, hoàn tồn kho sản phẩm đơn lẻ (`tx.product.update`, `tx.stockMovement.create`), hoàn tồn kho từng thành phần định mức BOM Combo (`tx.bomComponent.findMany`, `tx.product.update`, `tx.stockMovement.create`), đồng bộ tồn hiển thị combo `syncComboStock(tx, comboId)` và `syncCombosUsingComponents(tx, restockedProductIds)` bên trong khối nguyên tử `db.$transaction(async (tx) => ...)`.

2. **Kiểm tra `src/app/api/shipments/[id]/route.ts`**:
   - Dòng 81–140: Bọc quy trình xử lý vận đơn hoàn hàng `RETURNED` trong `db.$transaction(async (tx) => ...)`.
   - Có cơ chế bảo vệ lũy thoái (Idempotency Guard) `if (data.status === 'RETURNED' && shipment.status !== 'RETURNED')`, chỉ thực hiện hoàn tồn kho một lần duy nhất nếu vận đơn chưa ở trạng thái `RETURNED`.
   - Thực hiện cập nhật vận đơn, cập nhật đơn hàng sang `CANCELLED`, hoàn trả kho thành phần Combo / sản phẩm đơn và gọi `syncComboStock(tx, ...)` và `syncCombosUsingComponents(tx, ...)`.

3. **Kiểm tra `src/app/api/customers/route.ts`**:
   - Dòng 95–106: Kiểm tra số điện thoại:
     ```ts
     const trimmedPhone = phone?.trim() || null
     if (trimmedPhone) {
       const existing = await db.customer.findFirst({
         where: { phone: trimmedPhone },
       })
       if (existing) {
         return NextResponse.json(
           { error: 'Số điện thoại này đã được đăng ký cho khách hàng khác' },
           { status: 400 }
         )
       }
     }
     ```
   - Cho phép khách vãng lai không có SĐT (`trimmedPhone === null`) tạo thành công (HTTP 201), chặn mọi SĐT đã tồn tại (HTTP 400).

4. **Kiểm tra `src/app/api/system/backup/route.ts`**:
   - Dòng 9–18: Hàm `resolveDbPath()` chuẩn hóa đường dẫn tĩnh `path.join(process.cwd(), 'db', 'custom.db')`, không nhận tham số động từ client, loại trừ nguy cơ Path Traversal.
   - Dòng 15, 26, 30: Sử dụng chú thích `/*turbopackIgnore: true*/` cho các hàm filesystem của Node.js, giải phóng Turbopack khỏi cảnh báo dynamic filesystem tracing.
   - Dòng 23: Thực thi `PRAGMA wal_checkpoint(PASSIVE)` trước khi đọc tệp.
   - Dòng 45–53: Trả về tệp nhị phân với header `Content-Type: application/octet-stream` và `Content-Disposition: attachment; filename="uudam-cms-backup-...db"`.

5. **Kết quả chạy thực tế độc lập từ kiểm toán viên**:
   - **`scripts/verify-r1-regressions.ts`**: 11 PASS, 0 FAIL.
   - **Thử nghiệm độc lập API khách hàng trùng SĐT qua Node fetch**:
     - Call 1 (SĐT mới): `HTTP 201` `{ id: '...', name: 'Audit Customer 1', phone: '0988802262' }`
     - Call 2 (SĐT trùng): `HTTP 400` `{ error: 'Số điện thoại này đã được đăng ký cho khách hàng khác' }`
   - **Thử nghiệm độc lập API Hủy đơn hàng qua Node fetch**:
     - Lần 1: `HTTP 200`, `order.status = 'CANCELLED'`, tồn kho hoàn lại đúng 10.
     - Lần 2 (Hủy lại): `HTTP 400` `{ error: 'Đơn hàng đã bị hủy trước đó' }`, tồn kho không đổi.
   - **Thử nghiệm độc lập API Vận đơn RETURNED qua Node fetch**:
     - Lần 1: `HTTP 200`, `shipment.status = 'RETURNED'`, `order.status = 'CANCELLED'`, tồn kho hoàn trả từ 5 -> 8.
     - Lần 2: `HTTP 200`, tồn kho giữ nguyên 8 (Bảo toàn tính Idempotent).
   - **Thử nghiệm độc lập API Tải Backup `/api/system/backup`**:
     - `HTTP 200`, `Content-Type: application/octet-stream`, độ dài 2,658,304 bytes, 16 bytes đầu tiên khớp định dạng chuẩn `SQLite format 3 `.
   - **So sánh số lượng bản ghi với `db/baseline-counts.json`**:
     - Product: 12 (baseline: 12) — [IDENTICAL]
     - Category: 3 (baseline: 3) — [IDENTICAL]
     - Order: 173 (baseline: 173) — [IDENTICAL]
     - OrderItem: 226 (baseline: 226) — [IDENTICAL]
     - Customer: 34 (baseline: 34) — [IDENTICAL]
     - SalesInvoice: 10 (baseline: 10) — [IDENTICAL]
     - PurchaseInvoice: 4 (baseline: 4) — [IDENTICAL]
     - StockMovement: 246 (baseline: 246) — [IDENTICAL]
     - Warehouse: 4 (baseline: 4) — [IDENTICAL]
     - WarehouseStock: 22 (baseline: 22) — [IDENTICAL]
     - Voucher: 4 (baseline: 4) — [IDENTICAL]
     - BomComponent: 5 (baseline: 5) — [IDENTICAL]
     - AccountingPeriod: 5 (baseline: 5) — [IDENTICAL]
     - Partner: 1 (baseline: 1) — [IDENTICAL]
     - Channel: 10 (baseline: 10) — [IDENTICAL]
     - ChannelListing: 110 (baseline: 110) — [IDENTICAL]
     - Shipment: 85 (baseline: 85) — [IDENTICAL]
     - AfterSalesCase: 2 (baseline: 2) — [IDENTICAL]
     - AppSetting: 16 (baseline: 16) — [IDENTICAL]
     - IntegrationCredential: 14 (baseline: 14) — [IDENTICAL]
   - **Cổng chất lượng toàn hệ thống**:
     - `npx tsc --noEmit`: 0 errors (Exit code 0).
     - `npm run lint`: 0 errors, 0 warnings (Exit code 0).
     - `npm run test:chain`: Chuỗi biến động kho của `UD-QT-002` và `UD-VL-001` khớp 100% với tồn thực tế (Exit code 0).
     - `npm run test:scenarios`: 21/21 KỊCH BẢN ĐẠT (FAILED: 0, Exit code 0).
     - `npm run build`: Thành công trong 3.0s, không xuất hiện cảnh báo Turbopack Dynamic Filesystem Access (Exit code 0).

---

## 2. LOGIC CHAIN (CHUỖI LẬP LUẬN TỪ QUAN SÁT ĐẾN KẾT LUẬN)

1. *Quan sát*: Mã nguồn trong `orders/[id]/route.ts` và `shipments/[id]/route.ts` đã bọc toàn bộ chuỗi cập nhật đơn hàng, vận đơn, tồn kho sản phẩm/thành phần định mức Combo và đồng bộ `syncComboStock(tx, ...)` bên trong `db.$transaction(async (tx) => ...)`.
   *Lập luận*: Nếu bất kỳ thao tác nào trong chuỗi thất bại, toàn bộ giao dịch ghi trên SQLite sẽ được hoàn tác (rollback), loại bỏ nguy cơ phân mảnh dữ liệu giữa đơn hàng và tồn kho.
2. *Quan sát*: Mã nguồn trong `customers/route.ts` truy vấn trực tiếp CSDL qua `db.customer.findFirst({ where: { phone: trimmedPhone } })` trước khi tạo, và trả về HTTP 400 nếu trùng.
   *Lập luận*: Cơ chế này ngăn chặn tuyệt đối việc tạo trùng SĐT, đồng thời vẫn bảo đảm tính linh hoạt cho khách hàng vãng lai không có SĐT.
3. *Quan sát*: Tuyến `/api/system/backup` đọc trực tiếp `db/custom.db`, có `/*turbopackIgnore: true*/` và WAL checkpoint.
   *Lập luận*: Bản sao lưu được xuất khẩu là file SQLite nguyên bản, quá trình build Turbopack không còn quét thư mục dự án.
4. *Quan sát*: Bộ test `scripts/verify-r1-regressions.ts` tạo dữ liệu với tiền tố thời gian ngẫu nhiên, gọi API qua HTTP fetch thật, kiểm tra phản hồi HTTP và kiểm tra lại trực tiếp CSDL bằng Prisma, sau đó dọn dẹp sạch sẽ.
   *Lập luận*: Bộ test không tự chứng nhận (self-certifying) mà kiểm định độc lập qua black-box HTTP request và white-box DB verification. Toàn bộ dữ liệu thử nghiệm đều được dọn dẹp, số lượng bản ghi DB khớp 100% baseline.
5. *Kết luận*: Toàn bộ 4 tính năng F02, F03, F04, F05 thuộc Milestone M2 (R1) đều đạt chuẩn chính trực, không có gian lận, không có facade hay hardcode, đạt chuẩn để nghiệm thu.

---

## 3. CAVEATS (GIỚI HẠN & GIẢ ĐỊNH)

- **Phạm vi kiểm toán**: Báo cáo này tập trung kiểm toán bảo mật và tính toàn vẹn của Milestone M2 (System Hardening - R1). Các tính năng tương lai thuộc M3 (Bulk Orders), M4 (VAT XML), M5 (Catalog CSV), M6 (P2 features) nằm ngoài phạm vi M2 và sẽ được kiểm toán trong các milestone tương ứng.
- **Môi trường chạy**: Kiểm toán được thực hiện trực tiếp trên môi trường Windows máy chủ phát triển cục bộ, cổng HTTP 3010.

---

## 4. CONCLUSION (KẾT LUẬN VÀ KIẾN NGHỊ)

- **Phán quyết chính thức**: **CLEAN (CHÍNH TRỰC & ĐẠT CHUẨN)**.
- Sản phẩm bàn giao của Milestone M2 từ `worker_m2` được **CHẤP THUẬN (ACCEPTED)**.
- Cho phép Orchestrator đóng Milestone M2 và kích hoạt Milestone M3 (Xử lý đơn hàng hàng loạt & Phiếu in A6).

---

## 5. VERIFICATION METHOD (LỆNH TÁI KIỂM CHỨNG ĐỘC LẬP)

Để tái kiểm chứng độc lập báo cáo này, thực thi lần lượt các lệnh sau:

```powershell
# 1. Chạy bộ kiểm thử hồi quy R1 (Kỳ vọng: 11 PASS, 0 FAIL)
node --experimental-strip-types scripts/verify-r1-regressions.ts

# 2. Kiểm tra typecheck TypeScript (Kỳ vọng: 0 errors)
npx tsc --noEmit

# 3. Kiểm tra ESLint (Kỳ vọng: 0 errors, 0 warnings)
npm run lint

# 4. Kiểm tra chuỗi biến động sổ kho (Kỳ vọng: PASS, kết thúc đúng tồn thực tế)
npm run test:chain

# 5. Kiểm tra 21 kịch bản nghiệp vụ (Kỳ vọng: 21/21 KỊCH BẢN ĐẠT)
npm run test:scenarios

# 6. Kiểm tra build sản xuất (Kỳ vọng: Compile thành công, 0 Turbopack dynamic filesystem warnings)
npm run build
```

**Điều kiện vô hiệu hóa phán quyết**:
- Bất kỳ lệnh kiểm chứng nào ở trên thất bại hoặc trả về mã thoát khác 0.
- Phát hiện bất kỳ mã hardcode hoặc facade nào trong các route được kiểm toán.
