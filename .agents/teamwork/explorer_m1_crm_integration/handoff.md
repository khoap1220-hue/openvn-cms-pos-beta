# Báo Cáo Bàn Giao Kỹ Thuật (Handoff Report) — M1: CRM Integration & Verification Design

- **Tác nhân (Sender)**: Explorer Subagent (`explorer_m1_crm_integration`)
- **Tác nhân tiếp nhận (Recipient)**: Orchestrator (`3f0d510d-9880-49f5-b710-8d6bfe356311`) & Worker M1
- **Vị trí tệp**: `y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\explorer_m1_crm_integration\handoff.md`
- **Loại bàn giao**: Hard Handoff (Nhiệm vụ điều tra & thiết kế Milestone 1 đã hoàn thành trọn vẹn)
- **Thời gian lập**: 2026-10-26T13:33:00Z

---

## 1. OBSERVATION (Quan Sát Thực Nghiệm & Bằng Chứng Trực Tiếp)

1. **Hiện trạng Model `Product` và `Voucher` trong `prisma/schema.prisma`**:
   - `Product` (dòng 18–48): Quản lý 12 sản phẩm baseline (`Product: 12` theo `db/baseline-counts.json`). Trường giá gồm `sellPrice Float @default(0)` và `costPrice Float @default(0)`.
   - `Voucher` (dòng 467–483): Quản lý 4 voucher baseline (`Voucher: 4` theo `db/baseline-counts.json`). Trường chiết khấu gồm: `code String @unique`, `discountType String @default("PERCENT")` (`PERCENT` | `FIXED` | `FREESHIP`), `discountValue Float @default(10)`, `maxDiscount Float?`, `minOrderAmount Float @default(0)`, `usageLimit Int?`, `usedCount Int @default(0)`, `scope String @default("ALL")`, `active Boolean @default(true)`.
2. **Dữ liệu thực tế được truy vấn trực tiếp từ `db/custom.db`**:
   - Sản phẩm gồm 12 bản ghi, tiêu biểu: `UD-NEN-001` (Nến bơ Udumbara, giá 129.000₫, giá vốn 55.000₫), `UD-TRA-001` (Bộ ấm trà men lam, giá 350.000₫, giá vốn 195.000₫), `UD-COMBO-001` (Set quà tặng Ưu Đàm, giá 219.000₫).
   - Voucher gồm 4 bản ghi: `UUDAM10` (giảm 10% tối đa 50k, đơn từ 150k), `PHATDAN50K` (giảm 50k, đơn từ 400k), `LIENKET15` (giảm 15% tối đa 80k, đơn từ 250k), `FREESHIP0D` (hỗ trợ 30k ship, đơn từ 200k).
3. **Cơ chế tính Voucher hiện hữu**:
   - `src/lib/warehouse-service.ts` (dòng 611–655) cung cấp hàm chuẩn:
     ```typescript
     export function calculateVoucherDiscount(
       voucher: { discountType: string; discountValue: number; maxDiscount?: number | null; minOrderAmount: number; usageLimit?: number | null; usedCount: number; active: boolean; expiresAt?: Date | string | null },
       subtotal: number,
       shippingFee: number
     ): { valid: boolean; discountAmount: number; reason?: string }
     ```
4. **Ràng buộc bất biến hệ thống**:
   - `PROJECT.md` (dòng 5): "Zero modifications to existing 24/28 baseline tables."
   - `ORIGINAL_REQUEST.md` (dòng 113–115, 122–124): Giữ nguyên số lượng bản ghi baseline 24 bảng, chặn $endDate \le startDate$, kiểm thử trạng thái biên tại các mốc thời gian.
   - Hợp đồng giao tiếp M1 ↔ M3 (`PROJECT.md` dòng 64–77): `CampaignData` chứa mảng `products: Array<{ id, name, price, discountPercent?, campaignPrice? }>` và `vouchers: Array<{ id, code, discountPercent?, discountAmount?, minOrderValue? }>`.

---

## 2. LOGIC CHAIN (Chuỗi Suy Luận & Lập Luận Kỹ Thuật)

