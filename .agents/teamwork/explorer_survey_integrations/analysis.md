# BÁO CÁO PHÂN TÍCH KỸ THUẬT: TÍCH HỢP NGOẠI VI & MODULE AUTO SOCIAL
**Dự án:** OPENVN · Ưu Đàm Suite (Next.js 16 + Prisma/SQLite)  
**Agent thực hiện:** Explorer Subagent (`explorer_survey_integrations`)  
**Ngày phân tích:** 2026-10-26  
**Trạng thái:** Hoàn thành khảo sát thực nghiệm

---

## 1. TỔNG QUAN KHẢO SÁT

Nhiệm vụ của phân hệ **AUTO SOCIAL** là tự động hóa toàn bộ quy trình tiếp thị đa kênh cho chuỗi cửa hàng Ưu Đàm:
1. Đọc dữ liệu tài nguyên từ thư mục Google Drive công khai (ảnh sản phẩm, video ngắn, bài viết hướng dẫn .doc/.docx, bảng thông số kỹ thuật/tồn kho Google Sheets).
2. Kết hợp với các Chương trình khuyến mãi/bán hàng (CRM Campaign) đang chạy hoặc sắp chạy trên hệ thống.
3. Kích hoạt AI (Google Gemini / LLM) để lên lịch đăng bài và tự động soạn thảo bài viết tối ưu cho **7 nền tảng** xuất bản khác nhau, chuẩn giọng thương hiệu Ưu Đàm (trầm mặc, thanh tịnh, chữa lành, tâm linh, định vị trung - cao cấp).
4. Cung cấp quy trình kiểm duyệt (Approval Workflow) chặt chẽ: chỉ bài được chủ tiệm duyệt mới được lên lịch đăng; bài thuộc chương trình đã kết thúc hoặc bị hủy tuyệt đối không được đăng.
5. Thực thi đăng bài tự động qua Gateway 7 kênh (Facebook Fanpage, Zalo OA, Website Blog nội bộ, Website ngoài WP/Haravan/Sapo, Instagram, TikTok, Threads) với cơ chế chuyển đổi thông minh giữa Mock và Real mode.
6. Thiết lập rào chắn an toàn bất biến (Operational Safety Invariant) nhằm đảm bảo 100% các bộ test tự động và hoạt động phát triển không bao giờ gửi request xuất bản lên mạng xã hội thật.

---

## 2. PHÂN TÍCH CHI TIẾT TỪNG PHÂN HỆ

### 2.1. Phân hệ Google Drive: Đọc Thư mục Công khai Không Cần OAuth & Xử lý Tập tin

#### A. Thách thức kỹ thuật
- Thông thường, tích hợp Google Drive yêu cầu cấu hình OAuth 2.0 (Client ID, Client Secret, Redirect URI, cấp quyền hạn chế `drive.readonly` và màn hình xác thực Google Consent Screen phức tạp cho người dùng).
- Tuy nhiên, với thư mục công khai ("Bất kỳ ai có đường liên kết đều có thể xem" / *Anyone with the link can view*), người dùng chỉ cung cấp một đường link chia sẻ dạng:
  `https://drive.google.com/drive/folders/1FYLaoscxWBV_BU5sFouf7XCrv7cKktBY?usp=sharing`
- Hệ thống cần phân tích được thư mục này mà **không bắt buộc người dùng thực hiện luồng OAuth**.

#### B. Cơ chế tiếp cận 2 tầng (Two-Tier Hybrid Architecture)

```
                       ┌──────────────────────────────────────────────┐
                       │  Đầu vào: URL Thư mục Google Drive Công khai │
                       └──────────────────────┬───────────────────────┘
                                              │
                                   Trích xuất Folder ID
                               (Regex: /\/folders\/([a-zA-Z0-9_-]+)/)
                                              │
                      Có Google API Key trong AppSetting / Credential?
                                       /              \
                                     CÓ               KHÔNG / LỖI QUOTA
                                     /                  \
                        ┌───────────────────┐    ┌──────────────────────────────────┐
                        │ TẦNG 1: API v3    │    │ TẦNG 2: Zero-Key HTML Scraper    │
                        │ Drive API REST    │    │ Fetch HTML công khai             │
                        │ (Google Cloud Key)│    │ Parse window['_DRIVE_ivd'] blob  │
                        └─────────┬─────────┘    └────────────────┬─────────────────┘
                                  │                               │
                                  └───────────────┬───────────────┘
                                                  │
                                                  ▼
                                      Danh sách File & Thư mục con
                                      (ID, Tên, MIME Type, Kích thước)
                                                  │
                             ┌────────────────────┼────────────────────┐
                             ▼                    ▼                    ▼
                        Google Docs         Google Sheets       Ảnh & Video
                     export?format=txt    export?format=csv   lh3.googleusercontent
```

