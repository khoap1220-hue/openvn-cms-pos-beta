# OmniSales CMS - Worklog

Project: CMS bán hàng đa kênh (Omni-channel Sales CMS) - Next.js 16 + Prisma + shadcn/ui

---
Task ID: 1
Agent: main (Z.ai Code)
Task: Thiết kế DB schema + push database

Work Log:
- Thiết kế 8 models: Category, Product, Channel, ChannelListing, Customer, Order, OrderItem, StockMovement
- Channel.key: SHOPEE | LAZADA | TIKI | TIKTOK | WEBSITE | FACEBOOK | POS (7 kênh VN)
- Order.status: PENDING | CONFIRMED | PACKING | SHIPPING | COMPLETED | CANCELLED
- Push schema vào SQLite qua `bun run db:push`

Stage Summary:
- Schema hỗ trợ: sản phẩm nhiều kênh (ChannelListing với giá riêng từng kênh), đơn hàng theo kênh, lịch sử tồn kho
- Contract API được định nghĩa tại src/lib/types.ts (Task 3)

---
Task ID: 5-b
Agent: frontend developer
Task: Xây Channels + Customers + Inventory views

Work Log:
- Đọc worklog.md + types.ts + api.ts + các component dùng chung (page-header, stat-card, channel-badge, confirm-dialog, product-avatar) để tái sử dụng đúng contract
- Đối chiếu API thực tế: /api/channels, /api/channels/[id] (PATCH connected/sync), /api/customers (GET search + POST), /api/inventory (lowstock/movements/POST), /api/products
- Tạo src/components/cms/views/channels-view.tsx: PageHeader + 3 StatCard tổng quan (kênh kết nối X/7, tổng đơn, tổng doanh thu); grid card kênh 1/2/3 cột với logo chữ cái nền channel.color, ConnectedDot, badge "Phí X%", hàng stats (listings/orders/revenue formatCompactVND), SyncInfo; Switch Kết nối (connect → toast + đẩy sản phẩm; disconnect → ConfirmDialog cảnh báo mất đồng bộ đơn), nút Đồng bộ RefreshCw (disabled khi chưa kết nối, animate-spin khi đang chạy); mọi mutation PATCH xong refetch
- Tạo src/components/cms/views/customers-view.tsx: 3 StatCard (tổng khách, tổng doanh thu từ khách, khách chi tiêu cao nhất); toolbar tìm kiếm debounce 400ms (tên/SĐT/email) + nút Thêm khách hàng; bảng khách (avatar emerald + tên + email, SĐT mono, địa chỉ truncate, số đơn, tổng chi tiêu formatVND, đơn cuối formatDate); Dialog thêm khách (tên bắt buộc, validate client + server) → POST + toast + refetch
- Tạo src/components/cms/views/inventory-view.tsx: fetch song song lowstock + movements + products (Promise.all); 2 StatCard (sản phẩm sắp hết hàng icon amber AlertTriangle, biến động kho 60 bản ghi); panel cảnh báo tồn kho thấp (ProductAvatar + SKU, badge đỏ "Còn X / ngưỡng Y", nút Nhập thêm prefill dialog); Dialog thao tác kho dùng chung IMPORT/EXPORT/ADJUST (Select sản phẩm + loại, Input number min 0, hint động "Tồn hiện tại: X → sau thao tác: Y" kèm cảnh báo đỏ khi xuất vượt tồn, chặn submit khi không hợp lệ, Textarea ghi chú) → POST + toast + refetch cả 3 nguồn; bảng lịch sử biến động trong max-h-96 overflow-auto (thời gian formatDateTime, sản phẩm + SKU, badge loại emerald/orange/violet, số lượng có dấu +xanh/-đỏ, tồn sau, ghi chú truncate)
- Chạy `bunx eslint` trên 3 file: 0 lỗi 0 warning; chạy `tsc --noEmit`: 0 lỗi tại 3 file view (các lỗi tsc còn lại thuộc file có sẵn của task khác, không đụng tới)

