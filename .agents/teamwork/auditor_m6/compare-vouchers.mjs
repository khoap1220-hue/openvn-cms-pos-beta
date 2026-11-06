import { PrismaClient } from '@prisma/client'

const dbBak = new PrismaClient({
  datasources: {
    db: {
      url: 'file:../db/custom.db.bak',
    },
  },
})

const dbCurr = new PrismaClient({
  datasources: {
    db: {
      url: 'file:../db/custom.db',
    },
  },
})

async function run() {
  const vouchersBak = await dbBak.voucher.findMany()
  console.log('Vouchers in db/custom.db.bak:', vouchersBak.length)
  console.log(vouchersBak.map((v) => ({ id: v.id, code: v.code, title: v.title })))

  const vouchersCurr = await dbCurr.voucher.findMany()
  console.log('\nVouchers in current db/custom.db:', vouchersCurr.length)
  console.log(vouchersCurr.map((v) => ({ id: v.id, code: v.code, title: v.title })))

  await dbBak.$disconnect()
  await dbCurr.$disconnect()
}

run().catch(console.error)
