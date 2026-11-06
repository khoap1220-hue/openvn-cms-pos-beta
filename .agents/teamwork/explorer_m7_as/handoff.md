# BÁO CÁO KHẢO SÁT & KẾ HOẠCH TRIỂN KHAI MILESTONE 7 (AUTO SOCIAL)
**Hệ thống**: OPENVN · Ưu Đàm Suite  
**Người thực hiện**: Explorer M7 (`explorer_m7_as`)  
**Ngày thực hiện**: 2026-10-27  
**Mục tiêu**: Khảo sát hiện trạng UI/UX, kiểm thử máy chủ, rà soát tài liệu bàn giao và lập kế hoạch thực thi cho Milestone 7 (Worker M7, Browser Reviewer, Auditor M7).

---

## 1. Observation (Quan sát trực tiếp có bằng chứng)

### 1.1. Khảo sát các thành phần UI/UX
- **`src/components/cms/views/campaigns-view.tsx`**:
  - Lệnh kiểm tra: `view_file` / `find_by_name` trên `src/components/cms/views/`
  - Kết quả: **TỆP CHƯA TỒN TẠI** (`The system cannot find the file specified`).
  - Đánh giá: Phân hệ giao diện quản trị Chiến dịch CRM cần được Worker M7 xây dựng mới.

- **`src/components/cms/views/auto-social-view.tsx`**:
  - Lệnh kiểm tra: `view_file` / `find_by_name` trên `src/components/cms/views/`
  - Kết quả: **TỆP CHƯA TỒN TẠI** (`The system cannot find the file specified`).
  - Đánh giá: Phân hệ giao diện quản trị Auto Social (Google Drive, AI Planning, Calendar Review, 7 Platforms) cần được Worker M7 xây dựng mới.

- **`src/components/cms/app-sidebar.tsx`** (CMS Sidebar Navigation):
  - Kiểm tra dòng 46–67: `ViewId` kiểu liên hiệp hiện tại gồm 20 view (`pos`, `liveops`, `orders`, `inbox`, `shipments`, `products`, `inventory`, `channels`, `customers`, `dashboard`, `reports`, `autopilot`, `accounting`, `bom`, `partners`, `purchase`, `sales`, `ledger`, `integrations`, `system`). Chưa có `'campaigns'` và `'auto-social'`.
  - Kiểm tra dòng 75–111: Các nhóm điều hướng `NAV_OVERVIEW`, `NAV_SALES`, `NAV_CATALOG`, `NAV_CRM`, `NAV_FINANCE`, `NAV_SYSTEM` chưa có mục chọn cho Campaigns và Auto Social.

- **`src/app/page.tsx`** (CMS Main View Routing):
  - Kiểm tra dòng 55–76: `VIEW_LABELS` chưa khai báo nhãn hiển thị cho `'campaigns'` và `'auto-social'`.
  - Kiểm tra dòng 366–386: Khối chuyển mạch `activeView` trong `<main>` chưa import và chưa render `<CampaignsView />` hoặc `<AutoSocialView />`.

- **`src/app/blog/page.tsx` & `src/app/blog/[slug]/page.tsx`** (Public Blog Route):
  - Kiểm tra `src/app/blog/page.tsx`: **ĐÃ TỒN TẠI VÀ HOÀN CHỈNH** (217 dòng). Sử dụng `db.socialPost.findMany({ where: { channel: 'WEBSITE', status: 'PUBLISHED' } })`, giao diện tone màu `#faf8f5`, typography font serif/sans trang nhã, thẻ Card, responsive grid 1/2/3 cột, có trạng thái trống và link điều hướng.
  - Kiểm tra `src/app/blog/[slug]/page.tsx`: **ĐÃ TỒN TẠI VÀ HOÀN CHỈNH** (268 dòng). Tuân thủ Next.js 16 App Router với `params: Promise<{ slug: string }>`, tự động sinh SEO metadata động qua `generateMetadata`, parse media/hashtags an toàn, breadcrumbs, hiển thị đẹp mắt.

