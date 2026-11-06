import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function check() {
  const creds = await db.integrationCredential.findMany({ where: { provider: 'PAYOS_TEST' } })
  console.log('PAYOS_TEST count:', creds.length)
  console.log('PAYOS_TEST:', creds)
  await db.$disconnect()
}

check().catch(console.error)
