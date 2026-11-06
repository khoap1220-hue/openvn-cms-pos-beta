# Khảo Sát & Đo Lường Cơ Sở Hạ Tầng Kiểm Thử (Test Infrastructure & Baseline Survey)
**Hệ thống**: OPENVN · Ưu Đàm Suite (Next.js 16 + Prisma/SQLite)  
**Agent thực hiện**: `explorer_survey_3` (Test Infrastructure & Baseline Explorer)  
**Thời điểm khảo sát**: 2026-10-26T07:28:00Z  
**Đường dẫn thư mục làm việc**: `.agents/teamwork/explorer_survey_3/`

---

## 1. Tổng Quan Scripts Trong `package.json`

| Script | Lệnh thực thi | Mục đích | Thời gian chạy | Kết quả Baseline |
| :--- | :--- | :--- | :--- | :--- |
| `dev` | `next dev -p 3010` | Khởi động Next.js server cổng 3010 | - | Đang chạy nền |
| `dev:realtime` | `node --watch mini-services/realtime/index.ts` | Realtime Socket.io bus cổng 3013 | - | Đang chạy nền |
| `build` | `next build && node -e "..."` | Build Next.js 16 standalone + copy static/public | ~35s | **PASS (0 lỗi)**, 3 cảnh báo Turbopack tracing |
| `lint` | `eslint src` | Kiểm tra cú pháp, convention ESLint v9 | ~8s | **PASS (0 lỗi, 0 cảnh báo)** |
| `test:chain` | `node --experimental-strip-types scripts/verify-chain.ts` | Kiểm toán chuỗi biến động kho `StockMovement` | ~2s | **PASS (0 lỗi)**, chuỗi đơn điệu khớp tồn kho |
| `test:scenarios` | `node --experimental-strip-types scripts/verify-realworld-scenarios.ts` | Kiểm thử 21 kịch bản thực tế & đối kháng qua HTTP `:3010` | ~12s | **PASS (21/21 PASS, 0 fail)** |
| `verify` | `tsc --noEmit && npm run lint && npm run test:chain && npm run test:scenarios` | Cổng chất lượng mã nguồn tổng hợp 4 bước | ~24s | **PASS (0 lỗi, 0 cảnh báo)** |
| `db:push` | `prisma db push --accept-data-loss` | Đồng bộ schema Prisma vào SQLite | - | Sử dụng khi sửa schema |
| `db:generate` | `prisma generate` | Sinh Prisma client types | - | Sẵn sàng |

### Đặc điểm kiến trúc Test Runner
- **Không sử dụng Jest hay Vitest**: Toàn bộ kiểm thử hiện tại sử dụng cơ chế **Node.js 22+ native `--experimental-strip-types`** chạy trực tiếp các file TypeScript trong thư mục `scripts/`.
- **Zero test framework dependency**: Giúp tốc độ khởi động cực nhanh (< 1 giây) và không bị ảnh hưởng bởi các xung đột cấu hình loader của Jest/ESM trong môi trường Next.js 16.
- **Môi trường yêu cầu**: `test:scenarios` yêu cầu Next.js dev server đang chạy tại `http://localhost:3010`. `test:chain` kết nối trực tiếp database SQLite qua PrismaClient mà không cần web server.

---

## 2. Kiểm Tra Chi Tiết Kịch Bản Kiểm Thử Hiện Có (`test:scenarios`)

File: `scripts/verify-realworld-scenarios.ts` (740 dòng)  
Cấu trúc kiểm thử gồm **21 bước kiểm định (20 kịch bản nghiệp vụ + 1 bước dọn dẹp sạch CSDL)**:

1. **Kịch bản 1 (Định mức BOM & Tồn kho Combo tự động)**:
   - Tạo SP thành phần A (cost 100k, sell 200k, stock 10) và B (cost 50k, sell 120k, stock 6).
   - Tạo SP Combo (2A + 1B). Gọi `POST /api/bom` cấu hình định mức.
   - Khẳng định: Tồn kho Combo tự tính = `min(10/2, 6/1) = 5`, giá vốn tự động tính từ BOM = 250.000đ.