### 1.2. Kiểm tra trạng thái máy chủ Next.js và phản hồi Endpoints
- **Trạng thái cổng 3010**:
  - Lệnh thực thi: `Get-NetTCPConnection -LocalPort 3010`
  - Kết quả: Cổng 3010 đang `Listen` với `OwningProcess: 7456` (PID 7456).
- **Phản hồi HTTP `/blog`**:
  - Lệnh thực thi: `curl.exe -s -o NUL -w "%{http_code}\n" http://localhost:3010/blog`
  - Kết quả: `HTTP status: 200` (OK).
- **Phản hồi HTTP `/api/campaigns`**:
  - Lệnh thực thi: `curl.exe -s -w "\nHTTP status: %{http_code}\n" http://localhost:3010/api/campaigns`
  - Kết quả: `{"campaigns":[],"total":0,"page":1,"pageSize":20}`, `HTTP status: 200` (OK).

### 1.3. Trạng thái Backend APIs của Auto Social
Tất cả các API Route cần thiết cho Auto Social đều đã được xây dựng và sẵn sàng:
1. `src/app/api/campaigns/route.ts`: CRUD chiến dịch, lọc trạng thái động, phân trang, xác thực `endDate > startDate`.
2. `src/app/api/campaigns/[id]/route.ts`: Chi tiết, cập nhật và xóa chiến dịch.
3. `src/app/api/social/drive/route.ts`: Quản lý và kích hoạt đồng bộ Drive.
4. `src/app/api/social/ai-plan/route.ts`: AI lên kế hoạch và sinh bài viết nháp.
5. `src/app/api/social/posts/route.ts`: Danh sách và tạo bài viết mạng xã hội.
6. `src/app/api/social/posts/[id]/route.ts`: Duyệt bài (`APPROVE`), từ chối (`REJECT`), đổi giờ (`RESCHEDULE`), thử lại (`RETRY`), đăng ngay (`PUBLISH`).
7. `src/app/api/social/publish/route.ts`: Kích hoạt bộ xuất bản đa kênh.
8. `src/app/api/social/schedule/route.ts`: Background runner quét và xuất bản các bài viết tới hạn.

### 1.4. Trạng thái chất lượng mã nguồn & CSDL hiện tại
- `npx tsc --noEmit`: Exit code `0`, **0 errors**.
- `npm run lint`: Exit code `0`, **0 warnings / 0 errors**.
- `node check-counts.mjs`: **24/24 Core Business Tables 100% MATCH (PASS)**, Delta = 0.
- Cơ sở dữ liệu hiện có 1 nguồn Drive và 5 bài viết test (chế độ an toàn).

### 1.5. Khảo sát hiện trạng tài liệu (Documentation)
- **`docs/FEATURE_EXPERIENCE_MATRIX.md`**:
  - Hiện tại chỉ có 19 phân hệ của đợt 1 (P1 + P2).
  - Chưa có bảng trải nghiệm cho các tính năng của AUTO SOCIAL (Chiến dịch CRM, Google Drive, AI Copywriting, Review & Approval, 7-Platform Publisher, Blog công khai, UI Auto Social).
  - Cần bổ sung các mục từ STT 20 đến 26 và cập nhật phần tổng kết.
- **`docs/RELEASE_CHECKLIST.md`**:
  - Bản hiện tại chỉ phản ánh nghiệm thu Milestone M7 đợt 1 (ngày 2026-10-26).
  - Chưa có mục kiểm tra bộ test `scripts/verify-auto-social.ts` (113 assertions).
  - Chưa ghi nhận đường dẫn thư mục Google Drive công khai dùng cho kiểm thử: `https://drive.google.com/drive/folders/1FYLaoscxWBV_BU5sFouf7XCrv7cKktBY`.
  - Chưa có phần checklist cho 7 nền tảng, AI rubric, blog và UI responsive audit của Auto Social.
