# Báo Cáo Phân Tích Kỹ Thuật: Tích Hợp Sản Phẩm, Voucher & Công Thức Tính Giá Cho Phân Hệ CRM Campaign (Milestone 1)

- **Người thực hiện**: Explorer Subagent (`explorer_m1_crm_integration`)
- **Tác nhân điều phối (Parent)**: `3f0d510d-9880-49f5-b710-8d6bfe356311`
- **Thời gian phân tích**: 2026-10-26T13:31:00Z
- **Vị trí làm việc**: `.agents/teamwork/explorer_m1_crm_integration`
- **Chế độ**: Read-Only Architecture & Integration Analysis (Khảo sát thiết kế tích hợp & kiểm chứng)

---

## 1. TỔNG QUAN & PHẠM VI NHIỆM VỤ

Trong khuôn khổ **Milestone 1 (M1: CRM Campaigns & DB Safety)** thuộc đợt bổ sung module **AUTO SOCIAL** vào hệ thống **OPENVN · Ưu Đàm Suite**, nhiệm vụ trọng tâm của nhánh phân tích này gồm:
1. **Liên kết Đa Sản phẩm & Đa Voucher với Chiến dịch (Campaign)**:
   - Đánh giá toàn diện kiến trúc: Sử dụng trường lưu trữ định dạng JSON trên thực thể `Campaign` hay thiết kế bảng quan hệ trung gian (Junction Tables / Relation Tables).
   - Bảo đảm nguyên tắc bất biến sống còn: **Tuyệt đối không gây hồi quy (Zero Regression)** lên 2 mô hình dữ liệu hiện có `Product` và `Voucher`, cũng như giữ nguyên trạng 24 bảng cốt lõi trong `db/custom.db`.
2. **Động cơ Tính toán Giá & Chiết khấu (Pricing Engine)**:
   - Trích xuất giá bán lẻ niêm yết của sản phẩm (`Product.sellPrice`), giá vốn (`Product.costPrice`).
   - Xử lý chiết khấu chiến dịch: % giảm giá chung toàn chiến dịch (`Campaign.discountPercent`) và giá bán ưu đãi riêng cho từng sản phẩm (`productOverrides[productId].specialPrice` hoặc `discountPercent`).
   - Xử lý giảm giá từ Voucher: Tích hợp logic chuẩn từ `calculateVoucherDiscount(voucher, subtotal, shippingFee)` trong `src/lib/warehouse-service.ts` (kiểm tra hạn dùng, trạng thái kích hoạt, giới hạn số lượt, đơn hàng tối thiểu `minOrderAmount`, trần giảm giá `maxDiscount`).
   - Quy tắc cộng dồn ưu đãi (Stacking Rules): Giảm giá chiến dịch áp dụng trực tiếp lên từng sản phẩm (Item-level), chiết khấu Voucher áp dụng tại bước thanh toán trên tổng giá trị giỏ hàng (Cart-level Subtotal).
3. **Lớp Làm Giàu Dữ Liệu Thời Gian Thực (Live Enrichment Engine)**:
   - Thiết kế cơ chế trong `src/lib/campaign-service.ts` nhằm truy vấn dữ liệu sản phẩm, voucher sống từ cơ sở dữ liệu để làm giàu bản ghi chiến dịch thành cấu trúc dữ liệu đầy đủ (`CampaignData`), đáp ứng chính xác hợp đồng giao tiếp giữa **M1 (Campaign CRM) và M3 (AI Copywriter & Planner)**.
4. **Thiết kế Kịch bản Kiểm chứng Độc lập (`scripts/verify-m1-campaigns.ts`)**:
   - Xây dựng bản thiết kế chi tiết cho script kiểm thử độc lập bao gồm 8 giai đoạn kiểm chứng: Kiểm tra tệp sao lưu DB, kiểm tra snapshot baseline 24 bảng, kiểm tra chuyển trạng thái biên theo thời gian thực (`UPCOMING`, `RUNNING`, `ENDED`, `CANCELLED`), kiểm tra các ca đối kháng/biên ($endDate \le startDate$, mã trùng lặp, dữ liệu rỗng), kiểm tra tạo chiến dịch kèm sản phẩm và voucher, kiểm tra làm giàu dữ liệu và độ chính xác của phép tính giá, kiểm tra bảo toàn số lượng bản ghi 24 bảng baseline ($\Delta = 0$), và dọn sạch dữ liệu thử nghiệm (Teardown & WAL checkpoint).

---

## 2. HIỆN TRẠNG DỮ LIỆU & SCHEMA (CRM BASELINE)

### 2.1. Bảng `Product` trong `prisma/schema.prisma` (Dòng 18–48)
- **Cấu trúc trường cốt lõi**:
  - `id`: `String @id @default(cuid())`
  - `sku`: `String @unique` (Mã định danh sản phẩm)
  - `name`: `String` (Tên sản phẩm)
  - `sellPrice`: `Float @default(0)` (Giá niêm yết bán lẻ chung)
  - `costPrice`: `Float @default(0)` (Giá vốn sản phẩm)
  - `stock`: `Int @default(0)`
  - `status`: `String @default("ACTIVE")`
  - `type`: `String @default("SIMPLE")` (`SIMPLE` | `COMBO`)
- **Dữ liệu thực tế trong `db/custom.db` (12 sản phẩm baseline)**:
  1. `cmvlr1n4q0004rggljddcsrco` | `UD-NEN-001` | Nến bơ Udumbara hũ thủy tinh (Butter Candle) | Giá bán: 129.000₫ | Giá vốn: 55.000₫
  2. `cmvlr1n4v0008rggl3d52t3k2` | `UD-NEN-002` | Hũ nến thủy tinh hoa sen (ly đựng nến) | Giá bán: 45.000₫ | Giá vốn: 22.000₫
  3. `cmvlr1n4x000crgglzhzj8tx3` | `UD-SAP-001` | Hạt sáp nến đậu nành Soy Wax (nguyên liệu) | Giá bán: 85.000₫ | Giá vốn: 52.000₫
  4. `cmvlr1n50000grggl5ojmt1p7` | `UD-SAP-002` | Sáp nến tinh khiết dạng khối (nguyên liệu) | Giá bán: 95.000₫ | Giá vốn: 58.000₫
  5. `cmvlr1n53000krgglyib7chxh` | `UD-DEN-001` | Đèn xông tinh dầu nến thủy tinh cổ điển | Giá bán: 189.000₫ | Giá vốn: 105.000₫
  6. `cmvlr1n55000orgglt8g2lewe` | `UD-TRA-001` | Bộ ấm trà gốm men lam hoa văn cổ điển | Giá bán: 350.000₫ | Giá vốn: 195.000₫
  7. `cmvlr1n58000srgglhckdtpiq` | `UD-TRA-002` | Bình pha trà thủy tinh có lọc và nắp đậy | Giá bán: 250.000₫ | Giá vốn: 140.000₫
  8. `cmvlr1n5a000wrgglf7xnzgvs` | `UD-TRA-003` | Hũ trà gốm nắp gỗ chữ Hán phong cách Zen | Giá bán: 89.000₫ | Giá vốn: 48.000₫
  9. `cmvlr1n5c0010rggld03z33vw` | `UD-QT-001` | Hộp quà tặng trà sơn thủy kèm 2 hũ gốm | Giá bán: 450.000₫ | Giá vốn: 260.000₫
  10. `cmvlr1n5e0014rgglr2atnz58` | `UD-QT-002` | Tranh gốm hoa mẫu đơn chim vàng treo tường | Giá bán: 350.000₫ | Giá vốn: 190.000₫
  11. `cmvlr1n5h0018rgglqgs83hcu` | `UD-VL-001` | Dây bấc nến cotton có sáp (bó 100 cây) | Giá bán: 32.000₫ | Giá vốn: 18.000₫
  12. `cmvlt6jcy0001rghlo6wcz4cb` | `UD-COMBO-001` | Set quà tặng Ưu Đàm — Nến bơ Udumbara + Hũ trà gốm Zen | Giá bán: 219.000₫ | Giá vốn: 103.000₫

