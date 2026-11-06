import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function check() {
  const bdayVouchers = await db.voucher.findMany({
    where: { code: { startsWith: 'BDAY' } },
  })
  console.log(`Found ${bdayVouchers.length} BDAY vouchers:`)
  for (const v of bdayVouchers) {
    const orders = await db.order.findMany({
      where: { voucherCode: v.code },
    })
    console.log(`- ${v.code} (${v.title}): referenced by ${orders.length} orders`)
  }
  await db.$disconnect()
}

check().catch(console.error)
