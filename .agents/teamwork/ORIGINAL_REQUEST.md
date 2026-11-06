# Original User Request

## 2026-10-26T07:18:59Z

Hoàn thiện hệ thống có sẵn **OPENVN · Ưu Đàm Suite** (CMS bán hàng đa kênh + Quầy POS tại kho, Next.js 16 + Prisma/SQLite) để **vận hành thật** tại cửa hàng Ưu Đàm: rà soát và sửa lỗi toàn bộ hệ thống, sau đó bổ sung toàn bộ các tính năng còn thiếu (P1 + P2) đang được ghi trong `docs/FEATURE_EXPERIENCE_MATRIX.md`. Đây là hệ thống chạy thật — độ chắc chắn và an toàn dữ liệu được ưu tiên hơn tốc độ.

Working directory: y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)
Integrity mode: development

Bối cảnh: dự án đã có sẵn. Đọc `MATRIX_HANDOFF.md`, `docs/` (FEATURE_EXPERIENCE_MATRIX, UX_UI_FLOW, OPERATIONS_RUNBOOK, RELEASE_CHECKLIST) và phần cuối `worklog.md` (file rất lớn) để nắm trạng thái. Theo `AGENTS.md` của repo: phiên bản Next.js này có thay đổi phá vỡ so với kiến thức cũ — đọc tài liệu trong `node_modules/next/dist/docs/` trước khi viết code. Máy chủ phát triển là Windows; `npm run dev` chạy cổng 3010, realtime bus cổng 3013. Giao diện dùng tiếng Việt.

## Requirements

### R1. Rà soát và gia cố toàn hệ thống
Tìm và sửa lỗi trên toàn bộ các view giao diện, API route và logic nghiệp vụ (đơn hàng, tồn kho/Combo BOM, POS, hóa đơn, vận chuyển/COD, hội viên/voucher, kế toán). Mỗi lỗi đã sửa phải có kiểm thử hồi quy tương ứng.

### R2. Đơn hàng hàng loạt
Chọn nhiều đơn cùng lúc để xác nhận hàng loạt và in phiếu giao hàng hàng loạt. Khi một số đơn không hợp lệ, hệ thống xử lý các đơn hợp lệ và báo rõ lý do từng đơn bị từ chối (không được bỏ qua im lặng).

### R3. Hóa đơn VAT điện tử
Xuất hóa đơn bán ra file XML theo định dạng hóa đơn điện tử của Tổng cục Thuế Việt Nam (Nghị định 123/2020, Thông tư 78/2021, Quyết định 1450/QĐ-TCT). Có điểm kết nối cấu hình được (adapter/webhook) để gửi hóa đơn sang nhà cung cấp ký số (VNPT, Viettel SInvoice…), kèm chế độ giả lập.

### R4. Nhập/xuất danh mục sản phẩm
Nhập và xuất danh mục sản phẩm cùng bảng giá bằng file CSV/Excel trên giao diện, có kiểm tra dữ liệu và báo lỗi theo từng dòng.

### R5. Các tính năng P2 còn lại
- Dashboard: chọn khoảng ngày cho biểu đồ doanh thu (7/14/30/90 ngày).
- Nhập hàng: bước Đơn đặt hàng mua (PO) nháp → duyệt → nhận hàng (đủ hoặc một phần); tồn kho chỉ tăng khi thực nhận.
- Chat: kéo-thả để tải ảnh từ máy tính lên khung chat.
- POS: in trực tiếp máy in nhiệt K80 qua WebUSB/WebSerial (ESC/POS, có lệnh cắt giấy), tự quay về `window.print` khi trình duyệt/thiết bị không hỗ trợ.
- Vận chuyển: tính phí ship tự động theo địa chỉ qua GHN/GHTK.
- Hội viên: tự động gửi voucher Zalo dịp sinh nhật cho khách VIP theo lịch.
- Buồng lái AI: nút diễn tập đơn hàng Shopee / TikTok Shop.

### R6. Tích hợp bên ngoài — không gọi mạng thật
Trong phát triển và kiểm thử **không gọi mạng/thiết bị thật** (GHN/GHTK, Zalo, ký số, máy in USB). Mỗi tích hợp phải có chế độ giả lập (mock) kiểm thử được, tự dùng khi chưa có thông tin xác thực, và tự chuyển sang gọi thật khi chủ tiệm điền key trong màn hình Kết nối API. Không ghi log hay hard-code bí mật.