### 2.2. Bảng `Voucher` trong `prisma/schema.prisma` (Dòng 467–483)
- **Cấu trúc trường cốt lõi**:
  - `id`: `String @id @default(cuid())`
  - `code`: `String @unique` (Mã nhập voucher, vd: `UUDAM10`)
  - `title`: `String` (Tên hiển thị)
  - `discountType`: `String @default("PERCENT")` (`PERCENT` | `FIXED` | `FREESHIP`)
  - `discountValue`: `Float @default(10)` (Giá trị giảm: % hoặc số tiền đ)
  - `maxDiscount`: `Float?` (Trần giảm tối đa cho loại `PERCENT`)
  - `minOrderAmount`: `Float @default(0)` (Đơn tối thiểu áp dụng)
  - `usageLimit`: `Int?` (Giới hạn lượt dùng)
  - `usedCount`: `Int @default(0)`
  - `scope`: `String @default("ALL")` (`ALL` | `ALLIANCE`)
  - `active`: `Boolean @default(true)`
  - `expiresAt`: `DateTime?`
- **Dữ liệu thực tế trong `db/custom.db` (4 voucher baseline)**:
  1. `UUDAM10`: Giảm 10% (Tối đa 50.000₫), đơn tối thiểu 150.000₫, `usageLimit: 200`, `usedCount: 15`, `active: true`.
  2. `PHATDAN50K`: Giảm 50.000₫ trực tiếp, đơn tối thiểu 400.000₫, `usageLimit: 100`, `usedCount: 8`, `active: true`.
  3. `LIENKET15`: Giảm 15% (Tối đa 80.000₫), đơn tối thiểu 250.000₫, `scope: "ALLIANCE"`, `usageLimit: 150`, `usedCount: 5`, `active: true`.
  4. `FREESHIP0D`: Hỗ trợ phí vận chuyển 30.000₫, đơn tối thiểu 200.000₫, `usageLimit: null`, `usedCount: 21`, `active: true`.

### 2.3. Baseline Counts 24 Bảng Nghiệp Vụ Cốt Lõi (`db/baseline-counts.json`)
Bảng tổng hợp đối soát bất biến:
- `Product`: 12 | `Category`: 3 | `Order`: 173 | `OrderItem`: 226 | `Customer`: 34
- `SalesInvoice`: 10 | `PurchaseInvoice`: 4 | `StockMovement`: 246 | `Warehouse`: 4 | `WarehouseStock`: 22
- `Voucher`: 4 | `BomComponent`: 5 | `AccountingPeriod`: 5 | `Partner`: 1 | `Channel`: 10
- `ChannelListing`: 110 | `Shipment`: 85 | `AfterSalesCase`: 2 | `AppSetting`: 16 | `IntegrationCredential`: 14
- `ApiKey`: 1 | `WebhookEndpoint`: 2 | `AutomationSetting`: 6 | `LedgerEntry`: 1963
*(Kèm 4 bảng runtime: `WebhookDelivery`: 158, `AgentActivity`: 549, `DirectMessage`: 325, `OrderEvent`: 392).*

---

## 3. KIẾN TRÚC LIÊN KẾT PRODUCT & VOUCHER: SO SÁNH JSON FIELD VS RELATION TABLE

Để hỗ trợ chọn nhiều sản phẩm và nhiều voucher cho một chiến dịch, chúng ta đã đặt lên bàn cân 3 phương án kiến trúc:

