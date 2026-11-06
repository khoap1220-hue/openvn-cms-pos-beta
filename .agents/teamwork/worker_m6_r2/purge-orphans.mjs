import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function main() {
  const result = await db.voucher.deleteMany({
    where: {
      OR: [
        { title: { contains: '(R5-' } },
        { code: { startsWith: 'BDAY-2026-' } },
      ],
    },
  })
  console.log('Purged orphan vouchers count:', result.count)
}

main()
  .catch((err) => {
    console.error('Error purging vouchers:', err)
    process.exit(1)
  })
  .finally(() => {
    db.$disconnect()
  })
