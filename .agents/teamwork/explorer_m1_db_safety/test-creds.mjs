import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function testCreds() {
  try {
    const creds = await prisma.integrationCredential.findMany({
      select: { provider: true, name: true, active: true }
    })
    console.log('Integration credentials in db:', creds)
  } catch (err) {
    console.error('Error:', err)
  } finally {
    await prisma.$disconnect()
  }
}

testCreds()