1. **Từ Quan sát 1 và 4 (Yêu cầu Zero Regression & Không sửa đổi 24 bảng baseline)**:
   - Nếu áp dụng giải pháp Bảng quan hệ trung gian (`CampaignProduct` / `CampaignVoucher`) có `@relation`, Prisma ORM bắt buộc phải thêm trường quan hệ ngược vào `Product` (`campaignProducts CampaignProduct[]`) và `Voucher` (`campaignVouchers CampaignVoucher[]`).
   - Việc chỉnh sửa file `prisma/schema.prisma` tại các model cũ sẽ làm biến đổi kiểu dữ liệu sinh bởi Prisma (`@prisma/client`), và lệnh `prisma db push` trên SQLite sẽ thực hiện kiểm tra/thay đổi bảng cũ, vi phạm trực tiếp nguyên tắc "Zero modifications to existing 24/28 baseline tables" và làm tăng rủi ro khóa database khi có WAL.
   - *Hệ quả logic*: Sử dụng các trường JSON (`productIds String?`, `voucherIds String?`, `productOverrides String?`) trực tiếp trên mô hình `Campaign` là phương án DUY NHẤT bảo đảm 100% không đụng vào `Product` và `Voucher`, không gây bất kỳ thay đổi nào lên 24 bảng SQLite baseline, đồng thời hoàn toàn đồng nhất với phong cách thiết kế JSON metadata của toàn bộ dự án Ưu Đàm Suite (`Customer.preferences`, `LedgerEntry.detail`).

2. **Từ Quan sát 2, 3 và Phân tích Nghiệp Vụ Tính Giá**:
   - Chiến dịch khuyến mãi có 2 cấp độ ưu đãi:
     * Cấp độ sản phẩm (Item-level): Áp dụng giá ưu đãi riêng (`specialPrice`) hoặc % giảm giá của chiến dịch (`discountPercent`) lên từng sản phẩm. Giá sau ưu đãi: $P_{\text{camp}} = \min(P_{\text{reg}}, \text{specialPrice} \lor \text{round}(P_{\text{reg}} \times (1 - D / 100)))$.
     * Cấp độ giỏ hàng (Cart-level): Áp dụng mã Voucher lên tổng giá trị giỏ hàng $\text{Subtotal} = \sum P_{\text{camp}} \times Q$. Hàm `calculateVoucherDiscount` sẽ kiểm tra ngưỡng tối thiểu `minOrderAmount` và tính số tiền giảm theo tỷ lệ % (có khống chế trần `maxDiscount`) hoặc số tiền cố định.
   - *Hệ quả logic*: Tầng dịch vụ `campaign-service.ts` phải tích hợp logic tính giá này để tự động tính toán và trả về cả 3 thông số: Giá gốc (`originalPrice`), Giá chiến dịch (`campaignPrice`), và % giảm thực tế (`discountPercent`), giúp module M3 (AI Copywriter) đọc dữ liệu chính xác tuyệt đối mà không cần tự tính toán.

3. **Từ Quan sát 4 (R1 Acceptance Criteria & Hợp đồng M1 ↔ M3)**:
   - Trạng thái chiến dịch phải chuyển đổi tự động theo thời gian thực: `UPCOMING` nếu $T_{\text{now}} < T_{\text{start}}$, `RUNNING` nếu $T_{\text{start}} \le T_{\text{now}} \le T_{\text{end}}$, `ENDED` nếu $T_{\text{now}} > T_{\text{end}}$, và `CANCELLED` nếu bị chủ tiệm hủy.
   - Kiểm tra ràng buộc bắt buộc: $endDate \le startDate$ phải bị chặn và trả về lỗi 400 Bad Request ngay tại tầng API/Service.
   - *Hệ quả logic*: Thiết kế hàm thuần túy `computeCampaignStatus(campaign, now)` với tham số `now` tùy biến cho phép kiểm thử xác định (deterministic unit testing) toàn bộ các ca biên (trước 1 phút, đúng mili-giây bắt đầu, trong kỳ, đúng mili-giây kết thúc, sau 1 giây).

4. **Từ Yêu cầu Thiết kế Kịch bản Kiểm chứng Độc lập (`scripts/verify-m1-campaigns.ts`)**:
   - Cần một script hoàn chỉnh chạy bằng Node.js 24 (`--experimental-strip-types`) đi qua 8 giai đoạn:
     1. Kiểm tra tồn tại và SQLite header của tệp backup `db/custom.db.bak.pre-autosocial`.
     2. Đối soát snapshot 24 bảng baseline ban đầu.
     3. Kiểm tra chuyển trạng thái biên theo thời gian.
     4. Kiểm tra các ca đối kháng ($endDate \le startDate$, dữ liệu rỗng).
     5. Tạo chiến dịch test liên kết sản phẩm & voucher thật.
     6. Xác minh làm giàu dữ liệu và độ chuẩn xác của động cơ tính giá.
     7. Xác minh số lượng bản ghi 24 bảng baseline không thay đổi ($\Delta = 0$).
     8. Dọn dẹp bản ghi test (`code LIKE 'TEST_M1_%'`) và checkpoint WAL.