### R7. An toàn dữ liệu
Dữ liệu hiện có trong `db/custom.db` phải được giữ nguyên. Sao lưu DB trước mọi thay đổi schema; thay đổi schema phải tương thích với dữ liệu cũ. Dữ liệu tạo ra trong quá trình kiểm thử phải được dọn sạch. Cập nhật `docs/FEATURE_EXPERIENCE_MATRIX.md`, `docs/RELEASE_CHECKLIST.md` và `MATRIX_HANDOFF.md` theo trạng thái mới.

## Acceptance Criteria

### Cổng chất lượng mã nguồn
- [ ] `npm run verify` (tsc + lint + test:chain + test:scenarios) pass với 0 lỗi, 0 cảnh báo.
- [ ] `npm run build` thành công.
- [ ] 17 kịch bản có sẵn trong `test:scenarios` vẫn pass.

### Rà soát lỗi (R1)
- [ ] Có báo cáo liệt kê từng lỗi tìm thấy: vị trí `file:line`, cơ chế lỗi, cách sửa, tên kiểm thử hồi quy; mọi kiểm thử hồi quy đều nằm trong bộ test chạy bởi `npm run verify` và pass.

### Kiểm thử tính năng (R2–R5)
- [ ] Mỗi tính năng mới có ít nhất một kịch bản đường chuẩn và một kịch bản đối kháng trong bộ test tự động, tất cả đều pass.
- [ ] Xác nhận hàng loạt trên tập hỗn hợp (đơn hợp lệ + đơn đã hủy + đơn vượt tồn kho): chỉ đơn hợp lệ được xác nhận, phản hồi liệt kê lý do từng đơn bị từ chối; `test:chain` vẫn khớp 100%.
- [ ] XML hóa đơn: kiểm tra tự động xác nhận có đủ các trường bắt buộc (MST người bán, người mua, dòng hàng, thuế suất, tổng tiền), tổng tiền trong XML khớp đúng hóa đơn; hóa đơn đã hủy không xuất được XML hợp lệ.
- [ ] CSV/Excel: xuất → nhập lại cho ra dữ liệu sản phẩm và giá giống hệt; file có N dòng lỗi trả về đúng N lỗi theo dòng và không ghi dữ liệu hỏng vào DB.
- [ ] Dashboard: số liệu từng ngày của cả 4 khoảng (7/14/30/90) khớp với truy vấn tổng hợp trực tiếp từ DB.
- [ ] PO: tồn kho không đổi khi tạo nháp/duyệt; tăng đúng bằng số lượng thực nhận (kể cả nhận một phần); chuỗi `StockMovement` khớp.
- [ ] Voucher sinh nhật: chạy tác vụ 2 lần trong cùng ngày chỉ gửi 1 lần cho mỗi khách.
- [ ] In nhiệt: bộ mã hóa ESC/POS được kiểm thử so với chuỗi byte mong đợi (bao gồm lệnh cắt giấy và tiếng Việt có dấu); khi không có WebUSB/WebSerial thì quay về `window.print`.

### Tích hợp & bảo mật (R6)
- [ ] Khi không có key, toàn bộ tính năng tích hợp chạy được ở chế độ giả lập và có kiểm thử tự động; bộ test không thực hiện kết nối mạng ra ngoài.
- [ ] Quét mã nguồn không phát hiện bí mật/API key bị hard-code.

### Giao diện (kiểm định độc lập)
- [ ] Một agent độc lập (không phải agent viết code) mở từng view đã thay đổi trên trình duyệt ở desktop và mobile 390px, thực hiện luồng chính, ghi nhận 0 lỗi console và không tràn ngang; lưu ảnh chụp màn hình làm bằng chứng.

### Dữ liệu (R7)
- [ ] Có file sao lưu DB tạo trước thay đổi schema đầu tiên.
- [ ] Số lượng bản ghi các bảng cốt lõi (đơn hàng, sản phẩm, tồn kho, hội viên, hóa đơn) trước và sau đợt làm việc giống hệt nhau, trừ dữ liệu demo có chủ đích được ghi rõ trong báo cáo.
- [ ] Các tài liệu `docs/FEATURE_EXPERIENCE_MATRIX.md`, `docs/RELEASE_CHECKLIST.md`, `MATRIX_HANDOFF.md` đã cập nhật.