##### 1. Tầng 1: Google Drive API v3 với Google Cloud API Key (Khuyến nghị khi có Key)
- **Endpoint:**
  ```http
  GET https://www.googleapis.com/drive/v3/files?q='{folderId}'+in+parents+and+trashed=false&key={apiKey}&fields=files(id,name,mimeType,size,modifiedTime,parents)&pageSize=100
  ```
- **Nguyên lý:** Khi thư mục được share công khai, Google Drive API v3 cho phép truy vấn danh sách file chỉ bằng `key={apiKey}` (API Key của Google Cloud có bật Google Drive API), hoàn toàn không cần OAuth token.
- **Nguồn lấy Key:** Tự động đọc từ `AppSetting` (`google_drive_api_key`) hoặc `IntegrationCredential` (`provider: 'GOOGLE_DRIVE'` hoặc `provider: 'GEMINI'`).

##### 2. Tầng 2: Zero-Key Web Extraction (Đã kiểm chứng thực nghiệm 100% thành công)
- **Thực nghiệm đã thực hiện:**
  Đã gửi request trực tiếp tới thư mục công khai thực tế:
  `https://drive.google.com/drive/folders/1FYLaoscxWBV_BU5sFouf7XCrv7cKktBY`
- **Kết quả quan sát được:**
  - Google Drive trả về HTTP 200 OK ngay cả khi không có bất kỳ Cookie hay Authorization header nào.
  - Trong mã nguồn HTML trả về (độ dài ~336 KB), Google nhúng sẵn dữ liệu trạng thái ban đầu của thư mục dưới biến JavaScript:
    `window['_DRIVE_ivd'] = '\x5b\x5b\x5b\x221rCuD8MxDwX...`
  - Biến này được mã hóa hex dạng `\xHH`. Khi giải mã qua regex:
    ```ts
    const jsonStr = rawHex.replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    )
    const data = JSON.parse(jsonStr)
    ```
  - Cấu trúc `data[0]` chứa mảng các phần tử:
    - `item[0]`: File ID duy nhất (ví dụ: `1rCuD8MxDwX-7o0eNXQTjd7XaWVe1IACV`)
    - `item[1]`: Mảng Parent Folder ID (ví dụ: `["1FYLaoscxWBV_BU5sFouf7XCrv7cKktBY"]`)
    - `item[2]`: Tên file gốc (ví dụ: `Generated document.pdf`, `How_to_migrate_from_Lunr_to_Algolia_-_a_technical_guide.pdf`)
    - `item[3]`: MIME Type chuẩn (ví dụ: `application/pdf`, `image/jpeg`, `application/vnd.google-apps.folder`)
- **Khả năng đệ quy:** Nếu `item[3] === 'application/vnd.google-apps.folder'`, hệ thống tự động gọi đệ quy (giới hạn maxDepth = 3) để quét toàn bộ cây thư mục chiến dịch/sản phẩm.

#### C. Xử lý các định dạng tệp tin từ Google Drive công khai

