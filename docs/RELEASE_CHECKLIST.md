# Danh Sách Kiểm Tra Phát Hành & Bàn Giao (`docs/RELEASE_CHECKLIST.md`)

> **Hệ thống**: OPENVN · Ưu Đàm Suite (Next.js 16 + Prisma/SQLite)  
> **Trạng thái**: SẴN SÀNG VẬN HÀNH THƯƠNG MẠI TOÀN DIỆN (100% PRODUCTION & GO-LIVE READY)  
> **Phiên bản**: v2.6.0 — Hoàn thiện toàn bộ Phân hệ Cốt lõi (P1 + P2), Module **AUTO SOCIAL**, **SePay VietQR**, **Fanpage Test Studio**, **Tùy biến Cột Dữ liệu Động**, **Buồng lái Chi tiết Màn hình lớn (Widescreen)** & **1-Click Production Launcher**  
> **Thư mục Google Drive công khai kiểm thử**: `https://drive.google.com/drive/folders/1FYLaoscxWBV_BU5sFouf7XCrv7cKktBY`  
> **Ngày phê duyệt chất lượng vận hành**: 2026-10-31 (Operational Go-Live Hardening Gate Passed)

---

## 1. Cổng Chất Lượng Mã Nguồn & Kiểu Tĩnh (Static Verification Gate)
- [x] **Kiểm tra kiểu tĩnh TypeScript (`npx tsc --noEmit`)**: Đạt **0 lỗi** (`0 errors`, exit code `0`).
- [x] **Kiểm tra quy chuẩn Linter (`npm run lint` / `eslint src`)**: Đạt **0 cảnh báo, 0 lỗi** (`0 warnings / 0 errors`, exit code `0`).
- [x] **Đóng gói biên dịch sản xuất Turbopack (`npm run build`)**: Thành công 100% (`exit code 0`, standalone build artifacts sẵn sàng).
- [x] **Loại bỏ cảnh báo Dynamic Tracing & Middleware Deprecation**: Chuẩn hóa `src/proxy.ts` theo Next.js 16, tắt DevTools indicator (`devIndicators: false`), tuyệt đối không còn cảnh báo dynamic filesystem access hay middleware deprecation.
- [x] **Trình khởi chạy Vận hành 1-Click & Health Probe**: Bổ sung `run-production.bat`, `start-cms.ps1 -Production`, Docker `HEALTHCHECK` và lệnh kiểm tra sức khỏe 3 tầng `npm run ops:health` (`scripts/ops-healthcheck.mjs`).

---

## 2. Cổng Kiểm Thử Tự Động Master E2E Suite (Toàn Bộ 8 Suites Pass)
Chạy bằng lệnh: `npm run verify` / `node --experimental-strip-types scripts/verify-e2e-suite.ts`
- [x] **Suite 1: Stock Ledger Chain Integrity (`scripts/verify-chain.ts`)** — PASS:
  - Chuỗi biến động kho `StockMovement` của tất cả sản phẩm khớp 100% với tồn kho thực tế hiện hành (`bal === stockAfter` và `bal === stock`).
- [x] **Suite 2: R1 Regressions & Transaction Atomicity (`scripts/verify-r1-regressions.ts`)** — PASS (11/11 tests):
  - Hủy đơn hàng nguyên tử hoàn kho sản phẩm đơn lẻ (`F02-Tier1-SimpleOrderCancel`).
  - Hủy đơn hàng Combo hoàn kho nguyên tử từng thành phần BOM và tự động đồng bộ tồn kho hiển thị Combo.
  - Chặn hủy lại đơn đã hủy và chặn mở lại đơn đã hủy sang PENDING/CONFIRMED.
  - Chặn hủy đơn hàng đã hoàn tất COMPLETED.
  - Vận đơn hoàn hàng RETURNED tự động hủy đơn và hoàn kho nguyên tử.
  - Tính lũy đẳng (Idempotency) khi gọi lại RETURNED trên vận đơn đã hoàn.
  - Chặn tạo khách hàng trùng lặp số điện thoại (`F04 Guard`).
  - API Sao lưu CSDL trả về file SQLite hợp lệ có header `SQLite format 3`.
- [x] **Suite 3: R2 Bulk Orders & Delivery Slips (`scripts/verify-r2-bulk-orders.ts`)** — PASS (20/20 tests):
  - Xác nhận hàng loạt trên tập đơn hỗn hợp: Chỉ duyệt đơn hợp lệ, trả về lý do chi tiết từng đơn bị từ chối (`POST /api/orders/bulk-confirm`).
  - In phiếu giao hàng hàng loạt khổ A6 tiêu chuẩn kèm ngắt trang CSS `page-break-after: always`.