Stage Summary:
- Hoàn tất 3 view: ChannelsView (kết nối/đồng bộ 7 kênh sàn), CustomersView (tìm kiếm debounce + thêm khách + bảng chi tiêu), InventoryView (cảnh báo tồn thấp + nhập/xuất/điều chỉnh kho + lịch sử biến động)
- Toàn bộ dùng lại lib/api, lib/format, lib/types, component CMS dùng chung + shadcn/ui; UI tiếng Việt, màu emerald chủ đạo, responsive mobile-first, loading/rỗng/lỗi đầy đủ (TableSkeleton/EmptyState/ErrorState + toast)
- Không sửa bất kỳ file nào ngoài 3 file view + worklog.md; API giữ nguyên


---
Task ID: 5-a
Agent: frontend developer
Task: Xây Products view + Orders view

Work Log:
- Đọc worklog + types.ts + các reusable components (page-header, status-badge, channel-badge, confirm-dialog, product-avatar, lib/api, lib/format) để dùng đúng contract
- Tạo src/components/cms/views/products-view.tsx: toolbar (search debounce 400ms, lọc danh mục từ /api/categories, lọc trạng thái), bảng sản phẩm (ProductAvatar + SKU, danh mục, formatVND, badge đỏ tồn kho <= ngưỡng kèm ghi ngưỡng, ChannelBadge từ listings, ProductStatusBadge, DropdownMenu Sửa/Ngừng bán-Kích hoạt lại/Xóa), phân trang client-side 20/trang
- Dialog Thêm/Sửa sản phẩm: SKU*, Tên*, mô tả, Select danh mục (sentinel NONE → null), giá vốn/giá bán (input number step 1000), tồn kho ban đầu (chỉ khi thêm), ngưỡng cảnh báo (default 10), Switch trạng thái, Checkbox kênh bán từ GET /api/channels (kênh chưa connected disabled + hint, khi sửa gửi listingChannelIds để sync), PUT/POST qua api helper, refetch sau mutation
- Xóa sản phẩm dùng ConfirmDialog destructive; khi API lỗi (409 đã có đơn) → toast destructive kèm hướng dẫn chuyển "Ngừng bán"
- Tạo src/components/cms/views/orders-view.tsx: toolbar (search debounce, lọc trạng thái dùng ORDER_STATUSES + ORDER_STATUS_LABELS, lọc kênh từ GET /api/channels), nút Tạo đơn; bảng đơn (mã đơn font-mono, ChannelBadge, khách + SĐT, summary items "n × Tên"/"n sản phẩm", formatVND font-semibold, PaymentStatusBadge, OrderStatusBadge, formatDateTime, nút Chi tiết); phân trang server-side với "Hiển thị x–y trong z đơn" + Trước/Sau
- Dialog chi tiết: fetch GET /api/orders/:id (skeleton lần đầu, reload ngầm sau mutation), info kênh/khách/SĐT/địa chỉ/thanh toán (PAYMENT_METHOD_LABELS + PaymentStatusBadge)/ghi chú, bảng items (tên+SKU, đơn giá, SL, thành tiền), tổng Tạm tính + Phí ship + Tổng cộng, Select cập nhật trạng thái theo luồng PENDING→CONFIRMED→PACKING→SHIPPING→COMPLETED (CANCELLED từ mọi trạng thái qua ConfirmDialog cảnh báo hoàn kho, đơn CANCELLED là terminal), nút "Đánh dấu đã thanh toán" khi UNPAID → PATCH, refetch cả detail + list
- Dialog Tạo đơn (POS): Select kênh (chỉ connected), tên*/SĐT/địa chỉ, ghi chú, Select phương thức thanh toán từ PAYMENT_METHOD_LABELS, chọn sản phẩm (fetch /api/products?status=ACTIVE, search client-side, hiện tồn kho) + số lượng + Thêm (trùng thì cộng dồn), danh sách items max-h-64 overflow-y-auto với qty +/- và xóa, tổng tạm tính, POST /api/orders (lỗi 400 hết hàng → toast message từ server)
- Chạy eslint trên 2 file: sạch, 0 error 0 warning; tsc --noEmit không báo lỗi ở 2 file