- **`MATRIX_HANDOFF.md`**:
  - Mục 1 (Điểm truy cập dịch vụ): Chưa có endpoint Blog công khai `http://localhost:3010/blog`.
  - Mục 2 (Kiến trúc API): Cần bổ sung mục 2.10 (Phân hệ Chương trình CRM) và 2.11 (Module Auto Social & 7 Nền Tảng).
  - Mục 4 (Hướng dẫn vận hành): Cần bổ sung lệnh chạy test Auto Social: `npm run test:autosocial` / `node --experimental-strip-types scripts/verify-auto-social.ts`.
  - Cần ghi nhận rõ ràng link Google Drive công khai kiểm thử: `https://drive.google.com/drive/folders/1FYLaoscxWBV_BU5sFouf7XCrv7cKktBY`.

---

## 2. Logic Chain (Chuỗi lập luận từ quan sát đến kết luận)

1. **Từ Quan sát 1.1**: Backend và API của Campaigns và Auto Social đã hoạt động 100% (M1–M6 pass), nhưng các tệp giao diện `campaigns-view.tsx` và `auto-social-view.tsx` chưa được tạo, đồng thời Sidebar và Page Router chưa liên kết view. Do đó, trọng tâm xây dựng của Milestone 7 là hoàn thiện 2 view này theo chuẩn giao diện OPENVN (shadcn/ui, Tailwind, responsive Desktop + Mobile 390px).
2. **Từ Quan sát 1.2 & 1.3**: Dev server Next.js 16 trên cổng 3010 đang hoạt động ổn định. Tuyến `/blog` và `/api/campaigns` đều trả về HTTP 200. Điều này chứng minh hệ thống đã sẵn sàng đón nhận giao diện mới mà không gặp trở ngại về hạ tầng server.
3. **Từ Quan sát 1.4**: Toàn bộ hệ thống đang sạch lỗi TypeScript (0 errors), sạch linter (0 warnings), và 24 bảng dữ liệu cốt lõi khớp 100% với baseline. Mọi thay đổi UI mới phải bảo đảm tuyệt đối tuân thủ TypeScript, không gây hydration error, và không làm biến động dữ liệu cốt lõi ngoài phạm vi cho phép.
4. **Từ Quan sát 1.5**: Cả 3 tài liệu quan trọng (`FEATURE_EXPERIENCE_MATRIX.md`, `RELEASE_CHECKLIST.md`, `MATRIX_HANDOFF.md`) đều đang ở trạng thái của đợt 1. Để đạt chuẩn nghiệm thu (Acceptance Criteria R7), Worker M7 cần cập nhật toàn diện cả 3 tài liệu này, phản ánh đầy đủ module AUTO SOCIAL và ghi nhận đường dẫn Google Drive công khai theo đúng quy định.
5. **Về quy trình kiểm định**: Để đảm bảo nguyên tắc kiểm định độc lập (không do agent viết code tự chấm), cần phân chia rõ 3 vai trò:
   - **Worker M7**: Tạo 2 view UI, tích hợp sidebar/router, cập nhật 3 file tài liệu.
   - **Browser Reviewer**: Mở trình duyệt thật (Chrome DevTools / agent-browser), thực hiện luồng thao tác đầy đủ trên desktop và mobile 390px, chụp ảnh màn hình làm bằng chứng, xác nhận 0 console error và không tràn ngang.
   - **Auditor M7**: Chạy lại master verify suite, đối soát CSDL baseline, kiểm tra tính toàn vẹn và cấp chứng chỉ phát hành.

---

## 3. Caveats (Các điểm cần lưu ý & Giả định)

