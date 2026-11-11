/**
 * scripts/challenger2_crash_child.ts
 *
 * Child process test worker for Adversarial Crash Resilience testing.
 * Supports multiple crash scenarios:
 *  --mode=throw    : Throws unhandled Error inside suiteFn
 *  --mode=exit     : Calls process.exit(42) inside suiteFn
 *  --mode=sigterm  : Inserts test data and waits for parent to send SIGTERM/SIGINT
 *  --mode=hardkill : Inserts test data and signals parent to kill with SIGKILL/taskkill
 */

import { PrismaClient } from '@prisma/client'
import { runGuardedSuite, takeSnapshot, DEFAULT_BASE_URL } from './test_guard_helper'

const prisma = new PrismaClient()
const mode = process.argv.find((arg) => arg.startsWith('--mode='))?.split('=')[1] || 'throw'
const baseUrl = process.env.TEST_BASE_URL || DEFAULT_BASE_URL

async function main() {
  console.log(`[CHILD PROCESS] Started with mode: ${mode}, PID: ${process.pid}`)

  if (mode === 'throw') {
    await runGuardedSuite('Child Crash Throw Suite', async () => {
      console.log('[CHILD PROCESS] Inserting synthetic test product before throwing...')
      await prisma.product.create({
        data: {
          sku: 'UD-CHALLENGE-THROW-01',
          name: '[QA Test] Product in Throw Crash Suite',
          costPrice: 15000,
          sellPrice: 35000,
          stock: 12,
          type: 'SIMPLE',
        },
      })
      console.log('[CHILD PROCESS] Throwing deliberate unhandled exception...')
      throw new Error('INTENTIONAL_CRASH_THROW_FROM_CHILD')
    }, { baseUrl })
  } else if (mode === 'exit') {
    await runGuardedSuite('Child Crash Exit Suite', async () => {
      console.log('[CHILD PROCESS] Inserting synthetic test product before process.exit...')
      await prisma.product.create({
        data: {
          sku: 'UD-CHALLENGE-EXIT-01',
          name: '[QA Test] Product in Exit Crash Suite',
          costPrice: 20000,
          sellPrice: 40000,
          stock: 10,
          type: 'SIMPLE',
        },
      })
      console.log('[CHILD PROCESS] Calling process.exit(42) abruptly...')
      process.exit(42)
    }, { baseUrl })
  } else if (mode === 'sigterm') {
    await runGuardedSuite('Child Crash SIGTERM Suite', async () => {
      console.log('[CHILD PROCESS] Inserting synthetic test product before SIGTERM...')
      await prisma.product.create({
        data: {
          sku: 'UD-CHALLENGE-SIGTERM-01',
          name: '[QA Test] Product in SIGTERM Crash Suite',
          costPrice: 25000,
          sellPrice: 50000,
          stock: 8,
          type: 'SIMPLE',
        },
      })
      console.log('READY_FOR_SIGNAL')
      // Wait indefinitely until parent sends signal
      await new Promise((resolve) => setTimeout(resolve, 60000))
    }, { baseUrl })
  } else if (mode === 'hardkill') {
    // Mode hardkill does not use runGuardedSuite so traps are deliberately bypassed
    await takeSnapshot({ baseUrl, autoCleanFirst: true })
    console.log('[CHILD PROCESS] Inserting synthetic test product for Hard Kill simulation...')
    await prisma.product.create({
      data: {
        sku: 'UD-CHALLENGE-HARDKILL-01',
        name: '[QA Test] Product Abandoned by Hard Kill',
        costPrice: 30000,
        sellPrice: 60000,
        stock: 5,
        type: 'SIMPLE',
      },
    })
    console.log('READY_FOR_HARDKILL')
    await new Promise((resolve) => setTimeout(resolve, 60000))
  } else {
    throw new Error(`Unknown mode: ${mode}`)
  }
}

main()
  .catch((err) => {
    console.error('[CHILD PROCESS ERROR]', err.message)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
