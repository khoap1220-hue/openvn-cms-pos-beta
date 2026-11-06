# KHẢO SÁT TOÀN DIỆN KIẾN TRÚC MÃ NGUỒN HỆ THỐNG OPENVN · ƯU ĐÀM SUITE
**Báo cáo kỹ thuật chi tiết phục vụ triển khai vận hành thương mại**
*Thực hiện bởi: explorer_survey_1 (Codebase Architecture Explorer) — Thời điểm: 2026-10-26*

---

## 1. TỔNG QUAN HỆ THỐNG (EXECUTIVE SUMMARY)

Hệ thống **OPENVN · Ưu Đàm Suite** là giải pháp phần mềm quản trị bán hàng đa kênh (Omnichannel Commerce Suite), kết hợp quầy bán hàng tại kho (Offline-First / Warehouse POS) và buồng lái điều phối tự động bằng AI (AI Cockpit & Agent Autopilot).

- **Kiến trúc cốt lõi**: Next.js 16.4.3 (Turbopack, App Router, React 19, TypeScript 5.x) + Tailwind CSS v4 + Prisma ORM 6.11.1 + SQLite (`db/custom.db`).
- **Dịch vụ mạng song song**:
  - Máy chủ ứng dụng & CMS Quản trị: cổng `3010` (`http://localhost:3010`, `/pos`, `/store`, `/login`).
  - Trục bus phát sóng sự kiện thời gian thực (Realtime Event Bus): cổng `3013` (`http://localhost:3013`, Socket.IO, `/health`, `/emit`).
- **Hiện trạng kiểm thử & chất lượng**:
  - `npx tsc --noEmit`: **0 lỗi** (PASS).
  - `npm run lint`: **0 lỗi, 0 cảnh báo** (PASS).
  - `npm run test:chain` (`scripts/verify-chain.ts`): **100% khớp chuỗi biến động kho monotonic** (PASS).
  - `npm run test:scenarios` (`scripts/verify-realworld-scenarios.ts`): **21/21 kịch bản đạt** (PASS).
  - `npm run build`: Biên dịch thành công với Turbopack (Exit code 0).
- **Hiện trạng tính năng so với yêu cầu vận hành (ORIGINAL_REQUEST.md)**:
  - **Nền tảng cốt lõi**: 12 chốt chặn nghiệp vụ, quản lý Combo BOM, bán tại kho POS, tích điểm hội viên idempotent, quản lý đa kho & bán chéo liên shop, đối soát COD, sổ cái Lineage Audit Trail đã hoàn thành và hoạt động ổn định.
  - **Khoảng trống cần hoàn thiện (P1 & P2)**:
    - **R2 (P1)**: Xác nhận đơn hàng loạt & in phiếu giao hàng hàng loạt chưa có trên UI lẫn API.
    - **R3 (P1)**: Xuất hóa đơn VAT điện tử file XML chuẩn QĐ 1450/QĐ-TCT (NĐ 123/2020, TT 78/2021) & Adapter ký số (VNPT/Viettel SInvoice) chưa có.
    - **R4 (P2)**: Nhập/xuất danh mục sản phẩm và bảng giá bằng file CSV/Excel chưa có.
    - **R5 (P2)**: Bộ chọn khoảng ngày Dashboard (7/14/30/90), Quy trình PO nhập hàng (nháp -> duyệt -> nhận thực tế), Kéo-thả tải ảnh trong Chat, In nhiệt K80 trực tiếp qua WebUSB/WebSerial (ESC/POS), Tính phí ship tự động GHN/GHTK theo địa chỉ, Gửi voucher sinh nhật tự động cho khách VIP, và Nút diễn tập đơn Shopee/TikTok Shop trên Buồng lái AI.
    - **R1 (Củng cố)**: Cần bọc transaction ACID cho một số luồng cập nhật kho/đơn và vá các cảnh báo Turbopack / Next.js 16.

---

## 2. PHÂN TÍCH CẤU TRÚC REPOSITORY & NỀN TẢNG KỸ THUẬT

### 2.1. Cấu hình gói và Dependencies (`package.json`)
- **Tên gói**: `nextjs_tailwind_shadcn_ts` (v0.2.1).
- **Thành phần chính**:
  - `next`: `^16.1.1` (thực tế cài đặt là `16.4.3`).
  - `react` & `react-dom`: `^19.0.0` (React 19).
  - `prisma` & `@prisma/client`: `^6.11.1`.
  - `@tanstack/react-query`: `^5.82.0`.
  - `@tanstack/react-table`: `^8.21.3`.
  - `socket.io-client`: `^4.8.4`.
  - `lucide-react`: `^0.525.0`.
  - `recharts`: `^2.15.4`.
  - `tailwindcss`: `^4` và `@tailwindcss/postcss`: `^4` (Tailwind CSS v4 mới nhất).
  - `typescript`: `^5`.
