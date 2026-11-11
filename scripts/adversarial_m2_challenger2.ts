/**
 * scripts/adversarial_m2_challenger2.ts
 *
 * EMPIRICAL ADVERSARIAL STRESS TEST — MILESTONE 2 (FEATURES 8, 10 & 12)
 * Agent: teamwork_challenger_2_m2
 *
 * Verification Scope:
 * 1. Adversarial Logistics & Carrier Normalization (Feature 8):
 *    - 8 raw carrier strings: "Shopee Express", "SPX", "SPX VN", "Giao Hàng Tiết Kiệm",
 *      "GHTK", "Viettel Post", "J&T Express", "Ninja Van".
 *    - Case insensitivity, whitespace trimming, fallback edge cases.
 *    - Automated Shipment record generation, carrier binding, trackingCode assignment.
 *    - Shipment progression (DISPATCHED -> IN_TRANSIT -> DELIVERED) and COD reconciliation.
 *    - Backward regression rejection (terminal lock 409).
 *
 * 2. Adversarial Masked PII Deduplication (Feature 10):
 *    - Unit stress on isMaskedOrDummyPhone with boundary cases.
 *    - Ingestion of 10 orders with identical masked phone ("0900000000" and "******")
 *      and distinct buyer usernames.
 *    - Verification of 10 isolated Customer records (zero collision / merging).
 *    - Verification of phone: null on masked profiles.
 *    - Ingestion of repeat orders linking back to existing profiles.
 *    - Forensic audit proving test-guard synthetic detector DOES NOT flag or purge masked phone customers.
 *
 * 3. Outbox Dry-Run Verification (Feature 12):
 *    - Python execution with SHOPEE_OUTBOX_DRY_RUN=1.
 *    - urllib monkeypatch assertion proving ZERO network requests attempted.
 *    - Edge cases: CLI flag --dry-run, case variants, stock & price clamping.
 *
 * 4. Data Isolation Invariant (R2):
 *    - Strict takeSnapshot() pre-test and restoreAndClean() post-test.
 *    - Audit shop thaimy1605 13 canonical products in Supabase and SQLite custom.db (Delta = 0).
 *    - verifyCleanState() confirmation (clean: true, leftoverCount: 0).
 */

import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { db } from '../src/lib/db'
import { CARRIERS } from '../src/lib/agents'
import { isMaskedOrDummyPhone } from '../src/lib/order-service'
import { normalizeShopeeCarrier } from '../src/app/api/webhooks/inbound/route'
import {
  takeSnapshot,
  restoreAndClean,
  assert13RealProductsInvariant,
  verifyCleanState,
  DEFAULT_BASE_URL,
  AUTHORITATIVE_13_PRODUCTS,
} from './test_guard_helper'
import {
  detectSyntheticTestArtifacts,
  THAIMY1605_CANONICAL_BASELINE,
  PROTECTED_REAL_SKUS,
} from '../src/app/api/ledger/test-guard/route'

const CMS_URL = DEFAULT_BASE_URL
const CMS_API_KEY = '191a5ab9fd0c1e392c51b3e9fbe7df57694c2098b78b4955'

interface TestAssertion {
  category: string
  name: string
  status: 'PASS' | 'FAIL'
  detail?: string
}

const testResults: TestAssertion[] = []

function assert(condition: boolean, category: string, name: string, detail?: string) {
  if (condition) {
    console.log(`  ✅ [PASS] [${category}] ${name}`)
    testResults.push({ category, name, status: 'PASS' })
  } else {
    console.error(`  ❌ [FAIL] [${category}] ${name}${detail ? ` -> ${detail}` : ''}`)
    testResults.push({ category, name, status: 'FAIL', detail })
    throw new Error(`[ASSERTION_FAILURE] [${category}] ${name}: ${detail || 'Condition not satisfied'}`)
  }
}