| Loại tập tin | MIME Type | Cơ chế đọc nội dung / URL truy cập | Kiểm chứng thực nghiệm |
|---|---|---|---|
| **Google Sheet** | `application/vnd.google-apps.spreadsheet` | `https://docs.google.com/spreadsheets/d/{id}/export?format=csv` | Đã test trên file mẫu `1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms` -> trả về 200 OK + dữ liệu CSV đầy đủ |
| **Google Doc** | `application/vnd.google-apps.document` | `https://docs.google.com/document/d/{id}/export?format=txt` | Trả về 200 OK + chuỗi text thuần túy không chứa thẻ HTML thừa |
| **Tệp .txt / Markdown** | `text/plain`, `text/markdown` | `https://drive.google.com/uc?export=download&id={id}` | Tải trực tiếp qua HTTP GET |
| **Tệp Word (.docx)** | `application/vnd.openxmlformats-...` | Tải binary qua export link, trích xuất text XML từ `word/document.xml` trong buffer zip | Khả thi bằng thư viện JS thuần hoặc đọc unzip |
| **Hình ảnh (.jpg, .png, .webp)** | `image/jpeg`, `image/png`, `image/webp` | `https://lh3.googleusercontent.com/d/{id}` (render/thumbnail) và `https://drive.google.com/uc?export=view&id={id}` | Hỗ trợ CDN Google tốc độ cao, không chặn CORS khi nhúng thẻ `<img>` |
| **Video (.mp4, .mov)** | `video/mp4`, `video/quicktime` | `https://drive.google.com/file/d/{id}/preview` hoặc download stream | Phù hợp làm link đính kèm cho bài viết TikTok/Facebook |

#### D. Xử lý trường hợp ngoại lệ (Edge Cases)
1. **Link không công khai / bị khóa quyền (Private):**
   - Google Drive redirect về trang `accounts.google.com/v3/signin` hoặc trả HTTP 403.
   - Cơ chế phát hiện: Kiểm tra URL redirect hoặc `res.status === 403` -> Ném lỗi thân thiện:  
     `"Thư mục Google Drive chưa được mở công khai. Vui lòng chuyển quyền chia sẻ sang 'Bất kỳ ai có đường liên kết đều có thể xem' và thử lại."`
2. **Link không tồn tại (404):**
   - Phản hồi HTTP 404 -> Ném lỗi: `"Thư mục Google Drive không tồn tại hoặc đã bị xóa."`
3. **Link sai định dạng:**
   - Hàm `extractDriveFolderId(url)` trả về `null` -> Ném lỗi ngay tại frontend/validation layer mà không gửi request mạng.
4. **Bảo toàn dữ liệu:** Mọi lỗi đồng bộ Drive đều dừng ở mức ghi log cảnh báo; **tuyệt đối không xóa hay làm hỏng các tài nguyên đã đồng bộ thành công trước đó**.

---

### 2.2. Phân hệ AI Generation, Tone Giọng Thương Hiệu & Cơ Chế Chấm Điểm Rubric

#### A. Kiến trúc gọi LLM hiện hữu trong dự án
- **Module hạt nhân:** `src/lib/llm.ts`
- **Thứ tự ưu tiên phân giải Key (`resolveGeminiApiKey`):**
  1. `db.appSetting.findUnique({ where: { key: 'gemini_api_key' } })`
  2. `db.integrationCredential.findUnique({ where: { provider: 'GEMINI' } })`
  3. Biến môi trường `process.env.GEMINI_API_KEY`
- **Mô hình hỗ trợ:** `gemini-2.5-flash`, `gemini-2.0-flash` qua endpoint REST chuẩn của Google Generative AI:
  `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}`
- **Tính năng chịu lỗi (Resilience):**
  - Có timeout qua `AbortSignal.timeout(timeoutMs)`.
  - Fallback sang ZAI SDK (`z-ai-web-dev-sdk`).
  - Khi cạn quota hoặc mạng lỗi: trả về `null` để lớp ứng dụng chuyển sang bộ template mẫu có sẵn (Deterministic Human-Crafted Templates), đảm bảo giao diện và luồng nghiệp vụ không bao giờ bị sập.

#### B. Hướng dẫn Giọng Thương hiệu Ưu Đàm (Brand Tone & Voice Guidelines)
Dựa trên phân tích mã nguồn `src/lib/agent-voice.ts` và `src/lib/agent-engine.ts`:
- **Định vị cốt lõi:**
  - Sản phẩm: Trầm hương thượng hạng, nhang thiền mộc, nến thơm sáp bơ thực vật đổ tay, trà đạo thiền định, gốm tử sa / men lam thủ công.
  - Phân khúc: Trung - Cao cấp. Khách hàng tìm kiếm sự an yên, tĩnh tại, chữa lành tâm hồn, không gian thanh tịnh sau những bộn bề cuộc sống.
