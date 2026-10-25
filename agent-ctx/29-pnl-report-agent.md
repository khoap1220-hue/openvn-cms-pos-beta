# Task 29 — pnl-report-agent

## Task
Báo cáo Lợi nhuận Ròng (P&L & Unit Economics) 5 tầng — API `GET /api/reports/pnl?days=30` + UI thêm vào cuối tab Báo cáo (reports-view.tsx).

## Files đã tạo/sửa (chỉ 2 file code + 1 script verify — KHÔNG đụng file của agent khác)
- **TẠO MỚI** `src/app/api/reports/pnl/route.ts` (243 dòng) — `export const dynamic = 'force-dynamic'`, days clamp 7..90 mặc định 30.
- **SỬA** `src/components/cms/views/reports-view.tsx` (268 → 521 dòng) — THÊM card P&L cuối view, giữ nguyên 100% nội dung cũ (4 StatCard, xu hướng doanh thu, doanh thu theo kênh, phân bố trạng thái, SP bán chạy). State `pnl`/`pnlLoading` + `useEffect` riêng theo `days` (load song song, try/catch riêng — lỗi P&L chỉ ẩn phần P&L).
- **SCRIPT** `scripts/verify-pnl.ts` (161 dòng) — đối chiếu số học API vs tính tay từ DB (chạy `bunx tsx scripts/verify-pnl.ts`).

## Công thức chốt (5 tầng)
1. **Doanh thu gộp** = `Order.total` (đơn status ≠ CANCELLED, createdAt ≥ from).
2. **COGS** = Σ items: SIMPLE → `costPrice × qty` · COMBO → `comboCostFromRows(BOM) × qty`.
3a. **Phí sàn** = `order.platformFee > 0 ? platformFee : subtotal × channel.feePercent / 100` (snapshot ưu tiên, ước tính % kênh hiện tại khi thiếu).
3b. **Vận chuyển hỗ trợ** = có shipment ? `max(0, carrierFee − order.shippingFee)` : 0; carrierFee = `fee > 0 ? fee : CARRIER_FEE_ESTIMATES[carrier] ?? 20000` (GHN/GHTK 22k, JT 20k, VIETTEL 15k, NINJA 18k).
4. **Điểm thưởng** = `COMPLETED ? floor(total/10.000) điểm × 1.000đ` : 0.
5. **Net** = gross − cogs − phí sàn − vận chuyển − điểm. **marginPct** = gross > 0 ? round(net/gross×1000)/10 : 0.

**Phân bổ per-product** phí sàn/vận chuyển/điểm theo `itemRevenue (price×qty) / order.subtotal`; guard subtotal ≤ 0 → chia đều theo quantity. Product `grossRevenue = Σ itemRevenue` (không gồm phí ship — khác tier kênh/tổng dùng `total`).

**Rounding-safe**: `buildRow()` làm tròn từng tầng trước (Math.round), rồi `netProfit = các tầng ĐÃ LÀM TRÒN trừ nhau` → đẳng thức Net = Gross − COGS − Fee − Ship − Điểm giữ tuyệt đối trên mọi dòng JSON.

**Hiệu năng**: 3 truy vấn (orders include items/channel/shipments + products in ids + bomComponents in comboIds) + Map lookup — không N+1.

## UI
- Card "Báo cáo Lợi nhuận Ròng (P&L & Unit Economics)" + mô tả 5 tầng + `pnl.period.label`.
- Thanh tổng hợp 5 tầng (`data-testid="pnl-summary-bar"`) — visually giống PeriodSummaryBar: 6 segment (label 10px uppercase + giá trị font-semibold tabular-nums, formatCompactVND), toán tử −/−/−/−/= aria-hidden giữa các segment; segment Net có màu emerald/rose theo dấu + Badge "% margin".
- Bảng theo kênh (min-w-[900px]): Kênh (dot màu + tên) | Số đơn | Doanh thu gộp | Giá vốn | Phí sàn | Vận chuyển | Điểm | Lợi nhuận ròng (đậm emerald/rose) | % Margin badge (emerald ≥20%, amber 0–20%, rose <0).
- Bảng Unit Economics per SP (min-w-[1000px], cuộn cả 2 trục ngay trên `[data-slot=table-container]` qua Tailwind arbitrary variant `[&_[data-slot=table-container]]:max-h-96` + overflow-y-auto → **header sticky hoạt động thật** + scrollbar ngang luôn nhìn thấy; `[scrollbar-width:thin]`): SP (tên + SKU mono + badge COMBO teal) | SL bán | Doanh thu | COGS | Phí sàn | Vận chuyển | Điểm | Lợi nhuận ròng | % Margin.
- Dòng giả định text-xs cuối card; Skeleton khi loading; kỳ 0 đơn → message thay bảng; formatVND (Intl vi-VN) tự xử lý dấu âm "-1.234.567 ₫".
- Bộ lọc kỳ dùng NGUYÊN 7/30/90 ngày sẵn của view (không thêm PeriodFilterBar, không chart mới).

## Verify (toàn ✅, 0 ❌)
- `bunx tsc --noEmit` → 0 lỗi vùng src (chỉ lỗi cũ examples/skills).
- `bunx eslint <2 file> --max-warnings 0` → exit 0.
- curl days=7/30/90 (+ clamp 3→7, 200→90, days=abc→30) → HTTP 200.
- Script verify 36/36 pass, diff 0: (a) summary = Σ byChannel mọi tầng; (b) đơn DH261024-9859 (UD-COMBO-001 ×1 @219k, Zalo OA, JT fee=30k) tính tay 5 tầng = dòng products API từng số (gross 219.000, cogs 103.000 BOM, net 92.000, margin 42%); (c) identity Net = 5 tầng cho summary + 8 kênh + 12 SP.
- Browser E2E: chuyển kỳ 7/30/90 → bar + subtitle cập nhật đúng (51,3tr/12,5tr/55,9tr gross); mobile 390px: bảng cuộn ngang + dọc OK, thead sticky OK; 5 section cũ vẫn render; console/page errors trống.

## Lưu ý cho agent sau
- Đã có agent khác sửa products-view.tsx song song lúc 04:25 (lúc test thấy console error `FileSync` lucide tạm thời của agent đó — đã tự hết, KHÔNG phải file của task 29).
- `PnlData`/`PnlRow`/`PnlChannelRow`/`PnlProductRow` đã có sẵn trong `src/lib/types.ts` (task cha thêm) — tuyệt đối không sửa.
- UI dùng `[&_[data-slot=table-container]]:max-h-96` để cuộn ngay trên container của shadcn Table — pattern này cho sticky thead hoạt động; có thể tái dùng cho bảng dài khác.