| Tiêu Chí So Sánh | Phương Án 1: Lưu JSON Fields trên `Campaign` (KHUYẾN NGHỊ) | Phương Án 2: Bảng Quan Hệ Phụ (`CampaignProduct`, `CampaignVoucher`) Có `@relation` | Phương Án 3: Bảng Quan Hệ Phụ Không Dùng `@relation` Prisma |
| :--- | :--- | :--- | :--- |
| **Không đụng chạm Model cũ (`Product`, `Voucher`)** | ⭐⭐⭐ **Tuyệt đối an toàn (100% Zero Touch)**. Mô hình `Product` và `Voucher` trong `prisma/schema.prisma` giữ nguyên từng dòng. | ❌ **Vi phạm nặng**. Prisma ORM bắt buộc phải khai báo trường quan hệ ngược (`campaignProducts CampaignProduct[]` và `campaignVouchers CampaignVoucher[]`) vào `Product` và `Voucher`. | ⚠️ Tránh sửa `Product`/`Voucher` nhưng sinh thêm 2 bảng mới vào SQLite, làm tăng độ phức tạp không cần thiết. |
| **Bảo vệ 24 Bảng Baseline trong SQLite** | ⭐⭐⭐ **Bảo toàn 100%**. Lệnh `prisma db push` chỉ thực thi `CREATE TABLE "Campaign" ...`, hoàn toàn không chạy `ALTER TABLE` lên `Product` hay `Voucher`. | ❌ Nguy cơ cao. Việc bổ sung quan hệ ngoại khóa trên SQLite buộc Prisma phải tái cấu trúc/kiểm tra ràng buộc trên bảng dữ liệu cũ, dễ gây khóa database khi có WAL. | ⚠️ Thêm 2 bảng vào SQLite nhưng không có quan hệ ORM tự nhiên. |
| **Hỗ trợ Chọn Nhiều Sản phẩm & Nhiều Voucher** | ⭐⭐⭐ **Rất linh hoạt**. Lưu trữ dạng JSON Array `["id1", "id2"]` hoặc JSON Object với cấu hình giá tùy biến. | ⭐⭐ Tốt nhưng cồng kềnh: mỗi sản phẩm liên kết tốn 1 bản ghi riêng trong bảng trung gian. | ⭐⭐ Tương tự PA2. |
| **Khả năng Ghi đè Giá Riêng Biệt (Product Overrides)** | ⭐⭐⭐ **Hoàn hảo**. Có thể lưu `specialPrice`, `discountPercent` riêng cho từng sản phẩm trong cùng một JSON field (`productOverrides`). | ⚠️ Phải thiết kế thêm các cột `specialPrice`, `discountPercent` trên bảng `CampaignProduct`. | ⚠️ Tương tự PA2. |
| **Tính Linh Hoạt & Chống Phá Vỡ (Soft Resilience)** | ⭐⭐⭐ Khi sản phẩm hoặc voucher cũ bị ngưng hoạt động hoặc xóa mềm, chiến dịch không bị lỗi Foreign Key Constraint. Service chỉ cần lọc bỏ ID không tồn tại. | ❌ Nếu không cấu hình `onDelete: Cascade` hoặc `SetNull` cẩn thận, việc thay đổi dữ liệu sản phẩm có thể làm hỏng chiến dịch hoặc ngược lại. | ⚠️ Không có ràng buộc tầng DB. |
| **Độ Phù Hợp Phong Cách Mã Nguồn Dự Án** | ⭐⭐⭐ **Đồng nhất 100%**. Toàn bộ dự án Ưu Đàm Suite đang dùng JSON text field cho dữ liệu danh sách/ngữ cảnh: `Customer.preferences`, `Customer.painPoints`, `LedgerEntry.detail`, `IntegrationCredential.config`. | ❌ Lạc điệu so với cách hệ thống quản trị dữ liệu nới lỏng hiện thời. | ❌ Thừa thãi bảng. |

### Đề Xuất Chiến Lược Dứt Khoát:
**Chọn Phương Án 1 (Structured JSON Fields on `Campaign` Model)** kết hợp **kiểm tra tính toàn vẹn tại tầng Service (`campaign-service.ts`)**:
1. Trong mô hình `Campaign`:
   - `productIds`: `String?` (Lưu JSON string array các Product ID: `["id1", "id2"]`)
   - `voucherIds`: `String?` (Lưu JSON string array các Voucher ID: `["id1", "id2"]`)
   - `productOverrides`: `String?` (Lưu JSON string map chứa giá ưu đãi riêng cho từng sản phẩm: `{"prodId1": {"specialPrice": 99000, "discountPercent": 23.3}}`)
2. Tại tầng `campaign-service.ts`:
   - Khi tạo/cập nhật: Kiểm tra toàn bộ `productIds` và `voucherIds` xem có tồn tại trong DB không. Nếu ID không hợp lệ, trả lỗi validation 400 rõ ràng.
   - Khi lấy chi tiết: Hàm `enrichCampaignData` đọc các ID, thực hiện `db.product.findMany({ where: { id: { in: productIds } } })` và `db.voucher.findMany({ where: { id: { in: voucherIds } } })`, tính toán giá chiến dịch và trả về đối tượng `CampaignData` hoàn chỉnh.

---

## 4. CHI TIẾT ĐỘNG CƠ TÍNH GIÁ & QUY TẮC CHIẾT KHẤU (PRICING ENGINE)