- **Scripts vận hành**:
  - `npm run dev`: Chạy `next dev -p 3010` (mặc định cổng 3010).
  - `npm run dev:realtime`: Chạy `node --watch mini-services/realtime/index.ts`.
  - `npm run build`: Chạy `next build` và sao chép `.next/static` + `public` vào standalone bundle.
  - `npm run start`: Chạy `node .next/standalone/server.js`.
  - `npm run start:realtime`: Chạy `node mini-services/realtime/index.ts`.
  - `npm run lint`: Chạy `eslint src`.
  - `npm run test:chain`: Chạy `node --experimental-strip-types scripts/verify-chain.ts`.
  - `npm run test:scenarios`: Chạy `node --experimental-strip-types scripts/verify-realworld-scenarios.ts`.
  - `npm run verify`: Lệnh kiểm định 4 cổng tổng hợp: `tsc --noEmit && npm run lint && npm run test:chain && npm run test:scenarios`.

### 2.2. Quy ước Next.js 16 & Các thay đổi quan trọng (Breaking Changes)
Dựa trên tài liệu chính hãng trong `node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md`:
1. **Turbopack là trình biên dịch mặc định**: `next dev` và `next build` sử dụng Turbopack trực tiếp mà không cần cờ `--turbopack`.
2. **Quy ước `proxy` thay thế `middleware`**:
   - Tệp `src/middleware.ts` hiện phát sinh cảnh báo khi build:
     `⚠ The "middleware" file convention is deprecated. Please use "proxy" instead.`
   - Next.js 16 khuyến nghị đổi tên sang `proxy.ts` (chạy trên Node.js runtime).
3. **Async Request APIs**:
   - `params` và `searchParams` trong Page và Route Handler là `Promise`:
     `export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> })`
     Codebase hiện tại đã tuân thủ chuẩn xác (`const { id } = await params`).
4. **Cảnh báo Dynamic Filesystem Access trong Turbopack**:
   - Tệp `src/app/api/system/backup/route.ts` sử dụng `fs.existsSync(p)` và `fs.readFileSync(dbPath)` để sao lưu `db/custom.db`. Turbopack phát hiện truy cập filesystem động và cảnh báo trace toàn bộ project. Cần thêm comment `/*turbopackIgnore: true*/` hoặc chuẩn hóa đường dẫn tĩnh qua `path.join(process.cwd(), 'db', 'custom.db')`.

### 2.3. Cơ sở dữ liệu SQLite & Lược đồ Prisma (`prisma/schema.prisma`)
- **Nguồn dữ liệu**: SQLite qua `DATABASE_URL="file:../db/custom.db"`.
- **Tệp CSDL thực tế**: `db/custom.db` (kích thước ~2.28 MB, chứa dữ liệu sản xuất của tiệm Ưu Đàm: 12 sản phẩm danh mục nến/trầm/gốm, 171 đơn hàng, 4 kho hàng, 14 đối tác tích hợp, lịch sử kế toán).
- **Các thực thể mô hình (20 Models)**:
  1. `Product` & `Category`: Danh mục sản phẩm đơn lẻ (`SIMPLE`) và Combo (`COMBO`), mã vạch CODE128 (`barcode`), giá vốn (`costPrice`), giá bán chung (`sellPrice`), tồn kho (`stock`), thuộc tính (`attributes`), hàng dễ vỡ (`fragile`), kho sở hữu (`ownerWarehouseId`), tỷ lệ hoa hồng bán chéo (`crossSellRate`).
  2. `Channel` & `ChannelListing`: 10 kênh bán hàng, phí sàn snapshot (`feePercent`), bảng giá riêng theo kênh (`price`), bản sao mô tả đồng bộ (`description`, `descriptionSyncedAt`).
  3. `Customer`: Khách hàng, thành viên thân thiết (`isMember`, `memberCode`, `memberAt`, `points`), chân dung & trí nhớ dài hạn AI (`avatarUrl`, `salutation`, `inferredProfile`, `contextSummary`, `preferences`, `painPoints`).
  4. `Order` & `OrderItem`: Đơn hàng đa kênh, mã `code`, kho xuất (`warehouseId`), mã voucher (`voucherCode`), chiết khấu (`discountAmount`), phí sàn snapshot (`platformFeePct`, `platformFee`), trạng thái thanh toán và vận chuyển.
  5. `StockMovement`: Sổ biến động kho đơn điệu (Monotonic Stock Ledger), lưu `productId`, `warehouseId`, `type` (`IMPORT`, `EXPORT`, `ADJUST`, `COMBO_ISSUE`, `SALE_EXPORT`, `REVERSE`), `quantity`, `stockAfter`, `note`.
  6. `Shipment`: Vận đơn vận chuyển, đối soát COD (`PENDING`, `RECEIVED`, `RECONCILED`), tiền thu hộ `codAmount`, thực nhận `codReceived`.
  7. `BomComponent`: Định mức nguyên vật liệu 1 cấp giữa thành phẩm combo (`productId`) và thành phần (`componentProductId`), số lượng `quantity`.
  8. `PurchaseInvoice` & `PurchaseInvoiceItem`: Hóa đơn mua hàng từ NCC (`code` dạng `PMM...`), thuế suất `vatRate`, thành tiền `total`.
  9. `SalesInvoice` & `SalesInvoiceItem`: Hóa đơn bán hàng VAT (`code` dạng `PXK...`), số hóa đơn tăng dần toàn cục `invoiceNo`, ký hiệu `series`, mẫu số `templateCode`, hình thức thanh toán `paymentMethod`.
  10. `AccountingPeriod`: Kỳ kế toán (`year`, `quarter`), trạng thái `OPEN` / `CLOSED` để khóa sổ chống sửa lùi ngày.
  11. `LedgerEntry`: Sổ cái dữ liệu toàn hệ thống (Data Provenance & Lineage Audit Trail), lưu `scope`, `action`, `entityType`, `entityId`, `entityCode`, `actor`, `originSource`, `beforeSnapshot`, `afterSnapshot`, `changedFields`.
  12. `Warehouse` & `WarehouseStock`: Đa kho nội bộ (`INTERNAL`) và shop đối tác liên kết bán chéo (`PARTNER_SHOP`), tỷ lệ hoa hồng `commissionPct`.
  13. `Voucher`: Mã khuyến mại (`UUDAM10`, `PHATDAN50K`, `LIENKET15`, `FREESHIP0D`), loại giảm giá (`PERCENT`, `FIXED`, `FREESHIP`), giới hạn sử dụng, phạm vi `ALL` hoặc `ALLIANCE`.
  14. `ApiKey`, `WebhookEndpoint`, `WebhookDelivery`, `IntegrationCredential`: Trung tâm tích hợp API hai chiều, quản lý khóa và chữ ký HMAC-SHA256.
  15. `AgentActivity`, `OrderEvent`, `DirectMessage`, `AutomationSetting`, `AfterSalesCase`, `AppSetting`: Các bảng phục vụ vận hành tự động và sau bán hàng.