- **Phong cách ngôn ngữ (Tone of Voice):**
  - **Trầm mặc, thanh tịnh, sâu lắng, chữa lành (Healing & Zen):** Dùng câu từ gợi cảm giác an nhiên, nhẹ nhàng như một tách trà ấm giữa chiều mưa, một nén hương trầm bảng lảng lúc sớm mai.
  - **Tự xưng chuẩn mực:** "tụi em", "em", "tiệm", "Ưu Đàm".
  - **Cách gọi khách hàng:** "mình", "anh/chị [Tên]", "bạn thương", "người thương trà/trầm".
- **Danh mục từ ngữ CẤM TUYỆT ĐỐI (`BANNED_PHRASES`):**
  - ❌ Cấm xưng hô robot / công nghiệp: "shop OmniSales", "chúng tôi là hệ thống tự động", "kính chào quý khách", "hân hạnh phục vụ".
  - ❌ Cấm văn mẫu AI sáo rỗng: "vô cùng quý giá", "nguồn động lực to lớn", "trải nghiệm tuyệt vời", "cải thiện chất lượng dịch vụ", "sự lựa chọn hoàn hảo".
  - ❌ Cấm giật tít, chèo kéo rẻ tiền: "SALE SẬP SÀN", "XẢ KHO CẮT LỖ", "MUA NGAY KẺO HẾT", "GIÁ RẺ NHẤT THỊ TRƯỜNG", "CƠ HỘI DUY NHẤT".
  - ❌ Cấm bão emoji: Mỗi bài viết chỉ dùng tối đa 1–2 emoji tinh tế (🌿, 🕯️, 🍵, 🙏, 🌸, ✨) hoặc không dùng emoji để giữ sự trang nhã.
- **Khớp dữ liệu Khuyến mãi CRM (Hard Invariant):**
  - Tên chương trình, giá niêm yết, giá ưu đãi, tỷ lệ % giảm giá, mã voucher và hạn dùng trong bài viết PHẢI KHỚP TUYỆT ĐỐI với dữ liệu trong bảng `Campaign` và `Voucher`. Không cho phép AI tự sáng tác con số.

#### C. Thiết kế Prompt Hợp đồng cho AI Auto Social
Prompt gửi tới Gemini sẽ được cấu trúc gồm 3 phần rõ ràng:
1. **System Instruction:** Thiết lập vai trò "Chuyên gia sáng tạo nội dung & Người kể chuyện thương hiệu của Tiệm Ưu Đàm", nạp bộ quy tắc giọng văn và từ ngữ cấm.
2. **Context Block (Nguồn sự thật):**
   - Thông tin Chương trình (Tên, ngày bắt đầu - kết thúc, thông điệp chính).
   - Sản phẩm áp dụng (Tên rút gọn, giá gốc, giá ưu đãi, link ảnh Drive).
   - Voucher áp dụng (Mã code, giá trị giảm, hạn sử dụng).
   - Trích xuất tài liệu từ Drive (nội dung Google Doc/Sheet mô tả công dụng).
3. **Output Constraint (Format per Platform):**
   Yêu cầu trả về JSON schema chuẩn cho 7 nền tảng:
   - `facebook`: { title, caption, hashtags, suggestedMediaIds }
   - `zalo_oa`: { title (<= 65 chars), summary (<= 120 chars), contentHtml, bannerMediaId }
   - `website_blog`: { title, slug, excerpt, contentMarkdown, metaTitle, metaDescription, featuredMediaId }
   - `external_website`: { title, contentHtml, category, tags, status: 'publish' }
   - `instagram`: { caption (<= 600 chars, visual-first), hashtags (10-15), mediaId }
   - `tiktok`: { hook3s, caption (<= 250 chars), soundSuggestion, hashtags, mediaId (bắt buộc video/carousel) }
   - `threads`: { threadPosts: [string <= 500 chars], mediaId }