## 2026-10-26T11:23:02Z

Server vừa restart, toàn bộ subagent và cron của bạn đã bị dừng. Hãy tiếp tục từ trạng thái hiện tại: GATE_STATUS.md cho thấy M1–M6 đã PASS. Khôi phục orchestrator (hoặc khởi chạy lại từ .agents/teamwork/orchestrator_1), khởi động lại dev server nếu cần, và hoàn thành M7 (master suite, kiểm định browser độc lập desktop + 390px, cập nhật docs/FEATURE_EXPERIENCE_MATRIX.md, docs/RELEASE_CHECKLIST.md, MATRIX_HANDOFF.md, báo cáo lỗi R1, đối soát baseline counts) rồi chạy victory audit đối chiếu toàn bộ Acceptance Criteria. Trong báo cáo cuối hãy làm rõ: (1) chênh lệch 6 vs 7 voucher rác đã xóa; (2) ESC/POS in tiếng Việt có dấu hay bỏ dấu; (3) 2 đơn chênh lệch 171 vs 173 trong baseline. Khởi động lại các cron báo cáo tiến độ.

## 2026-10-26T11:57:21Z

Lưu ý từ caller về bản vá M7-R2 (page.tsx đổi SalesView → SalesInvoicesView): kiểm tra nhanh cho thấy sales-view.tsx có quét mã vạch khi lập hóa đơn (handleBarcodeScan, 6 tham chiếu barcode) và thêm/xóa dòng hàng (addRow/removeRow/updateRow/selectProduct), trong khi sales-invoices-view.tsx chỉ còn 2 tham chiếu barcode và không có addRow. Yêu cầu: trước khi claim victory, xác minh SalesInvoicesView giữ ĐẦY ĐỦ chức năng của SalesView cũ (lập HĐ nhiều dòng hàng, quét mã vạch, chọn đối tác, in A4/VietQR, hủy, lineage) — nếu thiếu thì bổ sung vào SalesInvoicesView (hoặc gắn nút XML/Ký số vào SalesView) để không có hồi quy chức năng. Reviewer/browser test phải thực hiện luồng lập hóa đơn bán đầy đủ (nhiều dòng + quét mã vạch) trên view mới.


## 2026-10-26T13:06:22Z

Bổ sung module **AUTO SOCIAL** vào hệ thống có sẵn **OPENVN · Ưu Đàm Suite** (Next.js 16 + Prisma/SQLite, đang vận hành thật): AI tự lên kế hoạch nội dung và viết bài từ thư mục Google Drive công khai cùng các chương trình đang chạy / sắp chạy trên CRM; chủ tiệm duyệt từng bài; hệ thống tự đăng đúng giờ lên website và mạng xã hội.

Working directory: y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)
Integrity mode: development

Bối cảnh: dự án vừa hoàn thành một đợt nâng cấp đã nghiệm thu — đọc `MATRIX_HANDOFF.md`, `docs/`, `.agents/teamwork/handoff.md` để nắm trạng thái (thư mục `.agents/teamwork/` chứa artefact của đợt trước — không ghi đè, dùng thư mục làm việc mới cho đợt này). Theo `AGENTS.md`: phiên bản Next.js này có thay đổi phá vỡ — đọc `node_modules/next/dist/docs/` trước khi viết code. Hệ thống đã có sẵn lớp gọi LLM, màn hình Kết nối API quản lý credential (có FACEBOOK, ZALO_OA, WEBSITE, GEMINI…) và cơ chế adapter/mock cho tích hợp ngoài — tái sử dụng khi hợp lý. Giao diện tiếng Việt.

Thư mục Google Drive công khai: người dùng sẽ cung cấp link thật sau và tự cấu hình trên giao diện. Trong lúc phát triển, đội agent tự chọn một thư mục Google Drive công khai có sẵn (có ảnh, video, Google Doc, Google Sheet và thư mục con) để kiểm thử với dữ liệu thật; ghi rõ link đã dùng trong báo cáo.

## Requirements