2. **Kịch bản 2 (Chặn điều chỉnh kho thủ công trên SP Combo)**:
   - Thử gọi `POST /api/inventory` trực tiếp vào sản phẩm Combo.
   - Khẳng định: Bị chặn với mã `400 Bad Request` và thông báo lỗi rõ ràng.
3. **Kịch bản 3 (Đồng bộ dây chuyền Thành phần -> Combo)**:
   - Nhập kho +4 SP thành phần A (10 -> 14).
   - Khẳng định: Tồn kho Combo tự động tăng từ 5 lên `min(floor(14/2), 6) = 6` bộ.
4. **Kịch bản 4 (Chặn đặt hàng vượt tồn kho gộp Lẻ + Combo)**:
   - Đặt 10 A lẻ + 3 bộ Combo (cần 3*2 = 6 A -> tổng cần 16 A > tồn kho 14).
   - Khẳng định: `POST /api/orders` bị chặn `400` với thông báo "chỉ còn 14 trong kho".
5. **Kịch bản 5 (Chặn đặt hàng sản phẩm Ngừng kinh doanh)**:
   - Chuyển SP B sang `INACTIVE`. Đặt hàng SP B.
   - Khẳng định: `POST /api/orders` bị chặn `400` ("ngừng kinh doanh"). Phục hồi lại `ACTIVE`.
6. **Kịch bản 6 (Nhận diện SĐT Hội viên & Trừ kho Lẻ + Combo chuẩn xác)**:
   - Tạo khách hàng với SĐT test, nâng cấp hội viên.
   - Đặt đơn hàng chỉ truyền SĐT và tên khách (không truyền `customerId`).
   - Khẳng định: Đơn hàng tự động liên kết đúng `customerId`, trừ kho chuẩn xác, tồn Combo cập nhật đúng.
7. **Kịch bản 7 (Đồng bộ Vận đơn DELIVERED -> Đơn COMPLETED & Chống cộng trùng điểm)**:
   - Chuyển trạng thái đơn -> tạo vận đơn -> chuyển vận đơn sang `DELIVERED`.
   - Khẳng định: Đơn hàng tự động thành `COMPLETED` + `PAID`, cộng điểm hội viên 88 điểm.
   - Thử gọi lại `PATCH /api/orders/[id]` với status `COMPLETED` lần 2 -> điểm không đổi (Idempotent 100%).
8. **Kịch bản 8 (Chặn xuất trùng Hóa đơn bán ra cho cùng 1 đơn hàng)**:
   - Lập hóa đơn bán ra `SalesInvoice` cho đơn hàng trên.
   - Gọi tạo tiếp hóa đơn bán lẻ thứ 2 cho cùng đơn hàng.
   - Khẳng định: Bị chặn `400` ("đã có hóa đơn bán hiệu lực").
9. **Kịch bản 9 (Xuất & Hủy Hóa đơn bán lẻ Combo hoàn kho thành phần BOM)**:
   - Xuất hóa đơn bán lẻ trực tiếp 2 bộ Combo tại quầy (không qua Order).
   - Tồn kho A giảm từ 10 xuống 6, Combo giảm từ 5 xuống 3.
   - Hủy hóa đơn bán lẻ `POST /api/sales-invoices/[id] { action: 'CANCEL' }`.
   - Khẳng định: Kho A hoàn về 10, Combo hoàn về 5 (`COMBO_ISSUE` reverse).
10. **Kịch bản 10 (Hủy đơn hoàn kho & Chặn mở lại đơn đã hủy)**:
    - Tạo đơn nháp rồi chuyển `CANCELLED` -> hoàn kho thành công.
    - Cố tình chuyển ngược đơn `CANCELLED` về `CONFIRMED`.
    - Khẳng định: Bị chặn `400` ("Đơn hàng đã hủy, không thể chuyển lại trạng thái khác").