#### D. Cơ chế Chấm Điểm Rubric Độc Lập (8/10+ Threshold)
Theo Acceptance Criteria R3: *"Một agent độc lập chấm 10 bài mẫu theo rubric — tối thiểu 8/10 đạt. Giá, % giảm, mã voucher, ngày hiệu lực xuất hiện trong bài khớp chính xác dữ liệu CRM (kiểm tra tự động bằng đối chiếu, không do AI tự chấm)."*

Hệ thống Rubric 5 tiêu chí (thang điểm 10):

| Tiêu chí | Điểm tối đa | Mô tả đánh giá | Phương pháp kiểm tra |
|---|:---:|---|---|
| **1. Khớp dữ liệu CRM & Đúng sự thật** | 2.0 | Toàn bộ con số (giá tiền, % giảm, mã voucher, ngày hết hạn) khớp chính xác 100% với CRM. Không bịa đặt tính năng. | **Kiểm tra tự động bằng Regex & Assert Code**: So sánh chuỗi số trong bài với database `Campaign.discountValue`, `Voucher.code`. Sai số = 0 điểm. |
| **2. Đúng Giọng Thương Hiệu (Brand Voice)** | 2.0 | Giọng trầm mặc, thanh tịnh, chữa lành; tự xưng "tụi em/Ưu Đàm"; không chứa từ cấm trong `BANNED_PHRASES`; tối đa 1–2 emoji tinh tế. | **Kiểm tra tự động + Reviewer**: Chạy `sanitizeVoice()`. Nếu phát hiện từ cấm hoặc quá 2 emoji -> trừ điểm. |
| **3. Tiếng Việt Tự Nhiên & Chính Tả** | 2.0 | Câu từ mượt mà, ngắt nhịp tự nhiên, giàu cảm xúc, không lỗi chính tả, không dùng văn dịch máy lủng củng. | Reviewer độc lập thẩm định ngữ cảnh. |
| **4. Lời Kêu Gọi Hành Động (CTA)** | 2.0 | Lời mời gọi ghé tiệm, thỉnh trà, lưu mã voucher nhẹ nhàng, ấm áp, văn minh; không hối thúc phản cảm. | Reviewer kiểm tra sự hiện diện của CTA phù hợp với kênh. |
| **5. Tuân Thủ Định Dạng Nền Tảng** | 2.0 | Độ dài ký tự nằm trong giới hạn kênh (Threads ≤ 500, TikTok ≤ 300); bài viết TikTok/Instagram có đính kèm media bắt buộc. | **Kiểm tra tự động**: `caption.length <= limit` và `Boolean(mediaUrl) === true`. |

- **Ngưỡng đạt:** Điểm tổng $\ge 8.0/10$.
- **Cổng chất lượng:** 10 bài viết mẫu ngẫu nhiên sinh ra từ các chương trình phải đạt tỷ lệ ít nhất 8/10 bài (80%) vượt qua ngưỡng này.

---

### 2.3. Cổng Xuất Bản 7 Nền Tảng (7-Platform Publishing Gateway)

#### A. Ma trận Đặc tả 7 Nền tảng

