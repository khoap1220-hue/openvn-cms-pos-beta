import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function main() {
  const vouchers = await db.voucher.findMany()
  console.log(`=== VOUCHER TABLE AUDIT ===`)
  console.log(`Total Vouchers: ${vouchers.length}`)
  for (const v of vouchers) {
    console.log(`- Code: ${v.code} | Title: "${v.title}" | DiscountType: ${v.discountType} | DiscountValue: ${v.discountValue} | Active: ${v.active}`)
  }

  const orderCount = await db.order.count()
  console.log(`\n=== ORDER TABLE AUDIT ===`)
  console.log(`Total Orders: ${orderCount}`)

  const baselineVouchers = ['UUDAM10', 'PHATDAN50K', 'LIENKET15', 'FREESHIP0D']
  const actualCodes = vouchers.map(v => v.code)
  const isVouchersExact = vouchers.length === 4 && baselineVouchers.every(code => actualCodes.includes(code))
  console.log(`\nVoucher baseline exact match (4 baseline codes): ${isVouchersExact ? 'YES ✅' : 'NO ❌'}`)
  console.log(`Order baseline exact match (173 orders): ${orderCount === 173 ? 'YES ✅' : 'NO ❌'}`)
}

main()
  .catch(console.error)
  .finally(() => db.$disconnect())