- [x] **Suite 4: R3 VAT E-Invoice XML & Mock Signing (`scripts/verify-r3-einvoice-xml.ts`)** — PASS (11/11 tests):
  - Xuất hóa đơn bán ra file XML theo đúng chuẩn Tổng cục Thuế Việt Nam (Nghị định 123/2020, Thông tư 78/2021, Quyết định 1450/QĐ-TCT).
  - Cấu trúc XML chuẩn `<HDon><DLHDon><TTChung>...<NDHDon><NBan>...<NMua>...<DSHangHoa>...<TToan>...`.
  - Kiểm tra đầy đủ các trường bắt buộc (MST người bán, người mua, dòng hàng, thuế suất, tổng tiền, số tiền bằng chữ tiếng Việt).
  - Chặn xuất XML đối với hóa đơn đã hủy (`400 Bad Request`).
  - Bộ chuyển đổi ký số Mock Adapter (VNPT / Viettel SInvoice) với khóa RSA-SHA256 cục bộ, không gọi mạng ngoài.
- [x] **Suite 5: R4 Product Catalog CSV/Excel Import/Export (`scripts/verify-r4-catalog-csv-excel.ts`)** — PASS (10/10 tests):
  - Xuất danh mục sản phẩm và bảng giá ra file CSV có UTF-8 BOM (`GET /api/products/export`), mở đúng tiếng Việt trên MS Excel.
  - Vòng xuất ➔ nhập lại (Round-trip) bảo toàn 100% dữ liệu sản phẩm, SKU, phân loại và giá bán.
  - Nhập CSV kiểm tra dữ liệu từng dòng theo chuẩn RFC 4180 (`POST /api/products/import`).
  - File có N dòng lỗi trả về đúng N lỗi theo số dòng tương ứng và thực hiện rollback nguyên tử.
- [x] **Suite 6: R5 P2 Operational Features & Safe Mocks (`scripts/verify-r5-p2-features.ts`)** — PASS (13/13 tests):
  - Dashboard: Bộ chọn khoảng ngày (7 / 14 / 30 / 90 ngày) khớp 100% với truy vấn tổng hợp từ CSDL (`F15`).
  - Nhập hàng: Quy trình PO 3 bước (Nháp ➔ Duyệt ➔ Nhận hàng), tồn kho chỉ tăng khi thực nhận hàng (`F16`).
  - In nhiệt K80: Bộ mã hóa ESC/POS tạo chuỗi byte hợp lệ gồm lệnh khởi tạo `ESC @`, cắt giấy `GS V`, bộ lọc tiếng Việt không dấu (`vi2en`), và fallback tự động về `window.print` (`F18`).
  - Vận chuyển: Tính phí ship tự động nội thành/liên tỉnh qua adapter mock GHN/GHTK (`F19`).
  - Hội viên: Tự động gửi voucher Zalo dịp sinh nhật cho khách VIP với tính lũy đẳng (`F20`).
  - Buồng lái AI: Nút diễn tập đơn hàng Shopee và TikTok Shop mô phỏng luồng hoàn tất thành công (`F21`).
- [x] **Suite 7: Pre-existing Real-World Scenarios (`scripts/verify-realworld-scenarios.ts`)** — PASS (21/21 scenarios):
  - Vượt qua 100% toàn bộ 21/21 kịch bản nghiệp vụ phức tạp và đối kháng.
- [x] **Suite 8: Auto Social Marketing & 7 Platforms Master Suite (`scripts/verify-auto-social.ts`)** — PASS (113/113 assertions):
  - **Tier 1 (FEAT-CRM-01 -> FEAT-CRM-04)**: Chiến dịch CRM, xác thực ngày `endDate > startDate`, tính trạng thái biên thời gian thực (`UPCOMING`, `RUNNING`, `ENDED`, `CANCELLED`), làm giàu giá bán khuyến mãi và voucher.
  - **Tier 2 (FEAT-DRV-01 -> FEAT-DRV-05)**: Phân tích đường dẫn Drive công khai, trích xuất tệp Hybrid 2 tầng (Zero-Key HTML + Drive API v3), trích xuất văn bản Google Docs (`.txt`) và Google Sheets (`.csv`), tái đồng bộ không phá hủy, xử lý lỗi an toàn link 404/riêng tư.
  - **Tier 3 (FEAT-AI-01 -> FEAT-AI-05)**: AI Copywriter chuẩn giọng Ưu Đàm, lọc từ cấm Anti-AI (`BANNED_PHRASES`), đối soát bất biến số liệu CRM (giá, % giảm, mã voucher), kiểm định độ dài và định dạng 7 kênh, chấm rubric chất lượng độc lập đạt ≥ 8.0/10.
  - **Tier 4 (FEAT-REV-01 -> FEAT-PUB-08)**: Ba Cổng Thép (Three Iron Gates), khóa chống trùng lặp Concurrency Lock, quét hàng đợi tự động, bộ adapter 7 nền tảng (Facebook, Zalo OA, Website Blog, External CMS, Instagram, TikTok, Threads), chế độ Safe Mock Mode an toàn 100%.