---

## 3. BẢN ĐỒ KIẾN TRÚC HỆ THỐNG & ĐIỀU PHỐI MẠNG

### 3.1. Dịch vụ Máy chủ & Định tuyến Cổng
```
┌────────────────────────────────────────────────────────────────────────┐
│                        TRÌNH DUYỆT / CLIENT                            │
│  Quản trị CMS: :3010 | POS Kho: :3010/pos | Realtime WS: :3013        │
└──────────────────┬───────────────────────────────┬─────────────────────┘
                   │                               │
        HTTP / Dynamic Pages                 WebSocket (Socket.IO)
                   │                               │
┌──────────────────▼──────────────────────┐ ┌──────▼─────────────────────┐
│    Next.js 16 Web Server (Port 3010)   │ │ Realtime Service (Port 3013)│
│  - App Router (Page / Standalone)       │ │ - Socket.IO Broadcast Server│
│  - Next.js Proxy/Middleware (Auth)      │ │ - GET /health               │
│  - 34 REST API Endpoints                │ │ - POST /emit                │
│  - Rewrites /?EIO=* -> :3013            │ │   (Internal HTTP Push)      │
└──────────────────┬──────────────────────┘ └──────▲─────────────────────┘
                   │                               │
                   │ broadcast(event, payload)     │
                   └───────────────────────────────┘
                                   │
                   ┌───────────────▼──────────────┐
                   │    SQLite DB: db/custom.db   │
                   │    Prisma ORM (Schema v2.5)   │
                   └──────────────────────────────┘
```

- **Next.js CMS Server (`PORT=3010`)**: Chạy ứng dụng Next.js chính. Tệp `next.config.ts` chứa rule `rewrites` chuyển tiếp truy vấn chứa query parameter `EIO` (Engine.IO / Socket.IO handshake) từ cổng 3010 sang `http://localhost:3013/`.
- **Realtime Bus (`REALTIME_PORT=3013`)**: Dịch vụ độc lập tại `mini-services/realtime/index.ts`. Khởi chạy HTTP server và Socket.IO server. Cung cấp API nội bộ `POST /emit` để server Next.js bắn sự kiện (order, inventory, shipment, settings, message) tới toàn bộ các client đang kết nối mà không bị nghẽn luồng.

### 3.2. Cấu trúc Giao diện & Quản lý Trạng thái UI
- **Single Page Shell (`src/app/page.tsx`)**:
  - Quản lý điều hướng mượt mà giữa 19 phân hệ thông qua state `activeView: ViewId`.
  - Header tích hợp định vị phân hệ, huy hiệu Realtime 3 trạng thái (`Realtime` / `Tự đồng bộ` fallback polling 10s / `Mất kết nối`), bộ đếm đơn hàng chờ / tồn kho thấp / tin nhắn chưa đọc, công tắc tổng Agent Autopilot và công cụ tìm kiếm nhanh toàn cục `Ctrl+K` (`QuickSearchDialog`).
- **Trang độc lập**:
  - `/pos` (`src/app/pos/page.tsx`): Quầy bán hàng tại kho tối ưu toàn màn hình, có nút quay về CMS.
  - `/store` (`src/app/store/page.tsx`): Giao diện cửa hàng demo.
  - `/login` (`src/app/login/page.tsx`): Trang đăng nhập quản trị khi kích hoạt chế độ bảo vệ.
- **Hệ thống thiết kế (Design Tokens & Color Palette)**:
  - Sidebar: Deep Navy `#182537` (`oklch(0.22 0.035 252)`).
  - Màu chủ đạo (Primary Accent): OPENVN Royal Blue `#0066CC` (`oklch(0.51 0.19 252)`).
  - Canvas: Cool Light Gray `#F3F5F8` (`oklch(0.968 0.004 250)`).
  - Thành phần giao diện: Shadcn UI (Radix UI primitives) được Việt hóa hoàn toàn.