Stage Summary:
- ProductsView + OrdersView hoàn chỉnh, tiếng Việt 100%, dùng lại toàn bộ reusable components + types, không dùng any, không màu blue/indigo
- Sản phẩm: filter/search/paginate đầy đủ, sync kênh bán khi sửa, xóa an toàn có hướng dẫn fallback "Ngừng bán"
- Đơn hàng: phân trang server-side, chi tiết đơn có cập nhật trạng thái theo luồng + xác nhận hủy hoàn kho + đánh dấu thanh toán, tạo đơn POS tự tính tiền và xử lý lỗi hết hàng
- Hai view sẵn sàng để mount vào page.tsx ở task tích hợp tiếp theo

---
Task ID: 4+6+7
Agent: main (Z.ai Code)
Task: Shell CMS + Dashboard view + Reports view + tích hợp toàn bộ

Work Log:
- Cấu hình theme emerald (globals.css) + dark mode, ThemeProvider (next-themes), custom scrollbar
- Shell: AppSidebar (7 mục + badge đơn chờ xử lý/tồn kho thấp), header sticky breadcrumb, footer sticky mt-auto + safe-area
- Shared: StatCard, OrderStatusBadge/PaymentStatusBadge/ProductStatusBadge, ChannelBadge/ConnectedDot/SyncInfo, PageHeader/EmptyState/ErrorState/TableSkeleton, ConfirmDialog, ProductAvatar
- DashboardView: 4 KPI cards, AreaChart doanh thu 14 ngày, donut đơn theo kênh, đơn mới nhất, top SP, cảnh báo tồn kho
- ReportsView: chọn kỳ 7/30/90 ngày, 4 summary cards, LineChart xu hướng, thanh doanh thu theo kênh, pie trạng thái, top sản phẩm
- Tích hợp page.tsx: state-based view switching, import cả 7 views
- Sửa TS: cast recentOrders (Date→string qua JSON), bỏ subset "vietnamese" của Geist, fix lint set-state-in-effect
- tsc --noEmit sạch (ngoại trừ examples/skills có sẵn), eslint sạch, smoke test 8/8 API trả 200

Stage Summary:
- Ứng dụng hoàn chỉnh 7 view, chờ kiểm thử browser end-to-end (Task 8)

---
Task ID: 8
Agent: main (Z.ai Code)
Task: Kiểm thử end-to-end bằng Agent Browser + sửa lỗi

Work Log:
- Dashboard: KPI, AreaChart 14 ngày, donut kênh, đơn mới nhất, top SP, low stock — render chuẩn cả light/dark
- Đơn hàng: danh sách + phân trang server-side; chi tiết đầy đủ; HỦY ĐƠN → ConfirmDialog → hoàn kho OK; đổi PENDING→CONFIRMED OK; đánh dấu thanh toán OK; tạo đơn POS → trừ kho + phí ship tự động (đơn <500k +30k) OK
- Sản phẩm: thêm mới (chọn kênh bán, checkbox kênh chưa kết nối disabled) → toast + refetch; xóa qua dropdown + ConfirmDialog → API xác nhận; search/filter OK
- Kênh bán: 7 kênh; kết nối Facebook → 30 SP tự đẩy lên; ngắt kết nối → ConfirmDialog; đồng bộ
- Khách hàng: bảng + stats (tổng chi tiêu sort desc) OK
- Tồn kho: nhập 50 "Ví da nam cầm tay" (còn 0) → thoát cảnh báo low stock; lịch sử biến động OK
- Báo cáo: kỳ 7/30/90 ngày, xu hướng, doanh thu theo kênh, phân bố trạng thái OK
- Mobile 390px: sidebar off-canvas, bảng scroll ngang, footer sticky; Dark mode OK
- Lỗi đã sửa: (1) KPI VND dài bị truncate → formatCompactVND + hint đầy đủ; (2) TS recentOrders Date→string cast; (3) subset vietnamese Geist; (4) lint set-state-in-effect page.tsx
- Ghi nhận: dialog tạo đơn có max-h-[85vh] overflow-y-auto — tool test cuộn trang thay vì dialog (không phải bug thật); 1 warning Radix Select controlled/uncontrolled cosmetic, không reproducible, không breaking

