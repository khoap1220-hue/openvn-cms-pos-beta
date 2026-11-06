import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function purgeOrphans() {
  console.log('--- Purging leaked orphan test vouchers from db/custom.db ---')
  const beforeCount = await db.voucher.count()
  console.log(`Current voucher count: ${beforeCount}`)

  const result = await db.voucher.deleteMany({
    where: {
      OR: [
        { title: { contains: '(R5-' } },
        { code: { startsWith: 'BDAY-2026-' } },
      ],
    },
  })

  console.log(`Successfully deleted ${result.count} orphan test vouchers.`)
  const afterCount = await db.voucher.count()
  console.log(`New voucher count: ${afterCount} (Baseline target: 4)`)

  const remaining = await db.voucher.findMany({
    select: { id: true, code: true, title: true, discountType: true },
  })
  console.log('Remaining baseline vouchers in database:')
  for (const v of remaining) {
    console.log(` - ${v.code}: ${v.title} (${v.discountType})`)
  }

  await db.$disconnect()
}

purgeOrphans().catch((err) => {
  console.error('Error purging orphan vouchers:', err)
  process.exit(1)
})