### R1. Phân hệ Chương trình (CRM)
Thêm phân hệ quản lý chương trình bán hàng/khuyến mãi: tên, mô tả, thời gian bắt đầu – kết thúc, sản phẩm áp dụng, voucher kèm theo; tự xác định trạng thái sắp chạy / đang chạy / đã kết thúc theo thời gian. Đây là nguồn dữ liệu CRM cho AUTO SOCIAL.

### R2. Nguồn nội dung từ Google Drive công khai
Chủ tiệm cấu hình một hoặc nhiều link thư mục Google Drive công khai. Hệ thống đọc được ảnh, video, tài liệu (Google Docs, .docx, .txt), Google Sheets và cấu trúc thư mục con (theo sản phẩm / chiến dịch), đồng bộ lại khi thư mục thay đổi, và cho phép liên kết tài nguyên với sản phẩm/chương trình.

### R3. AI lên kế hoạch và viết bài
Từ chương trình (R1), sản phẩm và tài nguyên Drive (R2), AI đề xuất lịch đăng (ngày giờ, kênh, chủ đề) và viết nháp bài cho từng nền tảng, phù hợp định dạng và giới hạn của nền tảng đó, đúng giọng thương hiệu Ưu Đàm, kèm ảnh/video phù hợp. Nội dung khuyến mãi (giá, % giảm, mã voucher, thời hạn) phải khớp dữ liệu CRM.

### R4. Duyệt bài và lịch đăng
Màn hình lịch nội dung: xem/sửa/duyệt/từ chối/đổi giờ từng bài. **Chỉ bài đã được chủ tiệm duyệt mới được đăng.** Bài đã duyệt tự đăng đúng giờ; trạng thái từng bài (nháp, chờ duyệt, đã lên lịch, đã đăng, lỗi) và lỗi đăng hiển thị rõ, có thể thử lại. Bài của chương trình đã kết thúc hoặc bị hủy không được đăng.

### R5. Đăng lên 7 nền tảng
Fanpage Facebook, Zalo OA, website của shop (trang tin/blog ngay trong hệ thống này, có trang công khai), website bên ngoài (WordPress, Haravan, Sapo), Instagram, TikTok, Threads. Mỗi nền tảng chạy thật khi có credential trong màn hình Kết nối API; khi chưa có thì chạy chế độ giả lập.

### R6. An toàn khi kiểm thử và vận hành
Được phép gọi thật Google Drive công khai và AI. **Bộ test tự động và mọi hoạt động kiểm thử của đội agent tuyệt đối không đăng bài công khai lên trang thật** — đăng thật chỉ xảy ra qua luồng chủ tiệm duyệt trên giao diện. Không ghi log hay hard-code bí mật. Hệ thống không sập khi Drive/AI/nền tảng lỗi hoặc hết quota.

### R7. Không hồi quy và an toàn dữ liệu
Dữ liệu hiện có trong `db/custom.db` giữ nguyên (sao lưu trước khi đổi schema, thay đổi schema tương thích dữ liệu cũ, dọn sạch dữ liệu test). Toàn bộ tính năng và bộ test hiện có tiếp tục chạy đúng. Cập nhật `docs/FEATURE_EXPERIENCE_MATRIX.md`, `docs/RELEASE_CHECKLIST.md`, `MATRIX_HANDOFF.md`.

## Acceptance Criteria

### Cổng chất lượng
- [ ] `npm run verify` pass 0 lỗi/0 cảnh báo; `npm run build` thành công; `scripts/verify-e2e-suite.ts` cũ vẫn pass toàn bộ.
- [ ] Module mới có bộ test tự động riêng (đường chuẩn + đối kháng cho từng R1–R6), chạy được bằng một lệnh và nằm trong `npm run verify`.

### Chương trình (R1)
- [ ] Trạng thái sắp chạy / đang chạy / đã kết thúc đúng tại các mốc biên (trước bắt đầu 1 phút, đúng giờ bắt đầu, sau kết thúc); chặn ngày kết thúc trước ngày bắt đầu.

### Google Drive (R2)
- [ ] Với thư mục Drive công khai dùng để kiểm thử: số lượng tệp và thư mục con hệ thống liệt kê khớp với danh sách lấy độc lập từ Drive; đọc được nội dung text của ít nhất một Google Doc và một Google Sheet.
- [ ] Link không công khai / không tồn tại / sai định dạng → báo lỗi rõ ràng, không làm hỏng dữ liệu đã đồng bộ.