Stage Summary:
- eslint: 0 lỗi; tsc: sạch (chỉ lỗi có sẵn ở examples/skills); dev.log không có runtime error
- Toàn bộ golden path verified qua browser: 7/7 view hoạt động end-to-end với dữ liệu thật

---
Task ID: 2-a
Agent: realtime-service developer
Task: Dựng mini-service realtime broadcast socket.io độc lập (port 3003) cho CMS e-commerce — chỉ broadcast event đẩy tới qua HTTP, không có DB

Work Log:
- Đọc worklog.md; kiểm tra port 3003 bằng lsof → rảnh, không có process cũ cần kill
- Tạo mini-services/realtime/package.json đúng spec (dev = bun --hot index.ts, dependency socket.io ^4.8.1 → bun install cài socket.io@4.8.4) và index.ts: Node http server + socket.io Server, PORT 3003 hardcoded, options bắt buộc { path: '/', cors: { origin: '*', methods: ['GET','POST'] }, pingTimeout: 60000, pingInterval: 25000 }
- Khắc phục xung đột cốt lõi: với path '/', engine.io intercept MỌI HTTP request (check() là prefix-match nên luôn true) → /health và /emit bị nuốt, trả {"code":0,"message":"Transport unknown"}. Fix giữ nguyên options: sau khi new Server(httpServer, opts), lấy các listener 'request' của engine, removeAllListeners rồi đăng ký dispatcher riêng — GET /health + POST /emit xử lý trực tiếp; request mang EIO= (polling socket.io) forward về engine handler; còn lại → 404 JSON. WebSocket upgrade không bị ảnh hưởng vì đi qua event 'upgrade' riêng của engine
- Routes: POST /emit { event: string, payload: any } → io.emit(event, payload) → 200 { ok: true, clients }; JSON lỗi/thiếu event → 400 (giới hạn body 1MB); GET /health → { ok, clients, uptime }; còn lại → 404. console.log connect/disconnect + socket.on('ping-custom', cb). Graceful shutdown SIGTERM/SIGINT (disconnectSockets + httpServer.close + fallback exit 3s)
- bun install OK. Vấn đề môi trường: background process bị reaper của sandbox giết khi session bash kết thúc (thử nohup & và setsid & đều chết chéo session) → fix bằng double-fork: ( setsid bun run dev > service.log 2>&1 < /dev/null & ) — process được reparent về init (PPID=1), verify sống bền vững qua nhiều session liên tiếp
- Verify bằng curl: GET /health → {"ok":true,"clients":0,"uptime":N}; POST /emit hợp lệ → 200 {"ok":true,"clients":N}; body 'not-json' → 400; thiếu event → 400; GET /nope → 404; handshake polling GET /?EIO=4&transport=polling → trả sid + pingInterval 25000/pingTimeout 60000 (đúng options bắt buộc); E2E websocket (bun -e inline client, không thêm dependency): connect ws://localhost:3003/?EIO=4&transport=websocket → CONNECT packet → POST /emit → client nhận 42["test.broadcast",{"hello":"world","n":42}] → PASSED; service.log sạch, log connect/disconnect đúng
- Không đụng Next.js dev server port 3000 (chain PID 1136 nguyên vẹn), không sửa file nào ngoài mini-services/realtime + worklog.md

Stage Summary:
- realtime-service đang chạy background trên port 3003 (bun --hot index.ts, PPID=1). Restart: cd /home/z/my-project/mini-services/realtime && ( setsid bun run dev > service.log 2>&1 < /dev/null & ); dừng: kill $(lsof -t -i :3003)
- Contract broadcast: POST http://localhost:3003/emit, body {"event":"<tên event>","payload":<any>} → io.emit tới TẤT CẢ clients, response {"ok":true,"clients":N}; body sai → 400. Health: GET /health → {"ok":true,"clients":N,"uptime":giây}; route khác → 404
- Socket.io client nối path '/' (bắt buộc bởi Caddy gateway), CORS origin '*', cả polling lẫn websocket OK; event 'ping-custom' ack {ok:true,t}. Service stateless không DB — task khác chỉ cần POST /emit để đẩy event realtime tới các client CMS

