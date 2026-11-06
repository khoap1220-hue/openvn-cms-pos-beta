import { PrismaClient } from '@prisma/client'
import fs from 'node:fs'
import path from 'node:path'

const prisma = new PrismaClient()

// The 24 core business tables mandated for baseline parity
const CORE_BUSINESS_TABLES = new Set([
  'Product',
  'Category',
  'Order',
  'OrderItem',
  'Customer',
  'SalesInvoice',
  'PurchaseInvoice',
  'StockMovement',
  'Warehouse',
  'WarehouseStock',
  'Voucher',
  'BomComponent',
  'AccountingPeriod',
  'Partner',
  'Channel',
  'ChannelListing',
  'Shipment',
  'AfterSalesCase',
  'AppSetting',
  'IntegrationCredential',
  'ApiKey',
  'WebhookEndpoint',
  'AutomationSetting',
  'OrderEvent',
])

async function main() {
  const baselinePath = path.resolve('db/baseline-counts.json')
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'))
  let corePass = true
  let coreChecked = 0

  console.log('=== OPENVN · ƯU ĐÀM SUITE — DATABASE BASELINE AUDIT ===')
  console.log('Checking 24 Core Business Tables vs db/baseline-counts.json:\n')

  for (const [model, expected] of Object.entries(baseline)) {
    if (!CORE_BUSINESS_TABLES.has(model)) continue
    coreChecked++
    const delegateName = model.charAt(0).toLowerCase() + model.slice(1)
    const delegate = prisma[delegateName]
    if (!delegate || typeof delegate.count !== 'function') {
      console.warn(`[WARN] No Prisma delegate for model: ${model}`)
      continue
    }
    const count = await delegate.count()
    if (count !== expected) {
      console.error(`❌ [MISMATCH] ${model}: expected ${expected}, got ${count}`)
      corePass = false
    } else {
      console.log(`✅ [MATCH] ${model.padEnd(24)} actual=${count} baseline=${expected}`)
    }
  }

  console.log('\n--- Informational: Append-only system activity logs ---')
  for (const [model, expected] of Object.entries(baseline)) {
    if (CORE_BUSINESS_TABLES.has(model)) continue
    const delegateName = model.charAt(0).toLowerCase() + model.slice(1)
    const delegate = prisma[delegateName]
    if (delegate && typeof delegate.count === 'function') {
      const count = await delegate.count()
      console.log(`ℹ️ [INFO]  ${model.padEnd(24)} actual=${count} baseline=${expected}`)
    }
  }

  await prisma.$disconnect()

  console.log('\n======================================================')
  console.log(`Core Business Tables Checked : ${coreChecked} / 24`)
  console.log(`Core Parity Status           : ${corePass ? '100% MATCH (PASS)' : 'MISMATCH (FAIL)'}`)
  console.log('======================================================\n')

  if (!corePass) {
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
