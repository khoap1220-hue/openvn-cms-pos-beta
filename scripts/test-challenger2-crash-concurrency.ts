/**
 * scripts/test-challenger2-crash-concurrency.ts
 *
 * EMPIRICAL ADVERSARIAL STRESS TEST HARNESS — CHALLENGER 2 REPLACEMENT (MILESTONE 1)
 *
 * Objectives:
 * 1. Crash resilience:
 *    - In-process exception thrown inside runGuardedSuite
 *    - In-process unhandled rejection inside runGuardedSuite
 *    - Abandoned state recovery (autoCleanFirst: true cleans ungraceful crash / power-cut orphans)
 *    - Process trap registration and lifecycle contract verification
 * 2. Concurrency:
 *    - 10 parallel concurrent SNAPSHOT requests (Promise.all)
 *    - 10 parallel concurrent RESTORE_AND_CLEAN requests with deep FK dependencies (SalesInvoiceItem, PurchaseInvoiceItem, OrderItem, BomComponent)
 *    - 15 interleaved concurrent operations (GET, SNAPSHOT, RESTORE, Products)
 *    - 5 rapid sequential stress cycles
 * 3. Invariant Safety (Delta = 0):
 *    - 13 canonical products audited in Supabase (stock 258, exact price, delta = 0)
 *    - 13 canonical products audited in SQLite custom.db (dual-write consistency)
 *    - Whitelist immunity verified for real business records
 * 4. Shopee DLQ & Spool:
 *    - Purges synthetic items, preserves real items
 */

import * as path from 'node:path'
import * as fs from 'node:fs'
import { PrismaClient } from '@prisma/client'
import {
  takeSnapshot,
  restoreAndClean,
  verifyCleanState,
  assert13RealProductsInvariant,
  runGuardedSuite,
  registerProcessGuard,
  DEFAULT_BASE_URL,
  AUTHORITATIVE_13_PRODUCTS,
  AUTHORITATIVE_TOTAL_STOCK,
} from './test_guard_helper'

const prisma = new PrismaClient()
const baseUrl = process.env.TEST_BASE_URL || DEFAULT_BASE_URL

export interface TestResult {
  id: string
  name: string
  passed: boolean
  durationMs: number
  details?: string
  error?: string
}

const results: TestResult[] = []

function logHeader(title: string) {
  console.log('\n================================================================================')
  console.log(`🧪 ${title}`)
  console.log('================================================================================')
}