- **Quản lý trạng thái & Kết nối thời gian thực**:
  - Hook `useRealtime` (`src/hooks/use-realtime.ts`): Đăng ký lắng nghe sự kiện Socket.IO; khi mất kết nối tự động kích hoạt timer polling 10s bắn sự kiện nội bộ `realtime.poll` để các view làm mới ngầm (không giật màn hình, không flash loading, không mất scroll).

---

## 4. BẢN ĐỒ CHI TIẾT CÁC PHÂN HỆ HIỆN CÓ

| STT | Phân Hệ Nghiệp Vụ | Tệp Giao Diện (View) | API Route Tương Ứng | Thư Viện / Service Logic | Trạng Thái Vận Hành Hiện Tại |
| :---: | :--- | :--- | :--- | :--- | :--- |
| 1 | **Quản lý Đơn hàng** | `src/components/cms/views/orders-view.tsx` | `src/app/api/orders/route.ts`<br>`src/app/api/orders/[id]/route.ts` | `src/lib/order-service.ts`<br>`src/lib/agents.ts` | 🟢 Hoàn thành luồng đơn đơn lẻ, đối chiếu kỳ kế toán, quét mã vạch đóng gói, chặn mở lại đơn đã hủy. 🔴 **Chưa có R2** (chọn hàng loạt, xác nhận hàng loạt & in hàng loạt). |
| 2 | **Tồn kho & Combo BOM** | `src/components/cms/views/inventory-view.tsx`<br>`src/components/cms/views/bom-view.tsx` | `src/app/api/inventory/route.ts`<br>`src/app/api/bom/route.ts` | `src/lib/combo.ts`<br>`src/lib/warehouse-service.ts` | 🟢 Hoàn thành tính tồn kho Combo tự động từ định mức BOM, chặn chỉnh kho trực tiếp trên Combo, đồng bộ dây chuyền khi nhập SP thành phần, điều chuyển đa kho A➔B. |
| 3 | **Quầy POS Bán tại kho** | `src/components/cms/views/pos-view.tsx`<br>`src/app/pos/page.tsx` | `src/app/api/orders/route.ts`<br>`src/app/api/customers/route.ts` | `src/lib/order-service.ts`<br>`src/lib/member.ts` | 🟢 Hoàn thành 6 tab hóa đơn chờ, quét mã `F2`, tìm kiếm `F3`, thanh toán `F9`, áp mã Voucher, đổi điểm, hoàn tất đơn tức thì. 🟡 **Chưa có R5.4** (in nhiệt trực tiếp qua WebUSB/WebSerial ESC/POS, hiện gọi `window.print`). |
| 4 | **Bán hàng & Hóa đơn VAT** | `src/components/cms/views/sales-view.tsx`<br>`src/components/cms/invoice-print.tsx` | `src/app/api/sales-invoices/route.ts`<br>`src/app/api/sales-invoices/[id]/route.ts` | `src/lib/invoice-service.ts`<br>`src/lib/accounting.ts` | 🟢 Hoàn thành lập HĐ từ đơn hàng hoặc bán lẻ, chặn xuất trùng, hủy HĐ tự hoàn kho BOM, số HĐ tăng dần `invoiceNo`, in VietQR động góc dưới phải. 🔴 **Chưa có R3** (xuất XML chuẩn QĐ 1450/QĐ-TCT & adapter ký số). |
| 5 | **Nhập hàng NCC** | `src/components/cms/views/purchase-view.tsx` | `src/app/api/purchase-invoices/route.ts`<br>`src/app/api/purchase-invoices/[id]/route.ts` | `src/lib/invoice-service.ts` | 🟢 Hoàn thành lập hóa đơn mua, tự cộng tồn kho, tính bình quân giá vốn, khóa kỳ kế toán. 🟡 **Chưa có R5.2** (bước Đơn đặt hàng mua PO nháp ➔ duyệt ➔ nhận hàng từng phần). |
| 6 | **Vận chuyển & Đối soát COD** | `src/components/cms/views/shipments-view.tsx` | `src/app/api/shipments/route.ts`<br>`src/app/api/shipments/[id]/route.ts` | `src/lib/agent-engine.ts`<br>`src/lib/ledger.ts` | 🟢 Hoàn thành 5 tab trạng thái vận chuyển, đối soát COD 1-click, `DELIVERED` tự hoàn tất đơn & tích điểm, `RETURNED` tự hủy đơn & hoàn kho BOM. 🟡 **Chưa có R5.5** (tính phí ship tự động GHN/GHTK theo địa chỉ). |
| 7 | **Hội viên & Voucher** | `src/components/cms/views/customers-view.tsx` | `src/app/api/customers/route.ts`<br>`src/app/api/vouchers/route.ts` | `src/lib/member.ts`<br>`src/lib/warehouse-service.ts` | 🟢 Hoàn thành 4 hạng thẻ, nhận diện SĐT khách quen, tích điểm idempotent, áp mã voucher đa dạng. 🟡 **Chưa có R5.6** (tự động gửi voucher sinh nhật Zalo cho khách VIP theo lịch). |
| 8 | **Tổng quan kinh doanh** | `src/components/cms/views/dashboard-view.tsx` | `src/app/api/dashboard/route.ts` | `src/lib/types.ts` | 🟢 Hoàn thành 6 ô việc cần làm, 4 thẻ KPI, biểu đồ doanh thu Recharts, cập nhật realtime. 🟡 **Chưa có R5.1** (bộ chọn khoảng ngày 7/14/30/90 trên biểu đồ). |
| 9 | **Buồng lái AI & Autopilot** | `src/components/cms/views/liveops-view.tsx`<br>`src/components/cms/views/autopilot-view.tsx` | `src/app/api/liveops/route.ts`<br>`src/app/api/autopilot/route.ts`<br>`src/app/api/simulate/route.ts` | `src/lib/agent-engine.ts`<br>`src/lib/agent-log.ts` | 🟢 Hoàn thành giám sát đội Agent, hàng đợi PACKING thực tế, diễn tập đơn Zalo. 🟡 **Chưa có R5.7** (nút diễn tập đơn hàng Shopee / TikTok Shop trên Buồng lái). |
| 10 | **Chat đa kênh & Vision AI** | `src/components/cms/views/inbox-view.tsx` | `src/app/api/inbox/route.ts` | `src/lib/memory-engine.ts`<br>`src/lib/llm.ts` | 🟢 Hoàn thành chat 3 cột, phân tích ảnh khách gửi qua Gemini Vision, trí nhớ dài hạn. 🟡 **Chưa có R5.3** (kéo-thả tải ảnh trực tiếp từ máy tính lên khung chat). |
| 11 | **Danh mục Sản phẩm** | `src/components/cms/views/products-view.tsx` | `src/app/api/products/route.ts`<br>`src/app/api/products/[id]/route.ts`<br>`.../sync-description/route.ts` | `src/lib/barcode.ts`<br>`src/lib/ledger.ts` | 🟢 Hoàn thành quản lý giá riêng theo kênh, đồng bộ mô tả master sang 10 kênh, in mã vạch CODE128. 🟡 **Chưa có R4** (nhập/xuất danh mục sản phẩm & giá qua CSV/Excel). |
| 12 | **Báo cáo P&L 5 tầng** | `src/components/cms/views/reports-view.tsx` | `src/app/api/reports/pnl/route.ts`<br>`src/app/api/reports/route.ts` | `src/lib/accounting.ts` | 🟢 Hoàn thành phân tích lợi nhuận ròng 5 tầng toán học chính xác 100% (Doanh thu gộp ➔ Giá vốn BOM ➔ Phí sàn ➔ Trợ giá ship ➔ Chi phí điểm thưởng). |
| 13 | **Sổ cái Data Lineage** | `src/components/cms/views/ledger-view.tsx` | `src/app/api/ledger/route.ts`<br>`src/app/api/lineage/route.ts` | `src/lib/ledger.ts`<br>`src/lib/lineage-server.ts` | 🟢 Hoàn thành lưu trữ vết Before/After/ChangedFields cho mọi thực thể, đối chiếu kỳ kế toán chuẩn mực. |
| 14 | **Trung tâm Kết nối API** | `src/components/cms/views/integrations-view.tsx` | `src/app/api/integrations/route.ts`<br>`.../credentials/test/route.ts`<br>`.../webhooks/test/route.ts` | `src/lib/webhook-service.ts` | 🟢 Hoàn thành quản lý API Key, 12 sự kiện Outbound, 8 sự kiện Inbound HMAC-SHA256, kiểm thử 14 Credentials đối tác (14/14 CONNECTED). |

