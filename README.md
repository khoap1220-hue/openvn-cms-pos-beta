# OPENVN · Ưu Đàm Suite (`v2.6.0`)

Hệ thống **CMS Quản Lý Bán Hàng Đa Kênh · Quầy POS Bán Tại Kho · Tiếp Thị Tự Động Auto Social AI · Hóa Đơn Điện Tử GTGT · Đồng Bộ Shopee 24/7** dành cho gian hàng **Ưu Đàm / Bơ Mộc (`thaimy1605`)**.

- **Bản Beta Trực Tuyến (GitHub Pages 24/7)**: https://khoap1220-hue.github.io/openvn-cms-pos-beta/
- **Gian hàng Shopee liên kết chuẩn**: `thaimy1605` (Shop ID `197195817` · `18` SKU biến thể chuẩn · tồn kho CMS đầu kỳ `0/0`)
- **Nền tảng kỹ thuật**: Next.js `16.4.3` (App Router + Turbopack), React `19`, TypeScript `5`, Tailwind CSS `v4`, `shadcn/ui`, Prisma ORM `6.11.1`, SQLite WAL (`db/custom.db`) / PostgreSQL (`DATABASE_URL`).

---

## 1. Kiến Trúc 3 Phân Hệ Độc Lập

| Phân hệ | Cổng mặc định | Thành phần thực thi | Điểm kiểm tra sức khỏe |
| :--- | :---: | :--- | :--- |
| **1. CMS, POS & Public Blog** | `3010` | `.runtime/standalone/server.js` (Next.js Standalone) | `GET http://127.0.0.1:3010/api` |
| **2. Realtime Event Bus** | `3013` | `mini-services/realtime/index.ts` (Socket.IO) | `GET http://127.0.0.1:3013/health` |
| **3. Shopee Seller Sync Daemon** | `51898` | `scripts/shopee_seller_sync.py` (HTTP Bridge + CDP `:9222`) | `GET http://127.0.0.1:51898/shopee/status` |

Các phân hệ giao diện chính:
- `http://localhost:3010/` — Trung tâm Quản trị CMS (21 phân hệ nghiệp vụ, Buồng lái AI, Hạch toán P&L 5 tầng, Kênh bán đa sàn, Auto Social).
- `http://localhost:3010/pos` — Quầy thu ngân POS bán tại kho (quét mã vạch `F2`, tìm kiếm `F3`, thanh toán `F9`, in nhiệt ESC/POS K80, VietQR/SePay).
- `http://localhost:3010/blog` — Chuyên trang Blog công khai chuẩn SEO.
- `http://localhost:3010/store` — Gian hàng mẫu trực tuyến.

---

## 2. Khởi Chạy Nhanh (1-Click Launchers)

### Chế độ Vận hành Thực tế (Production Standalone — Khuyên dùng)
```cmd
run-production.bat
:: hoặc trên PowerShell:
powershell -NoProfile -ExecutionPolicy Bypass -File .\start-cms.ps1 -Production
```
Tự động kiểm tra thư viện, khởi chạy Realtime Bus (`:3013`), Shopee Sync Daemon (`:51898`), biên dịch `.next/standalone` nếu chưa có, đồng bộ sang `.runtime/standalone` (Blue-Green Runtime) và mở máy chủ tại `http://localhost:3010`.

### Chế độ Phát triển (Development)
```cmd
run-cms.bat
:: hoặc: npm run dev
```

### Đồng bộ Phiên Shopee & Phát hành Bản Beta
```cmd
:: Mở Google Chrome CDP cổng 9222 để gia hạn phiên Shopee Seller (thaimy1605):
launch-chrome-shopee.bat

:: Quản lý vòng đời Shopee Sync Daemon:
run-shopee-sync.bat status

:: Đồng bộ phản hồi & xuất bản bản tĩnh Free Beta lên GitHub Pages:
deploy-beta.bat
```

---

## 3. Bộ Cổng Kiểm Tra Chất Lượng & Toàn Vẹn CSDL

```bash
# 1. Kiểm tra sức khỏe 4 tầng dịch vụ (SQLite + Realtime :3013 + Shopee :51898 + CMS :3010)
npm run ops:health

# 2. Đối soát toàn vẹn 24/24 bảng CSDL nghiệp vụ cốt lõi (db/baseline-counts.json, Delta = 0)
npm run ops:counts

# 3. Kiểm tra kiểu tĩnh TypeScript & chuẩn mã nguồn ESLint (0 errors, 0 warnings)
npx tsc --noEmit
npm run lint

# 4. Bộ kiểm thử sẵn sàng sản xuất tổng hợp (139/139 assertions & Test-Guard thaimy1605)
npm run test:master

# 5. Bộ kiểm thử Hội viên 4 hạng, Điểm thưởng & Chiến dịch CRM (11/11 nghiệp vụ)
npm run test:loyalty

# 6. Toàn bộ 8 bộ Master E2E Suite (Sổ kho, R1–R5, 21 kịch bản thực tế, 113 kiểm định Auto Social)
npm run test:e2e
```

---

## 4. Hệ Thống Tài Liệu Bàn Giao & Vận Hành

- [`HANDOVER_MAINTENANCE.md`](./HANDOVER_MAINTENANCE.md) — Sổ tay bàn giao vận hành độc lập, bảo vệ dữ liệu `thaimy1605` & quy trình bảo trì Free Beta.
- [`MATRIX_HANDOFF.md`](./MATRIX_HANDOFF.md) — Hồ sơ bàn giao kiến trúc hệ thống & danh mục hơn 50 REST API endpoints.
- [`TEST_READY.md`](./TEST_READY.md) — Đặc tả kiến trúc kiểm thử tự động 4 tầng (Tiers 1–4) & ma trận bao phủ tính năng.
- [`CICD_PIPELINE.md`](./CICD_PIPELINE.md) — Quy trình CI/CD và triển khai Cloud.
- [`docs/OPERATIONS_RUNBOOK.md`](./docs/OPERATIONS_RUNBOOK.md) — Quy trình vận hành chuẩn theo ca trực (Shift-by-Shift SOP).
- [`docs/MAINTENANCE_RUNBOOK.md`](./docs/MAINTENANCE_RUNBOOK.md) — Sổ tay nâng cấp không gián đoạn trên nhánh `main` & khôi phục khẩn cấp (`RTO < 5 phút`).
- [`docs/LAUNCH_READINESS.md`](./docs/LAUNCH_READINESS.md) — Hồ sơ sẵn sàng đưa vào vận hành thực tế & các cổng kiểm duyệt của chủ tiệm.
- [`docs/COMMERCIAL_READINESS.md`](./docs/COMMERCIAL_READINESS.md) — Hồ sơ sẵn sàng thương mại & ma trận kiểm soát rủi ro kinh doanh.
- [`docs/RELEASE_CHECKLIST.md`](./docs/RELEASE_CHECKLIST.md) — Biên bản nghiệm thu phát hành toàn diện.
- [`docs/FEATURE_EXPERIENCE_MATRIX.md`](./docs/FEATURE_EXPERIENCE_MATRIX.md) — Bảng tổng hợp trải nghiệm 29/29 phân hệ tính năng.
- [`docs/UX_UI_FLOW.md`](./docs/UX_UI_FLOW.md) — Chuẩn thiết kế giao diện & bản đồ luồng điều hướng OPENVN.