1. **Tránh xung đột SQLite song song**: Tuyệt đối không để nhiều agent chạy song song các script ghi đè/test trên cùng file `db/custom.db` để tránh lỗi khóa SQLite (`SQLITE_BUSY`).
2. **Cô lập mạng xã hội thật (R6 Invariant)**: Bộ test và giao diện mặc định luôn chạy ở chế độ giả lập an toàn (`Safe Mock Mode`), không gửi request ra các nền tảng thật (Facebook, TikTok...) khi chưa có key của chủ tiệm.
3. **Viewport 390px trên Mobile**: Mọi bảng dữ liệu trong view mới phải được bao bọc trong `overflow-x-auto` để đảm bảo không bị tràn trang ngang (no horizontal page overflow) khi kiểm thử ở màn hình 390px (iPhone 12/13/14 Pro).
4. **Next.js 16 Client Component Directive**: Cả `campaigns-view.tsx` và `auto-social-view.tsx` phải có `'use client'` ở đầu file do sử dụng React hooks (`useState`, `useEffect`, `useCallback`, `useToast`).

---

## 4. Conclusion & Concrete Plan for Milestone 7 (Kết luận & Kế hoạch hành động)

### 4.1. Nhiệm vụ của Worker M7 (`worker_m7_as`)

#### Bước 1: Xây dựng `src/components/cms/views/campaigns-view.tsx`
- **Chức năng**:
  - Header: Tiêu đề "Chương trình & Khuyến mãi (CRM)", nút "Làm mới", nút "Tạo chương trình".
  - Thẻ thống kê: Tổng chiến dịch, Đang diễn ra (`RUNNING`), Sắp diễn ra (`UPCOMING`), Đã kết thúc / Hủy (`ENDED`/`CANCELLED`).
  - Thanh lọc & Tìm kiếm: Tab trạng thái (Tất cả, Đang chạy, Sắp chạy, Kết thúc), ô tìm kiếm theo tên/mã.
  - Bảng danh sách chiến dịch: Mã, Tên, Ngày bắt đầu - kết thúc, Badge trạng thái thời gian thực, Số sản phẩm & voucher áp dụng.
  - Modal tạo/sửa chiến dịch: Form nhập Tên, Mã, Ngày bắt đầu, Ngày kết thúc (validate `endDate > startDate`), chọn sản phẩm liên kết (`/api/products`), chọn voucher (`/api/vouchers`).
  - Thao tác: Sửa, Xóa, Huỷ chiến dịch, Nút chuyển nhanh sang tạo bài Auto Social.
  - Tối ưu Responsive: Khối bảng cuộn ngang, bố cục thẻ stack trên mobile 390px.

#### Bước 2: Xây dựng `src/components/cms/views/auto-social-view.tsx`
- **Chức năng** (Thiết kế 4 Tab chuyên nghiệp):
  - **Tab 1: Nguồn Drive (`Drive Sources`)**:
    - Form kết nối Drive công khai: Input URL (`https://drive.google.com/drive/folders/1FYLaoscxWBV_BU5sFouf7XCrv7cKktBY`), Tên nguồn, Chọn chiến dịch liên kết.
    - Nút "Đồng bộ thư mục Drive" (gọi `POST /api/social/drive`, hiển thị trạng thái loading).
    - Danh sách nguồn đã đồng bộ: Thẻ hiển thị số lượng file, cây thư mục, trích xuất văn bản Google Docs/Sheets, hình ảnh/video.
  - **Tab 2: Lên Kế Hoạch AI (`AI Planning`)**:
    - Bộ chọn Chiến dịch CRM (`/api/campaigns`).
    - Bộ chọn Nguồn Drive (`/api/social/drive`).
    - Chọn các nền tảng (Facebook, Zalo OA, Website Blog, Instagram, TikTok, Threads, External CMS).
    - Cấu hình số lượng bài viết, yêu cầu văn phong bổ sung.
    - Nút "AI Tạo Kế Hoạch & Viết Bài" (`POST /api/social/ai-plan`).
    - Bảng hiển thị kế hoạch bài viết: Đối chiếu số liệu CRM (giá, giảm giá, voucher), nhãn nguồn sinh (LLM vs Template).
  - **Tab 3: Lịch & Duyệt Bài Đăng (`Calendar & Review`)**:
    - Bộ lọc bài viết theo Kênh, theo Trạng thái (`DRAFT`, `PENDING_APPROVAL`, `APPROVED`, `SCHEDULED`, `PUBLISHED`, `FAILED`, `REJECTED`).
    - Thẻ chi tiết bài viết: Channel Badge, Nội dung trích dẫn, Xem trước Media (ảnh/video), Badge nguồn sinh AI.
    - Hành động chủ tiệm: "Duyệt bài" (`APPROVE`), "Từ chối" (`REJECT` có lý do), "Đổi giờ" (`RESCHEDULE`), "Đăng ngay" (`PUBLISH`), "Thử lại" (`RETRY`).
  - **Tab 4: Cổng Xuất Bản 7 Nền Tảng & An Toàn (`Publishing Gateway`)**:
    - Trạng thái 7 nền tảng (Facebook, Zalo OA, Website Blog `/blog`, Web ngoài, Instagram, TikTok, Threads).
    - Chỉ báo an toàn: Safe Mock Mode (0 external calls), cơ chế chặn đăng bài tự động khi test.
    - Nút kích hoạt kiểm tra lịch đăng (`POST /api/social/schedule`).
  - Tối ưu Responsive: Tab cuộn ngang, giao diện mượt mà trên cả Desktop 1440px và Mobile 390px.