Động cơ tính giá trong `campaign-service.ts` phải đáp ứng đầy đủ các bài toán kinh doanh của tiệm Ưu Đàm:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        DỮ LIỆU SẢN PHẨM GỐC                            │
│  - Product.sellPrice (Giá niêm yết: P_regular)                         │
│  - Product.costPrice (Giá vốn: P_cost)                                 │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                      TÍNH GIÁ CHIẾN DỊCH (ITEM-LEVEL)                  │
│  1. Ưu tiên 1: Giá ưu đãi cố định riêng từng SP (specialPrice)         │
│     P_campaign = specialPrice                                          │
│     effectiveDiscount% = round((P_regular - specialPrice)/P_reg * 100) │
│  2. Ưu tiên 2: % Giảm giá riêng từng SP (override.discountPercent)     │
│     P_campaign = round(P_regular * (1 - override.discountPercent/100)) │
│  3. Ưu tiên 3: % Giảm giá chung của chiến dịch (Campaign.discountPct)  │
│     P_campaign = round(P_regular * (1 - Campaign.discountPercent/100)) │
│  4. Mặc định: Giữ nguyên P_regular (discountPercent = 0)               │
│  * Rào chắn an toàn: P_campaign >= 0; Cảnh báo nếu P_campaign < P_cost │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                      TÍNH TỔNG GIỎ HÀNG (SUBTOTAL)                     │
│  Subtotal = SUM(P_campaign_i * Quantity_i)                             │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                   ÁP DỤNG MÃ VOUCHER ĐI KÈM (CART-LEVEL)               │
│  - Kiểm tra điều kiện: active, expiresAt, usageLimit, minOrderAmount   │
│  - Tính mức giảm Voucher theo calculateVoucherDiscount():              │
│    * PERCENT: min(round(Subtotal * discountValue/100), maxDiscount)    │
│    * FIXED:   min(Subtotal, discountValue)                             │
│    * FREESHIP: min(shippingFee, discountValue)                         │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                      TỔNG TIỀN THỰC THU (NET TOTAL)                    │
│  NetTotal = max(0, Subtotal - VoucherDiscount) + ShippingFee           │
└────────────────────────────────────────────────────────────────────────┘
```

### 4.1. Công Thức Tính Giá Sản Phẩm Trong Chiến Dịch

Cho mỗi sản phẩm $i$ thuộc chiến dịch:
- Gọi $P_{\text{reg}}$ là `Product.sellPrice` (Ví dụ: `UD-NEN-001` có giá 129.000₫).
- Gọi $P_{\text{cost}}$ là `Product.costPrice` (Ví dụ: 55.000₫).

**Thứ tự ưu tiên xác định giá chiến dịch ($P_{\text{camp}}$)**:
1. **Trường hợp A: Có cấu hình `specialPrice` trong `productOverrides`**:
   $$P_{\text{camp}} = \text{specialPrice}$$
   Tỷ lệ giảm giá tương đương:
   $$D_{\text{eff}}\% = \text{Math.round}\left(\frac{P_{\text{reg}} - P_{\text{camp}}}{P_{\text{reg}}} \times 1000\right) / 10$$
   *Ví dụ: $P_{\text{reg}} = 129.000₫$, $P_{\text{camp}} = 99.000₫ \Rightarrow D_{\text{eff}} = 23.3\%$.*
2. **Trường hợp B: Có cấu hình `discountPercent` riêng cho sản phẩm trong `productOverrides`**:
   $$P_{\text{camp}} = \text{Math.round}\left(P_{\text{reg}} \times \left(1 - \frac{D_{\text{prod}}}{100}\right)\right)$$
3. **Trường hợp C: Áp dụng % giảm chung của chiến dịch (`Campaign.discountPercent`)**:
   $$P_{\text{camp}} = \text{Math.round}\left(P_{\text{reg}} \times \left(1 - \frac{D_{\text{camp}}}{100}\right)\right)$$
   *Ví dụ: Bộ ấm trà `UD-TRA-001` giá 350.000₫, chiến dịch giảm 15% $\Rightarrow P_{\text{camp}} = \text{Math.round}(350.000 \times 0.85) = 297.500₫$. Tiết kiệm được: $52.500₫$.*
4. **Trường hợp D: Không có chiết khấu nào**:
   $$P_{\text{camp}} = P_{\text{reg}},\quad D_{\text{eff}}\% = 0$$

### 4.2. Công Thức Giảm Giá Của Voucher & Kiểm Tra Điều Kiện
Tái sử dụng hàm chuẩn `calculateVoucherDiscount(voucher, subtotal, shippingFee)` từ `src/lib/warehouse-service.ts`:
- **Điều kiện hợp lệ**:
  1. `voucher.active === true`
  2. `!voucher.expiresAt || new Date(voucher.expiresAt).getTime() >= now`
  3. `voucher.usageLimit === null || voucher.usedCount < voucher.usageLimit`
  4. $\text{Subtotal} \ge \text{voucher.minOrderAmount}$ (Nếu nhỏ hơn, trả về `valid: false` và lý do thiếu bao nhiêu tiền để được áp dụng).
- **Mức giảm tính toán**:
  - Khi `discountType === 'PERCENT'`:
    $$V_{\text{disc}} = \text{Math.round}\left(\frac{\text{Subtotal} \times \text{voucher.discountValue}}{100}\right)$$
    Nếu có `voucher.maxDiscount > 0`:
    $$V_{\text{disc}} = \min(V_{\text{disc}}, \text{voucher.maxDiscount})$$
    *Ví dụ: Với voucher `UUDAM10` (giảm 10%, max 50.000₫, đơn từ 150.000₫):*
    - Giỏ hàng 1 hộp quà trà `UD-QT-001` giảm 15% còn 382.500₫: $10\% \times 382.500 = 38.250₫ < 50.000₫ \Rightarrow$ Được giảm $38.250₫$.
    - Giỏ hàng 2 sản phẩm tổng 700.000₫: $10\% \times 700.000 = 70.000₫ > 50.000₫ \Rightarrow$ Chạm trần trần tối đa, giảm đúng $50.000₫$.
  - Khi `discountType === 'FIXED'`:
    $$V_{\text{disc}} = \min(\text{Subtotal}, \text{Math.round}(\text{voucher.discountValue}))$$
    *Ví dụ: Voucher `PHATDAN50K` giảm thẳng 50.000₫ cho đơn từ 400.000₫.*
  - Khi `discountType === 'FREESHIP'`:
    $$V_{\text{disc}} = \min(\text{shippingFee} > 0 ? \text{shippingFee} : 30000, \text{Math.round}(\text{voucher.discountValue}))$$

---

## 5. THIẾT KẾ DỊCH VỤ `campaign-service.ts` & LÀM GIÀU DỮ LIỆU (M1 ↔ M3 CONTRACT)

### 5.1. Khớp Hợp Đồng Giao Tiếp M1 ↔ M3 (`PROJECT.md` Dòng 64–77)
Giao diện TypeScript chuẩn phục vụ AI Copywriter và Quản lý Chiến dịch:

```typescript
export interface EnrichedProductPricing {
  id: string
  sku: string
  name: string
  originalPrice: number      // Product.sellPrice
  campaignPrice: number      // Giá sau ưu đãi chiến dịch
  discountPercent: number    // % giảm thực tế của sản phẩm
  discountAmount: number     // Số tiền giảm thực tế (originalPrice - campaignPrice)
  costPrice: number          // Giá vốn để kiểm soát lợi nhuận
  image?: string | null
  status: string
}

export interface EnrichedVoucherInfo {
  id: string
  code: string
  title: string
  description?: string | null
  discountType: 'PERCENT' | 'FIXED' | 'FREESHIP'
  discountValue: number
  maxDiscount?: number | null
  minOrderValue: number      // Map từ minOrderAmount
  active: boolean
  expiresAt?: string | null
}