| Nền tảng | API Endpoint Thật (Real Mode) | Yêu cầu Dữ liệu & Giới hạn | Chế độ Giả lập (Mock Mode) |
|---|---|---|---|
| **1. Facebook Fanpage** | Meta Graph API v21.0<br>`POST /{page_id}/feed` hoặc `/photos` | `message` (1000–2000 ký tự), `url` ảnh hoặc `attached_media`. Token: `pageAccessToken`. | Kiểm tra schema payload, tạo ID bài viết ảo `fb_mock_post_{id}`, trả về link xem trước demo. |
| **2. Zalo OA** | Zalo Official Account OpenAPI<br>`POST /v2.0/oa/article/create` | Tiêu đề ≤ 65 ký tự, tóm tắt ≤ 120 ký tự, `cover_type: "photo"`, body dạng khối text/image. | Giả lập phản hồi `{ error: 0, message: "Success", data: { article_id: "zalo_mock_{id}" } }`. |
| **3. Website Blog (uudam.vn)** | **Lưu nội bộ vào CSDL hệ thống**<br>`POST /api/blog` (bảng `BlogPost`) | Tiêu đề H1, slug SEO duy nhất, markdown/HTML, meta title/description, ảnh đại diện. Có trang public `/blog/{slug}`. | Chạy lưu trực tiếp vào CSDL cục bộ (Real và Mock đều hiển thị được trên route công khai nội bộ qua HTTP). |
| **4. Website Ngoài (WP/Haravan/Sapo)** | - WordPress: `POST /wp-json/wp/v2/posts`<br>- Haravan: `POST /com/articles.json`<br>- Sapo: `POST /admin/blogs/{id}/articles.json` | `title`, `content` (HTML), `status: "publish"`, `categories`, `featured_media`. | Adapter giả lập sinh request REST chuẩn của WordPress v2, trả về `external_post_id: "wp_789"`. |
| **5. Instagram** | Instagram Graph API<br>`POST /{ig_user_id}/media` -> `media_publish` | **Bắt buộc có ảnh/video**. Caption ≤ 2200 ký tự (tối ưu 300–600 ký tự), 10–15 hashtags. | Xác nhận có `mediaUrl`, caption không vượt 2200 ký tự, trả về `media_id: "ig_mock_101"`. |
| **6. TikTok** | TikTok Content Posting API v2<br>`POST /v2/post/publish/video/init/` | **Bắt buộc có video hoặc photo album (9:16)**. Caption ≤ 300 ký tự, hashtags. | Kiểm tra có `videoUrl` hoặc tập ảnh, caption ≤ 300 ký tự, trả về `publish_id: "tt_mock_202"`. |
| **7. Threads** | Threads API<br>`POST /{threads_user_id}/threads` -> `threads_publish` | `media_type: "TEXT"` hoặc `"IMAGE"`. Văn bản **tối đa 500 ký tự**. | Kiểm tra nghiêm ngặt `text.length <= 500`, trả về `thread_id: "th_mock_303"`. |

#### B. Thiết kế Kiến trúc Gateway & Cơ chế Tự động Chuyển Đổi (Adapter Pattern)

```ts
export interface PublishPayload {
  platform: SocialPlatform // 'FACEBOOK' | 'ZALO_OA' | 'WEBSITE_INTERNAL' | 'WEBSITE_EXTERNAL' | 'INSTAGRAM' | 'TIKTOK' | 'THREADS'
  title: string
  content: string
  mediaUrls: string[]
  metadata?: Record<string, unknown>
}

export interface PublishResult {
  success: boolean
  platform: SocialPlatform
  postId: string
  postUrl?: string
  mode: 'REAL' | 'MOCK'
  publishedAt: string
  errorMessage?: string
}

export interface SocialPlatformAdapter {
  publish(payload: PublishPayload, credential?: Record<string, unknown> | null): Promise<PublishResult>
  validatePayload(payload: PublishPayload): { valid: boolean; errors: string[] }
}
```

- **Quy tắc chuyển đổi Real vs Mock:**
  ```ts
  const isReal = 
    isRealPublishingAllowed() && // Biến môi trường cho phép
    credential?.active === true && // Đã bật kết nối trong màn hình Kết nối API
    Boolean(credential?.config?.accessToken || credential?.config?.apiKey) && // Có token thật
    !credential?.config?.isMock // Không phải mock flag
  ```
  Khi thiếu key, token hết hạn hoặc đang trong môi trường test/dev: Gateway **tự động hạ cấp xuống chế độ Mock**, không ném exception làm gián đoạn hệ thống.

---

### 2.4. Tính Bất Biến Về An Toàn Vận Hành (Operational Safety Invariant)

#### A. Yêu cầu nghiệp vụ bắt buộc
- Trong quá trình phát triển, kiểm thử E2E và chạy lệnh tự động (`npm run verify`):
  **TUYỆT ĐỐI KHÔNG GỬI BẤT KỲ REQUEST NÀO RA CÁC MẠNG XÃ HỘI THẬT.**
- Việc đăng thật chỉ được diễn ra khi:
  1. Chủ tiệm đã xem nội dung trên giao diện Lịch nội dung.
  2. Bấm nút "Phê duyệt" (status chuyển sang `APPROVED`).
  3. Cấu hình sản xuất có cờ `ALLOW_REAL_SOCIAL_PUBLISHING=true` kèm thông tin xác thực thật được lưu trong `IntegrationCredential`.

