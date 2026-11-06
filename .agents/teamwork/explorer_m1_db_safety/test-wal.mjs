import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function testJournalMode() {
  try {
    const journalMode = await prisma.$queryRawUnsafe('PRAGMA journal_mode;')
    console.log('Journal mode:', journalMode)
  } catch (err) {
    console.error('Error:', err)
  } finally {
    await prisma.$disconnect()
  }
}

testJournalMode()