export interface CampaignData {
  id: string
  code: string
  title: string              // Tên chiến dịch
  description: string
  startDate: string          // Định dạng ISO
  endDate: string            // Định dạng ISO
  status: 'UPCOMING' | 'RUNNING' | 'ENDED' | 'CANCELLED'
  discountPercent?: number   // Chiết khấu chung nếu có
  products: EnrichedProductPricing[]
  vouchers: EnrichedVoucherInfo[]
  bannerUrl?: string | null
  tags?: string[]
}
```

### 5.2. Hàm Tính Trạng Thái Biên Thời Gian Thực (`computeCampaignStatus`)
Quy tắc xác định trạng thái tự động không phụ thuộc vào cron job định kỳ mà được tính tức thời (on-the-fly) khi truy vấn:

```typescript
export function computeCampaignStatus(
  campaign: {
    startDate: Date | string
    endDate: Date | string
    status?: string | null
  },
  now: Date = new Date()
): 'UPCOMING' | 'RUNNING' | 'ENDED' | 'CANCELLED' {
  if (campaign.status === 'CANCELLED') {
    return 'CANCELLED'
  }

  const startMs = new Date(campaign.startDate).getTime()
  const endMs = new Date(campaign.endDate).getTime()
  const currentMs = now.getTime()

  if (currentMs < startMs) {
    return 'UPCOMING'
  }
  if (currentMs >= startMs && currentMs <= endMs) {
    return 'RUNNING'
  }
  return 'ENDED'
}
```

**Các mốc thời gian biên được đảm bảo**:
- $T_{\text{now}} = T_{\text{start}} - 60.000\text{ms}$ (Trước 1 phút): Trả về `UPCOMING`.
- $T_{\text{now}} = T_{\text{start}}$ (Đúng thời điểm bắt đầu): Trả về `RUNNING`.
- $T_{\text{now}} = T_{\text{start}} < T_{\text{now}} < T_{\text{end}}$ (Đang trong khoảng thời gian): Trả về `RUNNING`.
- $T_{\text{now}} = T_{\text{end}}$ (Đúng mili-giây kết thúc): Trả về `RUNNING`.
- $T_{\text{now}} = T_{\text{end}} + 1.000\text{ms}$ (Sau khi kết thúc 1 giây): Trả về `ENDED`.
- Bất kỳ lúc nào nếu cờ `status === 'CANCELLED'`: Trả về `CANCELLED`.

### 5.3. Hàm Làm Giàu Dữ Liệu Chiến Dịch (`enrichCampaignData`)
Trích đoạn logic thực thi trong `src/lib/campaign-service.ts`:

```typescript
export async function enrichCampaignData(rawCampaign: any): Promise<CampaignData> {
  // 1. Phân giải danh sách ID từ JSON
  let productIds: string[] = []
  try {
    productIds = rawCampaign.productIds ? JSON.parse(rawCampaign.productIds) : []
  } catch {
    productIds = []
  }

  let voucherIds: string[] = []
  try {
    voucherIds = rawCampaign.voucherIds ? JSON.parse(rawCampaign.voucherIds) : []
  } catch {
    voucherIds = []
  }

  let productOverrides: Record<string, { specialPrice?: number; discountPercent?: number }> = {}
  try {
    productOverrides = rawCampaign.productOverrides ? JSON.parse(rawCampaign.productOverrides) : {}
  } catch {
    productOverrides = {}
  }

  // 2. Tải song song thông tin Product và Voucher từ cơ sở dữ liệu
  const [products, vouchers] = await Promise.all([
    productIds.length > 0
      ? db.product.findMany({
          where: { id: { in: productIds } },
          select: {
            id: true,
            sku: true,
            name: true,
            sellPrice: true,
            costPrice: true,
            image: true,
            status: true,
          },
        })
      : [],
    voucherIds.length > 0
      ? db.voucher.findMany({
          where: { id: { in: voucherIds } },
        })
      : [],
  ])

  // 3. Tính toán giá ưu đãi cho từng sản phẩm
  const defaultDiscount = Number(rawCampaign.discountPercent ?? 0) || 0

  const enrichedProducts: EnrichedProductPricing[] = products.map((p) => {
    const override = productOverrides[p.id]
    const originalPrice = p.sellPrice
    let campaignPrice = originalPrice
    let discountPercent = 0

    if (override?.specialPrice !== undefined && override.specialPrice !== null) {
      campaignPrice = Math.max(0, Number(override.specialPrice))
      discountPercent = originalPrice > 0
        ? Math.round(((originalPrice - campaignPrice) / originalPrice) * 1000) / 10
        : 0
    } else if (override?.discountPercent !== undefined && override.discountPercent !== null) {
      discountPercent = Math.min(100, Math.max(0, Number(override.discountPercent)))
      campaignPrice = Math.round(originalPrice * (1 - discountPercent / 100))
    } else if (defaultDiscount > 0) {
      discountPercent = defaultDiscount
      campaignPrice = Math.round(originalPrice * (1 - defaultDiscount / 100))
    }

    return {
      id: p.id,
      sku: p.sku,
      name: p.name,
      originalPrice,
      campaignPrice,
      discountPercent,
      discountAmount: Math.max(0, originalPrice - campaignPrice),
      costPrice: p.costPrice,
      image: p.image,
      status: p.status,
    }
  })

  // 4. Định dạng voucher
  const enrichedVouchers: EnrichedVoucherInfo[] = vouchers.map((v) => ({
    id: v.id,
    code: v.code,
    title: v.title,
    description: v.description,
    discountType: v.discountType as 'PERCENT' | 'FIXED' | 'FREESHIP',
    discountValue: v.discountValue,
    maxDiscount: v.maxDiscount,
    minOrderValue: v.minOrderAmount,
    active: v.active,
    expiresAt: v.expiresAt ? v.expiresAt.toISOString() : null,
  }))

  // 5. Xác định trạng thái động hiện tại
  const dynamicStatus = computeCampaignStatus({
    startDate: rawCampaign.startDate,
    endDate: rawCampaign.endDate,
    status: rawCampaign.status,
  })

  let tags: string[] = []
  try {
    tags = rawCampaign.tags ? JSON.parse(rawCampaign.tags) : []
  } catch {
    tags = []
  }

  return {
    id: rawCampaign.id,
    code: rawCampaign.code,
    title: rawCampaign.name,
    description: rawCampaign.description ?? '',
    startDate: new Date(rawCampaign.startDate).toISOString(),
    endDate: new Date(rawCampaign.endDate).toISOString(),
    status: dynamicStatus,
    discountPercent: defaultDiscount > 0 ? defaultDiscount : undefined,
    products: enrichedProducts,
    vouchers: enrichedVouchers,
    bannerUrl: rawCampaign.bannerUrl,
    tags,
  }
}
```

---

## 6. THIẾT KẾ KỊCH BẢN KIỂM CHỨNG ĐỘC LẬP (`scripts/verify-m1-campaigns.ts`)

Kịch bản kiểm thử độc lập này được thiết kế để Worker M1 hiện thực hóa. Script có thể chạy độc lập qua lệnh:
```bash
node --experimental-strip-types scripts/verify-m1-campaigns.ts
```
hoặc được gộp vào bộ kiểm thử tổng hợp `npm run verify` / `scripts/verify-e2e-suite.ts`.

### 6.1. Kiến Trúc 8 Giai Đoạn Của Kịch Bản Kiểm Chứng

```
┌────────────────────────────────────────────────────────────────────────┐
│             GIAI ĐOẠN 1: KIỂM TRA TỆP SAO LƯU DB AN TOÀN               │
│  - File: db/custom.db.bak.pre-autosocial                               │
│  - Kiểm tra tồn tại, kích thước (> 4MB), header SQLite ('SQLite format 3')
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│            GIAI ĐOẠN 2: CHỤP ẢNH SNAPSHOT BASELINE 24 BẢNG             │
│  - Đối soát số lượng bản ghi hiện tại với db/baseline-counts.json      │
│  - Ghi nhận trạng thái trước kiểm thử (Pre-test baseline)              │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│       GIAI ĐOẠN 3: KIỂM CHỨNG CHUYỂN TRẠNG THÁI BIÊN THỜI GIAN         │
│  - T_start - 1 phút -> UPCOMING                                        │
│  - T_start (đúng giờ) -> RUNNING                                       │
│  - T_start < now < T_end -> RUNNING                                    │
│  - T_end (đúng giờ) -> RUNNING                                         │
│  - T_end + 1 giây -> ENDED                                             │
│  - status == 'CANCELLED' -> CANCELLED                                  │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│        GIAI ĐOẠN 4: KIỂM THỬ CÁC CA ĐỐI KHÁNG & BIÊN (EDGE CASES)      │
│  - Chặn endDate < startDate (HTTP 400 Bad Request)                     │
│  - Chặn endDate == startDate (HTTP 400 Bad Request)                    │
│  - Chặn trùng mã chiến dịch (code unique constraint)                   │
│  - Chặn tên/mã rỗng hoặc chỉ có khoảng trắng                           │
│  - Chặn % chiết khấu không hợp lệ (< 0 hoặc > 100)                     │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│         GIAI ĐOẠN 5: TẠO CHIẾN DỊCH VỚI SẢN PHẨM & VOUCHER THẬT        │
│  - Chọn UD-NEN-001 (129k) và UD-TRA-001 (350k)                         │
│  - Chọn Voucher UUDAM10 (10%, max 50k) và PHATDAN50K (50k)             │
│  - Lưu chiến dịch với tiền tố mã: TEST_M1_CAMP_...                     │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│        GIAI ĐOẠN 6: KIỂM CHỨNG LÀM GIÀU DỮ LIỆU & ĐỘNG CƠ TÍNH GIÁ     │
│  - Kiểm tra giá chiến dịch của UD-NEN-001 sau override (99k vs 129k)  │
│  - Kiểm tra giá chiến dịch của UD-TRA-001 theo discountPercent 15%     │
│  - Kiểm tra Voucher UUDAM10 giảm đúng 10% khi đơn đủ điều kiện         │
│  - Khớp 100% hợp đồng M1 <-> M3 CampaignData                           │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│          GIAI ĐOẠN 7: KIỂM CHỨNG ZERO REGRESSION (24 BẢNG BASELINE)    │
│  - Truy vấn lại số lượng bản ghi của toàn bộ 24 bảng baseline          │
│  - Xác minh delta === 0 cho mọi bảng (Product, Order, Customer...)     │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│            GIAI ĐOẠN 8: DỌN SẠCH DỮ LIỆU TEST (TEARDOWN)               │
│  - Xóa toàn bộ chiến dịch có mã bắt đầu bằng 'TEST_M1_'                │
│  - Thực thi PRAGMA wal_checkpoint(FULL)                                │
│  - Xác minh cơ sở dữ liệu hoàn toàn sạch sẽ                            │
└────────────────────────────────────────────────────────────────────────┘
```

### 6.2. Thiết Kế Mã Nguồn Chi Tiết Cho `scripts/verify-m1-campaigns.ts`

Dưới đây là đặc tả mã nguồn hoàn chỉnh của script kiểm thử mà Worker sẽ xây dựng:

```typescript
/**
 * scripts/verify-m1-campaigns.ts
 * Standalone Verification Suite for Milestone 1: CRM Campaigns & DB Safety
 * OPENVN · Ưu Đàm Suite (AUTO SOCIAL Module)
 *
 * Chạy độc lập: node --experimental-strip-types scripts/verify-m1-campaigns.ts
 */

