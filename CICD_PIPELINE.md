# CI/CD Pipeline Chuẩn — `openvn-cms-pos-beta`

> Sinh bởi `free-beta-deploy-mcp` • template `v1` • cập nhật `2026-11-07T02:07:22Z`

| Thuộc tính | Giá trị |
| :--- | :--- |
| Target | `render` |
| Stack | `node` |
| Nhánh kích hoạt | `main` |
| Repo | `khoap1220-hue/openvn-cms-pos-beta` |
| Health URL | https://openvn-cms-pos-backend.onrender.com/health |
| Workflow | [`.github/workflows/beta-cicd.yml`](./.github/workflows/beta-cicd.yml) |

## Luồng chuẩn
`git push` → **CI** (secret scan → lint → test) → **CD** (render) → **Verify** (HTTP 200).
PR chỉ chạy CI, không deploy. File `*.md` và `beta-feedback/**` không kích hoạt pipeline (tiết kiệm phút Actions).

## Secrets & Variables cần đặt trên GitHub (KHÔNG commit vào repo)
```bash
gh secret set RENDER_DEPLOY_HOOK_URL -R khoap1220-hue/openvn-cms-pos-beta   # dán giá trị khi được hỏi
gh variable set BETA_HEALTH_URL -R khoap1220-hue/openvn-cms-pos-beta --body "<giá trị>"
```
Hoặc để MCP đọc từ biến môi trường local và đẩy giúp: `beta_cicd_pipeline(action="set_secrets", project_path=...)`.

## Bootstrap một lần
1. Render Dashboard → **New → Blueprint** → chọn repo (dùng `render.yaml`).
2. Service → **Settings → Deploy Hook** → copy URL → đặt vào secret `RENDER_DEPLOY_HOOK_URL`.
3. Đặt biến môi trường ứng dụng (DB URL, API key...) trực tiếp trong Render Dashboard — **không** commit.
4. Rollback: Render Dashboard → **Events → Rollback** về deploy trước.

## Vận hành
- Kích hoạt tay: `gh workflow run beta-cicd.yml` hoặc `beta_cicd_pipeline(action="trigger")`.
- Xem trạng thái: `gh run list --workflow beta-cicd.yml` hoặc `beta_cicd_pipeline(action="status")`.
- Toàn bộ fleet: `python cicd_fleet.py status` → `data/CICD_FLEET_DASHBOARD.md`.
