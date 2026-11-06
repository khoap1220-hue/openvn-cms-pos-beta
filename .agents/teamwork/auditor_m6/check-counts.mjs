import { PrismaClient } from '@prisma/client'
import fs from 'fs'

const db = new PrismaClient()

async function check() {
  const baseline = JSON.parse(fs.readFileSync('db/baseline-counts.json', 'utf8'))
  console.log('Comparing current db/custom.db table counts to baseline:')
  let mismatchCount = 0
  const mismatches = []
  for (const [table, expected] of Object.entries(baseline)) {
    const model = table.charAt(0).toLowerCase() + table.slice(1)
    if (db[model] && typeof db[model].count === 'function') {
      const actual = await db[model].count()
      const match = actual === expected
      if (!match) {
        mismatchCount++
        mismatches.push({ table, actual, expected })
      }
      console.log(`- ${table}: actual=${actual}, baseline=${expected} ${match ? 'MATCH' : 'MISMATCH'}`)
    } else {
      console.log(`- ${table}: model not found on PrismaClient`)
    }
  }
  await db.$disconnect()
  console.log('\nTotal mismatches:', mismatchCount)
  if (mismatchCount > 0) {
    console.log('Details:', JSON.stringify(mismatches, null, 2))
  }
}

check().catch(console.error)