#### B. Mô hình Phòng thủ 4 Lớp (4-Layer Defense-in-Depth)

```
[ LỚP 1: Approval State Machine Gate ]
  Post status !== 'APPROVED' hoặc Campaign status === 'ENDED'
  ---> Chặn ngay tại tầng Service, cấm đưa vào queue đăng bài.

[ LỚP 2: Publishing Gateway Environment Switch ]
  NODE_ENV === 'test' HOẶC ALLOW_REAL_SOCIAL_PUBLISHING !== 'true'
  ---> Ép 100% Adapter chạy sang Mock Mode độc lập.

[ LỚP 3: Global Network Interceptor trong Bộ Test ]
  Hook vào globalThis.fetch() trong file verify/test suite.
  Bất kỳ request nào nhắm tới domain mạng xã hội thật
  (graph.facebook.com, openapi.zalo.me, tiktokapis.com...)
  ---> Ném lỗi ngoại lệ nghiêm trọng VIOLATION_ERROR ngay lập tức!

[ LỚP 4: Mock Adapter Isolated Payload Engine ]
  Các adapter giả lập chạy 100% in-memory, mã hóa sha256 giả lập
  ID bài viết và log vào bảng Sổ Data (LedgerEntry) mà không mở socket.
```

---

### 2.5. Cơ Chế Lập Lịch & Background Worker trong Next.js 16

#### A. Hiện trạng hệ thống
- Hệ thống đang sử dụng Next.js 16 với tính năng `instrumentation.ts` đã được kích hoạt.
- Trong `src/instrumentation.ts`, server khởi chạy background engine qua `ensureEngine()` trong `src/lib/agent-engine.ts`.
- `ensureEngine()` duy trì một timer `setInterval` (tick mỗi 2.5s) lưu trên `globalThis` với khóa chống trùng lặp `g.__cmsEngineBusy`.

#### B. Thiết kế Scheduler cho AUTO SOCIAL
- Đăng ký một worker nhẹ `ensureAutoSocialScheduler()` chạy chu kỳ 30 giây (hoặc tích hợp vào tick hiện hữu).
- **Quy trình xử lý một tick:**
  1. Quét CSDL bảng `SocialPost`:
     `status === 'APPROVED' AND scheduledAt <= NOW() AND isLocked === false`
  2. Khóa lạc quan (Atomic Lock) chống race condition:
     ```ts
     const updated = await db.socialPost.updateMany({
       where: { id: post.id, status: 'APPROVED', isLocked: false },
       data: { isLocked: true }
     })
     if (updated.count === 0) continue // Bỏ qua nếu worker khác đang xử lý
     ```
  3. Kiểm tra tính hợp lệ của Chương trình (`Campaign`):
     Nếu chương trình liên kết đã bị hủy (`CANCELLED`) hoặc đã kết thúc (`ENDED`), lập tức hủy đăng bài, cập nhật `status = 'SKIPPED'` kèm lý do vào `errorLog`.
  4. Đẩy payload sang `PublishingGateway.publishPost(post)`.
  5. Cập nhật kết quả:
     - Thành công: `status = 'PUBLISHED'`, `publishedAt = NOW()`, `isLocked = false`.
     - Thất bại: `status = 'FAILED'`, `errorLog = error.message`, tăng `retryCount`, `isLocked = false`. Cho phép chủ tiệm bấm "Thử lại" trên giao diện.
  6. Ghi nhật ký vào `LedgerEntry` (scope: `'SOCIAL'`) và broadcast realtime qua socket.io event `'social.post.updated'` để cập nhật giao diện ngay lập tức.
  7. **Tính bất biến chống đăng trùng (Idempotency):** Chạy hàm 2 lần liên tiếp trong cùng 1 phút chỉ phát sinh đúng 1 lần xuất bản duy nhất.

---

## 3. TỔNG HỢP KIẾN TRÚC MÔ HÌNH DỮ LIỆU ĐỀ XUẤT (PRISMA SCHEMA EXTENSION)