11. **Kịch bản 11 (Khóa kỳ kế toán chặn xuất hóa đơn lùi ngày)**:
    - Đóng sổ kỳ Q1/2025 qua `POST /api/periods { action: 'CLOSE', year: 2025, quarter: 1 }`.
    - Thử tạo hóa đơn bán hàng có ngày hóa đơn trong Q1/2025.
    - Khẳng định: Bị chặn `409 Conflict` (`PeriodClosedError`). Mở lại kỳ Q1/2025 an toàn.
12. **Kịch bản 12 (Bảo vệ Hậu mãi: Chặn hoàn tiền vượt tổng đơn & Chặn đơn đã hủy)**:
    - Tạo phiếu hậu mãi đổi trả với tiền hoàn 99.999.999đ (> giá trị đơn).
    - Tạo phiếu hậu mãi trên đơn đã hủy.
    - Khẳng định: Cả 2 đều bị chặn `400`.
13. **Kịch bản 13 (Chặn xóa SP đã có đơn hàng/hóa đơn trả về 409 thay vì 500)**:
    - Gọi `DELETE /api/products/[id]` trên sản phẩm đã có đơn hàng hoặc hóa đơn.
    - Khẳng định: Trả về `409 Conflict` kèm thông báo hướng dẫn chuyển sang "Ngừng bán".
14. **Kịch bản 14 (Bảo mật Webhook HMAC-SHA256 & Chặn ghi đè tồn kho Combo qua Webhook)**:
    - Gửi webhook với chữ ký `x-signature` giả mạo -> trả về `401 Unauthorized`.
    - Gửi webhook với chữ ký hợp lệ nhưng cố tình update delta trên Combo -> trả về `400`.
15. **Kịch bản 15 (OPENVN POS Bán tại kho: Tiêu điểm, chiết khấu & tích điểm tức thì)**:
    - Bán tại kho 1 SP A (200k), tiêu 4 điểm (-4k), chiết khấu 6k, `instantComplete = true`.
    - Khẳng định: Đơn tạo ra `COMPLETED` + `PAID`, tiền thanh toán 190k, điểm hội viên cập nhật đúng công thức `88 - 4 + 19 = 103`.
16. **Kịch bản 16 (Vận đơn RETURNED hoàn hàng về kho -> Tự động Hủy đơn & Hoàn kho BOM)**:
    - Đơn giao đi (3 A + 1 B), vận chuyển báo hoàn hàng `RETURNED`.
    - Khẳng định: Đơn hàng tự động sang `CANCELLED`, kho thực tế của thành phần và Combo hoàn trả 100%.
17. **Kịch bản 17 (Áp dụng Mã Voucher UUDAM10 + Tự động Freeship >= 500k)**:
    - Đơn 600k (>= 500k -> `shippingFee = 0đ`), voucher `UUDAM10` (giảm 10% trần 50k -> giảm 50k).
    - Khẳng định: `total = 550000đ`, `usedCount` tăng 1. Sau đó hoàn trả `usedCount`.
18. **Kịch bản 18 (Đa Kho & Liên kết Shop Bán chéo: Điều chuyển kho A -> B & Đối soát hoa hồng)**:
    - Điều chuyển 2 SP từ Kho Trung Tâm sang Shop Liên kết (`Gốm Trà Zen`).
    - Khẳng định: Tồn nguồn giảm, tồn đích tăng, API trả về mảng `settlements` có tính hoa hồng và công nợ bán chéo.
19. **Kịch bản 19 (API Gateway /api, Integrations Hub, Kiểm tra Credential GHN & Outbound Webhook Test)**:
    - Khẳng định: `GET /api` trả về `healthy` (v2.5.0), 14 providers credentials, test GHN trả về `CONNECTED`, gửi webhook test thành công HTTP 200.
20. **Kịch bản 20 (API Kiểm tra Voucher, Giả lập Inbound Auto-HMAC & Quyết toán Công nợ Bán chéo)**:
    - Khẳng định: `GET /api/vouchers?code=UUDAM10` tính giảm đúng 40k; Inbound webhook giả lập voucher trả về 50k; quyết toán công nợ shop trả về mã `QT-SHOP-...`.