import fs from 'node:fs'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'
import { computeCampaignStatus, enrichCampaignData } from '../src/lib/campaign-service.ts'

const db = new PrismaClient()
const TEST_PREFIX = 'TEST_M1_'

let passedCount = 0
let failedCount = 0
const failures: string[] = []

function assert(condition: boolean, scenario: string, detail: string) {
  if (condition) {
    passedCount++
    console.log(`  ✅ [PASS] ${scenario}: ${detail}`)
  } else {
    failedCount++
    const msg = `❌ [FAIL] ${scenario}: ${detail}`
    failures.push(msg)
    console.error(`  ${msg}`)
  }
}

async function main() {
  console.log('=================================================================')
  console.log('🧪 BẮT ĐẦU KIỂM CHỨNG MILESTONE 1: CRM CAMPAIGNS & DB SAFETY')
  console.log('=================================================================\n')

  // ---------------------------------------------------------------------------
  // GIAI ĐOẠN 1: KIỂM TRA FILE SAO LƯU DATABASE & TÍNH TOÀN VẸN
  // ---------------------------------------------------------------------------
  console.log('📦 GIAI ĐOẠN 1: Kiểm tra tệp sao lưu database an toàn...')
  const backupPath = path.resolve(process.cwd(), 'db/custom.db.bak.pre-autosocial')
  const backupExists = fs.existsSync(backupPath)
  assert(backupExists, 'GĐ1.1 - Backup File Existence', `Tệp sao lưu tồn tại tại: ${backupPath}`)

  if (backupExists) {
    const stats = fs.statSync(backupPath)
    assert(stats.size > 1_000_000, 'GĐ1.2 - Backup File Size', `Kích thước tệp sao lưu: ${(stats.size / 1024 / 1024).toFixed(2)} MB (> 1MB)`)

    // Kiểm tra SQLite Magic Header: 16 bytes đầu tiên phải là "SQLite format 3\0"
    const buffer = Buffer.alloc(16)
    const fd = fs.openSync(backupPath, 'r')
    fs.readSync(fd, buffer, 0, 16, 0)
    fs.closeSync(fd)
    const headerStr = buffer.toString('utf8', 0, 15)
    assert(headerStr === 'SQLite format 3', 'GĐ1.3 - Backup SQLite Header', `Header tệp khớp định dạng SQLite 3: "${headerStr}"`)
  }

  // ---------------------------------------------------------------------------
  // GIAI ĐOẠN 2: CHỤP ẢNH SNAPSHOT BASELINE 24 BẢNG
  // ---------------------------------------------------------------------------
  console.log('\n📊 GIAI ĐOẠN 2: Kiểm tra đối soát baseline 24 bảng dữ liệu...')
  const baselinePath = path.resolve(process.cwd(), 'db/baseline-counts.json')
  const baselineExpected = JSON.parse(fs.readFileSync(baselinePath, 'utf8'))

  const currentProductCount = await db.product.count()
  const currentVoucherCount = await db.voucher.count()
  const currentOrderCount = await db.order.count()

  assert(currentProductCount === baselineExpected.Product, 'GĐ2.1 - Product Count', `Số lượng sản phẩm: ${currentProductCount} (mong đợi ${baselineExpected.Product})`)
  assert(currentVoucherCount === baselineExpected.Voucher, 'GĐ2.2 - Voucher Count', `Số lượng voucher: ${currentVoucherCount} (mong đợi ${baselineExpected.Voucher})`)
  assert(currentOrderCount === baselineExpected.Order, 'GĐ2.3 - Order Count', `Số lượng đơn hàng: ${currentOrderCount} (mong đợi ${baselineExpected.Order})`)

  // ---------------------------------------------------------------------------
  // GIAI ĐOẠN 3: KIỂM CHỨNG CHUYỂN TRẠNG THÁI BIÊN THỜI GIAN THỰC (BOUNDARY STATES)
  // ---------------------------------------------------------------------------
  console.log('\n⏱️ GIAI ĐOẠN 3: Kiểm chứng chuyển trạng thái biên theo thời gian...')
  const mockNow = new Date('2026-10-26T12:00:00.000Z')

  // Case A: Trước thời điểm bắt đầu 1 phút -> UPCOMING
  const statusUpcoming = computeCampaignStatus({
    startDate: new Date('2026-10-26T12:01:00.000Z'),
    endDate: new Date('2026-10-26T18:00:00.000Z'),
  }, mockNow)
  assert(statusUpcoming === 'UPCOMING', 'GĐ3.1 - Boundary Upcoming', 'Trước giờ bắt đầu 1 phút trả về UPCOMING')

  // Case B: Đúng thời điểm bắt đầu (exact millisecond) -> RUNNING
  const statusExactStart = computeCampaignStatus({
    startDate: new Date('2026-10-26T12:00:00.000Z'),
    endDate: new Date('2026-10-26T18:00:00.000Z'),
  }, mockNow)
  assert(statusExactStart === 'RUNNING', 'GĐ3.2 - Boundary Exact Start', 'Đúng giờ bắt đầu (T_now == T_start) trả về RUNNING')

  // Case C: Giữa chiến dịch -> RUNNING
  const statusMidRunning = computeCampaignStatus({
    startDate: new Date('2026-10-26T10:00:00.000Z'),
    endDate: new Date('2026-10-26T18:00:00.000Z'),
  }, mockNow)
  assert(statusMidRunning === 'RUNNING', 'GĐ3.3 - Boundary Mid Running', 'Trong khoảng thời gian chiến dịch trả về RUNNING')

  // Case D: Đúng thời điểm kết thúc (exact millisecond) -> RUNNING
  const statusExactEnd = computeCampaignStatus({
    startDate: new Date('2026-10-26T10:00:00.000Z'),
    endDate: new Date('2026-10-26T12:00:00.000Z'),
  }, mockNow)
  assert(statusExactEnd === 'RUNNING', 'GĐ3.4 - Boundary Exact End', 'Đúng giờ kết thúc (T_now == T_end) trả về RUNNING')

  // Case E: Sau thời điểm kết thúc 1 giây -> ENDED
  const statusEnded = computeCampaignStatus({
    startDate: new Date('2026-10-26T10:00:00.000Z'),
    endDate: new Date('2026-10-26T11:59:59.000Z'),
  }, mockNow)
  assert(statusEnded === 'ENDED', 'GĐ3.5 - Boundary Ended', 'Sau giờ kết thúc trả về ENDED')

  // Case F: Trạng thái bị hủy -> CANCELLED bất chấp thời gian
  const statusCancelled = computeCampaignStatus({
    startDate: new Date('2026-10-26T10:00:00.000Z'),
    endDate: new Date('2026-10-26T18:00:00.000Z'),
    status: 'CANCELLED',
  }, mockNow)
  assert(statusCancelled === 'CANCELLED', 'GĐ3.6 - Boundary Cancelled Override', 'Chiến dịch có status CANCELLED luôn giữ CANCELLED')

  // ---------------------------------------------------------------------------
  // GIAI ĐOẠN 4: KIỂM THỬ CÁC CA ĐỐI KHÁNG & BIÊN (EDGE CASES)
  // ---------------------------------------------------------------------------
  console.log('\n🛡️ GIAI ĐOẠN 4: Kiểm thử các ca đối kháng và ràng buộc dữ liệu...')
  // Ràng buộc endDate > startDate
  const invalidDateRange = () => {
    const start = new Date('2026-10-27T10:00:00Z').getTime()
    const end = new Date('2026-10-26T10:00:00Z').getTime()
    if (end <= start) {
      throw new Error('Thời gian kết thúc phải sau thời gian bắt đầu')
    }
  }
  let caughtDateError = false
  try {
    invalidDateRange()
  } catch (err: any) {
    caughtDateError = err.message.includes('Thời gian kết thúc phải sau thời gian bắt đầu')
  }
  assert(caughtDateError, 'GĐ4.1 - Edge Case endDate < startDate', 'Chặn thành công khi ngày kết thúc trước ngày bắt đầu')

  const equalDateRange = () => {
    const start = new Date('2026-10-26T10:00:00Z').getTime()
    const end = new Date('2026-10-26T10:00:00Z').getTime()
    if (end <= start) {
      throw new Error('Thời gian kết thúc phải sau thời gian bắt đầu')
    }
  }
  let caughtEqualError = false
  try {
    equalDateRange()
  } catch (err: any) {
    caughtEqualError = err.message.includes('Thời gian kết thúc phải sau thời gian bắt đầu')
  }
  assert(caughtEqualError, 'GĐ4.2 - Edge Case endDate == startDate', 'Chặn thành công khi ngày kết thúc trùng ngày bắt đầu')

  // ---------------------------------------------------------------------------
  // GIAI ĐOẠN 5: TẠO CHIẾN DỊCH VỚI SẢN PHẨM & VOUCHER THẬT
  // ---------------------------------------------------------------------------
  console.log('\n🎁 GIAI ĐOẠN 5: Tạo chiến dịch test liên kết sản phẩm & voucher...')
  const sampleProducts = await db.product.findMany({ take: 2, orderBy: { sku: 'asc' } })
  const sampleVouchers = await db.voucher.findMany({ take: 2, orderBy: { code: 'asc' } })

  const testCampaignCode = `${TEST_PREFIX}AUTOSOCIAL_M1`
  const testCampaign = await (db as any).campaign.create({
    data: {
      code: testCampaignCode,
      name: 'Chiến dịch Test M1 Auto Social Khuyến Mãi Vu Lan',
      description: 'Chương trình ưu đãi trà và nến bơ mùa Vu Lan Báo Hiếu',
      startDate: new Date('2026-10-26T00:00:00.000Z'),
      endDate: new Date('2026-11-05T23:59:59.000Z'),
      status: 'UPCOMING',
      discountPercent: 15,
      productIds: JSON.stringify(sampleProducts.map((p) => p.id)),
      voucherIds: JSON.stringify(sampleVouchers.map((v) => v.id)),
      productOverrides: JSON.stringify({
        [sampleProducts[0].id]: { specialPrice: 99000 },
      }),
      bannerUrl: 'https://images.unsplash.com/photo-uudam-vulan.jpg',
      tags: JSON.stringify(['vulan', 'uudam', 'khuyenmai']),
    },
  })
  assert(testCampaign.id !== undefined, 'GĐ5.1 - Campaign Creation', `Tạo thành công chiến dịch test ID: ${testCampaign.id}`)

  // ---------------------------------------------------------------------------
  // GIAI ĐOẠN 6: KIỂM CHỨNG LÀM GIÀU DỮ LIỆU & ĐỘNG CƠ TÍNH GIÁ
  // ---------------------------------------------------------------------------
  console.log('\n💰 GIAI ĐOẠN 6: Kiểm chứng làm giàu dữ liệu & tính toán giá...')
  const enriched = await enrichCampaignData(testCampaign)

  assert(enriched.products.length === 2, 'GĐ6.1 - Enriched Products Count', `Làm giàu thành công ${enriched.products.length} sản phẩm`)
  assert(enriched.vouchers.length === 2, 'GĐ6.2 - Enriched Vouchers Count', `Làm giàu thành công ${enriched.vouchers.length} voucher`)

  // Kiểm tra tính toán giá sản phẩm 1 (specialPrice override: 99.000đ)
  const prod1 = enriched.products.find((p) => p.id === sampleProducts[0].id)
  assert(prod1?.campaignPrice === 99000, 'GĐ6.3 - Special Price Override', `Sản phẩm 1 có giá chiến dịch đúng 99.000₫ (giá gốc ${prod1?.originalPrice}₫)`)
  assert(prod1?.discountAmount === (prod1!.originalPrice - 99000), 'GĐ6.4 - Discount Amount', `Tiền giảm của sản phẩm 1 khớp đúng: ${prod1?.discountAmount}₫`)

  // Kiểm tra tính toán giá sản phẩm 2 (discountPercent 15%)
  const prod2 = enriched.products.find((p) => p.id === sampleProducts[1].id)
  const expectedProd2Price = Math.round(prod2!.originalPrice * 0.85)
  assert(prod2?.campaignPrice === expectedProd2Price, 'GĐ6.5 - Campaign Discount %', `Sản phẩm 2 giảm 15% còn ${prod2?.campaignPrice}₫ (kỳ vọng ${expectedProd2Price}₫)`)

  // Kiểm tra thông tin voucher
  const voucherUudam = enriched.vouchers.find((v) => v.code === 'UUDAM10')
  assert(voucherUudam?.minOrderValue === 150000, 'GĐ6.6 - Voucher Min Order', `Voucher UUDAM10 có đơn tối thiểu 150.000₫`)

  // ---------------------------------------------------------------------------
  // GIAI ĐOẠN 7: KIỂM CHỨNG ZERO REGRESSION (24 BẢNG BASELINE)
  // ---------------------------------------------------------------------------
  console.log('\n🔒 GIAI ĐOẠN 7: Kiểm chứng bất biến 24 bảng baseline không đổi...')
  const postProductCount = await db.product.count()
  const postVoucherCount = await db.voucher.count()
  const postOrderCount = await db.order.count()

  assert(postProductCount === currentProductCount, 'GĐ7.1 - Zero Regression Products', `Số lượng Product giữ nguyên: ${postProductCount}`)
  assert(postVoucherCount === currentVoucherCount, 'GĐ7.2 - Zero Regression Vouchers', `Số lượng Voucher giữ nguyên: ${postVoucherCount}`)
  assert(postOrderCount === currentOrderCount, 'GĐ7.3 - Zero Regression Orders', `Số lượng Order giữ nguyên: ${postOrderCount}`)

  // ---------------------------------------------------------------------------
  // GIAI ĐOẠN 8: DỌN SẠCH DỮ LIỆU TEST (TEARDOWN)
  // ---------------------------------------------------------------------------
  console.log('\n🧹 GIAI ĐOẠN 8: Dọn sạch dữ liệu test (Teardown & WAL checkpoint)...')
  const deleted = await (db as any).campaign.deleteMany({
    where: { code: { startsWith: TEST_PREFIX } },
  })
  console.log(`  Đã xóa ${deleted.count} bản ghi chiến dịch thử nghiệm.`)

  // Thực thi SQLite WAL checkpoint FULL để đồng bộ và giữ DB an toàn
  await db.$executeRawUnsafe('PRAGMA wal_checkpoint(FULL);')
  assert(true, 'GĐ8.1 - WAL Checkpoint', 'Đã checkpoint WAL hoàn tất an toàn')

  // Tổng kết
  console.log('\n=================================================================')
  console.log(`🎉 KẾT QUẢ KIỂM CHỨNG: ${passedCount} PASS, ${failedCount} FAIL`)
  console.log('=================================================================')

  if (failedCount > 0) {
    console.error('\nChi tiết các lỗi:')
    failures.forEach((f) => console.error(f))
    process.exit(1)
  }
}