Để hỗ trợ đầy đủ R1–R5 mà không làm ảnh hưởng đến dữ liệu cũ trong `db/custom.db`, kiến trúc CSDL cần bổ sung các model mới tương thích ngược:

1. **`Campaign` (Chương trình CRM):**
   - `id`, `code` (unique, ví dụ: `CT-2026-VU-LAN`), `name`, `description`
   - `startDate`, `endDate` (chặn logic `endDate <= startDate`)
   - `status`: `'UPCOMING'` (sắp chạy) | `'ACTIVE'` (đang chạy) | `'ENDED'` (đã kết thúc) | `'CANCELLED'` (đã hủy)
   - `discountType`, `discountValue`, `voucherCode` (liên kết mã voucher)
   - Quan hệ: `products` (n-n với `Product`), `socialPosts` (1-n với `SocialPost`).

2. **`DriveFolderSource` (Nguồn Google Drive):**
   - `id`, `name`, `folderUrl`, `folderId`
   - `lastSyncedAt`, `fileCount`, `status` (`'SYNCED'` | `'ERROR'`)
   - `errorMessage`, `campaignId` (liên kết chiến dịch tùy chọn)
   - Quan hệ: `assets` (1-n với `DriveAsset`).

3. **`DriveAsset` (Tài nguyên Drive đã quét):**
   - `id`, `folderSourceId`, `googleFileId`, `name`, `mimeType`, `fileType` (`'IMAGE'` | `'VIDEO'` | `'DOC'` | `'SHEET'`)
   - `size`, `driveViewUrl`, `driveDownloadUrl`, `thumbnailUrl`, `textContent` (lưu text trích xuất từ Doc/Sheet)
   - `productId` (tùy chọn liên kết trực tiếp với sản phẩm).

4. **`SocialPost` (Bài đăng đa kênh):**
   - `id`, `campaignId`, `platform` (7 nền tảng)
   - `title`, `content` (markdown/text), `contentHtml`, `mediaUrls` (JSON array các link ảnh/video)
   - `scheduledAt`, `publishedAt`
   - `status`: `'DRAFT'` (nháp) | `'PENDING_APPROVAL'` (chờ duyệt) | `'APPROVED'` (đã duyệt) | `'REJECTED'` (từ chối) | `'PUBLISHED'` (đã đăng) | `'FAILED'` (lỗi) | `'SKIPPED'` (bỏ qua do hết hạn)
   - `errorLog`, `retryCount`, `isLocked` (khóa tác vụ đăng)
   - `externalPostId`, `externalPostUrl`, `publishMode` (`'REAL'` | `'MOCK'`).

5. **`BlogPost` (Trang tin nội bộ uudam.vn):**
   - `id`, `title`, `slug` (unique), `excerpt`, `contentHtml`, `coverImage`, `published`, `publishedAt`.
   - Có public route: `src/app/blog/[slug]/page.tsx` và `src/app/api/blog/[slug]/route.ts`.

---

## 4. KẾT LUẬN & KIẾN NGHỊ BÀN GIAO

1. **Khả thi 100%:** Việc tích hợp Google Drive công khai hoàn toàn khả thi mà không cần OAuth nhờ cơ chế Zero-Key JSON extraction (`window['_DRIVE_ivd']`) kết hợp Drive API v3 (khi có Google API Key).
2. **Thư mục kiểm thử thực tế:** Đã tìm thấy và kiểm chứng thành công thư mục công khai thực tế `https://drive.google.com/drive/folders/1FYLaoscxWBV_BU5sFouf7XCrv7cKktBY` chứa các tệp PDF/tài liệu, trích xuất chính xác cấu trúc mảng JSON.
3. **Giọng thương hiệu & AI:** Dự án đã có sẵn nền tảng `src/lib/agent-voice.ts` và `src/lib/llm.ts` với đầy đủ danh mục từ cấm (`BANNED_PHRASES`) và bộ lọc "100% Anti-AI". Hệ thống Auto Social chỉ cần kế thừa và mở rộng sang đa định dạng cho 7 kênh.
4. **An toàn kiểm thử:** Mô hình phòng thủ 4 lớp bảo đảm 100% không phát sinh request ra ngoài mạng xã hội trong quá trình chạy test tự động.
