/**
 * SEED "Thiết lập hóa đơn Ưu Đàm + VietQR" (Task 28).
 * 1) invoice_bank_holder  → 'HỘ KINH DOANH ƯU ĐÀM' (chủ tài khoản trên hóa đơn)
 * 2) invoice_footer_note  → 'Ưu Đàm cảm ơn bạn đã thương mến — Bảo hành gốm vỡ 1 đổi 1 khi có video mở hộp'
 * 3) invoice_bank_code    → 'VCB' (mã ngân hàng cho VietQR — khớp invoice_bank_name Vietcombank hiện có)
 * Idempotent (upsert theo key) — chạy lại không tạo trùng; sau khi ghi ĐỌC LẠI verify 3 giá trị khớp đúng.
 * Chạy: cd /home/z/my-project && bunx tsx scripts/seed-uudam-invoice.ts  (hoặc: bun scripts/seed-uudam-invoice.ts)
 */
import { existsSync, readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'

// bun tự nạp .env, còn tsx/node thì không → tự đọc DATABASE_URL từ .env nếu env còn thiếu
if (!process.env.DATABASE_URL) {
  try {
    const envPath = existsSync('.env') ? '.env' : '../.env'
    if (existsSync(envPath)) {
      for (const line of readFileSync(envPath, 'utf8').split('\n')) {
        const m = /^DATABASE_URL=(.*)$/.exec(line.trim())
        if (m) process.env.DATABASE_URL = m[1].trim().replace(/^["']|["']$/g, '')
      }
    }
  } catch {
    // bỏ qua — Prisma sẽ tự báo lỗi env nếu thiếu
  }
}

const db = new PrismaClient()

const TARGETS: Array<{ key: string; value: string; label: string }> = [
  {
    key: 'invoice_bank_holder',
    value: 'HỘ KINH DOANH ƯU ĐÀM',
    label: 'Chủ tài khoản in trên hóa đơn',
  },
  {
    key: 'invoice_footer_note',
    value: 'Ưu Đàm cảm ơn bạn đã thương mến — Bảo hành gốm vỡ 1 đổi 1 khi có video mở hộp',
    label: 'Ghi chú cuối hóa đơn',
  },
  {
    key: 'invoice_bank_code',
    value: 'VCB',
    label: 'Mã ngân hàng VietQR (khớp Vietcombank — CN Tân Bình)',
  },
]

async function main() {
  console.log('== Seed Thiết lập hóa đơn Ưu Đàm + VietQR (Task 28) ==')

  // 1) Upsert 3 setting (idempotent — key là @id của AppSetting nên chạy lại chỉ update)
  for (const t of TARGETS) {
    await db.appSetting.upsert({
      where: { key: t.key },
      update: { value: t.value },
      create: { key: t.key, value: t.value },
    })
    console.log(`upsert ${t.key} -> "${t.value}" (${t.label})`)
  }

  // 2) Đọc lại verify 3 giá trị khớp đúng
  let ok = true
  console.log('== Verify (đọc lại từ DB) ==')
  for (const t of TARGETS) {
    const row = await db.appSetting.findUnique({ where: { key: t.key } })
    const match = row?.value === t.value
    if (!match) ok = false
    console.log(`  ${t.key}: "${row?.value ?? '(null)'}" ${match ? '→ KHỚP' : '→ LỆCH (kỳ vọng: "' + t.value + '")'}`)
  }
  if (!ok) throw new Error('Verify thất bại — giá trị đọc lại không khớp giá trị vừa ghi')

  console.log('== DONE ==')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