---

## 5. ĐÁNH GIÁ CHI TIẾT TỪNG YÊU CẦU R1 ĐẾN R7

### R1. Rà soát và gia cố toàn hệ thống
- **Hiện trạng**: Hệ thống đã có 12 điểm chốt chặn kiểm thử trong 21 kịch bản. Tuy nhiên, qua rà soát sâu phát hiện **3 vấn đề cơ chế bất cập**:
  1. *Thiếu Transaction ACID khi Hủy đơn hàng và Vận đơn hoàn trả*:
     - Tệp `src/app/api/orders/[id]/route.ts` (dòng 80-118) và `src/app/api/shipments/[id]/route.ts` (dòng 103-153): khi cập nhật đơn sang `CANCELLED` hoặc vận đơn sang `RETURNED`, thao tác hoàn kho sản phẩm lẻ và thành phần BOM chạy bằng vòng lặp `for` với các lệnh `db.product.update` và `db.stockMovement.create` riêng lẻ ngoài transaction. Nếu một câu lệnh ném lỗi, đơn bị hủy nhưng kho chỉ hoàn một nửa, gây lệch chuỗi kiểm toán.
  2. *Nguy cơ tạo trùng khách hàng theo SĐT*:
     - Tệp `src/app/api/customers/route.ts` (dòng 95-120): `POST` tạo khách hàng mới không kiểm tra sự tồn tại của SĐT. Nếu người vận hành bấm thêm trùng SĐT, hệ thống tạo bản ghi thứ 2 (bảng `Customer` không đặt unique trên cột `phone`), khiến việc cộng điểm và tra cứu lịch sử mua hàng bị phân mảnh.
  3. *Cảnh báo Filesystem Tracing trong Turbopack*:
     - Tệp `src/app/api/system/backup/route.ts` dùng `fs.existsSync` và `fs.readFileSync` trên biến đường dẫn động, khiến Turbopack Next.js 16 cảnh báo trace cả dự án vào server bundle.

