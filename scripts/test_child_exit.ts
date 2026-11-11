/**
 * scripts/test_child_exit.ts
 * Minimal fast sub-script to test exit trap with process.exit(42).
 */
import { PrismaClient } from '@prisma/client'
import { registerProcessGuard, DEFAULT_BASE_URL } from './test_guard_helper'

const prisma = new PrismaClient()
const baseUrl = process.env.TEST_BASE_URL || DEFAULT_BASE_URL

async function run() {
  registerProcessGuard({ baseUrl })

  // Insert a test product
  await prisma.product.create({
    data: {
      sku: 'UD-CHALLENGE-CHILDEXIT-01',
      name: '[QA Test] Product in Fast Child Exit Suite',
      costPrice: 20000,
      sellPrice: 40000,
      stock: 10,
      type: 'SIMPLE',
    },
  })

  // Exit abruptly
  process.exit(42)
}

run()
  .catch((err) => {
    console.error('Child error:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
