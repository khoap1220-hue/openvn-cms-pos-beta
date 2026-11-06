# Sổ Tay Bàn Giao, Nghiệm Thu 2 Đầu & Hợp Đồng Số 6-Agent Fullstack — `openvn-cms-pos-beta`

## 1. Thông Tin Bàn Giao (Handover)
- **Link Live 24/7 (GitHub Pages CDN `\$0`):** https://khoap1220-hue.github.io/openvn-cms-pos-beta/
- **Kho chứa GitHub:** `khoap1220-hue/openvn-cms-pos-beta` (nhánh `gh-pages`)
- **Cổng Server Local & Cổng Proxy M.A.T.R.I.X:** `http://127.0.0.1:3010` • Local Gate: `http://127.0.0.1:51897/`
- **Kênh Đồng Bộ Dữ Liệu 2 Chiều Cloud 24/7:** `https://ntfy.sh/openvn_sync2way_openvn_cms_pos_beta_v1`

## 2. Quy Trình Chuẩn M.A.T.R.I.X: Khoanh Tròn + Mô Tả ➔ Nghiệm Thu Trước/Sau ➔ Ký Hợp Đồng Số 6-Agent
1. **Khoanh tròn chỗ lỗi + Nhập mô tả (`#__bk_circle_hint`)**: Ngay sau khi khoanh đỏ trên ảnh chụp, ô nhập mô tả tự động khóa phần tử DOM bên trong nét vẽ và đặt mô tả của người dùng làm **Trọng tâm số 1 (`Ground-Truth Intent`)** trước khi Gemini 3.8 Flash phân tích.
2. **Nghiệm thu TRƯỚC khi sửa (`Pre-Fix Acceptance`)**: Khóa mã băm `SHA-256` trước khi sửa đối với file giao diện TSX mục tiêu, file Backend API (`src/app/api/**/route.ts`) và `prisma/schema.prisma`.
3. **Tự sửa Đồng bộ Design Gốc (`Design-Synced Self-Healing`)**: Tổng hợp bản vá theo đúng biến `:root` (`var(--primary)`, `var(--radius)`, `var(--card)`, `var(--border)`) và chuẩn component `shadcn/ui`.
4. **Nghiệm thu SAU khi sửa (`Post-Fix Acceptance`)**: Kiểm chứng cân bằng ngoặc AST/CSS, xác nhận mã băm `SHA-256` của Database Schema & Backend API bất biến `100%`, và `0%` rò rỉ Secret.
5. **Ký Hợp Đồng Số 6-Agent Fullstack (`HMAC-SHA256`)**: 6 Agent Fullstack (`FS-AGENT-01`..`FS-AGENT-06`) biểu quyết, cam kết chịu trách nhiệm kỹ thuật (`Accountability Pledge`) và đóng dấu chữ ký số vào sổ cái.

## 3. Công Cụ Triển Khai & Bảo Trì Độc Lập Tại Dự Án
- **`deploy-beta.bat`**: Nhấp đúp chuột (1-Click) để tự động kéo phản hồi lỗi mới nhất, chạy Nghiệm thu Trước/Sau, ký Hợp đồng số 6-Agent, chụp lại dữ liệu SQLite và đẩy bản cập nhật lên GitHub Pages 24/7.
- **`start-ui-ux-agent.bat` / `python ui_ux_agent_worker.py`**: Khởi chạy **Agent UI/UX Độc Lập 24/7 (`UIUX-AGENT-PRO`)** kiểm toán 15 phân hệ theo 10 Danh mục Ưu tiên `ui-ux-pro-max` + 6 Cổng `matrix-thiet-ke-giao-dien-uxui`, duy trì `design-system/.../MASTER.md` và ký Hợp đồng số `CONTRACT-UIUX-PRO-...`.
- **`start-autonomous-agent.bat` / `python agent_autonomous_worker.py`**: Khởi chạy Agent QA & Self-Healing độc lập 24/7 tuần tra từng màn hình.
- **`python deploy_beta.py --sync-feedback`**: Đồng bộ nhanh các báo lỗi, ảnh chụp màn hình và cập nhật Sổ cái Hợp đồng số về `./beta-feedback/`.
- **`python deploy_beta.py --watch`**: Bật cầu nối chạy ngầm đồng bộ 2 chiều `Cloud 24/7 <-> SQLite Local`.
- **`beta-deploy.config.json`**: File cấu hình riêng của dự án.

## 4. Hộp Thư Nhận Báo Lỗi, Biên Bản Nghiệm Thu & Sổ Cái Hợp Đồng Số
- **Báo cáo Kiểm toán & Tinh chỉnh của Agent UI/UX Độc Lập (`UIUX-AGENT-PRO`):** [`beta-feedback/UI_UX_AGENT_AUDIT_REPORT.md`](./beta-feedback/UI_UX_AGENT_AUDIT_REPORT.md) (`ui_ux_audit.json`)
- **Tài liệu Hệ Thiết Kế Chuẩn (`Master Design System`):** [`design-system/openvn-cms-pos-beta/MASTER.md`](./design-system/openvn-cms-pos-beta/MASTER.md)
- **Sổ cái Hợp đồng Số 6-Agent Fullstack (`HMAC-SHA256`):** [`beta-feedback/DIGITAL_CONTRACTS_LEDGER.md`](./beta-feedback/DIGITAL_CONTRACTS_LEDGER.md) (`digital_contracts.json`)
- **Báo cáo 5 Cổng Chuẩn M.A.T.R.I.X:** [`beta-feedback/MATRIX_STANDARD_PIPELINE_REPORT.md`](./beta-feedback/MATRIX_STANDARD_PIPELINE_REPORT.md)
- **Báo cáo Agent Tự Kiểm Tra & Tự Sửa:** [`beta-feedback/AGENT_AUTO_FIX_REPORT.md`](./beta-feedback/AGENT_AUTO_FIX_REPORT.md)
- **Báo cáo Tự Review Đối Chiếu 3 Chiều:** [`beta-feedback/PRE_REVIEW_REPORT.md`](./beta-feedback/PRE_REVIEW_REPORT.md)
- **Bảng tổng hợp lỗi & góp ý:** [`beta-feedback/FEEDBACK_LIST.md`](./beta-feedback/FEEDBACK_LIST.md)
- **Dữ liệu JSON cấu trúc:** [`beta-feedback/feedback_inbox.json`](./beta-feedback/feedback_inbox.json)