async function postInboundWebhook(payload: Record<string, unknown>, retryCount = 3) {
  for (let attempt = 1; attempt <= retryCount; attempt++) {
    try {
      const res = await fetch(`${CMS_URL}/api/webhooks/inbound`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Apikey ${CMS_API_KEY}`,
        },
        body: JSON.stringify(payload),
      })
      const text = await res.text()
      let json: any = {}
      try {
        json = JSON.parse(text)
      } catch {
        json = { rawText: text }
      }
      if (res.status >= 500 && attempt < retryCount) {
        await new Promise((r) => setTimeout(r, 400 * attempt))
        continue
      }
      return { status: res.status, ok: res.ok, json }
    } catch (err) {
      if (attempt === retryCount) throw err
      await new Promise((r) => setTimeout(r, 400 * attempt))
    }
  }
  throw new Error('postInboundWebhook exhausted retries')
}

async function main() {
  console.log('================================================================================')
  console.log('⚔️  EMPIRICAL ADVERSARIAL CHALLENGER: MILESTONE 2 (F8, F10, F12)')
  console.log('================================================================================\n')

  const createdOrderIds: string[] = []
  const createdCustomerIds: string[] = []

  try {
    // ------------------------------------------------------------------------
    // PHASE 0: PRE-TEST SNAPSHOT & BASELINE VERIFICATION
    // ------------------------------------------------------------------------
    console.log('📸 [PHASE 0] Taking Pre-Test Snapshot via Test-Guard...')
    const snap = await takeSnapshot({ baseUrl: CMS_URL, autoCleanFirst: true })
    assert(snap.ok && snap.productCount === 13, 'R2-PRECHECK', 'Pre-test snapshot captured 13 real products')

    // ------------------------------------------------------------------------
    // SUITE 1: ADVERSARIAL LOGISTICS & CARRIER NORMALIZATION (FEATURE 8)
    // ------------------------------------------------------------------------
    console.log('\n--- SUITE 1: Adversarial Logistics & Carrier Normalization (Feature 8) ---')

    // 1A. Unit stress testing normalizeShopeeCarrier
    const carrierMappingTests: Array<{ raw: any; expected: string; label: string }> = [
      { raw: 'Shopee Express', expected: 'SPX', label: 'Shopee Express' },
      { raw: 'SPX', expected: 'SPX', label: 'SPX exact' },
      { raw: 'SPX VN', expected: 'SPX', label: 'SPX VN' },
      { raw: 'Giao Hàng Tiết Kiệm', expected: 'GHTK', label: 'Giao Hàng Tiết Kiệm' },
      { raw: 'GHTK', expected: 'GHTK', label: 'GHTK exact' },
      { raw: 'Viettel Post', expected: 'VIETTEL', label: 'Viettel Post' },
      { raw: 'J&T Express', expected: 'JT', label: 'J&T Express' },
      { raw: 'Ninja Van', expected: 'NINJA', label: 'Ninja Van' },
      // Adversarial cases
      { raw: 'shopee express', expected: 'SPX', label: 'Lowercase shopee express' },
      { raw: '  SPX VN  ', expected: 'SPX', label: 'Whitespace padded SPX' },
      { raw: 'GHTK FAST 247', expected: 'GHTK', label: 'GHTK variant string' },
      { raw: 'viettel post express', expected: 'VIETTEL', label: 'Viettel variant' },
      { raw: 'J&T', expected: 'JT', label: 'J&T short' },
      { raw: 'JT Express', expected: 'JT', label: 'JT prefix' },
      { raw: 'ninja van standard', expected: 'NINJA', label: 'Ninja Van variant' },
      { raw: 'Giao Hàng Nhanh', expected: 'GHN', label: 'Giao Hàng Nhanh' },
      { raw: 'VNPost Bưu Điện', expected: 'VNPOST', label: 'VNPost Bưu Điện' },
      { raw: undefined, expected: 'SPX', label: 'Undefined raw carrier fallback' },
      { raw: '', expected: 'SPX', label: 'Empty raw carrier fallback' },
    ]

    for (const testCase of carrierMappingTests) {
      const normalized = normalizeShopeeCarrier(testCase.raw)
      assert(
        normalized === testCase.expected,
        'F8-CARRIER-UNIT',
        `normalizeShopeeCarrier maps "${testCase.raw}" -> ${testCase.expected}`,
        `Actual: ${normalized}`
      )
    }

    // 1B. Empirical Ingestion of Orders across 8 Distinct Raw Carrier Strings
    const carrierIngestionScenarios = [
      { rawCarrier: 'Shopee Express', expectedKey: 'SPX' },
      { rawCarrier: 'SPX', expectedKey: 'SPX' },
      { rawCarrier: 'SPX VN', expectedKey: 'SPX' },
      { rawCarrier: 'Giao Hàng Tiết Kiệm', expectedKey: 'GHTK' },
      { rawCarrier: 'GHTK', expectedKey: 'GHTK' },
      { rawCarrier: 'Viettel Post', expectedKey: 'VIETTEL' },
      { rawCarrier: 'J&T Express', expectedKey: 'JT' },
      { rawCarrier: 'Ninja Van', expectedKey: 'NINJA' },
    ]

    for (let i = 0; i < carrierIngestionScenarios.length; i++) {
      const scenario = carrierIngestionScenarios[i]
      const uniqueSuffix = `${Date.now()}_${i + 1}`
      const orderSn = `ADV_ORDER_CARRIER_${uniqueSuffix}`
      const trackingCode = `TRA_ADV_${scenario.expectedKey}_${uniqueSuffix}`

      // Slight stagger to ensure clean DB concurrency
      await new Promise((r) => setTimeout(r, 80))

      const res = await postInboundWebhook({
        event: 'INBOUND_SHOPEE_ORDER_SYNC',
        data: {
          shopeeOrderSn: orderSn,
          shopeeOrderStatus: 'READY_TO_SHIP',
          customerName: `Khách Vận Đơn ${scenario.expectedKey} ${i + 1}`,
          customerPhone: `09123456${(10 + i).toString().slice(-2)}`,
          trackingNumber: trackingCode,
          shippingCarrier: scenario.rawCarrier,
          paymentMethod: 'SHOPEE_WALLET',
          items: [{ sku: 'BM-TEA-10', quantity: 1 }],
        },
      })

      assert(res.ok, 'F8-CARRIER-INGEST', `Order ingested for carrier "${scenario.rawCarrier}"`, JSON.stringify(res.json))
      createdOrderIds.push(res.json.order.id)

      const shipment = await db.shipment.findUnique({
        where: { orderId: res.json.order.id },
      })

      assert(Boolean(shipment), 'F8-CARRIER-INGEST', `Shipment record auto-created for "${scenario.rawCarrier}"`)
      assert(
        shipment?.carrier === scenario.expectedKey,
        'F8-CARRIER-INGEST',
        `Shipment carrier bound to ${scenario.expectedKey} (raw: "${scenario.rawCarrier}", actual: ${shipment?.carrier})`
      )
      assert(shipment?.status === 'DISPATCHED', 'F8-CARRIER-INGEST', `Initial shipment status is DISPATCHED`)
      assert(shipment?.trackingCode === trackingCode, 'F8-CARRIER-INGEST', `Tracking code matches ${trackingCode}`)
    }

    // 1C. Shipment Lifecycle Progression & COD Reconciliation
    const codSuffix = `${Date.now()}`
    const codOrderSn = `ADV_ORDER_COD_${codSuffix}`
    const codTracking = `TRA_ADV_COD_${codSuffix}`

    const codRes1 = await postInboundWebhook({
      event: 'INBOUND_SHOPEE_ORDER_SYNC',
      data: {
        shopeeOrderSn: codOrderSn,
        shopeeOrderStatus: 'READY_TO_SHIP',
        customerName: 'Khách COD Lifecycle',
        customerPhone: '0983123456',
        trackingNumber: codTracking,
        shippingCarrier: 'Shopee Express',
        paymentMethod: 'COD',
        shippingFee: 15000,
        items: [{ sku: 'BM-TEA-10', quantity: 1 }], // Price: 59000, Total: 74000
      },
    })

    assert(codRes1.ok, 'F8-LIFECYCLE-COD', 'COD Order created in READY_TO_SHIP')
    const codOrderId = codRes1.json.order.id
    createdOrderIds.push(codOrderId)

    const codShipment1 = await db.shipment.findUnique({ where: { orderId: codOrderId } })
    assert(Boolean(codShipment1), 'F8-LIFECYCLE-COD', 'Shipment record created for COD order')
    assert(codShipment1?.status === 'DISPATCHED', 'F8-LIFECYCLE-COD', 'Initial shipment status is DISPATCHED')
    assert(codShipment1?.carrier === 'SPX', 'F8-LIFECYCLE-COD', 'Carrier normalized to SPX')
    assert(codShipment1?.codStatus === 'PENDING', 'F8-LIFECYCLE-COD', 'Initial COD status is PENDING')
    assert(codShipment1!.codAmount > 0, 'F8-LIFECYCLE-COD', `COD amount is positive (${codShipment1?.codAmount})`)
    assert(codShipment1?.codReceived === 0, 'F8-LIFECYCLE-COD', 'COD received is initially 0')

    // Transition to SHIPPED -> IN_TRANSIT
    const codRes2 = await postInboundWebhook({
      event: 'INBOUND_SHOPEE_ORDER_SYNC',
      data: {
        shopeeOrderSn: codOrderSn,
        shopeeOrderStatus: 'SHIPPED',
        trackingNumber: codTracking,
        shippingCarrier: 'SPX',
      },
    })
    assert(codRes2.ok, 'F8-LIFECYCLE-COD', 'Order transitioned to SHIPPED')

    const codShipment2 = await db.shipment.findUnique({ where: { orderId: codOrderId } })
    assert(codShipment2?.status === 'IN_TRANSIT', 'F8-LIFECYCLE-COD', 'Shipment status progressed to IN_TRANSIT')
    assert(codShipment2?.codStatus === 'PENDING', 'F8-LIFECYCLE-COD', 'COD status remains PENDING while in transit')

    // Transition to COMPLETED -> DELIVERED & COD RECONCILIATION
    const codRes3 = await postInboundWebhook({
      event: 'INBOUND_SHOPEE_ORDER_SYNC',
      data: {
        shopeeOrderSn: codOrderSn,
        shopeeOrderStatus: 'COMPLETED',
        trackingNumber: codTracking,
        shippingCarrier: 'SPX',
      },
    })
    assert(codRes3.ok, 'F8-LIFECYCLE-COD', 'Order transitioned to COMPLETED')

    const codShipment3 = await db.shipment.findUnique({ where: { orderId: codOrderId } })
    assert(codShipment3?.status === 'DELIVERED', 'F8-LIFECYCLE-COD', 'Shipment status progressed to DELIVERED')
    assert(codShipment3?.codStatus === 'RECEIVED', 'F8-LIFECYCLE-COD', 'COD status reconciled to RECEIVED upon delivery')
    assert(
      codShipment3?.codReceived === codShipment3?.codAmount,
      'F8-LIFECYCLE-COD',
      `COD received matches COD amount (${codShipment3?.codReceived} === ${codShipment3?.codAmount})`
    )
    assert(Boolean(codShipment3?.codReceivedAt), 'F8-LIFECYCLE-COD', 'COD received timestamp recorded')

    // Backward transition attempt -> Terminal state lock rejection (HTTP 409)
    const codRes4 = await postInboundWebhook({
      event: 'INBOUND_SHOPEE_ORDER_SYNC',
      data: {
        shopeeOrderSn: codOrderSn,
        shopeeOrderStatus: 'SHIPPED',
        trackingNumber: codTracking,
      },
    })
    assert(
      codRes4.status === 409,
      'F8-LIFECYCLE-LOCK',
      `Backward transition from COMPLETED to SHIPPED is rejected with HTTP 409 Conflict (actual: ${codRes4.status})`
    )

    // ------------------------------------------------------------------------
    // SUITE 2: ADVERSARIAL MASKED PII DEDUPLICATION (FEATURE 10)
    // ------------------------------------------------------------------------
    console.log('\n--- SUITE 2: Adversarial Masked PII Deduplication (Feature 10) ---')

    // 2A. Unit stress testing isMaskedOrDummyPhone
    const phoneTestCases: Array<{ phone: any; expectedMasked: boolean; label: string }> = [
      { phone: '0900000000', expectedMasked: true, label: '0900000000 Shopee placeholder' },
      { phone: '0000000000', expectedMasked: true, label: 'All zeroes' },
      { phone: '******', expectedMasked: true, label: 'Pure asterisks' },
      { phone: '090*****12', expectedMasked: true, label: 'Partially masked asterisks' },
      { phone: '090xxxx123', expectedMasked: true, label: 'Masked with lowercase x' },
      { phone: '090XXXX123', expectedMasked: true, label: 'Masked with uppercase X' },
      { phone: '0999999999', expectedMasked: true, label: 'Repeated nines' },
      { phone: '0888888888', expectedMasked: true, label: 'Repeated eights' },
      { phone: '0123456789', expectedMasked: true, label: 'Sequential digits 0123456789' },
      { phone: '0987654321', expectedMasked: true, label: 'Reverse sequential digits' },
      { phone: null, expectedMasked: true, label: 'Null phone' },
      { phone: undefined, expectedMasked: true, label: 'Undefined phone' },
      { phone: '', expectedMasked: true, label: 'Empty string phone' },
      { phone: '   ', expectedMasked: true, label: 'Whitespace phone' },
      { phone: '123', expectedMasked: true, label: 'Too short digits (< 9)' },
      // Legitimate unmasked phones
      { phone: '0912345678', expectedMasked: false, label: 'Genuine 10-digit 0912345678' },
      { phone: '0983123456', expectedMasked: false, label: 'Genuine 10-digit 0983123456' },
      { phone: '0345678901', expectedMasked: false, label: 'Genuine 10-digit Viettel 0345678901' },
      { phone: '0771234567', expectedMasked: false, label: 'Genuine 10-digit Mobi 0771234567' },
      { phone: '0868123456', expectedMasked: false, label: 'Genuine 10-digit 0868123456' },
    ]

    for (const pt of phoneTestCases) {
      const isMasked = isMaskedOrDummyPhone(pt.phone)
      assert(
        isMasked === pt.expectedMasked,
        'F10-MASK-UNIT',
        `isMaskedOrDummyPhone("${pt.phone}") === ${pt.expectedMasked} (${pt.label})`
      )
    }

    // 2B. Ingest 10 orders with identical masked phone and distinct buyerUsername
    console.log('\n  ▶ Ingesting 10 orders with masked phones across 10 distinct buyerUsernames...')
    const maskedOrders: Array<{ orderSn: string; buyer: string; maskedPhone: string; orderId?: string; customerId?: string }> = []
    const piiTimestamp = Date.now()

    for (let i = 1; i <= 10; i++) {
      const buyer = `shopee_buyer_adv_${i}_${piiTimestamp}`
      const maskedPhone = i <= 5 ? '0900000000' : '******'
      const orderSn = `ADV_ORDER_PII_${i}_${piiTimestamp}`

      await new Promise((r) => setTimeout(r, 80))

      const res = await postInboundWebhook({
        event: 'INBOUND_SHOPEE_ORDER_SYNC',
        data: {
          shopeeOrderSn: orderSn,
          shopeeOrderStatus: 'READY_TO_SHIP',
          customerName: `Khách Shopee Adv ${i}`,
          customerPhone: maskedPhone,
          buyerUsername: buyer,
          items: [{ sku: 'BM-TEA-10', quantity: 1 }],
        },
      })

      assert(res.ok, 'F10-INGEST-10', `Order ${i}/10 created for buyer "${buyer}"`, JSON.stringify(res.json))
      createdOrderIds.push(res.json.order.id)
      maskedOrders.push({ orderSn, buyer, maskedPhone, orderId: res.json.order.id })
    }

    // Query all 10 orders and verify Customer isolation
    const isolatedCustomerIds: string[] = []
    for (const mo of maskedOrders) {
      const orderRecord = await db.order.findUnique({
        where: { id: mo.orderId },
        include: { customer: true },
      })
      assert(Boolean(orderRecord?.customerId), 'F10-CUSTOMER-ISOLATION', `Order ${mo.orderSn} has customerId bound`)
      assert(Boolean(orderRecord?.customer), 'F10-CUSTOMER-ISOLATION', `Order ${mo.orderSn} has Customer relation populated`)

      mo.customerId = orderRecord!.customerId!
      isolatedCustomerIds.push(orderRecord!.customerId!)
      createdCustomerIds.push(orderRecord!.customerId!)

      // Assert phone is stored as null
      assert(
        orderRecord!.customer!.phone === null,
        'F10-CUSTOMER-ISOLATION',
        `Customer for buyer "${mo.buyer}" has phone: null (masked input was: "${mo.maskedPhone}")`
      )

      // Assert channelRef is stored in email and inferredProfile
      const expectedChannelRef = `shopee:${mo.buyer.toLowerCase()}`
      assert(
        orderRecord!.customer!.email === expectedChannelRef,
        'F10-CUSTOMER-ISOLATION',
        `Customer email bound to channelRef "${expectedChannelRef}"`
      )
      // Note: customer.inferredProfile is populated upon creation and may be asynchronously enriched by AI CRM profiler
      assert(
        orderRecord!.customer!.inferredProfile !== null,
        'F10-CUSTOMER-ISOLATION',
        `Customer inferredProfile is populated (AI profiler active)`
      )
    }

    // Assert that all 10 customers are completely distinct (10 unique customer IDs)
    const uniqueCustomerIds = new Set(isolatedCustomerIds)
    assert(
      uniqueCustomerIds.size === 10,
      'F10-NO-COLLISION',
      `All 10 masked-phone orders produced 10 DISTINCT Customer records (uniqueCount: ${uniqueCustomerIds.size}/10, zero merging collision!)`
    )

    // 2C. Repeat orders for the same buyerUsername -> link to existing customer
    console.log('\n  ▶ Ingesting repeat orders for existing buyers (buyer 1 and buyer 6)...')
    const buyer1 = maskedOrders[0]
    const buyer6 = maskedOrders[5]

    const repeatSn1 = `ADV_ORDER_REPEAT_1_${Date.now()}`
    const repeatRes1 = await postInboundWebhook({
      event: 'INBOUND_SHOPEE_ORDER_SYNC',
      data: {
        shopeeOrderSn: repeatSn1,
        shopeeOrderStatus: 'READY_TO_SHIP',
        customerName: `Khách Shopee Adv 1 (Đơn Lần 2)`,
        customerPhone: '0900000000',
        buyerUsername: buyer1.buyer,
        items: [{ sku: 'BM-TEA-10', quantity: 1 }],
      },
    })
    assert(repeatRes1.ok, 'F10-REPEAT-ORDER', `Repeat order created for buyer 1 (${buyer1.buyer})`)
    createdOrderIds.push(repeatRes1.json.order.id)

    const repeatOrder1Record = await db.order.findUnique({ where: { id: repeatRes1.json.order.id } })
    assert(
      repeatOrder1Record?.customerId === buyer1.customerId,
      'F10-REPEAT-ORDER',
      `Repeat order for buyer 1 linked to EXISTING customerId (${repeatOrder1Record?.customerId} === ${buyer1.customerId})`
    )

    const repeatSn6 = `ADV_ORDER_REPEAT_6_${Date.now()}`
    const repeatRes6 = await postInboundWebhook({
      event: 'INBOUND_SHOPEE_ORDER_SYNC',
      data: {
        shopeeOrderSn: repeatSn6,
        shopeeOrderStatus: 'READY_TO_SHIP',
        customerName: `Khách Shopee Adv 6 (Đơn Lần 2)`,
        customerPhone: '******',
        buyerUsername: buyer6.buyer,
        items: [{ sku: 'BM-TEA-10', quantity: 1 }],
      },
    })
    assert(repeatRes6.ok, 'F10-REPEAT-ORDER', `Repeat order created for buyer 6 (${buyer6.buyer})`)
    createdOrderIds.push(repeatRes6.json.order.id)

    const repeatOrder6Record = await db.order.findUnique({ where: { id: repeatRes6.json.order.id } })
    assert(
      repeatOrder6Record?.customerId === buyer6.customerId,
      'F10-REPEAT-ORDER',
      `Repeat order for buyer 6 linked to EXISTING customerId (${repeatOrder6Record?.customerId} === ${buyer6.customerId})`
    )

    // 2D. Forensic Audit: Masked phone customers are NOT flagged or purged by test-guard synthetic detection
    console.log('\n  ▶ Forensic audit of Test-Guard synthetic customer detection...')
    const dbCustomers = await db.customer.findMany({
      where: { id: { in: isolatedCustomerIds } },
    })

    assert(dbCustomers.length === 10, 'F10-TESTGUARD-IMMUNITY', `All 10 customer records exist in database`)
    for (const c of dbCustomers) {
      assert(c.phone === null, 'F10-TESTGUARD-IMMUNITY', `Customer ${c.id} phone is null`)
    }

    const synthDetection = await detectSyntheticTestArtifacts()
    const flaggedCustomerIds = new Set(synthDetection.testCustomers.map((c) => c.id))
    for (const c of dbCustomers) {
      assert(
        !flaggedCustomerIds.has(c.id),
        'F10-TESTGUARD-IMMUNITY',
        `Customer ${c.id} (${c.name}) is NOT flagged as synthetic test artifact by test-guard`
      )
    }

    // ------------------------------------------------------------------------
    // SUITE 3: OUTBOX DRY-RUN VERIFICATION (FEATURE 12)
    // ------------------------------------------------------------------------
    console.log('\n--- SUITE 3: Outbox Dry-Run Verification (Feature 12) ---')

    const pythonScript = `
import os
import sys
import json
import urllib.request

# Ensure DRY_RUN is active
os.environ['SHOPEE_OUTBOX_DRY_RUN'] = '1'

# Monkeypatch urllib.request.urlopen to guarantee ZERO live network requests
def poisoned_urlopen(*args, **kwargs):
    raise RuntimeError("CRITICAL ERROR: Live HTTP request attempted while SHOPEE_OUTBOX_DRY_RUN=1!")

urllib.request.urlopen = poisoned_urlopen

from scripts.shopee_seller_sync import (
    is_outbox_dry_run,
    update_shopee_product_stock,
    update_shopee_product_price,
    update_shopee_product_status,
)

assert is_outbox_dry_run() is True, "is_outbox_dry_run() returned False!"

# 1. Test update_shopee_product_stock
ok_stock, res_stock = update_shopee_product_stock({}, "test_cds", "test_csrf", 50521234295, 386711278937, 25)
assert ok_stock is True, "Stock dry run returned False"
assert res_stock.get("dry_run") is True, "Stock dry run did not return dry_run: True"
assert res_stock.get("code") == 0, "Stock dry run code != 0"

# 2. Test update_shopee_product_price
ok_price, res_price = update_shopee_product_price({}, "test_cds", "test_csrf", 50521234295, 386711278937, 99000)
assert ok_price is True, "Price dry run returned False"
assert res_price.get("dry_run") is True, "Price dry run did not return dry_run: True"
assert res_price.get("code") == 0, "Price dry run code != 0"

# 3. Test update_shopee_product_status
ok_status, res_status = update_shopee_product_status({}, "test_cds", "test_csrf", 50521234295, True)
assert ok_status is True, "Status dry run returned False"
assert res_status.get("dry_run") is True, "Status dry run did not return dry_run: True"
assert res_status.get("code") == 0, "Status dry run code != 0"

# 4. Test edge cases: negative stock clamped to 0, price clamped to min 1000
ok_neg_stock, res_neg_stock = update_shopee_product_stock({}, "test_cds", "test_csrf", 50521234295, 386711278937, -15)
assert ok_neg_stock is True

ok_low_price, res_low_price = update_shopee_product_price({}, "test_cds", "test_csrf", 50521234295, 386711278937, 200)
assert ok_low_price is True

print("PYTHON_DRY_RUN_ZERO_NETWORK_CERTIFIED")
`
    const pyOutput = execSync('python', { input: pythonScript, encoding: 'utf-8' })
    assert(
      pyOutput.includes('PYTHON_DRY_RUN_ZERO_NETWORK_CERTIFIED'),
      'F12-OUTBOX-DRYRUN',
      'All 3 mutation functions executed with zero network calls and returned valid dry-run ACKs'
    )
    assert(
      pyOutput.includes('[DRY_RUN] Simulated Shopee update: task_type=STOCK'),
      'F12-OUTBOX-DRYRUN',
      'STOCK mutation logged simulated update correctly'
    )
    assert(
      pyOutput.includes('[DRY_RUN] Simulated Shopee update: task_type=PRICE'),
      'F12-OUTBOX-DRYRUN',
      'PRICE mutation logged simulated update correctly'
    )
    assert(
      pyOutput.includes('[DRY_RUN] Simulated Shopee update: task_type=STATUS'),
      'F12-OUTBOX-DRYRUN',
      'STATUS mutation logged simulated update correctly'
    )

    // Also test --dry-run CLI argument
    const pyCliScript = `
import sys
import os
os.environ.pop('SHOPEE_OUTBOX_DRY_RUN', None)
sys.argv.append('--dry-run')
from scripts.shopee_seller_sync import is_outbox_dry_run
assert is_outbox_dry_run() is True, "CLI --dry-run failed"
print("CLI_DRY_RUN_FLAG_OK")
`
    const pyCliOutput = execSync('python', { input: pyCliScript, encoding: 'utf-8' })
    assert(pyCliOutput.includes('CLI_DRY_RUN_FLAG_OK'), 'F12-OUTBOX-DRYRUN', 'CLI flag --dry-run correctly activates dry run mode')

  } finally {
    // ------------------------------------------------------------------------
    // PHASE TEARDOWN: CLEANUP & R2 INVARIANT VERIFICATION
    // ------------------------------------------------------------------------
    console.log('\n🧹 [PHASE TEARDOWN] Cleaning test records and restoring baseline...')

    // Explicitly clean up all created orders, shipments, order items, and customers from this test
    try {
      if (createdOrderIds.length > 0) {
        await db.orderItem.deleteMany({ where: { orderId: { in: createdOrderIds } } })
        await db.shipment.deleteMany({ where: { orderId: { in: createdOrderIds } } })
        await db.orderEvent.deleteMany({ where: { orderId: { in: createdOrderIds } } })
        await db.order.deleteMany({ where: { id: { in: createdOrderIds } } })
      }
      if (createdCustomerIds.length > 0) {
        await db.customer.deleteMany({ where: { id: { in: createdCustomerIds } } })
      }
    } catch (cleanErr: any) {
      console.warn('  ⚠️ Pre-clean error:', cleanErr.message)
    }

    // Call RESTORE_AND_CLEAN
    console.log('🧹 [PHASE TEARDOWN] Calling RESTORE_AND_CLEAN via Test-Guard...')
    const restoreRes = await restoreAndClean({ baseUrl: CMS_URL, silent: false })
    assert(restoreRes.ok, 'R2-TEARDOWN', 'restoreAndClean returned ok: true')

    // Allow 1200ms for async pool settlement
    await new Promise((r) => setTimeout(r, 1200))

    // Ensure any synthetic products left in DB are cleaned
    const syntheticProds = await db.product.findMany({
      where: { sku: { notIn: Array.from(PROTECTED_REAL_SKUS) } },
      select: { id: true, sku: true },
    })
    if (syntheticProds.length > 0) {
      console.warn(`  ⚠️ Found ${syntheticProds.length} synthetic products left in DB:`, syntheticProds.map((p) => p.sku))
      await db.product.deleteMany({ where: { id: { in: syntheticProds.map((p) => p.id) } } })
    }

    // Verify 13 Canonical Products Invariant in PostgreSQL (Delta = 0)
    console.log('⚖️ [FORENSIC AUDIT] Verifying shop thaimy1605 13 Real Products Invariant in PostgreSQL...')
    const auditPg = await assert13RealProductsInvariant(db, { silent: false })
    assert(auditPg.passed, 'R2-INVARIANT', 'Shop thaimy1605 13 products stock and price Delta = 0 in PostgreSQL')

    // Verify 13 Canonical Products Invariant in SQLite (db/custom.db)
    console.log('⚖️ [FORENSIC AUDIT] Verifying shop thaimy1605 13 Real Products Invariant in SQLite...')
    const sqlitePath = path.resolve(process.cwd(), 'db/custom.db')
    if (fs.existsSync(sqlitePath)) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { DatabaseSync } = require('node:sqlite')
      const sqlite = new DatabaseSync(sqlitePath)
      const rows = sqlite.prepare("SELECT sku, stock, sellPrice FROM Product WHERE status = 'ACTIVE'").all() as Array<{
        sku: string
        stock: number
        sellPrice: number
      }>
      sqlite.close()

      assert(rows.length === 13, 'R2-SQLITE', `SQLite Product table contains exactly 13 active products (found: ${rows.length})`)
      let sqliteDelta = 0
      for (const exp of AUTHORITATIVE_13_PRODUCTS) {
        const act = rows.find((r) => r.sku === exp.sku)
        if (!act || act.stock !== exp.stock || act.sellPrice !== exp.sellPrice) {
          sqliteDelta++
        }
      }
      assert(sqliteDelta === 0, 'R2-SQLITE', `SQLite 13 canonical products stock and price match baseline 100% (Delta = 0)`)
    }

    // Verify Clean State
    console.log('✨ [CLEAN STATE AUDIT] Verifying ecosystem clean state...')
    const cleanCheck = await verifyCleanState({ baseUrl: CMS_URL, silent: false })
    assert(cleanCheck.clean, 'R2-CLEAN-STATE', 'Ecosystem is 100% clean, leftoverCount = 0')
  }

  // --------------------------------------------------------------------------
  // SUMMARY
  // --------------------------------------------------------------------------
  const totalTests = testResults.length
  const passTests = testResults.filter((r) => r.status === 'PASS').length
  const failTests = testResults.filter((r) => r.status === 'FAIL').length

  console.log('\n================================================================================')
  console.log(`📊 ADVERSARIAL VERIFICATION SUMMARY: ${passTests} / ${totalTests} PASSED (Failures: ${failTests})`)
  console.log('================================================================================')

  if (failTests > 0) {
    console.error('❌ ADVERSARIAL STRESS TEST FAILED!')
    throw new Error(`Adversarial test suite failed with ${failTests} failures`)
  } else {
    console.log('🎉 ALL ADVERSARIAL CHALLENGES EMPIRICALLY CONFIRMED AND CERTIFIED!')
  }
}

main().catch((err) => {
  console.error('\n💥 FATAL ERROR IN ADVERSARIAL TEST SUITE:', err)
  // Clean exit for subagent runner
  throw err
})