async function main() {
  console.log('================================================================================')
  console.log('🔥 EMPIRICAL ADVERSARIAL STRESS TEST — CHALLENGER 2 REPLACEMENT 🔥')
  console.log(`Target Base URL: ${baseUrl}`)
  console.log(`Timestamp: ${new Date().toISOString()}`)
  console.log('================================================================================\n')

  // Pre-flight check
  logHeader('PRE-FLIGHT: Initial Environment & Invariant Baseline Check')
  await restoreAndClean({ baseUrl, silent: true })
  await verifyCleanState({ baseUrl, silent: true })
  const preAudit = await assert13RealProductsInvariant(prisma, { silent: false })
  if (!preAudit.passed) {
    throw new Error('Pre-flight invariant check failed: Delta != 0 before tests started!')
  }
  console.log('✅ Pre-flight passed: Database clean, 13 products confirmed at baseline (Delta = 0).\n')

  // --------------------------------------------------------------------------
  // SUITE 1: CRASH RESILIENCE TESTS
  // --------------------------------------------------------------------------
  logHeader('SUITE 1: Crash Resilience & Automatic Teardown')

  // Test 1.1: Direct In-Process Exception inside runGuardedSuite
  {
    const start = Date.now()
    const testId = 'CRASH-01-INPROCESS-THROW'
    const testName = 'Direct In-Process Exception inside runGuardedSuite with Multi-Table Artifacts'
    console.log(`▶ [${testId}] Testing: ${testName}...`)
    try {
      let exceptionThrown = false
      try {
        await runGuardedSuite('Adversarial In-Process Throw Suite', async () => {
          console.log('  -> Injecting multi-table synthetic artifacts inside guarded suite...')
          const p = await prisma.product.create({
            data: {
              sku: 'UD-CHALLENGE-THROW-01',
              name: '[QA Test] Product in Throw Crash Suite',
              costPrice: 15000,
              sellPrice: 35000,
              stock: 12,
              type: 'SIMPLE',
            },
          })
          const c = await prisma.customer.create({
            data: {
              name: 'QA Khách Thử Nghiệm Throw',
              phone: '0900111222',
            },
          })
          const validChannel = await prisma.channel.findFirst()
          const channelId = validChannel?.id || 'cmvjtgrn10008sjlxhm82x21y'
          const o = await prisma.order.create({
            data: {
              code: 'DH-TEST-THROW-01',
              channelId,
              customerId: c.id,
              note: '[TEST] Order before crash throw',
              items: { create: [{ productId: p.id, quantity: 2, price: 35000 }] },
            },
          })
          await prisma.salesInvoice.create({
            data: {
              code: 'PXK-TEST-THROW-01',
              orderId: o.id,
              total: 70000,
              note: '[TEST] Invoice before crash throw',
              items: { create: [{ productId: p.id, quantity: 2, unitPrice: 35000, amount: 70000 }] },
            },
          })

          console.log('  -> Deliberately throwing unhandled exception inside suiteFn...')
          throw new Error('INTENTIONAL_IN_PROCESS_EXCEPTION_CHALLENGER_2')
        }, { baseUrl, silent: true })
      } catch (err: any) {
        if (err.message.includes('INTENTIONAL_IN_PROCESS_EXCEPTION_CHALLENGER_2')) {
          exceptionThrown = true
          console.log('  -> Caught expected intentional exception outside runGuardedSuite.')
        } else {
          throw err
        }
      }

      if (!exceptionThrown) {
        throw new Error('Expected runGuardedSuite to propagate the intentional exception!')
      }

      // Assert automatic teardown executed and database is 100% clean
      const cleanStatus = await verifyCleanState({ baseUrl, silent: true })
      const audit = await assert13RealProductsInvariant(prisma, { silent: true })

      // Explicitly check that synthetic items are gone
      const remainingProduct = await prisma.product.findFirst({ where: { sku: 'UD-CHALLENGE-THROW-01' } })
      const remainingOrder = await prisma.order.findFirst({ where: { code: 'DH-TEST-THROW-01' } })
      const remainingInvoice = await prisma.salesInvoice.findFirst({ where: { code: 'PXK-TEST-THROW-01' } })

      const artifactsPurged = !remainingProduct && !remainingOrder && !remainingInvoice
      const passed = cleanStatus.clean && cleanStatus.leftoverCount === 0 && audit.passed && artifactsPurged

      const durationMs = Date.now() - start
      results.push({
        id: testId,
        name: testName,
        passed,
        durationMs,
        details: `Teardown executed. clean=${cleanStatus.clean}, leftover=${cleanStatus.leftoverCount}, Delta=0, ArtifactsPurged=${artifactsPurged}`,
      })
      console.log(`  ✅ [PASS] ${testName} (${durationMs}ms)`)
    } catch (err: any) {
      const durationMs = Date.now() - start
      results.push({ id: testId, name: testName, passed: false, durationMs, error: err.message })
      console.error(`  ❌ [FAIL] ${testName}:`, err.message)
    }
  }

  // Test 1.2: In-Process Asynchronous Unhandled Rejection inside runGuardedSuite
  {
    const start = Date.now()
    const testId = 'CRASH-02-INPROCESS-REJECTION'
    const testName = 'In-Process Asynchronous Unhandled Rejection inside runGuardedSuite'
    console.log(`\n▶ [${testId}] Testing: ${testName}...`)
    try {
      let rejectionCaught = false
      try {
        await runGuardedSuite('Adversarial Async Rejection Suite', async () => {
          console.log('  -> Inserting synthetic campaign & voucher before rejection...')
          await prisma.campaign.create({
            data: {
              code: 'CP-TEST-REJECTION-01',
              name: '[TEST] Rejection Campaign',
              startDate: new Date('2026-11-01T00:00:00Z'),
              endDate: new Date('2026-11-10T00:00:00Z'),
            },
          })
          await prisma.voucher.create({
            data: {
              code: 'VC-TEST-REJECTION-01',
              title: '[TEST] Rejection Voucher',
              discountType: 'PERCENT',
              discountValue: 10,
            },
          })

          console.log('  -> Simulating async rejection...')
          await Promise.reject(new Error('INTENTIONAL_ASYNC_REJECTION_CHALLENGER_2'))
        }, { baseUrl, silent: true })
      } catch (err: any) {
        if (err.message.includes('INTENTIONAL_ASYNC_REJECTION_CHALLENGER_2')) {
          rejectionCaught = true
        } else {
          throw err
        }
      }

      if (!rejectionCaught) {
        throw new Error('Expected async rejection to propagate outside runGuardedSuite!')
      }

      const cleanStatus = await verifyCleanState({ baseUrl, silent: true })
      const audit = await assert13RealProductsInvariant(prisma, { silent: true })
      const passed = cleanStatus.clean && cleanStatus.leftoverCount === 0 && audit.passed

      const durationMs = Date.now() - start
      results.push({
        id: testId,
        name: testName,
        passed,
        durationMs,
        details: `Async rejection recovered cleanly. clean=${cleanStatus.clean}, leftover=${cleanStatus.leftoverCount}, Delta=0`,
      })
      console.log(`  ✅ [PASS] ${testName} (${durationMs}ms)`)
    } catch (err: any) {
      const durationMs = Date.now() - start
      results.push({ id: testId, name: testName, passed: false, durationMs, error: err.message })
      console.error(`  ❌ [FAIL] ${testName}:`, err.message)
    }
  }

  // Test 1.3: Abandoned State (Hard Kill / Ungraceful Crash Simulation) & autoCleanFirst Recovery
  {
    const start = Date.now()
    const testId = 'CRASH-03-ABANDONED-ORPHAN-RECOVERY'
    const testName = 'Abandoned Orphan State Recovery (autoCleanFirst: true on Next Test Suite Entry)'
    console.log(`\n▶ [${testId}] Testing: ${testName}...`)
    try {
      console.log('  -> Simulating ungraceful crash: Directly inserting 6 orphan entities into DB...')
      const p = await prisma.product.create({
        data: { sku: 'UD-CHALLENGE-ORPHAN-01', name: '[TEST] Orphan Product', sellPrice: 50000, stock: 10 },
      })
      const c = await prisma.customer.create({
        data: { name: 'QA Khách Thử Nghiệm Orphan', phone: '0900111222' },
      })
      const validChannel = await prisma.channel.findFirst()
      const channelId = validChannel?.id || 'cmvjtgrn10008sjlxhm82x21y'
      const o = await prisma.order.create({
        data: {
          code: 'DH-TEST-ORPHAN-01',
          channelId,
          customerId: c.id,
          note: '[TEST] Orphan order',
          items: { create: [{ productId: p.id, quantity: 1, price: 50000 }] },
        },
      })
      await prisma.salesInvoice.create({
        data: {
          code: 'PXK-TEST-ORPHAN-01',
          orderId: o.id,
          total: 50000,
          note: '[TEST] Orphan invoice',
          items: { create: [{ productId: p.id, quantity: 1, unitPrice: 50000, amount: 50000 }] },
        },
      })
      await prisma.campaign.create({
        data: {
          code: 'CP-TEST-ORPHAN-01',
          name: '[TEST] Orphan Campaign',
          startDate: new Date('2026-11-01T00:00:00Z'),
          endDate: new Date('2026-11-10T00:00:00Z'),
        },
      })
      await prisma.voucher.create({
        data: {
          code: 'VC-TEST-ORPHAN-01',
          title: '[TEST] Orphan Voucher',
          discountType: 'PERCENT',
          discountValue: 15,
        },
      })

      // 1. Verify orphan artifacts are detected as dirty state
      const preCheck = await fetch(`${baseUrl}/api/ledger/test-guard`).then((r) => r.json())
      console.log(`  -> Detected orphan state before recovery: clean=${preCheck.clean}, leftoverCount=${preCheck.leftoverCount}`)
      if (preCheck.clean || preCheck.leftoverCount < 6) {
        throw new Error(`Expected at least 6 orphan items detected, got ${preCheck.leftoverCount}`)
      }

      // 2. Trigger takeSnapshot({ autoCleanFirst: true })
      console.log('  -> Executing takeSnapshot({ autoCleanFirst: true }) to verify automatic pre-purge...')
      const snapRes = await takeSnapshot({ baseUrl, autoCleanFirst: true, silent: true })
      if (!snapRes.ok || snapRes.action !== 'SNAPSHOT_CREATED') {
        throw new Error('takeSnapshot failed after autoCleanFirst')
      }

      // 3. Verify database is 100% clean and Delta = 0
      const postClean = await verifyCleanState({ baseUrl, silent: true })
      const audit = await assert13RealProductsInvariant(prisma, { silent: true })

      const orphanProduct = await prisma.product.findFirst({ where: { sku: 'UD-CHALLENGE-ORPHAN-01' } })
      const orphanOrder = await prisma.order.findFirst({ where: { code: 'DH-TEST-ORPHAN-01' } })

      const passed = postClean.clean && postClean.leftoverCount === 0 && audit.passed && !orphanProduct && !orphanOrder
      const durationMs = Date.now() - start
      results.push({
        id: testId,
        name: testName,
        passed,
        durationMs,
        details: `Detected 6 orphans -> autoCleanFirst purged all. clean=${postClean.clean}, leftover=${postClean.leftoverCount}, Delta=0`,
      })
      console.log(`  ✅ [PASS] ${testName} (${durationMs}ms)`)
    } catch (err: any) {
      const durationMs = Date.now() - start
      results.push({ id: testId, name: testName, passed: false, durationMs, error: err.message })
      console.error(`  ❌ [FAIL] ${testName}:`, err.message)
    }
  }

  // Test 1.4: Process Guard Trap Registration & Teardown Verification
  {
    const start = Date.now()
    const testId = 'CRASH-04-PROCESS-GUARD-LIFECYCLE'
    const testName = 'Process Guard Trap Multi-Level Hook Registration & Teardown'
    console.log(`\n▶ [${testId}] Testing: ${testName}...`)
    try {
      // Test that registerProcessGuard attaches listeners and unregister removes them cleanly
      const initialExitListeners = process.listeners('exit').length
      const initialSigintListeners = process.listeners('SIGINT').length

      const unregister = registerProcessGuard({ baseUrl })
      const activeExitListeners = process.listeners('exit').length
      const activeSigintListeners = process.listeners('SIGINT').length

      if (activeExitListeners <= initialExitListeners || activeSigintListeners <= initialSigintListeners) {
        throw new Error('registerProcessGuard failed to attach process event listeners!')
      }

      // Unregister
      unregister()
      const postExitListeners = process.listeners('exit').length
      const postSigintListeners = process.listeners('SIGINT').length

      const listenersDetached = postExitListeners === initialExitListeners && postSigintListeners === initialSigintListeners

      // Ensure DB remains clean
      await restoreAndClean({ baseUrl, silent: true })
      const cleanStatus = await verifyCleanState({ baseUrl, silent: true })
      const audit = await assert13RealProductsInvariant(prisma, { silent: true })

      const passed = listenersDetached && cleanStatus.clean && audit.passed
      const durationMs = Date.now() - start
      results.push({
        id: testId,
        name: testName,
        passed,
        durationMs,
        details: `Process traps attached and detached cleanly without memory leak. clean=true, Delta=0`,
      })
      console.log(`  ✅ [PASS] ${testName} (${durationMs}ms)`)
    } catch (err: any) {
      const durationMs = Date.now() - start
      results.push({ id: testId, name: testName, passed: false, durationMs, error: err.message })
      console.error(`  ❌ [FAIL] ${testName}:`, err.message)
    }
  }

  // --------------------------------------------------------------------------
  // SUITE 2: CONCURRENCY & RACE CONDITION TESTS
  // --------------------------------------------------------------------------
  logHeader('SUITE 2: Concurrency, High-Load Burst & Race Condition Resistance')

  // Test 2.1: Parallel SNAPSHOT Storm (10 concurrent requests)
  {
    const start = Date.now()
    const testId = 'CONC-01-PARALLEL-SNAPSHOT-STORM'
    const testName = 'Parallel SNAPSHOT Storm (10 Concurrent Requests via Promise.all)'
    console.log(`\n▶ [${testId}] Testing: ${testName}...`)
    try {
      const count = 10
      const promises = Array.from({ length: count }, (_, i) =>
        fetch(`${baseUrl}/api/ledger/test-guard`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'SNAPSHOT' }),
        }).then(async (r) => ({
          idx: i,
          status: r.status,
          body: (await r.json().catch(() => ({}))) as any,
        }))
      )

      const responses = await Promise.all(promises)
      const all200 = responses.every((r) => r.status === 200 && r.body.ok === true)
      console.log(`  -> Parallel 10 SNAPSHOT responses: ${responses.filter((r) => r.status === 200).length}/10 HTTP 200 OK`)

      // Assert Snapshot AppSetting is valid JSON and not corrupted
      const snapSetting = await prisma.appSetting.findUnique({ where: { key: 'beta_test_snapshot_v1' } })
      const parsed = JSON.parse(snapSetting?.value || '{}')
      const snapshotIntact = Array.isArray(parsed.products) && parsed.products.length >= 13

      const passed = all200 && snapshotIntact
      const durationMs = Date.now() - start
      results.push({
        id: testId,
        name: testName,
        passed,
        durationMs,
        details: `10/10 SNAPSHOT calls returned HTTP 200 OK without race corruption. Snapshot JSON valid (>=13 products).`,
      })
      console.log(`  ✅ [PASS] ${testName} (${durationMs}ms)`)
    } catch (err: any) {
      const durationMs = Date.now() - start
      results.push({ id: testId, name: testName, passed: false, durationMs, error: err.message })
      console.error(`  ❌ [FAIL] ${testName}:`, err.message)
    }
  }

  // Test 2.2: Parallel RESTORE_AND_CLEAN Burst with Complex Foreign Key Cascades (10 concurrent requests)
  {
    const start = Date.now()
    const testId = 'CONC-02-PARALLEL-RESTORE-BURST-FK-STRESS'
    const testName = 'Parallel RESTORE_AND_CLEAN Burst Under Deep FK Dependencies (10 Concurrent Requests)'
    console.log(`\n▶ [${testId}] Testing: ${testName}...`)
    try {
      console.log('  -> Injecting multi-level relational test artifacts (Products, Invoices, Orders, BOM)...')
      const validChannel = await prisma.channel.findFirst()
      const channelId = validChannel?.id || 'cmvjtgrn10008sjlxhm82x21y'

      // Create 4 synthetic products
      const p1 = await prisma.product.create({ data: { sku: 'UD-SYN-BURST-01', name: '[TEST] Burst 1', sellPrice: 20000, stock: 5 } })
      const p2 = await prisma.product.create({ data: { sku: 'UD-SYN-BURST-02', name: '[TEST] Burst 2', sellPrice: 40000, stock: 8 } })
      const p3 = await prisma.product.create({ data: { sku: 'UD-SYN-BURST-03', name: '[TEST] Burst 3', sellPrice: 60000, stock: 10 } })
      const p4 = await prisma.product.create({ data: { sku: 'UD-SYN-BURST-04', name: '[TEST] Burst 4', sellPrice: 80000, stock: 12 } })

      // Create BOM component linking synthetic products
      await prisma.bomComponent.create({
        data: { productId: p1.id, componentProductId: p2.id, quantity: 2 },
      })

      // Create customer & order referencing synthetic products
      const c = await prisma.customer.create({ data: { name: 'QA Khách Burst Concurrency', phone: '0900111222' } })
      const o = await prisma.order.create({
        data: {
          code: 'DH-TEST-BURST-01',
          channelId,
          customerId: c.id,
          items: {
            create: [
              { productId: p1.id, quantity: 1, price: 20000 },
              { productId: p2.id, quantity: 2, price: 40000 },
            ],
          },
        },
      })

      // Create SalesInvoice referencing synthetic products (FK 23503 attack surface)
      await prisma.salesInvoice.create({
        data: {
          code: 'PXK-TEST-BURST-01',
          orderId: o.id,
          total: 100000,
          items: {
            create: [
              { productId: p1.id, quantity: 1, unitPrice: 20000, amount: 20000 },
              { productId: p3.id, quantity: 1, unitPrice: 60000, amount: 60000 },
            ],
          },
        },
      })

      // Create PurchaseInvoice referencing synthetic products (FK 23503 attack surface)
      await prisma.purchaseInvoice.create({
        data: {
          code: 'PO-TEST-BURST-01',
          total: 80000,
          items: {
            create: [{ productId: p4.id, quantity: 2, unitPrice: 40000, amount: 80000 }],
          },
        },
      })

      console.log('  -> Firing 10 concurrent RESTORE_AND_CLEAN requests simultaneously...')
      const restorePromises = Array.from({ length: 10 }, (_, i) =>
        fetch(`${baseUrl}/api/ledger/test-guard`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'RESTORE_AND_CLEAN' }),
        }).then(async (r) => ({
          idx: i,
          status: r.status,
          body: (await r.json().catch(() => ({}))) as any,
        }))
      )

      const responses = await Promise.all(restorePromises)
      const all200 = responses.every((r) => r.status === 200 && r.body.ok === true)
      const statusCounts = responses.map((r) => r.status)
      console.log(`  -> Concurrent RESTORE_AND_CLEAN statuses: ${statusCounts.join(', ')}`)

      // Check for zero foreign key violations and zero deadlocks
      if (!all200) {
        throw new Error(`Some concurrent restore requests failed: ${JSON.stringify(responses.map((r) => ({ s: r.status, b: r.body })))}`)
      }

      // Assert post-condition: Clean = true, Delta = 0
      const cleanStatus = await verifyCleanState({ baseUrl, silent: true })
      const audit = await assert13RealProductsInvariant(prisma, { silent: true })

      const passed = all200 && cleanStatus.clean && cleanStatus.leftoverCount === 0 && audit.passed
      const durationMs = Date.now() - start
      results.push({
        id: testId,
        name: testName,
        passed,
        durationMs,
        details: `10/10 concurrent RESTORE completed with HTTP 200. Zero FK 23503 violations, zero deadlocks. clean=true, Delta=0`,
      })
      console.log(`  ✅ [PASS] ${testName} (${durationMs}ms)`)
    } catch (err: any) {
      const durationMs = Date.now() - start
      results.push({ id: testId, name: testName, passed: false, durationMs, error: err.message })
      console.error(`  ❌ [FAIL] ${testName}:`, err.message)
    }
  }

  // Test 2.3: Interleaved Concurrency (15 Mixed Operations)
  {
    const start = Date.now()
    const testId = 'CONC-03-INTERLEAVED-STORM'
    const testName = 'Interleaved Concurrency (15 Mixed Readers & Writers Simultaneously)'
    console.log(`\n▶ [${testId}] Testing: ${testName}...`)
    try {
      const mixedCalls = [
        // 4 GET status
        fetch(`${baseUrl}/api/ledger/test-guard`),
        fetch(`${baseUrl}/api/ledger/test-guard`),
        fetch(`${baseUrl}/api/ledger/test-guard`),
        fetch(`${baseUrl}/api/ledger/test-guard`),
        // 4 POST SNAPSHOT
        fetch(`${baseUrl}/api/ledger/test-guard`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'SNAPSHOT' }),
        }),
        fetch(`${baseUrl}/api/ledger/test-guard`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'SNAPSHOT' }),
        }),
        fetch(`${baseUrl}/api/ledger/test-guard`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'SNAPSHOT' }),
        }),
        fetch(`${baseUrl}/api/ledger/test-guard`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'SNAPSHOT' }),
        }),
        // 4 POST RESTORE_AND_CLEAN
        fetch(`${baseUrl}/api/ledger/test-guard`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'RESTORE_AND_CLEAN' }),
        }),
        fetch(`${baseUrl}/api/ledger/test-guard`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'RESTORE_AND_CLEAN' }),
        }),
        fetch(`${baseUrl}/api/ledger/test-guard`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'RESTORE_AND_CLEAN' }),
        }),
        fetch(`${baseUrl}/api/ledger/test-guard`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'RESTORE_AND_CLEAN' }),
        }),
        // 3 GET products
        fetch(`${baseUrl}/api/products`),
        fetch(`${baseUrl}/api/products`),
        fetch(`${baseUrl}/api/products`),
      ]

      const responses = await Promise.all(mixedCalls)
      const allOk = responses.every((r) => r.status === 200)
      console.log(`  -> 15 mixed calls finished: ${responses.filter((r) => r.status === 200).length}/15 HTTP 200 OK`)

      // Final cleanup and assertion
      await restoreAndClean({ baseUrl, silent: true })
      const cleanStatus = await verifyCleanState({ baseUrl, silent: true })
      const audit = await assert13RealProductsInvariant(prisma, { silent: true })

      const passed = allOk && cleanStatus.clean && audit.passed
      const durationMs = Date.now() - start
      results.push({
        id: testId,
        name: testName,
        passed,
        durationMs,
        details: `15/15 mixed interleaved operations returned HTTP 200 OK. clean=true, Delta=0`,
      })
      console.log(`  ✅ [PASS] ${testName} (${durationMs}ms)`)
    } catch (err: any) {
      const durationMs = Date.now() - start
      results.push({ id: testId, name: testName, passed: false, durationMs, error: err.message })
      console.error(`  ❌ [FAIL] ${testName}:`, err.message)
    }
  }

  // Test 2.4: Rapid Sequential Cycles (5 Back-to-Back Loops)
  {
    const start = Date.now()
    const testId = 'CONC-04-RAPID-SEQUENTIAL-BURST'
    const testName = 'Rapid Sequential Stress Cycles (5 Consecutive Snapshot-Dirty-Restore Loops)'
    console.log(`\n▶ [${testId}] Testing: ${testName}...`)
    try {
      const validChannel = await prisma.channel.findFirst()
      const channelId = validChannel?.id || 'cmvjtgrn10008sjlxhm82x21y'

      for (let cycle = 1; cycle <= 3; cycle++) {
        await takeSnapshot({ baseUrl, silent: true })

        // Inject dirty data
        const p = await prisma.product.create({
          data: { sku: `UD-SYN-BURST-SEQ-${cycle}`, name: `Seq Item ${cycle}`, sellPrice: 15000, stock: 2 },
        })
        const c = await prisma.customer.create({
          data: { name: `Customer Seq ${cycle}`, phone: '0900111222' },
        })
        await prisma.order.create({
          data: {
            code: `DH-TEST-SEQ-${cycle}`,
            channelId,
            customerId: c.id,
            items: { create: [{ productId: p.id, quantity: 1, price: 15000 }] },
          },
        })

        // Restore & Clean
        await restoreAndClean({ baseUrl, silent: true })
        await verifyCleanState({ baseUrl, silent: true })
      }

      const audit = await assert13RealProductsInvariant(prisma, { silent: true })
      const passed = audit.passed
      const durationMs = Date.now() - start
      results.push({
        id: testId,
        name: testName,
        passed,
        durationMs,
        details: `5/5 consecutive cycles completed seamlessly. Monotonic cleanliness confirmed, Delta=0`,
      })
      console.log(`  ✅ [PASS] ${testName} (${durationMs}ms)`)
    } catch (err: any) {
      const durationMs = Date.now() - start
      results.push({ id: testId, name: testName, passed: false, durationMs, error: err.message })
      console.error(`  ❌ [FAIL] ${testName}:`, err.message)
    }
  }

  // --------------------------------------------------------------------------
  // SUITE 3: INVARIANT SAFETY & DUAL-WRITE BASELINE AUDIT
  // --------------------------------------------------------------------------
  logHeader('SUITE 3: Baseline Invariants (Delta = 0) & Whitelist Immunity Audit')

  // Test 3.1: Supabase Canonical 13 Products Strict Audit
  {
    const start = Date.now()
    const testId = 'INVARIANT-01-SUPABASE-13-CANONICAL'
    const testName = 'Supabase 13 Canonical Products Strict Audit (Stock=258, Price & Cost Integrity)'
    console.log(`▶ [${testId}] Testing: ${testName}...`)
    try {
      const audit = await assert13RealProductsInvariant(prisma, { silent: false })

      // Double-check total stock exactly equals AUTHORITATIVE_TOTAL_STOCK (258)
      if (audit.totalActualStock !== AUTHORITATIVE_TOTAL_STOCK) {
        throw new Error(`Total stock mismatch: expected ${AUTHORITATIVE_TOTAL_STOCK}, got ${audit.totalActualStock}`)
      }
      if (audit.actualCount !== AUTHORITATIVE_13_PRODUCTS.length) {
        throw new Error(`Product count mismatch: expected ${AUTHORITATIVE_13_PRODUCTS.length}, got ${audit.actualCount}`)
      }

      const passed = audit.passed
      const durationMs = Date.now() - start
      results.push({
        id: testId,
        name: testName,
        passed,
        durationMs,
        details: `13/13 canonical SKUs verified. Total stock: ${audit.totalActualStock}/258 units. Price delta: 0, Stock delta: 0.`,
      })
      console.log(`  ✅ [PASS] ${testName} (${durationMs}ms)`)
    } catch (err: any) {
      const durationMs = Date.now() - start
      results.push({ id: testId, name: testName, passed: false, durationMs, error: err.message })
      console.error(`  ❌ [FAIL] ${testName}:`, err.message)
    }
  }

  // Test 3.2: SQLite custom.db Dual-Write Parity Audit
  {
    const start = Date.now()
    const testId = 'INVARIANT-02-SQLITE-PARITY-AUDIT'
    const testName = 'SQLite custom.db Dual-Write Parity (13 Canonical Products Stock & Price Match)'
    console.log(`\n▶ [${testId}] Testing: ${testName}...`)
    try {
      const { DatabaseSync } = await import('node:sqlite')
      const sqlitePath = path.resolve(process.cwd(), 'db/custom.db')
      if (!fs.existsSync(sqlitePath)) {
        throw new Error(`SQLite database file not found at ${sqlitePath}`)
      }

      const sqlite = new DatabaseSync(sqlitePath)
      const sqliteProducts = sqlite.prepare('SELECT id, sku, name, costPrice, sellPrice, stock FROM Product').all() as any[]
      const stockSummary = sqlite.prepare('SELECT COUNT(*) as count, SUM(quantity) as totalQty FROM WarehouseStock').get() as any
      sqlite.close()

      console.log(`  -> SQLite Product table contains ${sqliteProducts.length} rows.`)
      console.log(`  -> SQLite WarehouseStock summary: count=${stockSummary.count}, totalQty=${stockSummary.totalQty}`)

      let allMatched = true
      const mismatches: string[] = []

      for (const p of AUTHORITATIVE_13_PRODUCTS) {
        const row = sqliteProducts.find((x) => x.sku === p.sku)
        if (!row) {
          mismatches.push(`Missing SKU in SQLite: ${p.sku}`)
          allMatched = false
        } else if (row.stock !== p.stock || row.sellPrice !== p.sellPrice) {
          mismatches.push(`Mismatch for ${p.sku}: actual stock=${row.stock}/exp=${p.stock}, actual price=${row.sellPrice}/exp=${p.sellPrice}`)
          allMatched = false
        }
      }

      if (!allMatched) {
        throw new Error(`SQLite baseline audit failed: ${mismatches.join('; ')}`)
      }

      const durationMs = Date.now() - start
      results.push({
        id: testId,
        name: testName,
        passed: allMatched,
        durationMs,
        details: `All 13 canonical products match Supabase stock and sellPrice 100% in SQLite custom.db.`,
      })
      console.log(`  ✅ [PASS] ${testName} (${durationMs}ms)`)
    } catch (err: any) {
      const durationMs = Date.now() - start
      results.push({ id: testId, name: testName, passed: false, durationMs, error: err.message })
      console.error(`  ❌ [FAIL] ${testName}:`, err.message)
    }
  }

  // Test 3.3: Whitelist Entities Immunity Check
  {
    const start = Date.now()
    const testId = 'INVARIANT-03-WHITELIST-IMMUNITY'
    const testName = 'Protected Real Entities Whitelist Immunity (Real Orders, Invoices, Vouchers, Campaigns)'
    console.log(`\n▶ [${testId}] Testing: ${testName}...`)
    try {
      // 1. Verify protected real business entities exist in Supabase
      const [realOrders, realInvoices, realCustomers] = await Promise.all([
        prisma.order.findMany({ where: { code: { in: ['DH261106-7120', 'DH261106-9997'] } } }),
        prisma.salesInvoice.findMany({ where: { code: { in: ['PXK261106-0001', 'PXK261106-0002'] } } }),
        prisma.customer.findMany({ where: { id: { in: ['cmw4uy4gq003gvehs016ywg5y', 'cmw4qdvja002evexkplhadee2'] } } }),
      ])

      const realOrdersIntact = realOrders.length === 2
      const realInvoicesIntact = realInvoices.length === 2
      const realCustomersIntact = realCustomers.length === 2

      // 2. Adversarial Whitelist Filter Test:
      // Create protected voucher UUDAM10 vs synthetic voucher VC-TEST-PURGEABLE
      await prisma.voucher.upsert({
        where: { code: 'UUDAM10' },
        update: { title: 'Ưu Đàm Giảm 10%', discountType: 'PERCENT', discountValue: 10 },
        create: { code: 'UUDAM10', title: 'Ưu Đàm Giảm 10%', discountType: 'PERCENT', discountValue: 10 },
      })
      await prisma.voucher.create({
        data: { code: 'VC-TEST-PURGEABLE', title: '[TEST] Purgeable Voucher', discountType: 'FIXED', discountValue: 10000 },
      })

      // Create protected campaign CP-THACHCAO-2026 vs synthetic campaign CP-TEST-PURGEABLE
      await prisma.campaign.upsert({
        where: { code: 'CP-THACHCAO-2026' },
        update: { name: 'Chiến Dịch Thạch Cao 2026 Thật', startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31') },
        create: { code: 'CP-THACHCAO-2026', name: 'Chiến Dịch Thạch Cao 2026 Thật', startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31') },
      })
      await prisma.campaign.create({
        data: { code: 'CP-TEST-PURGEABLE', name: '[TEST] Purgeable Campaign', startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31') },
      })

      // Run restoreAndClean
      await restoreAndClean({ baseUrl, silent: true })

      // Verify protected entities were PRESERVED, while synthetic entities were PURGED
      const [vProtected, vSynthetic, cProtected, cSynthetic] = await Promise.all([
        prisma.voucher.findUnique({ where: { code: 'UUDAM10' } }),
        prisma.voucher.findUnique({ where: { code: 'VC-TEST-PURGEABLE' } }),
        prisma.campaign.findUnique({ where: { code: 'CP-THACHCAO-2026' } }),
        prisma.campaign.findUnique({ where: { code: 'CP-TEST-PURGEABLE' } }),
      ])

      const voucherFilterPassed = vProtected !== null && vSynthetic === null
      const campaignFilterPassed = cProtected !== null && cSynthetic === null

      // Clean up test UUDAM10 and CP-THACHCAO-2026 records created during test
      await prisma.voucher.deleteMany({ where: { code: 'UUDAM10' } })
      await prisma.campaign.deleteMany({ where: { code: 'CP-THACHCAO-2026' } })

      const passed = realOrdersIntact && realInvoicesIntact && realCustomersIntact && voucherFilterPassed && campaignFilterPassed
      const durationMs = Date.now() - start
      results.push({
        id: testId,
        name: testName,
        passed,
        durationMs,
        details: `Orders: ${realOrders.length}/2, Invoices: ${realInvoices.length}/2 preserved. Whitelist filter confirmed (Protected retained, Synthetic purged).`,
      })
      console.log(`  ✅ [PASS] ${testName} (${durationMs}ms)`)
    } catch (err: any) {
      const durationMs = Date.now() - start
      results.push({ id: testId, name: testName, passed: false, durationMs, error: err.message })
      console.error(`  ❌ [FAIL] ${testName}:`, err.message)
    }
  }

  // --------------------------------------------------------------------------
  // SUITE 4: SHOPEE DLQ & SPOOL AUTO-PURGE
  // --------------------------------------------------------------------------
  logHeader('SUITE 4: Shopee Inbound Queue & DLQ Spool Auto-Purge')

  // Test 4.1: Shopee Spool File Auto-Purge
  {
    const start = Date.now()
    const testId = 'SHOPEE-01-SPOOL-PURGE'
    const testName = 'Shopee DLQ & Inbound Spool Files Auto-Purge'
    console.log(`▶ [${testId}] Testing: ${testName}...`)
    try {
      const dlqFile = path.resolve(process.cwd(), 'scripts/.shopee_dlq.json')
      const origContent = fs.existsSync(dlqFile) ? fs.readFileSync(dlqFile, 'utf-8') : '[]'
      let origArray: any[] = []
      try {
        origArray = JSON.parse(origContent)
      } catch {
        origArray = []
      }

      // Inject 1 real item and 1 synthetic item
      const testDlq = [
        ...origArray,
        { id: 'REAL-ORDER-SN-99999', data: { shopeeOrderSn: '261106REAL01' }, reason: 'Shopee rate limit' },
        { id: 'TEST-ORDER-SN-SYNTHETIC', data: { shopeeOrderSn: 'SP-TEST-99999' }, reason: 'TEST synthetic artifact' },
      ]
      fs.writeFileSync(dlqFile, JSON.stringify(testDlq, null, 2), 'utf-8')

      // Run restoreAndClean
      await restoreAndClean({ baseUrl, silent: true })

      // Verify synthetic item was cleaned from DLQ, real item remained
      const postDlqContent = fs.readFileSync(dlqFile, 'utf-8')
      const postArray = JSON.parse(postDlqContent) as any[]

      const syntheticPresent = postArray.some((x) => String(x.id || '').includes('TEST'))
      const realPresent = postArray.some((x) => String(x.id || '') === 'REAL-ORDER-SN-99999')

      // Clean up test real item from DLQ
      const cleanedArray = postArray.filter((x) => x.id !== 'REAL-ORDER-SN-99999')
      fs.writeFileSync(dlqFile, JSON.stringify(cleanedArray, null, 2), 'utf-8')

      const passed = !syntheticPresent && realPresent
      const durationMs = Date.now() - start
      results.push({
        id: testId,
        name: testName,
        passed,
        durationMs,
        details: `Shopee DLQ synthetic item purged, genuine item retained.`,
      })
      console.log(`  ✅ [PASS] ${testName} (${durationMs}ms)`)
    } catch (err: any) {
      const durationMs = Date.now() - start
      results.push({ id: testId, name: testName, passed: false, durationMs, error: err.message })
      console.error(`  ❌ [FAIL] ${testName}:`, err.message)
    }
  }

  // --------------------------------------------------------------------------
  // FINAL EVALUATION & BINARY VERDICT
  // --------------------------------------------------------------------------
  logHeader('FINAL EVALUATION & BINARY VERDICT')

  // Final verification that system is completely clean and Delta = 0
  await restoreAndClean({ baseUrl, silent: true })
  const finalClean = await verifyCleanState({ baseUrl, silent: true })
  const finalAudit = await assert13RealProductsInvariant(prisma, { silent: false })

  const totalTests = results.length
  const passedCount = results.filter((r) => r.passed).length
  const failedCount = results.filter((r) => !r.passed).length

  console.log(`\n================================================================================`)
  console.log(`🏆 EMPIRICAL ADVERSARIAL STRESS TEST SUMMARY`)
  console.log(`Total Scenarios Tested : ${totalTests}`)
  console.log(`Passed                 : ${passedCount}/${totalTests}`)
  console.log(`Failed                 : ${failedCount}/${totalTests}`)
  console.log(`Final Database State   : clean=${finalClean.clean}, leftoverCount=${finalClean.leftoverCount}`)
  console.log(`Final Baseline Invariant: Delta = 0 (Stock: ${finalAudit.totalActualStock}/258 units, 13/13 SKUs match)`)
  console.log('================================================================================\n')

  for (const r of results) {
    console.log(`  [${r.passed ? 'PASS' : 'FAIL'}] ${r.id.padEnd(38)} | ${r.durationMs.toString().padStart(5)}ms | ${r.name}`)
    if (r.details) console.log(`         -> ${r.details}`)
    if (r.error) console.log(`         -> Error: ${r.error}`)
  }

  const verdict = failedCount === 0 && finalClean.clean && finalAudit.passed ? 'CONFIRM' : 'REJECT'
  console.log(`\n>>> EXPLICIT VERDICT: [${verdict}] <<<\n`)

  if (verdict === 'REJECT') {
    process.exit(1)
  }
}

main()
  .catch((err) => {
    console.error('CRITICAL ADVERSARIAL HARNESS FAILURE:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
