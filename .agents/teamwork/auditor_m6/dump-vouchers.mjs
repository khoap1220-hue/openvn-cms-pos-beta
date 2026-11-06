import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function dumpVouchers() {
  const vouchers = await db.voucher.findMany()
  console.log('All vouchers in db:', JSON.stringify(vouchers, null, 2))
  await db.$disconnect()
}

dumpVouchers().catch(console.error)