#### Bước 3: Tích hợp Sidebar Navigation & Router
- Trong `src/components/cms/app-sidebar.tsx`:
  - Thêm `'campaigns'` và `'auto-social'` vào `ViewId`.
  - Import icon `Megaphone` (hoặc `Sparkles`) và `Share2` từ `lucide-react`.
  - Bổ sung vào danh mục `NAV_CRM`:
    - `{ id: 'campaigns', label: 'Chương trình & Khuyến mãi', icon: Megaphone }`
    - `{ id: 'auto-social', label: 'Auto Social & Lịch AI', icon: Share2 }`
- Trong `src/app/page.tsx`:
  - Thêm nhãn vào `VIEW_LABELS`:
    - `campaigns: 'Chương trình & Khuyến mãi (CRM)'`
    - `'auto-social': 'Auto Social — Tiếp thị AI & Lịch Đăng'`
  - Import `CampaignsView` và `AutoSocialView`.
  - Thêm điều kiện render trong thẻ `<main>`:
    - `{activeView === 'campaigns' && <CampaignsView />}`
    - `{activeView === 'auto-social' && <AutoSocialView />}`

#### Bước 4: Cập nhật toàn diện bộ tài liệu dự án
- **`docs/FEATURE_EXPERIENCE_MATRIX.md`**:
  - Bổ sung các tính năng từ STT 20 đến 26 cho AUTO SOCIAL (Campaigns CRM, Drive Ingestion, AI Copywriter, Review & Scheduling, 7 Platforms, Public Blog, UI Views).
  - Ghi nhận đầy đủ URL Drive kiểm thử: `https://drive.google.com/drive/folders/1FYLaoscxWBV_BU5sFouf7XCrv7cKktBY`.
  - Đánh dấu 100% Hoàn Thành (🟢 Đạt).
- **`docs/RELEASE_CHECKLIST.md`**:
  - Bổ sung phần kiểm tra chất lượng cho Auto Social E2E Master Suite (`scripts/verify-auto-social.ts` - 113 assertions).
  - Bổ sung checklist 7 nền tảng, AI rubric, kiểm tra cô lập mạng an toàn, đối soát CSDL không rò rỉ, và đường dẫn Drive công khai.
- **`MATRIX_HANDOFF.md`**:
  - Bổ sung điểm truy cập Blog công khai `/blog` và `/blog/[slug]`.
  - Bổ sung tài liệu API mục 2.10 (Campaigns) và 2.11 (Auto Social).
  - Ghi nhận hướng dẫn kiểm thử tự động `npm run test:autosocial`.
  - Tài liệu hóa đường dẫn Drive công khai: `https://drive.google.com/drive/folders/1FYLaoscxWBV_BU5sFouf7XCrv7cKktBY`.

---