### R2. Đơn hàng hàng loạt (Bulk Orders)
- **Yêu cầu**: Chọn nhiều đơn cùng lúc trên giao diện để xác nhận hàng loạt và in phiếu giao hàng hàng loạt. Khi tập chọn có đơn không hợp lệ (đã hủy, vượt tồn kho, sai trạng thái), chỉ đơn hợp lệ được xác nhận; hệ thống trả về danh sách chi tiết lý do từng đơn bị từ chối.
- **Hiện trạng**: **Chưa cài đặt (0%)**.
- **Kế hoạch triển khai**:
  - Backend: Tạo endpoint `POST /api/orders/bulk-confirm`. Nhận danh sách `orderIds: string[]`. Dùng `order-service` để kiểm tra tồn kho gộp (Lẻ + Combo BOM), trạng thái hiện tại (chỉ đơn `PENDING` mới được xác nhận). Trả về `{ confirmed: Order[], rejected: { id, code, reason }[] }`.
  - Frontend: Thêm cột checkbox chọn từng dòng và checkbox chọn tất cả trong `src/components/cms/views/orders-view.tsx`. Khi có ≥ 1 đơn được chọn, hiển thị thanh công cụ nổi (Floating Action Bar) với 2 nút: "Xác nhận hàng loạt" (gọi API và bật modal tổng kết kết quả) và "In phiếu giao hàng hàng loạt" (bật dialog in A6 ghép nhiều trang).

### R3. Hóa đơn VAT điện tử (XML chuẩn QĐ 1450/QĐ-TCT)
- **Yêu cầu**: Xuất hóa đơn bán ra file XML theo định dạng hóa đơn điện tử của Tổng cục Thuế Việt Nam (Nghị định 123/2020, Thông tư 78/2021, Quyết định 1450/QĐ-TCT). Có adapter/webhook cấu hình được để gửi hóa đơn sang nhà cung cấp ký số (VNPT, Viettel SInvoice…), kèm chế độ giả lập (mock). Hóa đơn đã hủy không được xuất XML hợp lệ.
- **Hiện trạng**: **Chưa cài đặt (0%)**.
- **Kế hoạch triển khai**:
  - Tạo mô-đun sinh XML `src/lib/einvoice.ts`: Sinh cấu trúc `<HDon><DLHDon>...` với đầy đủ `<TTChung>`, `<NBan>` (lấy từ thiết lập đơn vị Ưu Đàm trong `AppSetting`), `<NMua>` (lấy từ `Partner` hoặc `Customer`), `<DSHHang hóa>` (danh sách mặt hàng, thuế suất 8%), và `<TToan>` (tổng tiền trước thuế, thuế VAT, tổng thanh toán bằng số và bằng chữ qua `docSoTienBangChu`).
  - API: Tạo endpoint `GET /api/sales-invoices/[id]/xml` để tải trực tiếp file `.xml` hợp chuẩn, và `POST /api/sales-invoices/[id]/einvoice` để gửi ký số qua adapter (mock mode trả về mã tra cứu CQT và mã ký số mô phỏng).
  - Chốt chặn: Nếu hóa đơn có `status === 'CANCELLED'`, trả về lỗi `400 Bad Request` ("Hóa đơn đã hủy không thể xuất XML").
  - Frontend: Thêm nút "Xuất XML HĐĐT" và "Ký số điện tử" trong danh sách và xem chi tiết tại `src/components/cms/views/sales-view.tsx`.

### R4. Nhập/xuất danh mục sản phẩm qua CSV/Excel
- **Yêu cầu**: Nhập và xuất danh mục sản phẩm cùng bảng giá bằng file CSV/Excel trên giao diện, có kiểm tra dữ liệu và báo lỗi chi tiết theo từng dòng (Row number). Dòng lỗi không được ghi vào DB.
- **Hiện trạng**: **Chưa cài đặt (0%)**.
- **Kế hoạch triển khai**:
  - Tạo service `src/lib/product-csv.ts`: Định dạng CSV UTF-8 kèm BOM hỗ trợ tiếng Việt có dấu. Các cột: `sku, name, barcode, type, unit, costPrice, sellPrice, stock, lowStockThreshold, status, categorySlug, price_shopee, price_tiktok...`.
  - API `GET /api/products/export`: Xuất toàn bộ danh mục sản phẩm hiện có ra file CSV.
  - API `POST /api/products/import`: Phân tích file CSV tải lên, kiểm tra hợp lệ từng dòng (SKU bắt buộc, không trùng, số lượng/giá không âm, danh mục tồn tại). Nếu có N dòng lỗi, trả về danh sách N lỗi `{ row, sku, error }` và không lưu dữ liệu hỏng.
  - Frontend: Thêm nút "Xuất CSV" và "Nhập CSV" tại PageHeader của `src/components/cms/views/products-view.tsx`, kèm hộp thoại xem trước (Preview Dialog) và bảng thống kê kết quả nhập.

### R5. Các tính năng P2 còn lại
1. **Dashboard - Bộ chọn khoảng ngày doanh thu**:
   - Tệp `src/app/api/dashboard/route.ts` nâng cấp nhận query `?days=7|14|30|90` (hiện cố định 14 ngày).
   - Tệp `src/components/cms/views/dashboard-view.tsx` bổ sung nút chọn khoảng ngày trên thẻ biểu đồ.
