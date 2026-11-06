# 🎨 MASTER DESIGN SYSTEM — `OPENVN · Ưu Đàm Omni CMS & POS Suite`

> **Quản trị bởi**: Agent Độc Lập `UIUX-AGENT-PRO` (`ui-ux-pro-max` + `matrix-thiet-ke-giao-dien-uxui`)
> **Kiến trúc UI gốc**: Next.js 16 App Router + Tailwind CSS v4 + `shadcn/ui` (Radix UI) + `Lucide Icons`

## 1. Bảng Token Màu & Hình Học Chuẩn (`:root` `src/app/globals.css`)
- **Primary Brand (`--primary`)**: `oklch(0.51 0.19 252)` / `#0066CC` (Xanh dương điều hành chuẩn OPENVN)
- **Surface Card (`--card`)**: `oklch(1 0 0)` (Light) / `oklch(0.19 0.015 252)` (Dark)
- **Border (`--border`)**: `oklch(0.905 0.008 250)` — Viền mảnh phân tách dữ liệu rõ nét
- **Muted Surface (`--muted`)**: `oklch(0.955 0.006 250)` — Nền thanh công cụ & chip lọc
- **Radius (`--radius`)**: `0.5rem` (`8px` cho Card/Input/Button đồng bộ)

## 2. Quy Chuẩn 5 Chiều (`5-Dimension Critique`) & Mật Độ Dữ Liệu (`Density = 8/10`)
1. **Philosophy (Triết lý)**: Ưu tiên tra cứu nhanh Đa Kho, thao tác 1 chạm tại quầy POS và đọc bảng dữ liệu lớn không mỏi mắt.
2. **Hierarchy (Phân cấp thị giác)**: Thanh điều hướng quy trình 5 bước kho (`1. Nhập kho`..`5. Sản xuất`) -> Thẻ KPI tổng hợp -> Thanh lọc kho/danh mục -> Bảng dữ liệu chi tiết.
3. **Execution (Thực thi chuẩn Token)**: Mọi bản vá UI/UX bắt buộc dùng biến `var(--primary)`, `var(--card)`, `var(--border)`, `var(--radius)` gốc; tuyệt đối cấm màu neon/gradient lệch chuẩn.
4. **Function (Công năng tương tác)**: Chuỗi JSON đặc tính tự động chuyển thành `Badge` dễ đọc; ô chữ dài (`.truncate`) tự bung đầy đủ khi di chuột hoặc chạm; bảng tự cuộn ngang gọn trong Card ở mọi độ phân giải (`390px` -> `2560px`).
5. **Innovation (Tự chữa lành giao diện)**: Tự động nhận diện vùng khoanh đỏ + mô tả của người dùng để tinh chỉnh CSS/UI tức thì kèm Hợp đồng số chịu trách nhiệm.

## 3. Trích Xuất Cơ Sở Dữ Liệu `ui-ux-pro-max`
```text
╔═════════════════════════════════════════════════════════════════════════════════════════╗
║  TARGET: OPENVN CMS POS Suite - RECOMMENDED DESIGN SYSTEM                               ║
╚═════════════════════════════════════════════════════════════════════════════════════════╝
┌─────────────────────────────────────────────────────────────────────────────────────────┐
├─── DESIGN DIALS ─────────────────────────────────────────────────────────────────────────┤
│  Density:  8/10 — Dense / Dashboard                                                     │
├─── PATTERN ──────────────────────────────────────────────────────────────────────────────┤
│  Name: Enterprise Gateway                                                               │
│     Conversion: Path selection (I am a...). Mega menu navigation. Trust signals prominent.│
│     CTA: Contact Sales (Primary) + Login (Secondary)                                    │
│     Sections:                                                                           │
│       1. 1. Hero (Video/Mission), 2. Solutions by Industry, 3. Solutions by Role, 4. Client Logos, 5. Contact Sales│
├─── STYLE ────────────────────────────────────────────────────────────────────────────────┤
│  Name: Minimalism & Swiss Style                                                         │
│     Mode Support: Light ✓ Full  Dark ✓ Full                                             │
│     Keywords: Clean, simple, spacious, functional, white space, high contrast,          │
│     geometric, sans-serif, grid-based, essential                                        │
│     Best For: Enterprise apps, dashboards, documentation sites, SaaS platforms,         │
│     professional tools                                                                  │
│     Performance: ⚡
```
