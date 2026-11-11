/**
 * scripts/adversarial-fk-cascade.ts
 *
 * EMPIRICAL ADVERSARIAL STRESS TEST SUITE — FK CASCADE & RESTORE_AND_CLEAN HARDENING
 * Author: teamwork_challenger_1_m1 (FK Cascade Challenger)
 * 
 * Objectives:
 * 1. Inject complex cross-table test artifacts violating standard naive deletion:
 *    - SalesInvoiceItem -> Product (RESTRICT FK)
 *    - PurchaseInvoiceItem -> Product (RESTRICT FK)
 *    - BomComponent dual FK (Finished Product <-> Material Product, including circular links)
 *    - OrderItem -> Product & Order -> Customer & Shipment / OrderEvent / AfterSalesCase -> Order
 *    - Invoices/Orders/BOM mixing synthetic products with REAL canonical products
 *    - Dummy phone numbers (0900111222, 0979998888)
 *    - Test StaffUser & BehaviorLog
 *    - Campaigns, Vouchers, SocialPosts, ContentSources
 *    - Shopee Spool Queue & DLQ files
 * 2. Directly mutate real product attributes (stock, sellPrice) in Supabase.
 * 3. Trigger RESTORE_AND_CLEAN via test_guard_helper and direct POST /api/ledger/test-guard.
 * 4. Empirically verify:
 *    - 0 PostgreSQL Foreign Key errors (error 23503)
 *    - 100% clean state (clean === true, leftoverCount === 0)
 *    - 13 real products of thaimy1605 intact with Delta = 0 in both Supabase & SQLite.
 */

import fs from 'node:fs'
import path from 'node:path'
import { db } from '../src/lib/db'
import {
  takeSnapshot,
  restoreAndClean,
  verifyCleanState,
  assert13RealProductsInvariant,
  AUTHORITATIVE_13_PRODUCTS,
  AUTHORITATIVE_TOTAL_STOCK,
  DEFAULT_BASE_URL,
} from './test_guard_helper'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { DatabaseSync } = require('node:sqlite')

interface AssertionResult {
  step: string
  passed: boolean
  details: string
  error?: string
}

const auditTrail: AssertionResult[] = []

function assertEmpirical(step: string, condition: boolean, details: string) {
  if (condition) {
    console.log(`  ✅ [PASS] ${step}: ${details}`)
    auditTrail.push({ step, passed: true, details })
  } else {
    console.error(`  ❌ [FAIL] ${step}: ${details}`)
    auditTrail.push({ step, passed: false, details })
    throw new Error(`Empirical Challenge Failed at [${step}]: ${details}`)
  }
}

async function getSqliteProducts(): Promise<Array<{ sku: string; stock: number; sellPrice: number }>> {
  const sqliteDbPath = path.resolve(process.cwd(), 'db', 'custom.db')
  if (!fs.existsSync(sqliteDbPath)) {
    throw new Error(`SQLite database not found at ${sqliteDbPath}`)
  }
  const sqlite = new DatabaseSync(sqliteDbPath)
  try {
    const rows = sqlite.prepare('SELECT sku, stock, sellPrice FROM Product ORDER BY sku ASC').all() as Array<{
      sku: string
      stock: number
      sellPrice: number
    }>
    return rows
  } finally {
    sqlite.close()
  }
}