2. **Nhập hàng - Quy trình Đơn đặt mua (PO)**:
   - Mở rộng trạng thái trong `src/lib/invoice-service.ts` và `PurchaseInvoice`: hỗ trợ `DRAFT` (PO nháp) ➔ `APPROVED` (Đã duyệt) ➔ `PARTIAL_RECEIVED` / `POSTED` (Nhận hàng).
   - Đảm bảo khi tạo nháp hoặc duyệt PO: **tồn kho không đổi**. Tồn kho chỉ tăng tương ứng với số lượng thực nhận khi người vận hành xác nhận phiếu nhập.
3. **Chat - Kéo-thả tải ảnh lên khung chat**:
   - Tệp `src/components/cms/views/inbox-view.tsx` bổ sung các sự kiện `onDragOver`, `onDragLeave`, `onDrop` trên vùng khung chat. Khi kéo thả ảnh từ desktop vào, tự động đọc `FileReader` dạng Data URL hoặc gửi phân tích Vision AI.
4. **POS - In nhiệt trực tiếp K80 qua WebUSB/WebSerial (ESC/POS)**:
   - Tạo bộ mã hóa `src/lib/escpos.ts`: Chuyển đổi dữ liệu hóa đơn thành mảng byte ESC/POS chuẩn: khởi tạo máy in `[0x1B, 0x40]`, in hoa đậm, căn giữa, in bảng hàng hóa, lệnh cắt giấy `[0x1D, 0x56, 0x41, 0x00]`.
   - Trong `src/components/cms/views/pos-view.tsx`: Kiểm tra `navigator.usb` hoặc `navigator.serial`. Nếu thiết bị được cấp quyền, truyền luồng byte trực tiếp tới máy in nhiệt; nếu trình duyệt không hỗ trợ hoặc lỗi kết nối, tự động fallback về `window.print()`.
5. **Vận chuyển - Tính phí ship tự động GHN/GHTK**:
   - Tạo endpoint `POST /api/shipments/calculate-fee` nhận địa chỉ, tỉnh/thành, quận/huyện và khối lượng. Ở chế độ giả lập (hoặc khi chưa có token thật), tính phí chuẩn: Nội thành HCM 22.000đ (GHN) / 20.000đ (GHTK); Ngoại thành / Tỉnh 30.000đ - 35.000đ; Đơn ≥ 500.000đ tự động áp dụng chính sách Freeship 0đ.
6. **Hội viên - Tự động gửi voucher Zalo sinh nhật cho khách VIP**:
   - Tạo hàm nghiệp vụ `sendBirthdayVouchers()`: Quét danh sách khách hàng VIP (`tier` là `GOLD` hoặc `PLATINUM`), kiểm tra ngày sinh trong hồ sơ/trí nhớ.
   - Chặn gửi trùng: Kiểm tra trong `LedgerEntry` hôm nay đã có action `BIRTHDAY_VOUCHER_SENT` cho khách hàng đó chưa. Nếu chưa, tạo voucher giảm giá sinh nhật, gửi tin nhắn Zalo lời chúc ấm áp tự nhiên (Anti-AI) và ghi Sổ Data. Chạy 2 lần trong ngày chỉ gửi đúng 1 lần.
7. **Buồng lái AI - Nút diễn tập đơn Shopee / TikTok Shop**:
   - Tệp `src/app/api/simulate/route.ts` bổ sung xử lý cho `type === 'shopee_order'` và `type === 'tiktok_order'`.
   - Tệp `src/components/cms/views/liveops-view.tsx` thêm 2 nút "Đơn mới · Shopee" và "Đơn mới · TikTok Shop" trong khối Diễn tập & Kiểm thử.

### R6. Tích hợp bên ngoài — Bảo mật & Chế độ Giả lập (Mock Mode)
- **Quy tắc vàng**: Tuyệt đối không gọi mạng/thiết bị thật trong môi trường phát triển và kiểm thử tự động.
- **Kiến trúc Mock Mode**:
  - Mọi tích hợp (GHN, GHTK, Viettel Post, J&T, Zalo OA, Chữ ký số, WebUSB) đều được trang bị cờ giả lập tự động: khi chưa có API key thật trong bảng `IntegrationCredential`, hệ thống tự động xử lý qua bộ điều hợp Mock (trả về kết quả xác thực hợp lệ, mã vận đơn mẫu, phản hồi ký số giả lập).
  - Khi chủ tiệm điền khóa thật trong giao diện `Kết nối API & Webhook`, hệ thống chuyển mạch liền mạch sang gọi mạng thật.
  - Quét toàn bộ mã nguồn: không có API key hay bí mật nhạy cảm nào bị hard-code (các khóa mẫu trong `webhook-service.ts` đều là định danh demo `uudam_2026`).

### R7. An toàn dữ liệu & Cập nhật Hồ sơ Vận hành
- **Bảo toàn CSDL**: Tệp cơ sở dữ liệu `db/custom.db` giữ nguyên vẹn toàn bộ 171 đơn hàng, tồn kho 12 sản phẩm danh mục, cấu hình và lịch sử kiểm toán.
- **Quy trình sao lưu**: Trước khi thực hiện bất kỳ thay đổi nào (nếu cần cập nhật schema), phải sao lưu file `db/custom.db` thành `db/custom.db.bak`.
- **Dọn dẹp kiểm thử**: Mọi kịch bản kiểm thử trong `verify-realworld-scenarios.ts` đều được bao bọc trong khối `finally` để xóa sạch toàn bộ sản phẩm và đơn hàng tạm sinh ra trong phiên test, bảo đảm số lượng bản ghi bảng cốt lõi trả về đúng baseline ban đầu.
- **Hồ sơ tài liệu**: Cập nhật đồng bộ `docs/FEATURE_EXPERIENCE_MATRIX.md`, `docs/RELEASE_CHECKLIST.md` và `MATRIX_HANDOFF.md` sau khi hoàn thành.