### 4.2. Nhiệm vụ của Browser Reviewer (`browser_reviewer_m7`)
1. Sử dụng công cụ kiểm thử trình duyệt độc lập (Chrome DevTools MCP / agent-browser).
2. Kiểm tra giao diện Desktop (Viewport 1440x900):
   - Mở `http://localhost:3010`, click điều hướng sang tab "Chương trình & Khuyến mãi" -> xác nhận bảng danh sách, mở modal tạo chiến dịch.
   - Click điều hướng sang tab "Auto Social & Lịch AI" -> xác nhận 4 tab hoạt động trơn tru (Nguồn Drive, Lên kế hoạch AI, Duyệt bài, Cổng xuất bản).
   - Kiểm tra luồng tạo chiến dịch -> đồng bộ Drive -> AI sinh kế hoạch -> duyệt bài -> đăng bài giả lập.
   - Mở `http://localhost:3010/blog` và `http://localhost:3010/blog/[slug]` -> xác nhận bài viết hiển thị đẹp mắt, phong cách Ưu Đàm.
3. Kiểm tra giao diện Mobile (Viewport 390x844 — iPhone 12/13/14 Pro):
   - Mở các view trên màn hình mobile 390px.
   - Xác nhận: **0 lỗi console**, **0 hiện tượng tràn ngang màn hình** (`no horizontal overflow`).
4. Chụp và lưu ảnh màn hình bằng chứng vào thư mục dự án (`docs/screenshots/` hoặc `.agents/teamwork/browser_reviewer_m7/`).

---

### 4.3. Nhiệm vụ của Auditor M7 (`auditor_m7_as`)
1. Chạy toàn bộ cổng kiểm tra tĩnh và kiểm thử:
   - `npx tsc --noEmit` (0 errors)
   - `npm run lint` (0 warnings / 0 errors)
   - `npm run verify` (chạy test:chain, test:scenarios, test:autosocial)
   - `npm run build` (Next.js 16 standalone build thành công)
2. Kiểm tra toàn vẹn CSDL:
   - `node check-counts.mjs` -> xác nhận 24 bảng cốt lõi 100% MATCH (Delta = 0).
   - Xác nhận dữ liệu test tạm thời đã được dọn sạch sẽ.
3. Quét mã nguồn kiểm tra rò rỉ bí mật / API key / hardcoded secret.
4. Cấp chứng nhận phê duyệt phát hành thương mại (100% Release Ready).

---

## 5. Verification Method (Phương pháp kiểm chứng độc lập)

Để độc lập kiểm chứng báo cáo này, thực hiện các lệnh sau trong thư mục gốc:

```bash
# 1. Kiểm tra trạng thái cổng máy chủ Next.js
powershell -Command "Get-NetTCPConnection -LocalPort 3010 | Format-Table -AutoSize"

# 2. Kiểm tra phản hồi HTTP các tuyến đường Auto Social
curl.exe -s -o NUL -w "Blog status: %{http_code}\n" http://localhost:3010/blog
curl.exe -s -w "\nCampaigns status: %{http_code}\n" http://localhost:3010/api/campaigns

# 3. Kiểm tra kiểu tĩnh và cú pháp
npx tsc --noEmit
npm run lint

# 4. Kiểm tra đối soát 24 bảng CSDL cốt lõi
node check-counts.mjs

# 5. Kiểm tra sự tồn tại của các view (trước khi Worker triển khai)
powershell -Command "Test-Path src/components/cms/views/campaigns-view.tsx; Test-Path src/components/cms/views/auto-social-view.tsx"
```

**Điều kiện vô hiệu hóa (Invalidation Conditions)**:
- Nếu cổng 3010 bị dừng hoặc trả về mã lỗi 500 khi truy cập `/blog` hoặc `/api/campaigns`.
- Nếu có file `campaigns-view.tsx` hoặc `auto-social-view.tsx` đã tồn tại trước đó mà báo cáo ghi nhận là thiếu.
- Nếu `tsc` hoặc `eslint` phát sinh lỗi.