### AI viết bài (R3)
- [ ] Mọi bài nháp cho một chương trình: giá, % giảm, mã voucher, ngày hiệu lực xuất hiện trong bài khớp chính xác dữ liệu CRM (kiểm tra tự động bằng đối chiếu, không do AI tự chấm).
- [ ] Bài cho từng nền tảng không vượt giới hạn ký tự/định dạng của nền tảng đó; bài TikTok/Instagram/Threads cần media luôn có media đi kèm.
- [ ] Một agent độc lập chấm 10 bài mẫu theo rubric (đúng sự thật, đúng giọng thương hiệu, tiếng Việt tự nhiên không lỗi chính tả, có lời kêu gọi hành động) — tối thiểu 8/10 đạt.

### Duyệt & lịch đăng (R4)
- [ ] Bài chưa duyệt / bị từ chối / thuộc chương trình đã kết thúc không bao giờ được gửi tới adapter đăng (kiểm tra bằng test).
- [ ] Bài đã duyệt được đăng đúng giờ (sai lệch ≤ 1 phút trong test có giả lập thời gian); chạy tác vụ đăng 2 lần không đăng trùng.
- [ ] Đăng lỗi → trạng thái lỗi kèm lý do, thử lại được.

### Nền tảng (R5, R6)
- [ ] Mỗi nền tảng trong 7 nền tảng có test chế độ giả lập xác nhận payload gửi đi đúng định dạng API của nền tảng đó.
- [ ] Bài đăng lên website nội bộ hiển thị được ở trang công khai (kiểm tra qua HTTP).
- [ ] Bằng chứng (log mạng hoặc cơ chế chặn trong test) cho thấy bộ test không gửi request đăng bài tới endpoint thật của Facebook/Zalo/Instagram/TikTok/Threads/website ngoài.
- [ ] Quét mã nguồn không có bí mật hard-code.

### Giao diện (kiểm định độc lập)
- [ ] Agent độc lập (không phải agent viết code) thực hiện trên trình duyệt luồng: tạo chương trình → đồng bộ Drive → AI lên lịch & viết bài → sửa → duyệt → bài được đăng (giả lập) đúng giờ; desktop và mobile 390px, 0 lỗi console, không tràn ngang; lưu ảnh chụp.

### Dữ liệu (R7)
- [ ] Có bản sao lưu DB trước thay đổi schema; số bản ghi các bảng cốt lõi cũ không đổi so với trước đợt làm việc (trừ dữ liệu demo có chủ đích được ghi rõ).
- [ ] Tài liệu đã cập nhật.


## 2026-10-26T13:40:49Z

Lưu ý từ caller: Sentinel của đợt trước (b36dc7b8) vừa báo đã dừng toàn bộ background tasks và dev servers của nó (port 3010/3013). Nếu đội AUTO SOCIAL đang dùng dev server/realtime bus do đợt trước khởi động, hãy kiểm tra và tự khởi động lại.


## 2026-10-26T14:32:56Z

Lưu ý từ caller về M3: báo cáo nói `scripts/verify-m3-ai.ts` của worker tự chấm "thang điểm rubric >= 8.0/10 trên 10 bài mẫu". Theo Acceptance Criteria, phần chấm rubric chất lượng bài (đúng sự thật, giọng Ưu Đàm, tiếng Việt tự nhiên không lỗi chính tả, có CTA) phải do MỘT AGENT ĐỘC LẬP (không phải worker, không phải LLM trong cùng pipeline sinh bài) thực hiện trên 10 bài thật do hệ thống sinh ra, với bảng chấm từng bài được lưu làm bằng chứng. Script của worker chỉ được dùng cho các kiểm tra tất định (đối soát số liệu CRM, giới hạn ký tự, media bắt buộc, cụm từ cấm). Ngoài ra đảm bảo 10 bài mẫu là output thật từ AI, không phải văn bản viết sẵn/hard-code.


## 2026-10-26T14:57:09Z