---

## 6. DANH SÁCH LỖI VÀ ĐIỂM GIA CỐ CẦN THỰC HIỆN (CHO R1)

| Mã lỗi / Vị trí | Tệp & Dòng mã (`file:line`) | Cơ chế lỗi & Rủi ro | Giải pháp gia cố | Kiểm thử hồi quy tương ứng |
| :--- | :--- | :--- | :--- | :--- |
| **BUG-01**: Hủy đơn thiếu transaction | `src/app/api/orders/[id]/route.ts`: dòng 80-118 | Khi đơn chuyển `CANCELLED`, việc hoàn kho từng sản phẩm và thành phần BOM chạy bằng nhiều truy vấn độc lập ngoài `db.$transaction`. Nếu có lỗi giữa chừng, đơn đã hủy nhưng kho chỉ hoàn một phần. | Bọc toàn bộ khối `order.update`, `product.update`, `stockMovement.create` và `syncComboStock` vào một `db.$transaction`. | Kịch bản 10 trong `verify-realworld-scenarios.ts` (Hủy đơn hoàn kho nguyên tử). |
| **BUG-02**: Vận đơn hoàn trả thiếu transaction | `src/app/api/shipments/[id]/route.ts`: dòng 103-153 | Khi vận đơn cập nhật `RETURNED`, việc hủy đơn hàng gốc và hoàn kho chạy tuần tự ngoài transaction. | Bọc toàn bộ các câu lệnh hoàn kho và chuyển trạng thái đơn hàng vào `db.$transaction`. | Kịch bản 16 trong `verify-realworld-scenarios.ts` (Vận đơn RETURNED hoàn kho BOM nguyên tử). |
| **BUG-03**: Trùng lặp khách hàng theo SĐT | `src/app/api/customers/route.ts`: dòng 95-102 | Tạo khách hàng thủ công bằng `POST` không kiểm tra SĐT đã tồn tại, dẫn tới sinh bản ghi trùng lặp và làm phân mảnh điểm hội viên. | Kiểm tra `db.customer.findFirst({ where: { phone } })`; nếu đã có, trả về bản ghi hiện tại hoặc cảnh báo lỗi rõ ràng. | Kịch bản kiểm thử khách hàng trùng SĐT mới. |
| **BUG-04**: Turbopack Project Tracing Warning | `src/app/api/system/backup/route.ts`: dòng 15, 26, 30 | `fs.existsSync` và `fs.readFileSync` trên đường dẫn động khiến Turbopack Next.js 16 trace toàn bộ project vào bundle. | Chuẩn hóa đường dẫn bằng `path.join(process.cwd(), 'db', 'custom.db')` và thêm chú thích `/*turbopackIgnore: true*/`. | `npm run build` không phát sinh cảnh báo filesystem access. |
| **BUG-05**: Deprecated Middleware convention | `src/middleware.ts`: dòng 1-76 | Next.js 16 cảnh báo quy ước `middleware` bị phản đối (deprecated) và khuyến nghị dùng `proxy`. | Giữ tương thích runtime hiện hành hoặc chuyển sang `proxy.ts` theo đúng tài liệu nâng cấp Next.js 16. | `npm run build` thành công. |

---

## 7. KẾT LUẬN & ĐỀ XUẤT CHO CÁC PHÂN ĐOÀN TIẾP THEO

Toàn bộ kiến trúc của **OPENVN · Ưu Đàm Suite** đã được khảo sát tường tận từ tầng mạng, tiến trình song song, cấu hình Next.js 16, Prisma SQLite, đến từng view và service logic. Dự án có nền móng rất vững chắc với bộ công cụ kiểm thử tự động 21 kịch bản sẵn sàng.

Các kỹ sư/agent tiếp theo có thể lập tức bắt tay vào việc thực thi theo lộ trình tối ưu:
1. **Đội Fixer / Hardening (R1)**: Bọc transaction cho Hủy đơn / Vận đơn hoàn trả, chặn trùng khách hàng SĐT, xử lý cảnh báo Turbopack trong backup route.
2. **Đội Feature P1 (R2 & R3)**: Triển khai Đơn hàng hàng loạt (`bulk-confirm` + bulk print) và Hóa đơn VAT điện tử (XML QĐ 1450 + Signing adapter mock).
3. **Đội Feature P2 (R4 & R5)**: Triển khai Import/Export CSV sản phẩm, Dashboard khoảng ngày, Đơn đặt mua PO, Chat kéo-thả ảnh, In nhiệt K80 ESC/POS, Tính phí ship tự động, Voucher sinh nhật và Diễn tập Shopee/TikTok Shop.
4. **Đội Verification & QA**: Chạy lại `npm run verify` (đảm bảo 100% test pass), kiểm tra độc lập trên trình duyệt desktop & mobile 390px, và bàn giao vận hành thật.