21. **Kịch bản 21 (Dọn dẹp sạch dữ liệu kiểm thử tạm thời)**:
    - Xóa toàn bộ sản phẩm `T-COMPA-*`, `T-COMPB-*`, `T-COMBO-*`, đơn hàng liên quan, khách hàng test, credential test.
    - CSDL trở về nguyên trạng ban đầu.

---

## 3. Cơ Chế Kiểm Toán Chuỗi Biến Động Kho (`test:chain`)

File: `scripts/verify-chain.ts` (23 dòng)  
Cơ chế kiểm toán sổ cái biến động kho:
- Quét các SKU trọng yếu (ví dụ: `UD-QT-002`, `UD-VL-001`).
- Lấy toàn bộ bản ghi `StockMovement` sắp xếp tăng dần theo thời gian (`createdAt ASC, id ASC`).
- Tính tổng tích lũy:
  $$\text{bal}_{0} = 0, \quad \text{bal}_{i} = \text{bal}_{i-1} + \text{quantity}_{i}$$
- **Quy tắc bất biến (Monotonic Invariant)**:
  1. Với mọi bước $i$: $\text{bal}_{i} == \text{stockAfter}_{i}$. Nếu sai $\rightarrow$ Báo lỗi `CHAIN BREAK at {id}`.
  2. Tại bước cuối cùng: $\text{bal}_{\text{cuối}} == \text{Product.stock}$. Nếu sai $\rightarrow$ Báo lỗi `END MISMATCH`.
- Hiển thị 8 biến động mới nhất mà UI sẽ nhìn thấy.
- **Kết quả thực tế**:
  - `UD-QT-002`: tồn hiện tại 4, 14 biến động $\rightarrow$ **Chuỗi hợp lệ, kết thúc đúng tồn thực tế ✓**
  - `UD-VL-001`: tồn hiện tại 149, 24 biến động $\rightarrow$ **Chuỗi hợp lệ, kết thúc đúng tồn thực tế ✓**

---

## 4. Đo Lường CSDL Hiện Hành (`db/custom.db`) — Baseline Chuẩn Cho R7

Dữ liệu được trích xuất trực tiếp qua Prisma Client tại mốc thời điểm khảo sát:

### Bảng Thực Thể Cốt Lõi (Core Business Entities)
| Bảng (Prisma Model) | Số Lượng Bản Ghi Baseline | Ghi Chú / Ràng Buộc R7 |
| :--- | :---: | :--- |
| **`Product`** | **12** | 11 sản phẩm đơn + 1 Combo (`UD-COMBO-001`) |
| **`Category`** | **3** | Danh mục chính của cửa hàng |
| **`Order`** | **173** | 171 đơn cũ + 2 đơn seed demo từ các task trước |
| **`OrderItem`** | **226** | Chi tiết các dòng hàng trong 173 đơn |
| **`Customer`** | **34** | Khách hàng thực tế và hội viên cửa hàng |
| **`SalesInvoice`** | **10** | Hóa đơn bán ra / Phiếu xuất kho |
| **`SalesInvoiceItem`** | **13** | Chi tiết dòng hóa đơn bán |
| **`PurchaseInvoice`** | **4** | Hóa đơn nhập hàng mua |
| **`PurchaseInvoiceItem`**| **6** | Chi tiết dòng hóa đơn mua |
| **`StockMovement`** | **246** | Chuỗi biến động kho tổng thể |
| **`WarehouseStock`** | **22** | Tồn kho phân bổ tại từng kho |
| **`Warehouse`** | **4** | 2 kho nội bộ + 2 shop đối tác liên kết bán chéo |
| **`Voucher`** | **4** | `UUDAM10`, `PHATDAN50K`, `LIENKET15`, `FREESHIP0D` |
| **`BomComponent`** | **5** | Định mức sản xuất cho Combo |
| **`AccountingPeriod`** | **5** | 4 quý năm 2025 (Q1..Q4) + 1 kỳ năm 2026 |
| **`Partner`** | **1** | Nhà cung cấp Minh Phát |
| **`Channel`** | **10** | 10 kênh bán hàng tích hợp |
| **`ChannelListing`** | **110** | 10 kênh × sản phẩm (bản giá & mô tả) |
| **`Shipment`** | **85** | Vận đơn vận chuyển |
| **`AfterSalesCase`** | **2** | Phiếu hậu mãi đổi trả / bảo hành |
| **`AppSetting`** | **16** | Cấu hình cửa hàng, VietQR, hóa đơn |
| **`IntegrationCredential`**| **14**| 14 nhà cung cấp tích hợp |
| **`ApiKey`** | **1** | Khóa API mở rộng |
| **`WebhookEndpoint`** | **2** | Điểm tiếp nhận webhook nội bộ |
| **`AutomationSetting`** | **6** | Cấu hình tự động hóa Agent Autopilot |