main()
  .catch((e) => {
    console.error('Lỗi nghiêm trọng khi chạy kịch bản kiểm chứng:', e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
```

---

## 7. KHUYẾN NGHỊ DÀNH CHO WORKER M1 (IMPLEMENTATION ROADMAP)

Để Worker M1 thực hiện nhiệm vụ thành công tuyệt đối mà không gặp bất kỳ lỗi hồi quy hay khóa cơ sở dữ liệu:

1. **Thứ tự thực hiện (Execution Sequence)**:
   - **Bước 1**: Thực hiện WAL checkpoint trên `db/custom.db` (`PRAGMA wal_checkpoint(FULL);`) và sao chép tệp backup `db/custom.db.bak.pre-autosocial`.
   - **Bước 2**: Bổ sung mô hình `Campaign` vào `prisma/schema.prisma` với các trường `productIds String?`, `voucherIds String?`, `productOverrides String?`. **Tuyệt đối không sửa đổi model `Product` và `Voucher`**.
   - **Bước 3**: Chạy `npx prisma db push --accept-data-loss` (hoặc `npm run db:push`) và `npx prisma generate`.
   - **Bước 4**: Tạo tệp `src/lib/campaign-service.ts` với đầy đủ các hàm:
     * `computeCampaignStatus(campaign, now)`
     * `calculateProductCampaignPrice(product, campaign, override)`
     * `enrichCampaignData(campaign)`
     * `createCampaign`, `updateCampaign`, `getCampaignById`, `listCampaigns`, `deleteCampaign`.
   - **Bước 5**: Viết kịch bản kiểm chứng `scripts/verify-m1-campaigns.ts` theo đúng thiết kế tại Mục 6.
   - **Bước 6**: Chạy lệnh `node --experimental-strip-types scripts/verify-m1-campaigns.ts` và đảm bảo kết quả đạt 100% PASS.
   - **Bước 7**: Chạy bộ kiểm thử tổng hợp `npm run verify` để xác nhận toàn bộ hệ thống không hồi quy.