---

## 3. Cổng Kiểm Tra Module AUTO SOCIAL Chi Tiết (R1–R7 Đầy Đủ)
- [x] **R1. Phân hệ Chương trình (CRM Campaigns)**:
  - Bảng `Campaign` liên kết sản phẩm và voucher, tự tính trạng thái biên theo mốc giờ máy chủ.
  - Chặn ngày kết thúc trước ngày bắt đầu (`400 Bad Request`).
  - Dữ liệu làm giàu sản phẩm cung cấp giá niêm yết, giá khuyến mãi, % chiết khấu và tồn kho cho AI.
- [x] **R2. Nguồn nội dung từ Google Drive công khai**:
  - Đã kiểm thử thành công với thư mục Google Drive công khai thật: `https://drive.google.com/drive/folders/1FYLaoscxWBV_BU5sFouf7XCrv7cKktBY`.
  - Liệt kê đầy đủ tệp ảnh, video, Google Docs và Google Sheets kèm cấu trúc cây thư mục.
  - Trích xuất được nội dung text của Google Doc và dữ liệu dòng của Google Sheet.
  - Link sai định dạng / không tồn tại / không công khai trả về thông báo lỗi rõ ràng, không làm hỏng CSDL.
- [x] **R3. AI lên kế hoạch và viết bài**:
  - Bài viết tạo ra cho chiến dịch: Giá, % giảm giá, mã voucher và ngày hiệu lực khớp 100% với dữ liệu CRM qua bộ kiểm định mã cấp (Deterministic Invariant Matcher).
  - Định dạng từng nền tảng: Threads nghiêm ngặt ≤ 500 ký tự; Instagram và TikTok luôn có media đi kèm.
  - Phân biệt rõ nguồn sinh giữa LLM Gemini thật và Template Fallback, không fallback ngầm.
  - Chấm điểm rubric chất lượng độc lập đạt ≥ 8.0/10.
- [x] **R4. Duyệt bài và lịch đăng**:
  - Bài viết chỉ xuất bản khi có xác nhận duyệt (`APPROVED`) từ chủ tiệm.
  - Bài chưa duyệt (`DRAFT`, `PENDING_APPROVAL`), bài bị từ chối (`REJECTED`) hoặc bài của chiến dịch đã kết thúc/hủy tuyệt đối không được xuất bản.
  - Đăng bài đúng giờ hẹn (sai lệch ≤ 1 phút trong bài kiểm tra giả lập thời gian).
  - Chạy tác vụ quét lịch đăng 2 lần không bao giờ đăng trùng bài viết nhờ Concurrency Lock.
  - Đăng bài lỗi ghi nhận lý do rõ ràng và cho phép chủ tiệm thử lại (`RETRY`).
- [x] **R5. Xuất bản 7 Nền tảng**:
  - Hỗ trợ đầy đủ 7 kênh: Facebook Fanpage, Zalo OA, Website Shop Blog (`/blog`), Website ngoài (WordPress/Haravan/Sapo), Instagram, TikTok, Threads.
  - Bài đăng lên Website nội bộ hiển thị đầy đủ, đẹp mắt trên trang công khai tại `/blog` và `/blog/[slug]`.
- [x] **R6. An toàn khi kiểm thử và vận hành**:
  - Cơ chế Safe Mock Mode đảm bảo bộ kiểm thử tự động và môi trường thử nghiệm không gửi bất kỳ socket HTTP ra mạng xã hội thật.
  - Quét toàn bộ mã nguồn không phát hiện bí mật / API key / token bị hard-code.
  - Hệ thống tự phục hồi nhẹ nhàng khi Google Drive hoặc AI gặp lỗi hoặc cạn quota 429.
- [x] **R7. Không hồi quy và an toàn dữ liệu**:
  - Bản sao lưu `db/custom.db.bak` bảo vệ an toàn.
  - 24/24 bảng dữ liệu cốt lõi nguyên vẹn 100% (Delta = 0).
  - Toàn bộ tính năng cũ tiếp tục hoạt động hoàn hảo.