async function verifySqliteCanonicalBaseline(stepName: string) {
  const rows = await getSqliteProducts()
  // Filter for the 13 canonical SKUs
  const canonicalSkus = new Set(AUTHORITATIVE_13_PRODUCTS.map((p) => p.sku))
  const matchedCanonical = rows.filter((r) => canonicalSkus.has(r.sku))
  const syntheticRows = rows.filter((r) => r.sku.startsWith('SP-TEST-') || r.sku.startsWith('QA-'))

  assertEmpirical(
    `${stepName} - SQLite Canonical Count`,
    matchedCanonical.length === 13,
    `SQLite contains exactly 13 canonical products (actual: ${matchedCanonical.length})`
  )

  assertEmpirical(
    `${stepName} - SQLite Zero Synthetic Leftover`,
    syntheticRows.length === 0,
    `SQLite contains 0 synthetic test products (actual: ${syntheticRows.length})`
  )

  let totalStock = 0
  for (const exp of AUTHORITATIVE_13_PRODUCTS) {
    const act = matchedCanonical.find((r) => r.sku === exp.sku)
    assertEmpirical(
      `${stepName} - SQLite SKU Invariant: ${exp.sku}`,
      Boolean(act && act.stock === exp.stock && act.sellPrice === exp.sellPrice),
      `SKU ${exp.sku}: stock=${act?.stock} (exp: ${exp.stock}), price=${act?.sellPrice} (exp: ${exp.sellPrice})`
    )
    if (act) totalStock += act.stock
  }

  assertEmpirical(
    `${stepName} - SQLite Total Stock Delta = 0`,
    totalStock === AUTHORITATIVE_TOTAL_STOCK,
    `SQLite total canonical stock is ${totalStock}/${AUTHORITATIVE_TOTAL_STOCK}`
  )
}

