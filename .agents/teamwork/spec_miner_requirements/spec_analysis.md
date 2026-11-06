# ĐẶC TẢ YÊU CẦU KỸ THUẬT PHÂN HỆ AUTO SOCIAL
## HỆ THỐNG OPENVN · ƯU ĐÀM SUITE (NEXT.JS 16 + PRISMA/SQLITE)
**Tài liệu**: `spec_analysis.md`  
**Phiên bản đặc tả**: 1.0.0 (Production Specification)  
**Ngày lập**: 2026-10-26  
**Tác giả**: Specification Miner Subagent (`spec_miner_requirements`)  
**Mục tiêu**: Khai phá, hệ thống hóa và chuẩn hóa 100% yêu cầu kỹ thuật, giao diện lập trình, ràng buộc an toàn, máy trạng thái và tiêu chí nghiệm thu cho phân hệ **AUTO SOCIAL** (R1 đến R7).

---

## MỤC LỤC
1. [Tổng Quan Kiến Trúc & Bối Cảnh Hệ Thống](#1-tổng-quan-kiến-trúc--bối-cảnh-hệ-thống)
2. [Chi Tiết Yêu Cầu R1: Phân Hệ Quản Lý Chương Trình (CRM Campaigns)](#2-chi-tiết-yêu-cầu-r1-phân-hệ-quản-lý-chương-trình-crm-campaigns)
3. [Chi Tiết Yêu Cầu R2: Nguồn Nội Dung Google Drive Công Khai](#3-chi-tiết-yêu-cầu-r2-nguồn-nội-dung-google-drive-công-khai)
4. [Chi Tiết Yêu Cầu R3: AI Lên Kế Hoạch & Viết Bài Đúng Giọng Ưu Đàm](#4-chi-tiết-yêu-cầu-r3-ai-lên-kế-hoạch--viết-bài-đúng-giọng-ưu-đàm)
5. [Chi Tiết Yêu Cầu R4: Lịch Nội Dung, Duyệt Bài & Động Cơ Tự Đăng](#5-chi-tiết-yêu-cầu-r4-lịch-nội-dung-duyệt-bài--động-cơ-tự-đăng)
6. [Chi Tiết Yêu Cầu R5: Phân Hệ Đăng Lên 7 Nền Tảng Đa Kênh](#6-chi-tiết-yêu-cầu-r5-phân-hệ-đăng-lên-7-nền-tảng-đa-kênh)
7. [Chi Tiết Yêu Cầu R6: An Toàn Vận Hành & Cô Lập Kiểm Thử Tuyệt Đối](#7-chi-tiết-yêu-cầu-r6-an-toàn-vận-hành--cô-lập-kiểm-thử-tuyệt-đối)
8. [Chi Tiết Yêu Cầu R7: An Toàn CSDL, Không Hồi Quy & Cổng Chất Lượng](#8-chi-tiết-yêu-cầu-r7-an-toàn-csdl-không-hồi-quy--cổng-chất-lượng)
9. [Đặc Tả Hợp Đồng Giao Diện Lập Trình (API Endpoints & Schemas)](#9-đặc-tả-hợp-đồng-giao-diện-lập-trình-api-endpoints--schemas)
10. [Mô Hình Dữ Liệu Mở Rộng Prisma ORM](#10-mô-hình-dữ-liệu-mở-rộng-prisma-orm)
11. [Bảng Kiểm Kê Tính Năng Toàn Diện (Feature Inventory Table)](#11-bảng-kiểm-kê-tính-năng-toàn-diện-feature-inventory-table)
12. [Ma Trận Tình Huống Biên & Kịch Bản Đối Kháng (Edge Cases & Adversarial Matrix)](#12-ma-trận-tình-huống-biên--kịch-bản-đối-kháng-edge-cases--adversarial-matrix)

---

## 1. Tổng Quan Kiến Trúc & Bối Cảnh Hệ Thống

### 1.1. Sứ mệnh của Phân Hệ AUTO SOCIAL
Phân hệ **AUTO SOCIAL** bổ sung vào hệ thống **OPENVN · Ưu Đàm Suite** khả năng tự động hóa chu trình tiếp thị nội dung đa kênh khép kín:
1. **Tiếp nhận chương trình kinh doanh từ CRM (R1)**: Quản lý chiến dịch khuyến mãi, sự kiện theo mùa, ưu đãi hội viên.
2. **Khai thác kho dữ liệu sáng tạo từ Google Drive công khai (R2)**: Đồng bộ hình ảnh sản phẩm thực tế, video clip, tài liệu mô tả (Docs), bảng biểu dữ liệu khuyến mãi (Sheets) mà không bắt buộc cấu hình OAuth phức tạp.
3. **Trợ lý AI Lập kế hoạch & Chắp bút nội dung (R3)**: Tự động phân bổ lịch đăng, tạo bản thảo bài viết cho từng nền tảng tuân thủ nghiêm ngặt **Giọng văn thương hiệu Ưu Đàm (100% Anti-AI, tĩnh tại, thiền vị, gần gũi như chủ tiệm)** và **bảo toàn 100% tính xác thực của số liệu khuyến mãi (giá, % giảm, voucher)**.
4. **Phê duyệt phân quyền chủ tiệm & Quản lý lịch phát hành (R4)**: Chủ tiệm toàn quyền xem xét, chỉnh sửa, chấp thuận (`APPROVED`) hoặc từ chối (`REJECTED`). **Bất biến**: Không bài viết nào được phép đăng nếu chưa có sự phê duyệt tường minh của chủ tiệm.
5. **Đăng đồng loạt lên 7 nền tảng đa kênh (R5)**: Fanpage Facebook, Zalo OA, Website Blog nội bộ (có trang công khai), Website ngoài (WordPress / Haravan / Sapo), Instagram, TikTok, Threads.
6. **Bảo vệ môi trường kiểm thử & Vận hành an toàn (R6)**: Kiểm thử tự động chạy trên Mock Adapter cục bộ, cô lập hoàn toàn không phát sinh cuộc gọi mạng thật ra ngoài; cơ chế thích ứng khi cạn hạn ngạch API (Fallback gracefully).
7. **Bảo tồn nguyên vẹn CSDL hiện hữu (R7)**: Không làm thay đổi số lượng bản ghi của 28 bảng cốt lõi trong `db/custom.db`, đáp ứng 100% các cổng chất lượng `npm run verify` và tương thích giao diện Desktop + Điện thoại 390px.

---

## 2. Chi Tiết Yêu Cầu R1: Phân Hệ Quản Lý Chương Trình (CRM Campaigns)

### 2.1. Nghiệp Vụ Cốt Lõi
Chương trình khuyến mãi/bán hàng (CRM Campaign) là hạt nhân kích hoạt toàn bộ luồng tạo nội dung của AUTO SOCIAL. Một chương trình phản ánh một hoạt động kinh doanh cụ thể tại cửa hàng Ưu Đàm (ví dụ: *Đại lễ Phật Đản*, *Mùa Vu Lan Báo Hiếu*, *Ưu Đãi Trà Đạo Đầu Xuân*, *Combo Nến Bơ Tri Ân*).

### 2.2. Trường Dữ Liệu & Quy Tắc Kiểm Tra Tính Hợp Lệ (Validation Rules)
1. `id`: Khóa chính định dạng CUID (`String`).
2. `code`: Mã chương trình định danh duy nhất (ví dụ: `CT-PHATDAN-2026`, `CT-VULAN-2026`). Regex chuẩn: `/^[A-Z0-9_-]{3,32}$/`.
3. `title`: Tên chương trình hiển thị (bắt buộc, không rỗng, tối đa 255 ký tự).
4. `description`: Mô tả chi tiết mục tiêu, thông điệp chính của chương trình.
5. `startDate`: Thời điểm bắt đầu có hiệu lực (ISO-8601 DateTime).
6. `endDate`: Thời điểm kết thúc (ISO-8601 DateTime).
   - **Ràng buộc bất biến**: `endDate > startDate`. Nếu `endDate <= startDate`, API phải từ chối ngay với mã lỗi `400 Bad Request` và thông báo `"Thời gian kết thúc phải diễn ra sau thời gian bắt đầu"`.
7. `status`: Trạng thái thực thi. Gồm 4 giá trị định danh:
   - `UPCOMING`: Sắp diễn ra (`now < startDate`).
   - `RUNNING`: Đang hoạt động (`startDate <= now <= endDate`).
   - `ENDED`: Đã kết thúc (`now > endDate`).
   - `CANCELLED`: Đã bị hủy thủ công bởi chủ tiệm (ưu tiên ghi đè mọi mốc thời gian).
8. `productIds`: Danh sách ID sản phẩm tham gia chương trình (chuỗi JSON mảng ID hoặc bảng liên kết n-n). Kiểm tra tính tồn tại của các `productId` trong bảng `Product`.
9. `voucherIds`: Danh sách ID mã giảm giá gắn kèm (chuỗi JSON mảng ID hoặc liên kết). Kiểm tra tính tồn tại của các `voucherId` trong bảng `Voucher`.
10. `driveFolderUrl`: Đường dẫn thư mục Google Drive công khai chứa tài nguyên riêng cho chiến dịch này (tùy chọn).

### 2.3. Máy Trạng Thái Tự Động Theo Thời Gian Thực (State Machine Engine)
Trạng thái của chiến dịch phải được tính toán động (computed property) hoặc cập nhật tự động tại các mốc biên:
- **Trước giờ bắt đầu 1 phút** (`now = startDate - 60s`): Trạng thái bắt buộc là `UPCOMING`.
- **Đúng thời điểm bắt đầu** (`now = startDate`): Trạng thái chuyển tức thì sang `RUNNING`.
- **Trong suốt giai đoạn hiệu lực** (`startDate < now < endDate`): Trạng thái là `RUNNING`.
- **Đúng thời điểm kết thúc** (`now = endDate`): Vẫn được xem là giai đoạn hoàn tất cuối cùng.
- **Sau thời điểm kết thúc 1 phút** (`now = endDate + 60s`): Trạng thái bắt buộc chuyển thành `ENDED`.
- **Chặn đăng bài viết khi hết hạn**: Bất kỳ bài viết nào liên kết với chương trình có trạng thái `ENDED` hoặc `CANCELLED` sẽ bị **chặn tuyệt đối** ở tầng phân phối (Publishing Engine Guard), ngay cả khi bài viết đó đã được duyệt trước đó.

---

## 3. Chi Tiết Yêu Cầu R2: Nguồn Nội Dung Google Drive Công Khai

### 3.1. Phân Tích & Chuẩn Hóa Đường Dẫn (URL Parsing & Normalization)
Chủ tiệm có thể dán bất kỳ định dạng link chia sẻ nào từ Google Drive:
- Định dạng thư mục chuẩn: `https://drive.google.com/drive/folders/{folderId}`
- Định dạng có tham số người dùng: `https://drive.google.com/drive/u/0/folders/{folderId}?usp=sharing`
- Định dạng legacy: `https://drive.google.com/open?id={folderId}`
- Định dạng mã thư mục trực tiếp: `{folderId}` (chuỗi ký tự chữ, số, gạch nối, gạch dưới dài từ 25 đến 45 ký tự).
- **Quy tắc trích xuất**:
  ```typescript
  export function extractDriveFolderId(inputUrl: string): string | null {
    const raw = inputUrl.trim()
    const folderMatch = raw.match(/\/folders\/([a-zA-Z0-9_-]{25,})/i)
    if (folderMatch) return folderMatch[1]
    const idMatch = raw.match(/[?&]id=([a-zA-Z0-9_-]{25,})/i)
    if (idMatch) return idMatch[1]
    if (/^[a-zA-Z0-9_-]{25,}$/.test(raw)) return raw
    return null
  }
  ```

### 3.2. Động Cơ Thu Thập Dữ Liệu Đa Tầng (Multi-Mode Enumerator)
Để hoạt động độc lập không phụ thuộc vào việc người dùng phải đăng ký tài khoản Google Cloud phức tạp:
1. **Tầng 1 (Google Drive API v3 nếu có Key)**: Sử dụng endpoint công khai của Google API khi có API Key:
   `GET https://www.googleapis.com/drive/v3/files?q='{folderId}'+in+parents+and+trashed=false&fields=files(id,name,mimeType,size,webViewLink,parents)&key={API_KEY}`
2. **Tầng 2 (Embedded Web View & HTML Crawler không cần Key)**:
   - Truy vấn trang `https://drive.google.com/embeddedfolderview?id={folderId}#list` hoặc `https://drive.google.com/drive/folders/{folderId}`.
   - Bóc tách cấu trúc HTML chứa danh sách tệp tin, thư mục con và mã định danh.
3. **Tầng 3 (Trích xuất nội dung văn bản & bảng tính)**:
   - **Google Docs** (`application/vnd.google-apps.document`): Đọc nội dung thô qua URL xuất bản công khai:
     `https://docs.google.com/document/d/{fileId}/export?format=txt`
   - **Google Sheets** (`application/vnd.google-apps.spreadsheet`): Bóc tách dữ liệu bảng biểu dạng CSV:
     `https://docs.google.com/spreadsheets/d/{fileId}/export?format=csv`
   - **Tệp hình ảnh & Video**: Trích xuất link ảnh gốc trực tiếp qua `https://lh3.googleusercontent.com/d/{fileId}` hoặc thumbnail `https://drive.google.com/thumbnail?id={fileId}&sz=w1200`.

### 3.3. Cơ Chế Bộ Nhớ Đệm & An Toàn Dữ Liệu Khi Đồng Bộ Lại (Non-destructive Re-sync)
- Kết quả quét được lưu trữ vào bảng `DriveSource` và `DriveItem` trong SQLite.
- Mỗi mục (`DriveItem`) lưu: `fileId`, `name`, `mimeType`, `type` (`IMAGE | VIDEO | DOC | SHEET | FOLDER | OTHER`), `size`, `folderPath`, `textContent`, `webViewLink`.
- **Bảo toàn liên kết thủ công**: Khi người dùng đã liên kết thủ công một `DriveItem` với `Product` hoặc `SocialCampaign`, việc bấm **Đồng bộ lại (Re-sync)** chỉ cập nhật thông tin tệp mới/đổi tên, **tuyệt đối không xóa bỏ các liên kết nghiệp vụ đã tạo trước đó**.
- **Xử lý lỗi**:
  - Link sai định dạng, thư mục riêng tư hoặc không tồn tại: Trả về thông báo lỗi rõ ràng trên UI và API (`400 / 404`), giữ nguyên trạng thái cache cũ mà không xóa dữ liệu đang có.

### 3.4. Thư Mục Google Drive Công Khai Kiểm Thử Thực Tế (Reference Test Drive)
Trong quá trình kiểm thử tự động và xác minh thực địa, hệ thống sử dụng thư mục Google Drive công khai tiêu chuẩn chứa đầy đủ 5 thành phần:
- URL Thư mục: `https://drive.google.com/drive/folders/1w5uH_sample_uudam_public_demo` (hoặc mock fixture tương đương đạt chuẩn).
- Thành phần kiểm chứng:
  1. Thư mục con: `Set Qua Tang Vu Lan`, `Hinh Anh Nen Bo Thuc Te`.
  2. Hình ảnh: `nen-bo-hoa-sen-01.jpg`, `tra-zen-men-lam-02.png`.
  3. Video: `quy-trinh-do-nen-thu-cong.mp4`.
  4. Google Doc: `Khai Niem Mui Huong Tram An Lac.docx` (đọc được nội dung văn bản tiếng Việt).
  5. Google Sheet: `Bang Gia Uu Dai Vu Lan 2026.xlsx` (đọc được các dòng dữ liệu giá & voucher).

---

## 4. Chi Tiết Yêu Cầu R3: AI Lên Kế Hoạch & Viết Bài Đúng Giọng Ưu Đàm

### 4.1. Quy Trình AI Lên Kế Hoạch Nội Dung (Planning Pipeline)
1. **Đầu vào (Context Aggregation)**:
   - Thông tin chương trình từ CRM (R1): Tên, mục tiêu, thời hạn bắt đầu/kết thúc.
   - Dữ liệu sản phẩm tham gia: Giá gốc (`sellPrice`), giá sau chiết khấu, số lượng tồn kho (`stock`), tên rút gọn thân thiện (`friendlyProductName`).
   - Mã Voucher đính kèm: Mã code (`UUDAM10`, `PHATDAN50K`), loại giảm (`PERCENT`, `FIXED`), mức giảm, điều kiện đơn tối thiểu.
   - Tài nguyên Drive (R2): Danh sách ảnh, video, ghi chú sản phẩm trích xuất từ Doc/Sheet.
2. **Đề xuất Lịch Đăng (Cadence Proposal)**:
   - AI tính toán các khung giờ vàng trong thời gian chiến dịch chạy (ví dụ: 08:30 sáng, 12:15 trưa, 20:00 tối).
   - Đề xuất chủ đề xuyên suốt (Story Arc):
     - *Giai đoạn 1 (Teaser / Khởi động)*: Câu chuyện tĩnh tại, nguồn gốc nguyên liệu nến bơ tự nhiên.
     - *Giai đoạn 2 (Bùng nổ / Giới thiệu ưu đãi)*: Công bố mã voucher, bộ quà tặng giới hạn.
     - *Giai đoạn 3 (Lan tỏa / Trải nghiệm khách)*: Review thực tế, góc thiền trà tại nhà.
     - *Giai đoạn 4 (Đếm ngược / Chốt đơn)*: Nhắc nhở hạn chót của voucher.

### 4.2. Ràng Buộc & Giới Hạn Định Dạng Của 7 Nền Tảng
| Nền tảng | Giới hạn Ký tự | Yêu cầu Phương tiện (Media) | Quy chuẩn Định dạng Đặc thù |
| :--- | :--- | :--- | :--- |
| **Facebook Fanpage** | Tối đa 63.206 ký tự (chuẩn tối ưu: 150 – 400 từ) | Tùy chọn (khuyến nghị 1–4 ảnh) | Hỗ trợ xuống dòng thoáng, hashtag cuối bài, liên kết đặt tự nhiên. |
| **Zalo OA** | Bài viết / ZNS: Tối đa 2.000 ký tự | Tùy chọn ảnh bìa (Cover 16:9) | Giọng ngắn gọn, thân mật, nút bấm CTA hành động rõ ràng. |
| **Website Blog** | Không giới hạn (chuẩn: 500 – 1.500 từ) | Bắt buộc 1 ảnh đại diện (Featured Image) | Định dạng Markdown / HTML, Tiêu đề SEO, Slug URL, Excerpt tóm tắt. |
| **Website Ngoài** | Theo chuẩn CMS WordPress / Haravan / Sapo | Ảnh đại diện theo bài | Tiêu đề, Nội dung HTML chuẩn thẻ `<h2>`, `<p>`, `<ul>`, tóm tắt tóm lược. |
| **Instagram** | Tối đa 2.200 ký tự | **BẮT BUỘC CÓ ẢNH HOẶC VIDEO** | Tối đa 30 hashtags, dòng đầu tiên là câu Hook hấp dẫn, không hỗ trợ hyperlink trong caption. |
| **TikTok** | Tối đa 2.200 ký tự (chuẩn tối ưu: 100 – 300 ký tự) | **BẮT BUỘC CÓ VIDEO CLIP** | Câu mở đầu giật hook 3 giây đầu, hashtag xu hướng, kêu gọi bình luận/ghé bio. |
| **Threads** | **Tối đa 500 ký tự** | Tùy chọn | Ngắn gọn, súc tích, văn phong chia sẻ góc nhìn hoặc đàm đạo nhẹ nhàng. |

### 4.3. Bộ Quy Tắc Giọng Văn Thương Hiệu Ưu Đàm (100% Anti-AI Voice)
Tất cả nội dung do AI tạo ra hoặc lọc qua hệ thống phải tuân thủ nghiêm ngặt chuẩn mực kế thừa từ `src/lib/agent-voice.ts`:
1. **Xưng hô**: Luôn tự xưng là `"tụi em"`, `"em"` hoặc gọi tên thương hiệu `"Ưu Đàm"`.
2. **CẤM TUYỆT ĐỐI các cụm từ sáo rỗng (Banned Phrases)**:
   - ❌ `"kính chào"`, `"quý khách"`, `"hân hạnh phục vụ"`, `"quý khách hàng"`.
   - ❌ `"nguồn động lực to lớn/quý báu"`, `"vô cùng quý giá"`, `"nâng cao chất lượng dịch vụ"`.
   - ❌ `"chúc một ngày tốt lành"`, `"thân ái"`, `"trân trọng"`.
   - ❌ `"shop OmniSales"`, `"hệ thống chúng tôi"`.
3. **Phong thái văn học**: Mộc mạc, tĩnh lặng, ấm cúng, đậm chất thiền trà và thảo mộc. Thả cảm xúc tự nhiên, câu văn vừa vặn, dùng từ ngữ đời thường thân thuộc (`"dạ"`, `"nha"`, `"nhé"`, `"đó ạ"`).
4. **Emoji**: Tối đa 1–2 emoji phù hợp tinh thần bình an (`🌿`, `🕯️`, `🍵`, `🙏`, `✨`), cấm lạm dụng icon nhấp nháy lòe loẹt.
5. **Lời kêu gọi hành động (CTA)**: Nhẹ nhàng, không chèo kéo gượng ép (Ví dụ: *"Mình nhắn tụi em giữ riêng cho mình một hũ nha"*, *"Nếu rảnh, ghé tiệm ngửi thử mùi khói trà mới về nhé"*).

### 4.4. Động Cơ Khớp Số Liệu CRM Tuyệt Đối (Anti-Hallucination Guard)
Để ngăn chặn hoàn toàn hiện tượng AI tự bịa ra giá bán hoặc voucher sai lệch:
- **Kiểm tra tự động bằng đối chiếu ký tự (Deterministic Invariant Check)**:
  - Giá sản phẩm trong bài viết: Phải khớp chính xác với `Product.sellPrice` hoặc giá khuyến mãi được truyền vào.
  - Tỷ lệ giảm giá (`%`): Phải khớp chính xác với `Voucher.discountValue`.
  - Mã Voucher: Phải xuất hiện chính xác nguyên văn mã định danh (ví dụ: `UUDAM10`, `PHATDAN50K`).
  - Thời hạn: Ngày bắt đầu và ngày kết thúc phải trùng khớp với `SocialCampaign.startDate` và `endDate`.
- **Chốt chặn tự động**: Nếu phát hiện số liệu khuyến mãi bị lệch so với CRM, bài viết sẽ bị hệ thống tự động từ chối xuất bản và gắn cờ cảnh báo lỗi kiểm định số liệu.

### 4.5. Khung Đánh Giá Rubric 10 Bài Mẫu (8/10+ Passing Threshold)
Một bộ kiểm định độc lập sẽ chấm điểm 10 bài viết ngẫu nhiên theo 4 tiêu chí cốt lõi:
1. **Tính chân thực & Khớp dữ liệu CRM** (Trọng số 30%): Khớp 100% giá, voucher, ngày giờ, tên sản phẩm.
2. **Đúng giọng thương hiệu Ưu Đàm** (Trọng số 30%): Không từ cấm, tự xưng tụi em/Ưu Đàm, tinh thần an yên.
3. **Ngôn ngữ tự nhiên & Chuẩn chính tả** (Trọng số 20%): Tiếng Việt trong sáng, không lỗi hành văn, không ngữ pháp dịch máy.
4. **Lời kêu gọi hành động phù hợp nền tảng** (Trọng số 20%): Đúng quy cách nền tảng, có CTA duyên dáng.
- **Tiêu chuẩn đạt**: Tối thiểu 8 trên 10 bài đạt điểm tuyệt đối ở cả 4 tiêu chí (tổng điểm quy đổi $\ge 8.0/10$).

---

## 5. Chi Tiết Yêu Cầu R4: Lịch Nội Dung, Duyệt Bài & Động Cơ Tự Đăng

### 5.1. Vòng Đời Trạng Thái Bài Viết (Post State Machine)
Mỗi bài viết (`SocialPost`) trải qua các trạng thái tuần tự:
```
[DRAFT] ──(Tạo/Lên lịch)──> [PENDING_APPROVAL] ──(Chủ tiệm bấm Duyệt)──> [APPROVED]
   │                               │                                         │
   │ (Xóa)                         │ (Từ chối)                               │ (Đến giờ hẹn & Cron chạy)
   ▼                               ▼                                         ▼
[DELETED]                      [REJECTED]                                [PUBLISHED]
                                   │                                         │
                                   └──(Sửa lại)──> [DRAFT]                   └──(Lỗi mạng/API)──> [FAILED]
                                                                                                     │
                                                                                                     └──(Bấm Thử lại)──> [APPROVED]
```

### 5.2. Ba Chốt Chặn Bất Biến Khi Xuất Bản (Three Iron Publishing Gates)
1. **Chốt Chặn 1: Phê Duyệt Của Chủ Tiệm (Owner Approval Guard)**:
   - **BẤT BIẾN TỐI CAO**: Chỉ những bài viết mang trạng thái `APPROVED` (hoặc cờ `isApproved = true`) mới được phép gửi payload tới các adapter xuất bản.
   - Các bài ở trạng thái `DRAFT`, `PENDING_APPROVAL`, `REJECTED`, `FAILED` bị cấm tuyệt đối không được kích hoạt đăng bài.
2. **Chốt Chặn 2: Tình Trạng Chiến Dịch CRM (Campaign Validity Guard)**:
   - Trước khi gửi bài, kiểm tra trạng thái của chiến dịch liên kết (`SocialCampaign`).
   - Nếu chiến dịch đang ở trạng thái `ENDED` (đã kết thúc) hoặc `CANCELLED` (bị hủy), hệ thống lập tức chặn đăng bài, chuyển trạng thái bài viết sang `REJECTED` kèm lý do `"Chiến dịch đã kết thúc hoặc bị hủy bỏ"`.
3. **Chốt Chặn 3: Mốc Thời Gian Hẹn Giờ (Scheduled Time Guard)**:
   - Bài viết chỉ được đưa vào hàng đợi đăng khi `scheduledAt <= now`. Nếu thời gian hẹn chưa tới, bài viết tiếp tục lưu giữ ở trạng thái `APPROVED` chờ lượt quét kế tiếp.

### 5.3. Động Cơ Lên Lịch & Tính Lũy Đẳng (Idempotency Engine)
- Tác vụ tự động quét bài đăng chạy qua endpoint nội bộ `POST /api/social/publish-job` (kết nối với cron hệ thống hoặc lệnh quét định kỳ).
- **Độ sai lệch thời gian**: Đảm bảo bài viết được xuất bản trong vòng $\le 1$ phút so với giờ hẹn trong các bài test mô phỏng thời gian.
- **Tính lũy đẳng (Chống đăng trùng 100%)**:
  - Khi tác vụ đăng bài được kích hoạt nhiều lần đồng thời hoặc liên tiếp:
    Sử dụng kỹ thuật khóa dòng nguyên tử trong Prisma transaction:
    ```typescript
    // Khóa trạng thái bài viết ngay khi bắt đầu xử lý
    const post = await db.socialPost.updateMany({
      where: {
        id: targetPostId,
        status: 'APPROVED',
        isApproved: true,
        isPublishing: false,
      },
      data: { isPublishing: true }
    })
    ```
  - Nếu `post.count === 0`, tác vụ thứ hai sẽ tự động bỏ qua, bảo đảm không bao giờ có hiện tượng đăng 2 lần một bài viết lên mạng xã hội.

### 5.4. Xử Lý Lỗi & Cơ Chế Thử Lại (Retry Policy)
- Khi gặp sự cố mạng, API đối tác phản hồi lỗi hoặc hết hạn token:
  - Cập nhật trạng thái bài viết thành `FAILED`.
  - Ghi nhận chi tiết thông điệp lỗi vào cột `errorMessage`.
  - Tăng biến đếm `retryCount = retryCount + 1` và ghi nhận `lastRetriedAt`.
- Trên giao diện: Hiển thị badge màu đỏ/cam báo lỗi kèm nguyên nhân chi tiết. Cung cấp nút **"Thử lại" (Retry)** để chủ tiệm tái kích hoạt trạng thái `APPROVED` ngay lập tức.

---

## 6. Chi Tiết Yêu Cầu R5: Phân Hệ Đăng Lên 7 Nền Tảng Đa Kênh

### 6.1. Cấu Trúc Đa Nền Tảng (Unified Publisher Adapter Interface)
Mỗi nền tảng được định nghĩa bởi một adapter chuẩn hóa:
```typescript
export interface PublishResult {
  success: boolean
  platform: string
  externalId?: string
  externalUrl?: string
  errorMessage?: string
  payloadSent: Record<string, unknown>
  simulated: boolean
}

export interface IPublisherAdapter {
  platform: string
  publish(post: SocialPostRecord, options?: { forceSimulated?: boolean }): Promise<PublishResult>
}
```

### 6.2. Đặc Tả 7 Nền Tảng Xuất Bản

#### Nền tảng 1: Fanpage Facebook (`FACEBOOK`)
- **Credential Provider**: `FACEBOOK` trong `IntegrationCredential`.
- **Tham số cấu hình**: `pageId`, `pageAccessToken`, `appSecret`.
- **Cơ chế hoạt động**:
  - *Chế độ thật*: Gọi Graph API `POST https://graph.facebook.com/v19.0/{pageId}/feed` (bài viết văn bản/link) hoặc `POST /{pageId}/photos` (bài viết kèm ảnh).
  - *Chế độ giả lập (Mock)*: Kiểm tra hợp lệ cấu trúc bài viết, trả về `externalId: "fb_post_mock_" + uuid` và link giả lập `https://facebook.com/{pageId}/posts/{id}`.

#### Nền tảng 2: Zalo Official Account (`ZALO_OA`)
- **Credential Provider**: `ZALO_OA` trong `IntegrationCredential`.
- **Tham số cấu hình**: `oaId`, `oaSecret`, `znsToken` / `accessToken`.
- **Cơ chế hoạt động**:
  - *Chế độ thật*: Đăng bài viết Article qua Zalo OpenAPI `POST https://openapi.zalo.me/v2.0/article/create`.
  - *Chế độ giả lập (Mock)*: Kiểm tra độ dài văn bản ($\le 2.000$ ký tự), ảnh bìa, trả về `externalId: "zalo_art_mock_" + uuid`.

#### Nền tảng 3: Website Blog Nội Bộ (`WEBSITE_INTERNAL`)
- **Cấu hình**: Tích hợp sẵn trong hệ thống Next.js này (không cần credential ngoài).
- **Cơ chế hoạt động**:
  - Khi bài viết được duyệt và xuất bản: Lưu vào bảng `SocialPost` (hoặc `BlogPost`) với trạng thái `PUBLISHED` và `slug` chuẩn hóa SEO (ví dụ: `bi-quyet-giu-am-goc-thien-tra-ngay-mua`).
  - **Trang công khai (Public Pages)**:
    - Danh sách tin tức / blog: `GET /blog` (hoặc `GET /store/blog`).
    - Chi tiết bài viết: `GET /blog/[slug]`.
    - **Yêu cầu nghiệm thu**: Trang công khai có thể truy cập được qua HTTP GET thông thường mà không cần đăng nhập, hiển thị tiêu đề, ngày đăng, tác giả ("Ưu Đàm"), ảnh đại diện và định dạng nội dung HTML/Markdown hoàn chỉnh.

#### Nền tảng 4: Website Bên Ngoài (`WEBSITE_EXTERNAL`)
- **Đối tác hỗ trợ**: WordPress, Haravan, Sapo.
- **Tham số cấu hình**: `platformType` (`WORDPRESS` | `HARAVAN` | `SAPO`), `apiUrl`, `apiKey` / `accessToken`, `blogId`.
- **Cơ chế hoạt động**:
  - *WordPress*: `POST {apiUrl}/wp-json/wp/v2/posts` với payload `{ title, content, excerpt, status: 'publish' }`.
  - *Haravan*: `POST {apiUrl}/admin/blogs/{blogId}/articles.json` với payload `{ article: { title, body_html, summary_html, author: 'Ưu Đàm' } }`.
  - *Sapo*: `POST {apiUrl}/admin/blogs/{blogId}/articles.json` tương tự.
  - *Chế độ giả lập (Mock)*: Kiểm tra đúng cấu trúc JSON theo từng loại website ngoài, trả về mã định danh bài viết mô phỏng.

#### Nền tảng 5: Instagram Graph API (`INSTAGRAM`)
- **Credential Provider**: `INSTAGRAM` trong `IntegrationCredential`.
- **Tham số cấu hình**: `instagramAccountId`, `accessToken`.
- **Ràng buộc nghiêm ngặt**: **BẮT BUỘC PHẢI CÓ MEDIA (Ảnh hoặc Video)**. Nếu bài viết không chứa link hình ảnh/video, adapter phải từ chối ngay với lỗi `"Instagram bắt buộc phải có ít nhất 1 hình ảnh hoặc video"`.
- **Cơ chế hoạt động**:
  - *Chế độ thật*: Tạo Media Container qua `POST /{ig-user-id}/media`, sau đó gọi `POST /{ig-user-id}/media_publish`.
  - *Chế độ giả lập*: Xác thực caption $\le 2.200$ ký tự, có media hợp lệ, trả về `externalId: "ig_media_mock_" + uuid`.

#### Nền tảng 6: TikTok Content Posting API (`TIKTOK`)
- **Credential Provider**: `TIKTOK` trong `IntegrationCredential`.
- **Tham số cấu hình**: `clientKey`, `clientSecret`, `accessToken`.
- **Ràng buộc nghiêm ngặt**: **BẮT BUỘC PHẢI CÓ VIDEO MEDIA**. Nếu không có video, từ chối với lỗi `"TikTok bắt buộc phải có video đính kèm"`.
- **Cơ chế hoạt động**:
  - *Chế độ thật*: Khởi tạo phiên đăng video `POST https://open.tiktokapis.com/v2/post/publish/video/init/`.
  - *Chế độ giả lập*: Xác thực độ dài caption, định dạng tệp video, trả về `externalId: "tiktok_publish_mock_" + uuid`.

#### Nền tảng 7: Threads API (`THREADS`)
- **Credential Provider**: `THREADS` trong `IntegrationCredential`.
- **Tham số cấu hình**: `threadsUserId`, `accessToken`.
- **Ràng buộc nghiêm ngặt**: **Độ dài văn bản TỐI ĐA 500 KÝ TỰ**. Nếu vượt quá 500 ký tự, adapter phải từ chối với thông báo lỗi rõ ràng.
- **Cơ chế hoạt động**:
  - *Chế độ thật*: Tạo Threads media container qua `POST /{threads-user-id}/threads`, xuất bản qua `POST /{threads-user-id}/threads_publish`.
  - *Chế độ giả lập*: Kiểm tra giới hạn 500 ký tự, trả về `externalId: "threads_post_mock_" + uuid`.

---

## 7. Chi Tiết Yêu Cầu R6: An Toàn Vận Hành & Cô Lập Kiểm Thử Tuyệt Đối

### 7.1. Nguyên Tắc Cô Lập An Toàn Tuyệt Đối (Safe Mock Isolation Principle)
- **Cho phép**: Trong môi trường phát triển (Development Mode), hệ thống được phép kết nối thực tế tới Google Drive công khai (để bóc tách thư mục) và gọi LLM Gemini (để sinh nội dung).
- **CẤM TUYỆT ĐỐI**: Toàn bộ các bộ kiểm thử tự động (`test:*`, `scripts/verify-*`, agent validation) **tuyệt đối không bao giờ gửi bất kỳ HTTP request thật nào tới các endpoint của Facebook, Zalo OA, Instagram, TikTok, Threads, hoặc Website bên ngoài**.
- **Cơ chế khóa cứng (Hardcoded Safety Switch)**:
  ```typescript
  export function isSafeMockMode(): boolean {
    if (process.env.NODE_ENV === 'test') return true
    if (process.env.AUTO_SOCIAL_FORCE_MOCK === 'true') return true
    return false
  }
  ```
- **Bằng chứng kiểm chứng**: Bộ test tự động phải có cơ chế xác nhận (Mock Interceptor Assertion) chứng minh 0 request lọt ra internet tới các domain mạng xã hội thật.

### 7.2. Phòng Chống Rò Rỉ Bí Mật (No Secrets Leaks)
- Không lưu trữ mật khẩu, App Secret, Access Token dưới dạng văn bản thuần (plain text) trong log hoặc git tracking.
- Kiểm tra linter mã nguồn không chứa bất kỳ secret/API key nào bị hard-code.

### 7.3. Khả Năng Chống Chịu Lỗi & Phục Hồi (Graceful Degradation & Quota 429)
1. **Sự cố Google Drive**: Khi Google Drive lỗi mạng, link thư mục bị xóa hoặc không thể truy cập $\rightarrow$ Hệ thống không bị treo hoặc sập (crash); trả về thông báo lỗi thân thiện trên giao diện và giữ nguyên dữ liệu bộ nhớ đệm trước đó.
2. **Sự cố AI Hết Quota (HTTP 429 / Timeout)**:
   - Khi Gemini trả về lỗi 429 Too Many Requests hoặc quá thời gian timeout (20s):
   - Động cơ AI tự động kích hoạt **Bộ mẫu bài viết dự phòng (Pre-authored Templates)** kế thừa từ `agent-voice.ts`.
   - Bài viết dự phòng vẫn bảo đảm đầy đủ dữ liệu khuyến mãi chính xác từ CRM và đúng giọng chủ tiệm Ưu Đàm, không làm gián đoạn trải nghiệm của người dùng.
3. **Sự cố Một Nền Tảng Trong 7 Nền Tảng Bị Lỗi**:
   - Khi đăng đồng loạt lên nhiều nền tảng, việc 1 nền tảng gặp lỗi (ví dụ token Instagram hết hạn) không được làm hủy bỏ việc đăng bài lên các nền tảng khác đang hoạt động tốt (Facebook, Website, Zalo).

---

## 8. Chi Tiết Yêu Cầu R7: An Toàn CSDL, Không Hồi Quy & Cổng Chất Lượng

### 8.1. Bảo Tồn Tuyệt Đối Cơ Sở Dữ Liệu Sản Xuất Hiện Hữu
- File CSDL SQLite sản xuất hiện hành đặt tại `db/custom.db`.
- **Quy trình sao lưu bắt buộc**:
  - Trước bất kỳ thao tác thay đổi schema nào (`prisma db push`), phải tạo bản sao lưu an toàn `db/custom.db.bak` (hoặc kiểm tra tính nguyên vẹn của bản sao lưu đã có).
- **Đối soát số lượng bản ghi 28 bảng cốt lõi (Baseline Table Parity)**:
  - Danh sách 28 bảng cốt lõi hiện có trong `db/baseline-counts.json` (Product, Order, Customer, SalesInvoice, StockMovement, Voucher, ...) phải giữ nguyên số lượng bản ghi 100% trước và sau khi hoàn tất phân hệ AUTO SOCIAL (ngoại trừ các dữ liệu demo được chỉ định rõ trong báo cáo).
- **Dọn dẹp kiểm thử (Teardown Discipline)**:
  - Mọi kịch bản kiểm thử tạo dữ liệu chiến dịch hoặc bài viết thử nghiệm phải tự động dọn dẹp sạch sẽ sau khi test xong, không để lại rác dữ liệu trong CSDL sản xuất.

### 8.2. Hệ Thống Cổng Kiểm Soát Chất Lượng (Quality Gates)
Toàn bộ dự án phải vượt qua 5 tầng kiểm tra liên hoàn:
1. `npx tsc --noEmit`: Đạt 0 lỗi kiểu dữ liệu TypeScript (`0 errors`, exit code `0`).
2. `npm run lint`: Đạt 0 lỗi, 0 cảnh báo ESLint (`0 warnings / 0 errors`, exit code `0`).
3. `npm run test:chain`: Kiểm tra tính đơn điệu của Sổ Cái Tồn Kho (`StockMovement`) đạt 100% PASS.
4. `npm run test:scenarios`: Chạy 21 kịch bản nghiệp vụ thực tế đạt 21/21 PASS.
5. `node --experimental-strip-types scripts/verify-e2e-suite.ts`: Bộ Master E2E Suite cũ vượt qua 7/7 suites.
6. **Bộ test mới cho AUTO SOCIAL**: Tập tin `scripts/verify-auto-social.ts` kiểm thử toàn diện cả đường chuẩn (Happy Path) và đường đối kháng (Adversarial Path) cho đầy đủ R1 đến R6, được tích hợp vào `npm run verify`.
7. `npm run build`: Đóng gói Turbopack Next.js 16 thành công với mã thoát `0`.

### 8.3. Kiểm Định Giao Diện Độc Lập (Independent Browser Validation)
- Một agent độc lập sẽ điều khiển trình duyệt truy cập và kiểm thử luồng nghiệp vụ hoàn chỉnh:
  **Tạo Chương trình CRM $\rightarrow$ Liên kết Google Drive $\rightarrow$ AI lên lịch & viết bài $\rightarrow$ Xem & sửa bài $\rightarrow$ Chủ tiệm bấm Duyệt $\rightarrow$ Bài đăng tự động đúng giờ (giả lập)**.
- Kiểm định hiển thị chuẩn trên 2 độ phân giải:
  - **Màn hình Desktop** ($1440 \times 900$).
  - **Màn hình Điện thoại Di động 390px** (iPhone 14 / Mobile standard viewport).
- Đảm bảo: 0 lỗi console, không bị tràn thanh cuộn ngang (no horizontal overflow), giao diện tiếng Việt chỉn chu theo phong cách OPENVN Design System.

---

## 9. Đặc Tả Hợp Đồng Giao Diện Lập Trình (API Endpoints & Schemas)

### 9.1. Danh Sách Endpoints Của Phân Hệ AUTO SOCIAL

| STT | Phương thức | Đường dẫn API | Mục đích nghiệp vụ | Phân loại |
| :---: | :---: | :--- | :--- | :---: |
| 1 | `GET` | `/api/social/campaigns` | Danh sách chương trình CRM kèm trạng thái thời gian thực | R1 |
| 2 | `POST` | `/api/social/campaigns` | Tạo mới chương trình CRM (kiểm tra `endDate > startDate`) | R1 |
| 3 | `GET` | `/api/social/campaigns/[id]` | Chi tiết chương trình, sản phẩm & voucher liên kết | R1 |
| 4 | `PATCH` | `/api/social/campaigns/[id]` | Chỉnh sửa chương trình hoặc hủy bỏ (`CANCELLED`) | R1 |
| 5 | `DELETE` | `/api/social/campaigns/[id]` | Xóa chương trình (an toàn khóa ngoại) | R1 |
| 6 | `GET` | `/api/social/drive/sources` | Danh sách nguồn thư mục Drive đã cấu hình | R2 |
| 7 | `POST` | `/api/social/drive/sources` | Thêm mới nguồn Drive (phân tích URL, quét ban đầu) | R2 |
| 8 | `POST` | `/api/social/drive/sync` | Kích hoạt quét đồng bộ lại thư mục Drive | R2 |
| 9 | `GET` | `/api/social/drive/files` | Lọc danh sách tệp tin Drive (ảnh, video, doc, sheet) | R2 |
| 10 | `PATCH` | `/api/social/drive/files/[id]`| Liên kết tệp Drive với Sản phẩm hoặc Chiến dịch | R2 |
| 11 | `POST` | `/api/social/ai/plan` | AI đề xuất lịch đăng bài (ngày giờ, góc tiếp cận) | R3 |
| 12 | `POST` | `/api/social/ai/generate` | AI viết bài cho 7 nền tảng (giọng Ưu Đàm, khớp CRM) | R3 |
| 13 | `POST` | `/api/social/ai/evaluate` | Đánh giá bài viết theo khung Rubric 4 tiêu chí | R3 |
| 14 | `GET` | `/api/social/posts` | Danh sách bài viết lịch nội dung (lọc theo trạng thái/kênh)| R4 |
| 15 | `POST` | `/api/social/posts` | Tạo bài viết nháp thủ công | R4 |
| 16 | `GET` | `/api/social/posts/[id]` | Chi tiết bài viết | R4 |
| 17 | `PATCH` | `/api/social/posts/[id]` | Sửa bài, đổi giờ hoặc Duyệt/Từ chối (`approve`/`reject`)| R4 |
| 18 | `DELETE` | `/api/social/posts/[id]` | Xóa bài viết nháp/từ chối | R4 |
| 19 | `POST` | `/api/social/publish-job` | Tác vụ tự động đăng bài đúng giờ (Cron / Scheduler Engine)| R4, R5 |
| 20 | `POST` | `/api/social/posts/[id]/publish-now` | Đăng ngay lập tức một bài viết đã duyệt | R4, R5 |
| 21 | `GET` | `/api/blog` | API trang tin / blog công khai nội bộ | R5 |
| 22 | `GET` | `/api/blog/[slug]` | API chi tiết bài viết blog công khai nội bộ | R5 |

---

### 9.2. Cấu Trúc Request / Response Chi Tiết

#### API 1: `POST /api/social/campaigns`
- **Request Body**:
  ```json
  {
    "code": "CT-VULAN-2026",
    "title": "Mùa Vu Lan Báo Hiếu — Thắp Lửa An Lạc",
    "description": "Chiến dịch tri ân mùa Vu Lan với set nến bơ và trà thiền gốm",
    "startDate": "2026-08-15T00:00:00.000Z",
    "endDate": "2026-08-30T23:59:59.000Z",
    "productIds": ["UD-NEN-001", "UD-TRA-003"],
    "voucherIds": ["UUDAM10"],
    "driveFolderUrl": "https://drive.google.com/drive/folders/1w5uH_sample_uudam_public_demo"
  }
  ```
- **Validation**:
  - `title` bắt buộc, không được để trống.
  - `endDate` phải lớn hơn `startDate`, nếu không:
    ```json
    { "error": "Thời gian kết thúc phải diễn ra sau thời gian bắt đầu", "code": "INVALID_DATE_RANGE" }
    ```
    HTTP Status: `400 Bad Request`.
- **Response Success** (`201 Created`):
  ```json
  {
    "ok": true,
    "campaign": {
      "id": "cuid_camp_123",
      "code": "CT-VULAN-2026",
      "title": "Mùa Vu Lan Báo Hiếu — Thắp Lửa An Lạc",
      "status": "UPCOMING",
      "startDate": "2026-08-15T00:00:00.000Z",
      "endDate": "2026-08-30T23:59:59.000Z",
      "productsCount": 2,
      "vouchersCount": 1,
      "createdAt": "2026-10-26T13:10:00.000Z"
    }
  }
  ```

---

#### API 2: `POST /api/social/drive/sources`
- **Request Body**:
  ```json
  {
    "name": "Kho Hình Ảnh & Video Mẫu Ưu Đàm 2026",
    "folderUrl": "https://drive.google.com/drive/folders/1w5uH_sample_uudam_public_demo"
  }
  ```
- **Validation**:
  - Không bóc tách được folderId từ URL:
    ```json
    { "error": "Đường dẫn thư mục Google Drive không đúng định dạng", "code": "INVALID_DRIVE_URL" }
    ```
    HTTP Status: `400 Bad Request`.
  - Không thể truy cập thư mục:
    ```json
    { "error": "Không thể truy cập thư mục Google Drive. Vui lòng đảm bảo quyền 'Bất kỳ ai có đường liên kết đều có thể xem'.", "code": "DRIVE_INACCESSIBLE" }
    ```
    HTTP Status: `400 Bad Request`.
- **Response Success** (`201 Created`):
  ```json
  {
    "ok": true,
    "source": {
      "id": "cuid_drive_source_01",
      "name": "Kho Hình Ảnh & Video Mẫu Ưu Đàm 2026",
      "folderId": "1w5uH_sample_uudam_public_demo",
      "filesCount": 8,
      "foldersCount": 2,
      "lastSyncedAt": "2026-10-26T13:10:05.000Z"
    }
  }
  ```

---

#### API 3: `POST /api/social/ai/generate`
- **Request Body**:
  ```json
  {
    "campaignId": "cuid_camp_123",
    "platforms": ["FACEBOOK", "ZALO_OA", "WEBSITE_INTERNAL", "INSTAGRAM", "TIKTOK", "THREADS"],
    "topic": "Giới thiệu bộ quà nến bơ và trà Zen an yên",
    "selectedMediaIds": ["cuid_drive_item_img_01", "cuid_drive_item_vid_01"]
  }
  ```
- **Response Success** (`200 OK`):
  ```json
  {
    "ok": true,
    "drafts": [
      {
        "platform": "FACEBOOK",
        "title": "Mùa Vu Lan, thắp một ngọn nến thơm gửi an lành",
        "content": "Dạ tụi em gửi mình chút ấm áp ngày mưa...\n\nSet quà Vu Lan tụi em chuẩn bị gồm hũ nến bơ hoa sen (cháy thơm thanh nhẹ) cùng hũ trà Zen nắp gỗ mộc. Đơn này tiệm gửi tặng mã UUDAM10 giảm 10% trọn vẹn từ 15/08 đến 30/08 đó ạ 🌿\n\nMình ghé tiệm chọn mùi ưng ý hoặc nhắn tụi em giữ riêng cho mình một set nha!",
        "hashtags": ["#UuDam", "#NenBo", "#TraZen", "#VuLanAnLanh"],
        "mediaUrls": ["https://lh3.googleusercontent.com/d/sample_img_01"],
        "crmMatchAudit": { "price": "120.000đ", "voucher": "UUDAM10", "discountPct": "10%", "valid": true }
      },
      {
        "platform": "THREADS",
        "content": "Mùa Vu Lan này, tụi em chuẩn bị mấy set nến bơ hoa sen với trà Zen mộc mạc lắm. Nhập mã UUDAM10 giảm 10% đến hết 30/08 nha. Ai cần chút an yên thì nhắn tụi em giữ set nhé 🌿",
        "characterCount": 194,
        "mediaUrls": []
      }
    ]
  }
  ```

---

#### API 4: `PATCH /api/social/posts/[id]` (Duyệt / Từ Chối Bài Viết)
- **Request Body (Chủ tiệm duyệt bài)**:
  ```json
  {
    "action": "APPROVE",
    "scheduledAt": "2026-08-16T08:30:00.000Z"
  }
  ```
- **Response Success** (`200 OK`):
  ```json
  {
    "ok": true,
    "post": {
      "id": "cuid_post_999",
      "status": "APPROVED",
      "isApproved": true,
      "approvedAt": "2026-10-26T13:10:10.000Z",
      "approvedBy": "Chủ tiệm Ưu Đàm",
      "scheduledAt": "2026-08-16T08:30:00.000Z"
    }
  }
  ```
- **Request Body (Chủ tiệm từ chối bài)**:
  ```json
  {
    "action": "REJECT",
    "reason": "Văn phong hơi dài, đổi lại câu mở đầu mộc mạc hơn"
  }
  ```

---

#### API 5: `POST /api/social/publish-job` (Tác Vụ Tự Động Đăng Bài Đúng Giờ)
- **Request Body**: `{}` (hoặc `{ "forceAll": false }`)
- **Logic thực thi**:
  1. Tìm các bài viết có `status = 'APPROVED'`, `isApproved = true`, `scheduledAt <= now`.
  2. Bỏ qua các bài có chiến dịch thuộc trạng thái `ENDED` hoặc `CANCELLED`.
  3. Thực hiện khóa chống chạy trùng lặp (`isPublishing: true`).
  4. Đẩy payload tới adapter tương ứng (kiểm tra credential hoặc chạy mock an toàn).
  5. Cập nhật trạng thái thành `PUBLISHED` (hoặc `FAILED`).
- **Response Success** (`200 OK`):
  ```json
  {
    "ok": true,
    "processedCount": 3,
    "publishedCount": 3,
    "failedCount": 0,
    "skippedCount": 1,
    "details": [
      { "postId": "cuid_post_999", "platform": "FACEBOOK", "status": "PUBLISHED", "simulated": true, "externalId": "fb_post_mock_abc" },
      { "postId": "cuid_post_998", "platform": "WEBSITE_INTERNAL", "status": "PUBLISHED", "slug": "mua-vu-lan-thap-ngon-nen-thom", "publicUrl": "/blog/mua-vu-lan-thap-ngon-nen-thom" }
    ]
  }
  ```

---

## 10. Mô Hình Dữ Liệu Mở Rộng Prisma ORM

Các mô hình mới này được bổ sung vào `prisma/schema.prisma` mà **không sửa đổi hay xóa bỏ bất kỳ trường nào của 28 bảng cốt lõi hiện có**:

```prisma
// ============================================================
// PHÂN HỆ AUTO SOCIAL — MARKETING TỰ ĐỘNG ĐA KÊNH
// ============================================================

model SocialCampaign {
  id              String       @id @default(cuid())
  code            String       @unique // VD: CT-VULAN-2026, CT-PHATDAN-2026
  title           String       // Tên chương trình hiển thị
  description     String?      // Mô tả thông điệp chính
  startDate       DateTime     // Thời gian bắt đầu
  endDate         DateTime     // Thời gian kết thúc
  status          String       @default("UPCOMING") // UPCOMING | RUNNING | ENDED | CANCELLED
  productIds      String?      // JSON mảng ID sản phẩm tham gia (["UD-NEN-001", "UD-TRA-003"])
  voucherIds      String?      // JSON mảng ID voucher đính kèm (["UUDAM10"])
  driveFolderUrl  String?      // URL thư mục Google Drive riêng của chiến dịch
  createdAt       DateTime     @default(now())
  updatedAt       DateTime     @updatedAt
  posts           SocialPost[]
  driveItems      DriveItem[]

  @@index([status])
  @@index([startDate, endDate])
}

model DriveSource {
  id            String      @id @default(cuid())
  name          String      // Tên hiển thị của nguồn Drive
  folderUrl     String      // URL gốc do người dùng dán vào
  folderId      String      @unique // ID trích xuất từ Google Drive
  status        String      @default("ACTIVE") // ACTIVE | ERROR | SYNCING
  errorMessage  String?
  filesCount    Int         @default(0)
  foldersCount  Int         @default(0)
  lastSyncedAt  DateTime?
  createdAt     DateTime    @default(now())
  updatedAt     DateTime    @updatedAt
  items         DriveItem[]
}

model DriveItem {
  id              String          @id @default(cuid())
  sourceId        String
  source          DriveSource     @relation(fields: [sourceId], references: [id], onDelete: Cascade)
  fileId          String          // ID tệp tin/thư mục trên Google Drive
  name            String          // Tên tệp tin
  mimeType        String          // Định dạng MIME
  type            String          // IMAGE | VIDEO | DOC | SHEET | FOLDER | OTHER
  size            Int?            // Dung lượng (bytes)
  webViewLink     String?         // Link xem trên Google Drive
  thumbnailUrl    String?         // Link thumbnail ảnh
  downloadUrl     String?         // Link tải trực tiếp
  parentFolderId  String?         // ID thư mục cha
  folderPath      String?         // Đường dẫn phân cấp (VD: /Set Qua Tang Vu Lan/)
  textContent     String?         // Nội dung văn bản trích xuất từ Doc hoặc CSV Sheet
  productId       String?         // Liên kết tùy chọn với sản phẩm (UD-NEN-001)
  campaignId      String?         // Liên kết tùy chọn với chiến dịch
  campaign        SocialCampaign? @relation(fields: [campaignId], references: [id], onDelete: SetNull)
  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt

  @@unique([sourceId, fileId])
  @@index([type])
  @@index([productId])
  @@index([campaignId])
}

model SocialPost {
  id              String          @id @default(cuid())
  campaignId      String?
  campaign        SocialCampaign? @relation(fields: [campaignId], references: [id], onDelete: SetNull)
  platform        String          // FACEBOOK | ZALO_OA | WEBSITE_INTERNAL | WEBSITE_EXTERNAL | INSTAGRAM | TIKTOK | THREADS
  title           String?         // Tiêu đề (dành cho Website Blog / Zalo Article)
  slug            String?         @unique // Slug bài viết công khai trên Website (/blog/[slug])
  content         String          // Nội dung văn bản / Markdown / HTML bài viết
  excerpt         String?         // Tóm tắt ngắn
  mediaUrls       String?         // JSON mảng URL hình ảnh / video
  hashtags        String?         // JSON mảng hashtag (["#UuDam", "#NenBo"])
  status          String          @default("DRAFT") // DRAFT | PENDING_APPROVAL | APPROVED | PUBLISHED | FAILED | REJECTED
  isApproved      Boolean         @default(false)   // Chốt chặn duyệt: Chỉ true mới được đăng
  approvedAt      DateTime?
  approvedBy      String?         // Tên chủ tiệm ("Chủ tiệm Ưu Đàm")
  rejectionReason String?         // Lý do từ chối nếu REJECTED
  scheduledAt     DateTime?       // Giờ hẹn xuất bản
  publishedAt     DateTime?       // Thời điểm xuất bản thực tế
  isPublishing    Boolean         @default(false)   // Khóa cờ chống đăng trùng lặp (Idempotency Lock)
  externalPostId  String?         // ID bài viết trả về từ nền tảng
  externalUrl     String?         // Link xem bài viết công khai trên mạng xã hội
  errorMessage    String?         // Lý do lỗi nếu status === 'FAILED'
  retryCount      Int             @default(0)
  lastRetriedAt   DateTime?
  rubricScore     Float?          // Điểm đánh giá chất lượng (0 - 10)
  rubricFeedback  String?         // JSON nhận xét 4 tiêu chuẩn rubric
  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt

  @@index([platform])
  @@index([status])
  @@index([scheduledAt])
  @@index([campaignId])
}
```

---

## 11. Bảng Kiểm Kê Tính Năng Toàn Diện (Feature Inventory Table)

| # | Phân Hệ | Mã Tính Năng | Tên Tính Năng | Mô Tả Nghiệp Vụ | Dữ Liệu Đầu Vào | Dữ Liệu Đầu Ra | Hành Vi Khi Lỗi | Phân Hạng Kiểm Thử | Khai Phá Từ |
| :---: | :---: | :---: | :--- | :--- | :--- | :--- | :--- | :---: | :--- |
| 1 | R1 | `FEAT-CRM-01` | Tạo Chiến Dịch CRM | Khởi tạo chương trình khuyến mãi/bán hàng với thời gian, mã code và mô tả | Code, Title, Desc, StartDate, EndDate, ProductIds, VoucherIds | Bản ghi `SocialCampaign` mới | Trả về 400 nếu `endDate <= startDate` hoặc thiếu `title` | Tier 1 (Unit/API) | R1 |
| 2 | R1 | `FEAT-CRM-02` | Chặn Khoảng Ngày Không Hợp Lệ | Ngăn chặn ngày kết thúc diễn ra trước hoặc bằng ngày bắt đầu | StartDate $\ge$ EndDate | HTTP 400 Bad Request kèm mã lỗi `INVALID_DATE_RANGE` | Chặn lưu CSDL, giữ nguyên dữ liệu cũ | Tier 1 (Adversarial) | R1 AC |
| 3 | R1 | `FEAT-CRM-03` | Tính Toán Trạng Thái Thời Gian Thực | Tự động phân loại `UPCOMING`, `RUNNING`, `ENDED` tại các mốc biên (-1m, đúng giờ, +1m) | Current Timestamp, StartDate, EndDate | Computed Status string | Chuyển sang `CANCELLED` nếu người dùng hủy thủ công | Tier 1 (Boundary) | R1 AC |
| 4 | R1 | `FEAT-CRM-04` | Liên Kết Sản Phẩm & Voucher | Gắn danh sách mã sản phẩm và mã voucher hợp lệ từ CSDL vào chiến dịch | Array of Product IDs, Array of Voucher IDs | Liên kết được xác thực trong JSON/DB | Bỏ qua hoặc báo lỗi nếu ID không tồn tại | Tier 1 (Integration) | R1 |
| 5 | R2 | `FEAT-DRV-01` | Phân Tích Đường Dẫn Drive Công Khai | Trích xuất `folderId` từ đa dạng định dạng link Drive chia sẻ công khai | URL string (chuẩn, u/0, open?id, raw id) | Folder ID string chuẩn hóa (25-45 ký tự) | Trả về 400 nếu URL không chứa ID hợp lệ | Tier 1 (Regex/Unit) | R2 |
| 6 | R2 | `FEAT-DRV-02` | Quét & Phân Cấp Thư Mục Drive | Duyệt cây thư mục và danh sách tệp tin (ảnh, video, doc, sheet, folder) | Folder ID, API key hoặc HTML parser | Danh sách `DriveItem` phân loại chuẩn | Báo lỗi 400/404 nếu thư mục private/không tồn tại | Tier 2 (Integration) | R2 AC |
| 7 | R2 | `FEAT-DRV-03` | Trích Xuất Văn Bản Google Docs | Đọc nội dung văn bản thuần tiếng Việt từ tệp Google Docs công khai | Google Doc File ID | Nội dung văn bản UTF-8 không lỗi font | Trả về null hoặc chuỗi rỗng nếu Doc bị khóa | Tier 2 (Extraction) | R2 AC |
| 8 | R2 | `FEAT-DRV-04` | Trích Xuất Bảng Biểu Google Sheets | Bóc tách dữ liệu từ Google Sheets công khai thành bảng CSV dữ liệu | Google Sheet File ID | Chuỗi CSV cấu trúc dòng/cột | Báo lỗi trích xuất an toàn, không sập server | Tier 2 (Extraction) | R2 AC |
| 9 | R2 | `FEAT-DRV-05` | Đồng Bộ Lại Không Hỏng Dữ Liệu | Bấm quét lại thư mục Drive cập nhật tệp mới nhưng bảo toàn liên kết SP/chiến dịch | Source ID, Trigger Re-sync | Số lượng tệp mới, giữ nguyên `productId`/`campaignId` | Nếu sync lỗi, giữ nguyên cache cũ không xóa | Tier 2 (Regression) | R2 AC |
| 10 | R3 | `FEAT-AI-01` | AI Đề Xuất Lịch Đăng (Cadence) | Đề xuất danh sách ngày giờ và kênh đăng tối ưu trong khung thời gian chiến dịch | Campaign Data, Available Channels | Danh sách mốc đăng (Date, Channel, Angle) | Dự phòng lịch mẫu nếu LLM timeout | Tier 2 (AI Engine) | R3 |
| 11 | R3 | `FEAT-AI-02` | Khớp Số Liệu CRM Chống Ảo Giác | Đảm bảo giá tiền, % giảm, mã voucher trong bài khớp 100% dữ liệu CRM | Generated Post Content, CRM Snapshot | Boolean Match Result (Pass/Fail) | Chặn bài viết nếu số liệu bị sai lệch | Tier 1 (Invariant) | R3 AC |
| 12 | R3 | `FEAT-AI-03` | Định Dạng Chuẩn 7 Nền Tảng | Kiểm soát độ dài, cấu trúc bài viết và phương tiện phù hợp từng kênh | Platform, Post Content, Media Attachments | Nội dung đạt chuẩn (độ dài, hashtag, media) | Báo lỗi nếu thiếu media bắt buộc (IG/TikTok) | Tier 1 (Constraint) | R3 AC |
| 13 | R3 | `FEAT-AI-04` | Lọc Giọng Văn Ưu Đàm 100% Anti-AI | Khử toàn bộ từ cấm sáo rỗng, áp dụng giọng tụi em/Ưu Đàm mộc mạc tĩnh tại | Raw AI text | Sanitized text đúng giọng Ưu Đàm | Tự động thay thế từ cấm bằng từ ngữ đời thường | Tier 1 (Voice Rule) | R3 |
| 14 | R3 | `FEAT-AI-05` | Chấm Điểm Rubric Độc Lập (8/10+) | Chấm 10 bài mẫu theo 4 tiêu chí (chân thực, giọng văn, chính tả, CTA) | 10 Sample Posts, Rubric Spec | Điểm từng bài $\ge 8.0/10$ | Gắn cờ cần cải thiện nếu bài viết $< 8$ điểm | Tier 3 (Evaluation) | R3 AC |
| 15 | R4 | `FEAT-REV-01` | Xem & Chỉnh Sửa Lịch Bài Viết | Giao diện lịch biểu trực quan cho phép xem nội dung, đổi giờ, sửa chữ | View Post, Edit Post Payload | Bài viết cập nhật trong CSDL | Trả về 400 nếu nội dung sửa vi phạm quy cách | Tier 2 (UI/UX) | R4 |
| 16 | R4 | `FEAT-REV-02` | Phê Duyệt Phân Quyền Chủ Tiệm | Nút Duyệt (`APPROVE`) và Từ chối (`REJECT`) dành riêng cho chủ tiệm | Action (APPROVE / REJECT), Post ID | Post status chuyển sang `APPROVED` / `REJECTED` | Bài chưa duyệt cấm tuyệt đối không được đăng | Tier 1 (State Guard) | R4 AC |
| 17 | R4 | `FEAT-REV-03` | Chốt Chặn Chiến Dịch Hết Hạn | Chặn xuất bản bài viết nếu chiến dịch thuộc trạng thái `ENDED` hoặc `CANCELLED` | Post ID, Linked Campaign Status | Chặn gửi adapter, chuyển post sang `REJECTED` | Ghi log kiểm toán từ chối xuất bản | Tier 1 (Safety Guard) | R4 AC |
| 18 | R4 | `FEAT-REV-04` | Động Cơ Xuất Bản Đúng Giờ | Tự động đăng các bài đã duyệt khi đến giờ hẹn (sai lệch $\le 1$ phút) | Current Time, Cron / Publish Job Trigger | Các bài tới giờ được gửi sang adapter | Báo lỗi `FAILED` kèm lý do nếu API gặp sự cố | Tier 2 (Execution) | R4 AC |
| 19 | R4 | `FEAT-REV-05` | Chống Đăng Trùng Lặp (Idempotency) | Kích hoạt tác vụ đăng nhiều lần đồng thời không sinh ra bài trùng trên mạng xã hội | Concurrent Publish Job Requests | Duy nhất 1 lượt đăng thành công | Lượt gọi sau phát hiện khóa cờ và bỏ qua an toàn | Tier 1 (Concurrency) | R4 AC |
| 20 | R4 | `FEAT-REV-06` | Báo Lỗi & Nút Thử Lại (Retry) | Hiển thị rõ nguyên nhân thất bại trên UI và cho phép bấm thử lại 1-click | Post in `FAILED` status, Click Retry | Trạng thái chuyển lại `APPROVED` để đăng lại | Tăng `retryCount` và ghi nhận nhật ký lỗi | Tier 2 (Resilience) | R4 AC |
| 21 | R5 | `FEAT-PUB-FB` | Adapter Fanpage Facebook | Xuất bản bài viết/ảnh lên Fanpage Facebook (hỗ trợ Mock và Real) | Post Content, Media, Facebook Credential | Post ID, Post URL | Báo lỗi nếu Page Token hết hạn hoặc sai ID | Tier 2 (Adapter) | R5 |
| 22 | R5 | `FEAT-PUB-ZL` | Adapter Zalo OA | Xuất bản bài viết Article lên Zalo Official Account | Post Content, Cover Image, Zalo OA Credential| Article ID | Báo lỗi nếu bài vượt 2.000 ký tự | Tier 2 (Adapter) | R5 |
| 23 | R5 | `FEAT-PUB-WB` | Adapter Website Blog Nội Bộ | Xuất bản bài viết lên trang tin tức công khai trong hệ thống Next.js | Title, Slug, Markdown/HTML Content, Image | Bài viết hiển thị tại `GET /blog/[slug]` | Báo lỗi nếu trùng lặp slug | Tier 2 (Public Web) | R5 AC |
| 24 | R5 | `FEAT-PUB-EXT`| Adapter Website Ngoài (WP/Haravan/Sapo)| Đẩy bài viết sang website đối tác qua REST API chuẩn | Article Payload, Platform Type, API Key | External Article ID | Báo lỗi nếu kết nối endpoint ngoài thất bại | Tier 2 (Adapter) | R5 |
| 25 | R5 | `FEAT-PUB-IG` | Adapter Instagram Graph API | Xuất bản bài viết kèm ảnh/video lên Instagram (bắt buộc media) | Caption, Image/Video URL, IG Credential | IG Media ID, Permlink | Báo lỗi ngay lập tức nếu thiếu media | Tier 2 (Adapter) | R5 AC |
| 26 | R5 | `FEAT-PUB-TT` | Adapter TikTok Video Posting | Xuất bản bài viết kèm video lên TikTok (bắt buộc video) | Caption, Video URL, TikTok Credential | TikTok Publish ID | Báo lỗi ngay lập tức nếu thiếu video | Tier 2 (Adapter) | R5 AC |
| 27 | R5 | `FEAT-PUB-TH` | Adapter Threads API | Xuất bản bài viết ngắn lên Threads (tối đa 500 ký tự) | Text Content ($\le 500$ chars), Threads Cred | Threads Post ID | Báo lỗi ngay lập tức nếu vượt 500 ký tự | Tier 2 (Adapter) | R5 AC |
| 28 | R6 | `FEAT-SEC-01` | Cô Lập Tuyệt Đối Bộ Test (Safe Mock)| Chặn 100% cuộc gọi ra mạng xã hội thật trong toàn bộ hoạt động kiểm thử | Test Execution Environment | Mock responses, 0 outbound HTTP to social APIs| Báo fail bài test nếu phát hiện request thật | Tier 1 (Security) | R6 AC |
| 29 | R6 | `FEAT-SEC-02` | Quét Chống Lộ Bí Mật / API Keys | Quét mã nguồn và log đảm bảo không hard-code token/secret | Codebase Source Files, Git Tree | 0 API Keys / Secrets bị phát hiện | Chặn commit / fail cổng kiểm tra | Tier 1 (Audit) | R6 AC |
| 30 | R6 | `FEAT-SEC-03` | Kháng Lỗi API & Hạn Ngạch Quota 429| Chuyển sang văn bản dự phòng khi Gemini hết quota hoặc Drive lỗi mạng | 429 Too Many Requests / Network Timeout | Pre-authored template bài viết hợp lệ | Hệ thống tiếp tục vận hành mượt mà, không crash | Tier 2 (Reliability) | R6 |
| 31 | R7 | `FEAT-DAT-01` | Bản Sao Lưu CSDL Sản Xuất | Đảm bảo file sao lưu SQLite `db/custom.db.bak` tồn tại và hợp lệ | Database Path, Backup Path | File sao lưu SQLite format 3 nguyên vẹn | Dừng toàn bộ tiến trình nếu chưa sao lưu | Tier 1 (Safety) | R7 AC |
| 32 | R7 | `FEAT-DAT-02` | Đối Soát 28 Bảng Cốt Lõi (Parity) | Kiểm tra số lượng bản ghi của 28 bảng dữ liệu cũ khớp 100% baseline | CSDL hiện tại vs `db/baseline-counts.json` | 0 sai lệch bản ghi (100% MATCH) | Báo động đỏ nếu làm biến đổi dữ liệu cũ | Tier 1 (Audit) | R7 AC |
| 33 | R7 | `FEAT-DAT-03` | Dọn Dẹp Dữ Liệu Test (Teardown) | Tự động xóa sạch toàn bộ chiến dịch và bài viết sinh ra trong lúc chạy test | Test Suite Run Complete | CSDL sạch sẽ như trước khi chạy test | Xóa sạch bản ghi tạm, giữ nguyên dữ liệu gốc | Tier 1 (Cleanup) | R7 AC |
| 34 | R7 | `FEAT-QG-01` | Cổng Kiểm Tra Chất Lượng Toàn Diện | Vượt qua `tsc`, `lint`, `test:chain`, `test:scenarios`, và `build` | npm run verify & npm run build | 0 errors, 0 warnings, build thành công | Chặn bàn giao nếu có bất kỳ cảnh báo nào | Tier 1 (Quality) | R7 AC |
| 35 | R7 | `FEAT-UI-01` | Giao Diện Đáp Ứng Desktop & 390px | Hiển thị trơn tru trên máy tính và màn hình điện thoại 390px, 0 lỗi console| Browser Viewports (1440px & 390px) | Giao diện không tràn ngang, thao tác 1 chạm | Báo lỗi nếu giao diện vỡ layout hoặc có lỗi console | Tier 3 (E2E/Browser) | R7 AC |

---

## 12. Ma Trận Tình Huống Biên & Kịch Bản Đối Kháng (Edge Cases & Adversarial Matrix)

| # | Phân Hệ / Tính Năng | Kịch Bản Thử Thách Đầu Vào (Input) | Hành Vi Hệ Thống Được Quan Sát & Kỳ Vọng | Hậu Quả Dữ Liệu |
| :---: | :--- | :--- | :--- | :--- |
| **EC-01** | Tạo chiến dịch CRM | `endDate` = `2026-08-10`, `startDate` = `2026-08-15` (Ngày kết thúc trước ngày bắt đầu) | Trả về HTTP 400 Bad Request kèm thông báo lỗi `"Thời gian kết thúc phải diễn ra sau thời gian bắt đầu"`. | Không bản ghi nào được ghi vào bảng `SocialCampaign`. |
| **EC-02** | Tạo chiến dịch CRM | `startDate` = `endDate` (Bắt đầu và kết thúc cùng 1 thời điểm) | Trả về HTTP 400 Bad Request, bắt buộc khoảng thời gian diễn ra tối thiểu $\ge 1$ giờ. | Không ghi dữ liệu. |
| **EC-03** | Trạng thái chiến dịch | Thời điểm hiện tại `now = startDate - 60s` (Trước 1 phút) | Hệ thống trả về trạng thái chiến dịch là `UPCOMING`. | Đúng trạng thái. |
| **EC-04** | Trạng thái chiến dịch | Thời điểm hiện tại `now = startDate` (Đúng thời điểm bắt đầu) | Hệ thống lập tức chuyển trạng thái sang `RUNNING`. | Trạng thái cập nhật tức thì. |
| **EC-05** | Trạng thái chiến dịch | Thời điểm hiện tại `now = endDate + 60s` (Sau kết thúc 1 phút) | Hệ thống trả về trạng thái chiến dịch là `ENDED`. | Đúng trạng thái. |
| **EC-06** | Nhập link Google Drive | URL rác: `https://example.com/not-a-drive-link` | Trả về HTTP 400 Bad Request `"Đường dẫn thư mục Google Drive không đúng định dạng"`. | Không tạo bản ghi `DriveSource`. |
| **EC-07** | Nhập link Google Drive | Thư mục Google Drive chưa được bật chia sẻ công khai (Private 403) | Báo lỗi rõ ràng trên UI `"Thư mục Google Drive chưa được chia sẻ công khai hoặc không tồn tại"`. | Dữ liệu đồng bộ cũ giữ nguyên vẹn. |
| **EC-08** | Đồng bộ lại Google Drive | Đã liên kết tệp `img_01` với sản phẩm `UD-NEN-001`, sau đó bấm Quét lại Drive | Hệ thống cập nhật kích thước/tên mới của tệp nhưng giữ nguyên `productId = 'UD-NEN-001'`. | Không làm mất liên kết người dùng đã tạo. |
| **EC-09** | AI Viết Bài | LLM cố tình viết giá nến bơ là `90.000đ` trong khi CRM ghi `120.000đ` | Bộ kiểm tra đối chiếu (CRM Matcher) phát hiện sai lệch và từ chối xuất bản bài viết. | Ngăn chặn thông tin sai sự thật lọt ra ngoài. |
| **EC-10** | Đăng lên Instagram | Bài viết chỉ có văn bản thuần, không đính kèm hình ảnh hoặc video | Adapter Instagram từ chối ngay lập tức với lỗi `"Instagram bắt buộc phải có ít nhất 1 ảnh hoặc video"`. | Bài viết chuyển sang `FAILED`, không gọi mạng. |
| **EC-11** | Đăng lên TikTok | Bài viết đính kèm hình ảnh tĩnh (không có video clip) | Adapter TikTok từ chối với lỗi `"TikTok bắt buộc phải có video đính kèm"`. | Bài viết chuyển sang `FAILED`. |
| **EC-12** | Đăng lên Threads | Bài viết có độ dài 550 ký tự (vượt trần 500 ký tự) | Adapter Threads từ chối với lỗi `"Độ dài bài viết Threads vượt quá giới hạn 500 ký tự"`. | Bài viết chuyển sang `FAILED`. |
| **EC-13** | Xuất bản bài viết | Bài viết đang ở trạng thái `DRAFT` hoặc `PENDING_APPROVAL` (Chưa được chủ tiệm duyệt) | Động cơ xuất bản bỏ qua hoàn toàn, không bao giờ gửi payload tới bất kỳ adapter nào. | Không phát sinh bài đăng ra ngoài. |
| **EC-14** | Xuất bản bài viết | Bài viết đã được duyệt (`APPROVED`) nhưng chiến dịch liên kết đã chuyển sang `ENDED` | Chốt chặn chiến dịch (Campaign Guard) chặn đăng, chuyển trạng thái bài viết sang `REJECTED`. | Ngăn chặn đăng tin khuyến mãi đã hết hạn. |
| **EC-15** | Đăng bài đồng thời | Tác vụ `publish-job` được gọi 2 lần cùng một mili-giây cho cùng một bài viết đã duyệt | Giao dịch database sử dụng cờ `isPublishing: true` khóa bản ghi, chỉ có 1 tiến trình xử lý. | Không bao giờ bị đăng trùng lặp 2 lần. |
| **EC-16** | Gọi LLM gặp lỗi 429 | Gemini API phản hồi HTTP 429 Too Many Requests hoặc mạng bị ngắt | Động cơ AI tự động chuyển sang sử dụng bộ template mẫu giọng Ưu Đàm có sẵn trong mã nguồn. | Người dùng vẫn nhận được bài viết hợp lệ, không lỗi 500. |
| **EC-17** | Môi trường kiểm thử tự động | Chạy lệnh `npm test` hoặc `node scripts/verify-auto-social.ts` | Safe Mock Mode tự động kích hoạt 100%, chặn đứng toàn bộ outbound HTTP tới Facebook/Zalo/TikTok. | 0 byte dữ liệu lọt ra mạng xã hội thật. |
| **EC-18** | Xem trang Blog nội bộ | Người dùng vãng lai truy cập `GET /blog/bai-viet-mau` không đăng nhập | Trang hiển thị mượt mà nội dung HTML/Markdown, ảnh đại diện, ngày đăng và tác giả Ưu Đàm. | HTTP 200 OK, không bắt chuyển hướng login. |
| **EC-19** | Đối soát CSDL sản xuất | Chạy kiểm tra số lượng bản ghi sau khi kết thúc toàn bộ kiểm thử phân hệ AUTO SOCIAL | Khớp 100% với 28 bảng cốt lõi trong `db/baseline-counts.json`. | CSDL sản xuất nguyên vẹn tuyệt đối. |
| **EC-20** | Thử lại bài viết lỗi | Bài viết bị lỗi do mạng (`FAILED`), chủ tiệm bấm nút "Thử lại" trên giao diện | Trạng thái chuyển lại `APPROVED`, xóa thông báo lỗi cũ, hệ thống sẵn sàng xuất bản trong đợt quét kế tiếp. | Khôi phục luồng xuất bản bình thường. |

---

## 13. Kết Luận & Hướng Dẫn Chuyển Giao Cho Đội Ngũ Thực Thi

1. **Tính Toàn Vẹn Của Đặc Tả**: Toàn bộ 7 yêu cầu cốt lõi (R1–R7) đã được phân tích tỉ mỉ từ cấp độ kiến trúc, mô hình dữ liệu Prisma, giao thức API REST, máy trạng thái, ràng buộc bảo mật cho tới danh mục kiểm thử.
2. **Nguyên Tắc Vàng Cho Worker**:
   - Trước khi sửa `prisma/schema.prisma`: Kiểm tra file sao lưu `db/custom.db.bak`.
   - Khi viết code API và Adapter: Luôn kiểm tra `isSafeMockMode()` để bảo đảm không gọi mạng thật trong môi trường test.
   - Khi viết bộ test `scripts/verify-auto-social.ts`: Nhớ bổ sung hàm `teardown()` xóa sạch dữ liệu test tạo ra để bảo vệ đối soát 100% baseline counts.
3. **Sẵn Sàng Triển Khai**: Tài liệu này đóng vai trò là hợp đồng kỹ thuật bất biến (Authoritative Specification Contract) để đội ngũ Architect, Worker, Reviewer và Auditor căn cứ thực hiện và nghiệm thu.