---

## 4. Cổng Kiểm Tra Toàn Vẹn CSDL Sản Xuất & Chống Rò Rỉ (R7 Parity Audit)
Lệnh kiểm tra: `node scripts/check-counts.mjs`
- [x] **File sao lưu CSDL**: `db/custom.db.bak` đã tạo an toàn từ Milestone M1.
- [x] **Khớp 100% toàn bộ 24 bảng dữ liệu nghiệp vụ cốt lõi (`db/baseline-counts.json`, Delta = 0)**:
  - `Product`: 18/18 MATCH
  - `Category`: 1/1 MATCH
  - `Order`: 3/3 MATCH
  - `OrderItem`: 2/2 MATCH
  - `Customer`: 3/3 MATCH
  - `SalesInvoice`: 3/3 MATCH
  - `PurchaseInvoice`: 0/0 MATCH
  - `StockMovement`: 0/0 MATCH
  - `Warehouse`: 1/1 MATCH
  - `WarehouseStock`: 18/18 MATCH
  - `Voucher`: 0/0 MATCH
  - `BomComponent`: 0/0 MATCH
  - `AccountingPeriod`: 5/5 MATCH
  - `Partner`: 0/0 MATCH
  - `Channel`: 10/10 MATCH
  - `ChannelListing`: 51/51 MATCH
  - `Shipment`: 0/0 MATCH
  - `AfterSalesCase`: 0/0 MATCH
  - `AppSetting`: 21/21 MATCH
  - `IntegrationCredential`: 14/14 MATCH
  - `ApiKey`: 1/1 MATCH
  - `WebhookEndpoint`: 2/2 MATCH
  - `AutomationSetting`: 7/7 MATCH
  - `OrderEvent`: 12/12 MATCH
- [x] **Master Production Suite (`npm run test:master`) & Loyalty Suite (`npm run test:loyalty`)**: Đạt **139/139 PASS (100%)** và **11/11 PASS (100%)**, cô lập hoàn toàn đơn kiểm thử qua `src/lib/synthetic-filter.ts`.
- [x] **Xác nhận không rò rỉ dữ liệu test**: Sau khi chạy xong toàn bộ các bộ test tự động, 24 bảng cốt lõi giữ nguyên số lượng bản ghi.

---

## 5. Cổng Kiểm Tra Giao Diện Trình Duyệt Độc Lập (Browser UI Audit)
- [x] **Kiểm tra màn hình Desktop (Viewport 1440x900)**:
  - Sidebar: Bổ sung 2 mục điều hướng mới trong nhóm `NAV_CRM`: "Chương trình & Khuyến mãi" (icon `Megaphone`) và "Auto Social & Lịch AI" (icon `Share2`).
  - View "Chương trình & Khuyến mãi" (`campaigns-view.tsx`): 4 thẻ thống kê, bộ lọc tab ngang, tìm kiếm, modal tạo/sửa chiến dịch với date picker & validation, nút chuyển nhanh AI Post.
  - View "Auto Social & Lịch AI" (`auto-social-view.tsx`): 4 tab nghiệp vụ mượt mà (Nguồn Drive, Lên kế hoạch AI, Duyệt bài & Lịch đăng, Cổng xuất bản 7 nền tảng).
  - Tuyến Blog công khai: `/blog` và `/blog/[slug]` hiển thị sang trọng, font chữ trang nhã, breadcrumbs và liên kết mua sắm.
- [x] **Kiểm tra màn hình Mobile (Viewport 390px — iPhone 12/13/14 Pro)**:
  - Tất cả các bảng danh sách và tab list được bao bọc trong `overflow-x-auto`, tuyệt đối không gây tràn ngang trang (`no horizontal page overflow`).
  - Các lưới thẻ (Card Grid) tự động xếp chồng (stack) theo chiều dọc linh hoạt.
  - Nút bấm, bộ chọn và ô nhập liệu dễ thao tác bằng ngón tay trên màn hình cảm ứng nhỏ.
- [x] **Console Errors**: Ghi nhận `0 console errors`, `0 hydration mismatches`.

---

## 6. Phê Duyệt Phát Hành Toàn Diện
- **Kỹ sư triển khai**: Worker M7 (`worker_m7_as`)
- **Kiểm định viên chất lượng**: Explorer / Reviewer / Auditor M7
- **Kết luận**: **ĐẠT TẤT CẢ TIÊU CHÍ PHÁT HÀNH (100% RELEASE READY)**