async function runAdversarialCascadeChallenge() {
  console.log('================================================================================')
  console.log('⚡ EMPIRICAL ADVERSARIAL STRESS TEST: FK CASCADE & RESTORE_AND_CLEAN')
  console.log('================================================================================\n')

  const centralWh = await db.warehouse.findFirst({ where: { isDefault: true } })
  const warehouseId = centralWh?.id || 'cmvnybfk10004veegeksmstwz'

  const channel = await db.channel.findFirst()
  const channelId = channel?.id || 'cmvqainai0000ve3wcldb6o62'

  const realProd1 = await db.product.findUnique({ where: { sku: 'BM-TEA-10' } })
  const realProd2 = await db.product.findUnique({ where: { sku: 'BM-DEC-SEN-KEM' } })
  if (!realProd1 || !realProd2) {
    throw new Error('Pre-condition failed: Real canonical products BM-TEA-10 and BM-DEC-SEN-KEM must exist')
  }

  // --------------------------------------------------------------------------
  // PHASE 0: PRE-CHECK BASELINE
  // --------------------------------------------------------------------------
  console.log('▶ [PHASE 0] Pre-Check Baseline Status')
  const initialAudit = await assert13RealProductsInvariant(db, { silent: true })
  assertEmpirical(
    'Phase 0 - Initial Baseline Audit',
    initialAudit.passed,
    `Pre-test Supabase baseline is 100% canonical (Stock: ${initialAudit.totalActualStock}/258)`
  )
  await verifySqliteCanonicalBaseline('Phase 0')

  // --------------------------------------------------------------------------
  // PHASE 1: WAVE 1 — COMPLEX CROSS-TABLE INJECTION & MUTATION
  // --------------------------------------------------------------------------
  console.log('\n▶ [PHASE 1] Wave 1: Complex Cross-Table Injection & Foreign Key Bomb')

  // 1.1 Snapshot baseline before test
  console.log('  Taking snapshot...')
  await takeSnapshot({ silent: true })

  // 1.2 Inject Synthetic Products
  console.log('  Creating synthetic products SP-TEST-ADV-A and SP-TEST-ADV-B...')
  const synthProdA = await db.product.create({
    data: {
      sku: 'SP-TEST-ADV-A',
      name: '[QA TEST] Adversarial Finished Combo A',
      costPrice: 40000,
      sellPrice: 99000,
      stock: 50,
      status: 'ACTIVE',
      type: 'COMBO',
      unit: 'bộ',
      ownerWarehouseId: warehouseId,
    },
  })

  const synthProdB = await db.product.create({
    data: {
      sku: 'SP-TEST-ADV-B',
      name: '[QA TEST] Adversarial Material Component B',
      costPrice: 20000,
      sellPrice: 45000,
      stock: 100,
      status: 'ACTIVE',
      type: 'SIMPLE',
      unit: 'cái',
      ownerWarehouseId: warehouseId,
    },
  })

  // 1.3 Inject Dual / Cross BOM Components
  console.log('  Injecting BomComponents: A -> B, and B -> RealProduct (BM-TEA-10)...')
  const bom1 = await db.bomComponent.create({
    data: {
      productId: synthProdA.id,
      componentProductId: synthProdB.id,
      quantity: 2,
    },
  })
  const bom2 = await db.bomComponent.create({
    data: {
      productId: synthProdB.id,
      componentProductId: realProd1.id, // Linking synthetic parent to real component!
      quantity: 1,
    },
  })
  assertEmpirical(
    'Phase 1 - BOM Injection',
    Boolean(bom1.id && bom2.id),
    'Created dual BomComponent with cross-linking to real product'
  )

  // 1.4 Inject Synthetic Partner & Purchase Invoice with Items
  console.log('  Injecting Partner & PurchaseInvoiceItem referencing both synthetic & real products...')
  const synthPartner = await db.partner.create({
    data: {
      code: 'NCC-TEST-ADV-01',
      name: 'Nhà Cung Cấp Thử Nghiệm Đối Kháng [TEST]',
      phone: '0912345678',
      type: 'SUPPLIER',
    },
  })

  const synthPurchaseInv = await db.purchaseInvoice.create({
    data: {
      code: 'PO-TEST-ADV-001',
      partnerId: synthPartner.id,
      total: 1000000,
      subtotal: 1000000,
      status: 'POSTED',
      note: '[TEST] Nhập hàng đối kháng kiểm thử FK 23503',
    },
  })

  // PurchaseInvoiceItem 1 -> synthProdA (RESTRICT FK)
  await db.purchaseInvoiceItem.create({
    data: {
      invoiceId: synthPurchaseInv.id,
      productId: synthProdA.id,
      quantity: 10,
      unitPrice: 40000,
      amount: 400000,
    },
  })

  // PurchaseInvoiceItem 2 -> realProd1 (BM-TEA-10)
  await db.purchaseInvoiceItem.create({
    data: {
      invoiceId: synthPurchaseInv.id,
      productId: realProd1.id,
      quantity: 20,
      unitPrice: 25000,
      amount: 500000,
    },
  })

  // 1.5 Inject Synthetic Customer & Order with Items
  console.log('  Injecting Customer with dummy phone and Order with items...')
  const synthCustomer = await db.customer.create({
    data: {
      name: 'Khách Hàng [TEST] FK Stress Cascade',
      phone: '0900111222',
      email: 'cust1_R1-test@uudam.vn',
    },
  })

  const synthOrder = await db.order.create({
    data: {
      code: 'ORD-TEST-ADV-001',
      customerId: synthCustomer.id,
      channelId: channelId,
      status: 'PENDING',
      total: 250000,
      subtotal: 250000,
      warehouseId: warehouseId,
      note: '[TEST] Đơn hàng đối kháng kiểm định FK',
    },
  })

  // OrderItem 1 -> synthProdB
  await db.orderItem.create({
    data: {
      orderId: synthOrder.id,
      productId: synthProdB.id,
      quantity: 2,
      price: 45000,
    },
  })

  // OrderItem 2 -> realProd2 (BM-DEC-SEN-KEM)
  await db.orderItem.create({
    data: {
      orderId: synthOrder.id,
      productId: realProd2.id,
      quantity: 1,
      price: 50000,
    },
  })

  // 1.6 Inject Shipment, OrderEvent, AfterSalesCase
  console.log('  Injecting Shipment, OrderEvent, AfterSalesCase on test Order...')
  await db.shipment.create({
    data: {
      orderId: synthOrder.id,
      carrier: 'GHN',
      trackingCode: 'TRA-R1-ADV-001',
      status: 'DISPATCHED',
      fee: 25000,
    },
  })

  await db.orderEvent.create({
    data: {
      orderId: synthOrder.id,
      type: 'CREATED',
      actor: 'TEST_RUNNER',
      title: '[TEST] Tạo đơn kiểm định FK',
    },
  })

  await db.afterSalesCase.create({
    data: {
      code: 'ASC-TEST-ADV-01',
      orderId: synthOrder.id,
      type: 'RETURN',
      reason: 'đòi hoàn tiền gấp đôi kiểm thử đối kháng',
      status: 'PENDING',
    },
  })

  // 1.7 Inject SalesInvoice and SalesInvoiceItem (RESTRICT FK to Product)
  console.log('  Injecting SalesInvoice and SalesInvoiceItem referencing synthProdA and realProd1...')
  const synthSalesInv = await db.salesInvoice.create({
    data: {
      code: 'PXK-TEST-ADV-001',
      orderId: synthOrder.id,
      partnerId: synthPartner.id,
      subtotal: 200000,
      total: 200000,
      status: 'POSTED',
      note: '[TEST] Xuất kho kiểm thử FK 23503',
    },
  })

  // SalesInvoiceItem 1 -> synthProdA
  await db.salesInvoiceItem.create({
    data: {
      invoiceId: synthSalesInv.id,
      productId: synthProdA.id,
      quantity: 1,
      unitPrice: 99000,
      amount: 99000,
    },
  })

  // SalesInvoiceItem 2 -> realProd1 (BM-TEA-10)
  await db.salesInvoiceItem.create({
    data: {
      invoiceId: synthSalesInv.id,
      productId: realProd1.id,
      quantity: 1,
      unitPrice: 59000,
      amount: 59000,
    },
  })

  // 1.8 Inject DirectMessage, StaffUser, BehaviorLog, Campaign, Voucher
  console.log('  Injecting DirectMessage, StaffUser, BehaviorLog, Campaign, Voucher...')
  await db.directMessage.create({
    data: {
      channelKey: 'ZALO_OA',
      customerId: synthCustomer.id,
      sender: 'CUSTOMER',
      content: '[QA TEST] Tin nhắn kiểm thử đối kháng',
    },
  })

  const synthStaff = await db.staffUser.create({
    data: {
      username: 'test_fk_adversarial_user',
      displayName: 'Test Nhân Viên Adversarial FK',
      role: 'MARKETING',
      passwordHash: 'dummy_hash',
      status: 'ACTIVE',
    },
  })

  await db.behaviorLog.create({
    data: {
      userId: synthStaff.id,
      actorName: 'Test Runner',
      category: 'MUTATION',
      action: 'TEST_ACTION',
      summary: '[TEST] Kiểm thử đối kháng FK 23503',
      targetCode: 'TEST-CODE',
    },
  })

  await db.campaign.create({
    data: {
      code: 'CP-TEST-ADV-CASCADE',
      name: '[TEST] Chiến dịch đối kháng FK Cascade',
      status: 'UPCOMING',
      startDate: new Date('2026-12-01T00:00:00Z'),
      endDate: new Date('2026-12-05T00:00:00Z'),
    },
  })

  await db.voucher.create({
    data: {
      code: 'VC-TEST-ADV-CASCADE',
      title: '[TEST] Voucher đối kháng FK Cascade',
      discountType: 'PERCENT',
      discountValue: 10,
      minOrderAmount: 100000,
      active: true,
    },
  })

  // 1.9 Mutate Real Products attributes deliberately!
  console.log('  Deliberately mutating real products in Supabase: BM-TEA-10 stock -> 888, BM-DEC-SEN-KEM stock -> 0...')
  await db.product.update({
    where: { id: realProd1.id },
    data: { stock: 888, sellPrice: 11111 },
  })
  await db.product.update({
    where: { id: realProd2.id },
    data: { stock: 0, sellPrice: 999999 },
  })

  // 1.10 Inject Spool Queue Files
  console.log('  Injecting synthetic items into Shopee spool files...')
  const queuePath = path.resolve('scripts/.shopee_inbound_queue.json')
  const dlqPath = path.resolve('scripts/.shopee_dlq.json')
  const synthQueueItem = {
    idempotencyKey: 'TEST-ADV-QUEUE-001',
    data: {
      sku: 'SP-TEST-ADV-QUEUE',
      name: '[TEST] Shopee Inbound Synthetic Order',
      customerPhone: '0900111222',
    },
    receivedAt: new Date().toISOString(),
  }
  const synthDlqItem = {
    idempotencyKey: 'TEST-ADV-DLQ-001',
    reason: 'SYNTHETIC TEST ADVERSARIAL DLQ',
    item: { sku: 'SP-TEST-ADV-DLQ', name: '[TEST] Shopee DLQ Synthetic' },
  }
  fs.writeFileSync(queuePath, JSON.stringify([synthQueueItem], null, 2), 'utf-8')
  fs.writeFileSync(dlqPath, JSON.stringify([synthDlqItem], null, 2), 'utf-8')

  // Check detected test artifacts before restore
  console.log('\n  Verifying detection of injected artifacts...')
  const statusBeforeClean = await fetch(`${DEFAULT_BASE_URL}/api/ledger/test-guard`).then((r) => r.json())
  assertEmpirical(
    'Phase 1 - Detection Pre-Clean',
    statusBeforeClean.clean === false && statusBeforeClean.leftoverCount >= 10,
    `Detected ${statusBeforeClean.leftoverCount} synthetic artifacts before cleanup (clean=false)`
  )

  // --------------------------------------------------------------------------
  // PHASE 2: TRIGGER RESTORE_AND_CLEAN & AUDIT FK 23503 IMMUNITY
  // --------------------------------------------------------------------------
  console.log('\n▶ [PHASE 2] Trigger RESTORE_AND_CLEAN & Verify 0 FK Error 23503')
  let cleanError: any = null
  let restoreCleanResult: any = null

  try {
    restoreCleanResult = await restoreAndClean({ silent: false })
  } catch (err: any) {
    cleanError = err
  }

  assertEmpirical(
    'Phase 2 - 0 PostgreSQL FK Error 23503',
    cleanError === null && restoreCleanResult?.ok === true,
    cleanError ? `Triggered error: ${cleanError.message}` : 'RESTORE_AND_CLEAN completed with 0 errors'
  )

  // --------------------------------------------------------------------------
  // PHASE 3: VERIFY CLEAN STATE (leftoverCount === 0, clean === true)
  // --------------------------------------------------------------------------
  console.log('\n▶ [PHASE 3] Verify Clean State on All 18 Models & Spool Files')
  const cleanStatus = await verifyCleanState()
  assertEmpirical(
    'Phase 3 - Clean State Verification',
    cleanStatus.clean === true && cleanStatus.leftoverCount === 0,
    `System clean=${cleanStatus.clean}, leftoverCount=${cleanStatus.leftoverCount}`
  )

  // --------------------------------------------------------------------------
  // PHASE 4: AUDIT 13 REAL PRODUCTS IN SUPABASE & SQLITE (DELTA = 0)
  // --------------------------------------------------------------------------
  console.log('\n▶ [PHASE 4] Audit 13 Real Products Invariants (Delta = 0)')
  const supabaseAudit = await assert13RealProductsInvariant(db, { silent: false })
  assertEmpirical(
    'Phase 4 - Supabase Canonical Delta = 0',
    supabaseAudit.passed && supabaseAudit.totalActualStock === 258,
    `Supabase total stock: ${supabaseAudit.totalActualStock}/258, Count: ${supabaseAudit.actualCount}/13`
  )

  // Verify that BM-TEA-10 and BM-DEC-SEN-KEM mutations were completely reverted
  const restoredProd1 = await db.product.findUnique({ where: { sku: 'BM-TEA-10' } })
  const restoredProd2 = await db.product.findUnique({ where: { sku: 'BM-DEC-SEN-KEM' } })
  assertEmpirical(
    'Phase 4 - BM-TEA-10 Restored Invariant',
    Boolean(restoredProd1 && restoredProd1.stock === 50 && restoredProd1.sellPrice === 59000),
    `BM-TEA-10: stock=${restoredProd1?.stock} (exp: 50), sellPrice=${restoredProd1?.sellPrice} (exp: 59000)`
  )
  assertEmpirical(
    'Phase 4 - BM-DEC-SEN-KEM Restored Invariant',
    Boolean(restoredProd2 && restoredProd2.stock === 16 && restoredProd2.sellPrice === 50000),
    `BM-DEC-SEN-KEM: stock=${restoredProd2?.stock} (exp: 16), sellPrice=${restoredProd2?.sellPrice} (exp: 50000)`
  )

  // Verify SQLite custom.db
  await verifySqliteCanonicalBaseline('Phase 4')

  // --------------------------------------------------------------------------
  // PHASE 5: WAVE 2 — REVERSE / CIRCULAR BOM & RE-TEST IDEMPOTENCY
  // --------------------------------------------------------------------------
  console.log('\n▶ [PHASE 5] Wave 2: Circular BOM & Idempotency Stress')
  const prodC = await db.product.create({
    data: {
      sku: 'SP-TEST-BOM-PARENT-C',
      name: '[QA TEST] Circular BOM Parent C',
      costPrice: 50000,
      sellPrice: 120000,
      stock: 10,
      ownerWarehouseId: warehouseId,
    },
  })

  const prodD = await db.product.create({
    data: {
      sku: 'SP-TEST-BOM-CHILD-D',
      name: '[QA TEST] Circular BOM Child D',
      costPrice: 20000,
      sellPrice: 40000,
      stock: 20,
      ownerWarehouseId: warehouseId,
    },
  })

  // Circular BOM: C -> D and D -> C
  await db.bomComponent.create({
    data: { productId: prodC.id, componentProductId: prodD.id, quantity: 1 },
  })
  await db.bomComponent.create({
    data: { productId: prodD.id, componentProductId: prodC.id, quantity: 1 },
  })

  // Also add SalesInvoiceItem to prodC
  const salesInvWave2 = await db.salesInvoice.create({
    data: {
      code: 'PXK-TEST-WAVE2-001',
      subtotal: 120000,
      total: 120000,
      status: 'POSTED',
      note: '[TEST] Wave 2 Sales Invoice',
    },
  })
  await db.salesInvoiceItem.create({
    data: {
      invoiceId: salesInvWave2.id,
      productId: prodC.id,
      quantity: 1,
      unitPrice: 120000,
      amount: 120000,
    },
  })

  console.log('  Triggering second RESTORE_AND_CLEAN...')
  const wave2Clean = await restoreAndClean({ silent: true })
  assertEmpirical(
    'Phase 5 - Wave 2 Clean Result',
    wave2Clean.ok === true,
    `Wave 2 cleanup succeeded: restored ${wave2Clean.restoredProductsCount} products, removed ${wave2Clean.removedTestArtifactsCount} artifacts`
  )

  const wave2CleanStatus = await verifyCleanState()
  assertEmpirical(
    'Phase 5 - Wave 2 Clean State Verification',
    wave2CleanStatus.clean === true && wave2CleanStatus.leftoverCount === 0,
    `Wave 2 system clean=${wave2CleanStatus.clean}, leftoverCount=${wave2CleanStatus.leftoverCount}`
  )

  const wave2SupabaseAudit = await assert13RealProductsInvariant(db, { silent: true })
  assertEmpirical(
    'Phase 5 - Wave 2 Supabase Delta = 0',
    wave2SupabaseAudit.passed && wave2SupabaseAudit.totalActualStock === 258,
    `Wave 2 Supabase total stock: ${wave2SupabaseAudit.totalActualStock}/258`
  )
  await verifySqliteCanonicalBaseline('Phase 5')

  // --------------------------------------------------------------------------
  // SUMMARY
  // --------------------------------------------------------------------------
  console.log('\n================================================================================')
  console.log('🏆 TỔNG KẾT ADVERSARIAL STRESS TEST SUITE')
  console.log('================================================================================')
  const totalPassed = auditTrail.filter((x) => x.passed).length
  const totalFailed = auditTrail.filter((x) => !x.passed).length
  console.log(`Tổng số assertions: ${auditTrail.length}`)
  console.log(`Thành công (PASS): ${totalPassed}`)
  console.log(`Thất bại (FAIL): ${totalFailed}`)
  console.log('================================================================================\n')

  return {
    totalPassed,
    totalFailed,
    auditTrail,
  }
}

if (require.main === module) {
  runAdversarialCascadeChallenge()
    .then(() => {
      console.log('✅ ADVERSARIAL FK CASCADE STRESS SUITE: 100% PASS — CONFIRMED!')
      process.exit(0)
    })
    .catch((err) => {
      console.error('❌ ADVERSARIAL FK CASCADE STRESS SUITE: FAILED!', err)
      process.exit(1)
    })
}

export { runAdversarialCascadeChallenge }