### Bảng Nhật Ký & Sự Kiện (Append-Only Event & Audit Logs)
*Lưu ý: Các bảng này ghi lại nhật ký khi thao tác chạy test và vận hành.*
| Bảng | Trước khi chạy verify | Sau khi chạy verify | Độ biến thiên |
| :--- | :---: | :---: | :---: |
| **`LedgerEntry`** | 1883 | 1923 | +40 bản ghi kiểm toán |
| **`WebhookDelivery`** | 108 | 133 | +25 bản ghi test webhook |
| **`AgentActivity`** | 525 | 537 | +12 nhật ký agent |
| **`DirectMessage`** | 319 | 322 | +3 tin nhắn test Zalo |
| **`OrderEvent`** | 392 | 392 | 0 |

**Kết luận bảo vệ dữ liệu (R7)**:
- Tất cả các bảng thực thể nghiệp vụ (Đơn hàng, Sản phẩm, Tồn kho, Khách hàng, Hóa đơn) giữ nguyên **100% số lượng bản ghi** trước và sau khi chạy bộ kiểm thử `npm run verify`.
- Cơ chế `cleanupLeftoverTestData()` hoạt động hoàn hảo, xóa sạch dữ liệu test tạm thời có tiền tố `T-COMPA-`, `T-COMPB-`, `T-COMBO-` và các đơn hàng/khách hàng phát sinh trong quá trình test.

---

## 5. Kết Quả Chạy Kiểm Thử Baseline Thực Tế

### 5.1. `npx tsc --noEmit`
- Mã thoát: `0`
- Thời gian: ~10 giây
- Đầu ra: Sạch, không có bất kỳ lỗi biên dịch TypeScript nào.

### 5.2. `npm run lint` (`eslint src`)
- Mã thoát: `0`
- Thời gian: ~8 giây
- Đầu ra: Sạch, 0 errors, 0 warnings.

### 5.3. `npm run test:chain`
- Mã thoát: `0`
- Kết quả: Khớp chuỗi đơn điệu 100%, kết thúc đúng tồn kho thực tế của `UD-QT-002` và `UD-VL-001`.

### 5.4. `npm run test:scenarios`
- Mã thoát: `0`
- Kết quả: **21/21 KỊCH BẢN ĐẠT (FAILED: 0)**.

### 5.5. `npm run build`
- Mã thoát: `0`
- Thời gian: ~35 giây
- Kết quả: Build thành công Next.js 16.4.3 (Turbopack), tối ưu hóa 6 trang static và 55 API dynamic routes.
- Cảnh báo ghi nhận:
  1. Next.js 16 cảnh báo quy ước `middleware.ts` bị deprecated, khuyến nghị chuyển sang `proxy.ts`.
  2. Turbopack phát hiện 3 vị trí `fs.existsSync` và `fs.readFileSync` động tại `src/app/api/system/backup/route.ts` (không ảnh hưởng runtime).

---

## 6. Kiến Trúc Khuyến Nghị Cho E2E Testing Track (Tiers 1–4)