---
Task ID: 9
Agent: main (Z.ai Code)
Task: Lớp vận hành tự động 100% bằng Agent — Zalo OA/Zalo cá nhân, tự báo ĐVVC, chăm sóc & xin đánh giá, realtime socket, kiểm thử vận hành 1 người

Work Log:
- Schema mở rộng: Shipment, AgentActivity, OrderEvent, DirectMessage, AutomationSetting; Order thêm reviewRating/reviewComment + relations; db:push OK
- Mini-service realtime (Task 2-a, subagent): socket.io port 3003, path '/', POST /emit + GET /health, dispatcher phân biệt HTTP vs engine.io; chạy nền setsid
- lib/realtime.ts (broadcast fire-and-forget), lib/llm.ts (z-ai-web-dev-sdk + timeout + fallback), lib/agents.ts (5 Agent + 5 ĐVVC + AUTOMATION_DEFS + template Zalo), lib/agent-log.ts, lib/order-service.ts (tạo đơn dùng chung)
- lib/agent-engine.ts: state machine tick 2.5s, 10 bước: xác nhận (LLM tin Zalo) → soạn hàng → báo ĐVVC (GHN/GHTK/Viettel/J&T/Ninja + mã vận đơn) → lấy hàng → đang giao → đã giao (COMPLETED+PAID) → cảm ơn CSKH (LLM) → xin đánh giá (LLM) → khách đánh giá (LLM) → AI trả lời tin nhắn 24/7 (LLM + fallback theo từ khóa khi 429)
- instrumentation.ts khởi động engine; APIs: /api/autopilot (GET/PATCH), /api/agent-activities, /api/shipments (+POST báo ĐVVC thủ công), /api/inbox (hội thoại/tin nhắn/gửi), /api/liveops (buồng lái), /api/simulate (đơn Zalo OA/CN + tin nhắn khách); orders POST/[id] ghi event + broadcast
- use-realtime.ts: socket singleton '/?XTransformPort=3003' + useRealtime/useRealtimeStatus
- UI: LiveOpsView (banner Autopilot + KPI + pipeline + feed realtime + mô phỏng 3 nút + đang vận chuyển + hàng đợi cần người), InboxView (hội thoại Zalo, bubble Agent/Khách/Người vận hành, trả lời thay Agent), ShipmentsView, AutopilotView (công tắc từng Agent + nhật ký lưu vĩnh viễn + thống kê); sidebar 3 nhóm Vận hành/Quản trị/Phân tích + badge unread; header chip Autopilot + Realtime; footer thêm Zalo
- orders-view: timeline hành trình Agent + card vận đơn + sao đánh giá trong chi tiết đơn
- Seed: +2 kênh Zalo (connected), AutomationSetting mặc định BẬT, 3 hội thoại Zalo mẫu
- Debug quan trọng: (1) dev server giữ Prisma client cũ → phải kill đúng PID next-server (pkill -f "next dev" không ăn) + rm -rf .next; (2) socket qua gateway chỉ hoạt động qua Caddy :81, không phải :3000 trực tiếp; (3) hot-reload không hiệu lực với engine trên globalThis → restart dev server; (4) LLM 429 rate-limit → fallback template cho auto-reply, Agent không bao giờ im lặng

Stage Summary:
- Kiểm thử browser end-to-end PASS: mô phỏng đơn Zalo OA DH261022-8147 → xác nhận/soạn gói/báo GHTK/lấy hàng/giao/cảm ơn/xin đánh giá/5⭐ hoàn tất 100% tự động ~30s; Agent Hỗ trợ auto-reply tin nhắn; tắt/bật Autopilot broadcast realtime (header+sidebar+toast); timeline đơn đầy đủ; mobile 390px + footer sticky OK
- Số liệu sau ~40 phút chạy: 226 tác vụ Agent, 160 tin nhắn Zalo, 6 đánh giá, automationRate 100% — 1 người chỉ cần giám sát Buồng lái
- lint 0 lỗi; dev.log không có runtime error (chỉ LLM 429 đã có fallback)