CALLER — YÊU CẦU MỞ LẠI GATE M3 (bằng chứng rubric không hợp lệ). Tôi đã kiểm tra trực tiếp:
1. Bài số 1 trong `.agents/teamwork/reviewer_rubric_m3/rubric_evidence.md` trùng NGUYÊN VĂN template thuật toán ở `src/lib/social-ai.ts` dòng 629 ("Có những buổi chiều... chỉ cần một đốm sáng nhỏ và hương thơm mộc mạc của ${prodName}..."). Tức là bài KHÔNG do LLM viết — `generatePlatformDraft` gọi `llmChat(..., 6000)` với timeout 6 giây, lỗi/timeout thì im lặng rơi về template (catch rỗng dòng 939). "10 bài AI thật" thực chất là output template.
2. Template gây sai sự thật: "Hộp quà tặng trà sơn thủy" được mô tả là "một đốm sáng nhỏ và hương thơm" (hộp trà không phát sáng); câu "từng giọt tinh dầu hay sáp nến đậu nành" áp cho mọi sản phẩm kể cả gốm/tranh. Reviewer vẫn chấm 10/10 tiêu chí "đúng sự thật" → chấm quá dễ dãi.
Yêu cầu:
(a) Mỗi bài nháp phải lưu rõ nguồn sinh (LLM hay template fallback) và hiển thị cho chủ tiệm; không fallback im lặng.
(b) Timeout LLM đủ thực tế cho việc viết bài (không phải 6s); lỗi LLM phải được log/hiển thị.
(c) Template fallback (nếu giữ) phải theo loại sản phẩm, không gán thuộc tính sai (ánh sáng/hương cho sản phẩm không có).
(d) Chấm lại rubric bởi một agent độc lập MỚI trên 10 bài mà nguồn sinh xác nhận là LLM thật (đính kèm bằng chứng: model, thời gian gọi, raw response), chấm nghiêm tiêu chí đúng sự thật theo thuộc tính thật của sản phẩm trong DB. Nếu môi trường không gọi được LLM, báo cáo trung thực điều đó cho caller thay vì dùng template thay thế.
(e) Kiểm tra lại các campaign demo đã tạo trong DB (4 chiến dịch) — phải được ghi rõ là dữ liệu demo có chủ đích hoặc dọn sạch theo R7.


## 2026-10-27T03:30:03Z

Server vừa restart lúc 10:28 sáng, toàn bộ subagent và background tasks đã bị dừng. Khôi phục ngay tiến trình:
1. Trạng thái trước khi dừng: M1–M5 đã GATE PASS. `worker_m6` đã hoàn thành `scripts/verify-auto-social.ts` (113/113 assertions) và nộp `.agents/teamwork/worker_m6/handoff.md`. Lúc 01:16 sáng, `orchestrator_2` (`3f0d510d-9880-49f5-b710-8d6bfe356311`) đang chạy 5 agent thẩm định M6 (`reviewer_1_m6`, `reviewer_2_m6`, `challenger_1_m6`, `challenger_2_m6`, `auditor_m6`) thì bị ngắt.
2. Lưu ý quan trọng:
   - Do `reviewer_1_m6` và `challenger_2_m6` đang chạy `verify-auto-social.ts` dở dang khi server tắt, hãy kiểm tra và dọn sạch dữ liệu test mồ côi trong `db/custom.db` (đảm bảo 24 bảng gốc Delta = 0 và các bảng mới sạch rác) trước khi chạy lại.
   - Thư mục `.agents/teamwork/auditor_m6/handoff.md` hiện đang chứa báo cáo cũ của đợt 1 (P2 features), KHÔNG phải của AUTO SOCIAL — hãy bảo `orchestrator_2` dùng tên thư mục riêng cho M6/M7 (ví dụ `*_m6_as`, `*_m7_as`) để không đè lên thư mục đợt 1.
   - Không cho phép nhiều agent chạy `verify-auto-social.ts` song song cùng lúc trên cùng file SQLite `db/custom.db` để tránh race condition khi teardown.
3. Khởi động lại các cron giám sát, đánh thức `orchestrator_2` hoàn tất thẩm định M6, triển khai M7 (UI AUTO SOCIAL + Campaign, kiểm định browser độc lập desktop & mobile 390px luồng đầy đủ, cập nhật tài liệu `FEATURE_EXPERIENCE_MATRIX.md`, `RELEASE_CHECKLIST.md`, `MATRIX_HANDOFF.md`), rồi chạy `teamwork_preview_victory_auditor`.