Để phục vụ triển khai R1–R5 một cách bài bản, an toàn cho dữ liệu thật của cửa hàng Ưu Đàm, hệ thống kiểm thử cần phân thành 4 tầng rõ ràng:

```
[ Tier 1: Static Type & Style Gate ]
  ├── tsc --noEmit (0 type errors)
  └── eslint src (0 lint warnings/errors)

[ Tier 2: Invariant & Arithmetic Integrity Gate ]
  ├── test:chain (Monotonic stock balance, no negative stock)
  ├── test:pnl (5-tier P&L math identity, zero divergence)
  └── test:contracts (VAT XML schema check, ESC/POS byte encoding validator)

[ Tier 3: API & Business Process Scenario Suites (Node Native Runners) ]
  ├── scripts/verify-realworld-scenarios.ts (Baseline Scenarios 1-21)
  ├── scripts/verify-r1-regressions.ts (Regression tests for all bug fixes in R1)
  ├── scripts/verify-r2-bulk-orders.ts (Bulk confirm & bulk delivery print, partial failures)
  ├── scripts/verify-r3-einvoice-xml.ts (General Dept of Taxation XML schema, signature adapter mock)
  ├── scripts/verify-r4-catalog-csv-excel.ts (CSV/Excel roundtrip, row-level validation errors)
  └── scripts/verify-r5-p2-features.ts (Dashboard date ranges, PO workflow, Chat drag-drop, WebUSB fallback)

[ Tier 4: Browser E2E & Visual Responsiveness (Independent Verification Agent) ]
  ├── Desktop (1280px+) & Mobile (390px) View Audits
  ├── 0 console errors & 0 horizontal overflow (scrollWidth === clientWidth)
  └── Mock isolation enforcement (0 external network calls to GHN/GHTK/Zalo/USB)
```

### Chi tiết tổ chức các kịch bản kiểm thử mới cho R1–R5

1. **R1 (Kiểm thử hồi quy cho các lỗi sửa được)**:
   - Tạo file `scripts/verify-r1-regressions.ts`.
   - Mỗi lỗi được phát hiện và sửa trong R1 sẽ có một test case độc lập:
     - Tên test định dạng: `[R1-BUG-{id}] {Mô tả ngắn lỗi và điều kiện hồi quy}`.
     - Khẳng định lỗi không tái diễn và không phá vỡ logic cũ.
2. **R2 (Đơn hàng hàng loạt)**:
   - Kịch bản đường chuẩn: Chọn 3 đơn `PENDING` hợp lệ -> gọi `POST /api/orders/bulk-confirm` -> cả 3 đơn chuyển sang `CONFIRMED`, in phiếu giao hàng loạt trả về file PDF/HTML chứa đủ 3 phiếu A6.
   - Kịch bản đối kháng: Chọn 3 đơn (1 đơn hợp lệ, 1 đơn đã `CANCELLED`, 1 đơn vượt tồn kho) -> hệ thống xác nhận 1 đơn hợp lệ, từ chối 2 đơn còn lại với mảng `rejected: [{ id, reason }]`, không nuốt lỗi, và `test:chain` vẫn khớp 100%.
3. **R3 (Hóa đơn VAT điện tử chuẩn TCT Việt Nam)**:
   - Kịch bản đường chuẩn: Xuất XML từ `SalesInvoice` hợp lệ. Dùng XML validator kiểm tra cấu trúc thẻ theo Thông tư 78/2021 và Quyết định 1450/QĐ-TCT: `<HDon>`, `<TTChung>`, `<NDHDon>`, `<NMua>`, `<NBan>`, `<DSHHDVu>`, `<TToan>`. Khẳng định MST người bán, MST người mua, tổng tiền trước thuế, thuế suất 8%/10%, tiền thuế và tổng thanh toán khớp từng đồng với hóa đơn trong DB.
   - Kịch bản đối kháng: Hóa đơn đã hủy (`status = CANCELLED`) gọi xuất XML bị từ chối `400`. Thử gọi adapter ký số ở chế độ giả lập (`mock = true`) -> trả về mã tra cứu hóa đơn và chữ ký số mô phỏng thành công mà không gọi ra Internet.