---

## 3. CAVEATS (Vấn Đề Giới Hạn & Giả Định)

1. **Kiểm tra tính toàn vẹn khóa ngoại (Referential Integrity)**: Do dùng trường JSON lưu danh sách ID (`productIds`, `voucherIds`) thay vì Foreign Key vật lý ở cấp DB, tính toàn vẹn dữ liệu được đảm bảo tại tầng ứng dụng (`campaign-service.ts`). Khi một sản phẩm hoặc voucher bị xóa/ngưng hoạt động, hàm `enrichCampaignData` cần tự động bỏ qua (filter out) hoặc đánh dấu cảnh báo thay vì làm ứng dụng bị crash.
2. **Quy tắc cộng dồn chiết khấu (Stacking Policy)**: Giả định hệ thống áp dụng cơ chế chuẩn trong thương mại điện tử: Khuyến mãi chiến dịch giảm giá trên đơn giá sản phẩm; Mã Voucher giảm thêm trên tổng đơn hàng. Không hỗ trợ cộng dồn 2 mã voucher trên cùng 1 đơn hàng (phù hợp với bảng `Order` hiện tại chỉ có 1 trường `voucherCode`).
3. **Môi trường chạy Script**: Script kiểm chứng sử dụng cờ `--experimental-strip-types` của Node.js 24 (`v24.15.0`) sẵn có trên máy chủ Windows, không phụ thuộc vào `ts-node` hay build trước.

---

## 4. CONCLUSION (Kết Luận & Khuyến Nghị Hành Động)

1. **Khẳng định chiến lược Schema**:
   - Bổ sung thực thể `Campaign` với các trường JSON `productIds String?`, `voucherIds String?`, `productOverrides String?`.
   - **Giữ nguyên 100% không chỉnh sửa** mô hình `Product` và `Voucher` trong `prisma/schema.prisma`.
2. **Khẳng định logic làm giàu & tính giá**:
   - `campaign-service.ts` đóng vai trò trung tâm cung cấp:
     * `computeCampaignStatus`: Xác định trạng thái biên tức thời.
     * `enrichCampaignData`: Tải dữ liệu sống từ `Product` và `Voucher`, tính giá ưu đãi và chiết khấu, trả về `CampaignData` chuẩn cho AI M3.
     * Kiểm tra chặt chẽ $endDate > startDate$ (nếu vi phạm trả về lỗi 400).
3. **Kế hoạch kiểm thử hoàn chỉnh**:
   - Triển khai kịch bản `scripts/verify-m1-campaigns.ts` gồm 8 giai đoạn như đã thiết kế chi tiết tại Mục 6 của `analysis.md`.

---

## 5. VERIFICATION METHOD (Phương Pháp & Lệnh Kiểm Chứng Độc Lập)

Sau khi Worker M1 hoàn tất việc bổ sung schema và viết mã nguồn, các tác nhân thẩm định (Reviewer/Auditor) có thể kiểm chứng độc lập bằng chuỗi lệnh sau:

1. **Kiểm tra tệp sao lưu database**:
   ```powershell
   Test-Path "db/custom.db.bak.pre-autosocial"
   (Get-Item "db/custom.db.bak.pre-autosocial").Length
   ```
   *Điều kiện hợp lệ*: Tệp tồn tại, dung lượng xấp xỉ 4.7MB – 5MB.

2. **Chạy kịch bản kiểm chứng độc lập Milestone 1**:
   ```powershell
   node --experimental-strip-types scripts/verify-m1-campaigns.ts
   ```
   *Điều kiện hợp lệ*: Toàn bộ 8 giai đoạn đều trả về `✅ [PASS]`, 0 FAIL, mã thoát `exit 0`.

3. **Kiểm chứng Zero Regression trên 24 bảng baseline**:
   - Sau khi script chạy xong, đối soát số lượng bản ghi:
   ```powershell
   node --experimental-strip-types scripts/verify-realworld-scenarios.ts
   ```
   *Điều kiện hợp lệ*: 21 kịch bản kiểm thử nghiệp vụ cũ tiếp tục PASS 100%.

4. **Kiểm tra chất lượng tổng thể**:
   ```powershell
   npm run verify
   ```
   *Điều kiện hợp lệ*: `tsc --noEmit`, `eslint`, `test:chain`, và `test:scenarios` đều hoàn thành với 0 lỗi, 0 cảnh báo.