4. **R4 (Nhập/xuất danh mục sản phẩm CSV/Excel)**:
   - Kịch bản đường chuẩn (Roundtrip Identity): Xuất CSV danh mục hiện có -> đọc lại file CSV vừa xuất -> đối chiếu 100% SKU, tên, giá vốn, giá bán, tồn kho, mã vạch khớp hoàn toàn.
   - Kịch bản đối kháng (Row-level Error Reporting): Tải lên file CSV có 5 dòng lỗi (dòng 2 thiếu SKU, dòng 4 giá bán âm, dòng 5 danh mục không tồn tại) -> API trả về đúng 3 thông báo lỗi chỉ rõ dòng 2, 4, 5; toàn bộ giao dịch bị rollback, DB không bị ghi bất kỳ bản ghi rác nào.
5. **R5 (Các tính năng P2 còn lại)**:
   - **Dashboard**: Kiểm tra 4 khoảng ngày (7, 14, 30, 90 ngày) qua `GET /api/dashboard?days=...`. Đối chiếu số liệu doanh thu từng ngày với truy vấn tổng hợp trực tiếp từ DB qua Prisma (`SUM(total)`).
   - **Đơn đặt hàng mua (PO)**: Luồng PO: `DRAFT` (tồn kho không đổi) -> `APPROVED` (tồn kho không đổi) -> `RECEIVED` (nhận 1 phần hoặc đủ: tồn kho tăng đúng bằng số thực nhận, sinh `StockMovement` loại `PURCHASE_RECEIPT`).
   - **In nhiệt POS WebUSB/ESC-POS**: Kiểm tra bộ mã hóa ESC/POS tạo ra chuỗi byte chuẩn: mã khởi tạo máy in `ESC @` (`1B 40`), mã in đậm `ESC E 1` (`1B 45 01`), tiếng Việt không lỗi font, lệnh cắt giấy `GS V 0` (`1D 56 00`). Khi WebUSB không hỗ trợ (môi trường test), tự động chuyển sang fallback `window.print`.
   - **Phí ship tự động GHN/GHTK**: Khi gọi tính phí ship ở chế độ giả lập (`MOCK`), trả về cước phí tính toán theo khoảng cách quận/huyện nội thành (22.000đ) / ngoại thành (30.000đ) / liên tỉnh (35.000đ) mà không gọi API ra ngoài.
   - **Voucher sinh nhật VIP**: Chạy tác vụ quét sinh nhật 2 lần liên tiếp trong ngày -> khách hàng VIP chỉ nhận đúng 1 tin nhắn và 1 mã voucher (Idempotent chống gửi lặp).
6. **Tích hợp vào lệnh `npm run verify`**:
   Cập nhật `scripts` trong `package.json`:
   ```json
   "verify": "tsc --noEmit && npm run lint && npm run test:chain && npm run test:scenarios && npm run test:regressions"
   ```
   Đảm bảo toàn bộ các kịch bản kiểm thử mới phải chạy và đạt `PASS` trước khi cho phép đóng gói hay bàn giao.

---

## 7. Kế Hoạch Sao Lưu & An Toàn CSDL (R7)

1. **Vị trí file CSDL hiện tại**: `db/custom.db` (kích thước ~800KB).
2. **Quy trình sao lưu bắt buộc trước khi tiến hành code**:
   - Trước bất kỳ thay đổi nào về Prisma schema hoặc migration:
     ```powershell
     Copy-Item -Path "db/custom.db" -Destination "db/custom.db.bak_$(Get-Date -Format 'yyyyMMdd_HHmmss')"
     ```
3. **Tiêu chí nghiệm thu bàn giao dữ liệu**:
   - Số lượng bản ghi tại các bảng cốt lõi (`Product = 12`, `Customer = 34`, `Order = 173`, `SalesInvoice = 10`, `PurchaseInvoice = 4`, `StockMovement = 246`) phải giữ nguyên vẹn sau toàn bộ chiến dịch phát triển và nghiệm thu.
