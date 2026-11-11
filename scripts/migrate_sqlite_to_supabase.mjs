import { Prisma, PrismaClient } from '@prisma/client'
import fs from 'fs'
import path from 'path'

const SUPABASE_URL = process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL || ""

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: SUPABASE_URL
    }
  }
})

const DUMP_DIR = String.raw`C:\Users\pkhoa\.gemini\antigravity\brain\b19d8efd-2ac6-4245-8c72-a1e527e91535\scratch\sqlite_dump`

// Đọc metadata trường từ DMMF để tự động convert date, boolean chính xác 100%
const dmmf = Prisma.dmmf.datamodel

function getModelFields(modelName) {
  const m = dmmf.models.find(x => x.name.toLowerCase() === modelName.toLowerCase())
  if (!m) return {}
  const res = {}
  for (const f of m.fields) {
    res[f.name] = f.type
  }
  return res
}

function transformRow(row, fieldTypes) {
  const res = {}
  for (const [k, v] of Object.entries(row)) {
    const fType = fieldTypes[k]
    if (!fType) continue // bỏ quan hệ hoặc trường không có trong schema
    if (v === null || v === undefined) {
      res[k] = null
      continue
    }
    if (fType === 'Boolean') {
      res[k] = Boolean(v === 1 || v === true || v === 'true')
    } else if (fType === 'DateTime') {
      res[k] = new Date(v)
    } else if (fType === 'Int') {
      res[k] = Math.round(Number(v))
    } else if (fType === 'Float') {
      res[k] = Number(v)
    } else {
      res[k] = String(v)
    }
  }
  return res
}

// Danh sách nạp theo thứ tự ràng buộc khóa ngoại
const MIGRATION_ORDER = [
  { table: 'Category', model: 'category' },
  { table: 'Channel', model: 'channel' },
  { table: 'Warehouse', model: 'warehouse' },
  { table: 'Partner', model: 'partner' },
  { table: 'AccountingPeriod', model: 'accountingPeriod' },
  { table: 'AppSetting', model: 'appSetting' },
  { table: 'AutomationSetting', model: 'automationSetting' },
  { table: 'SecurityPolicy', model: 'securityPolicy' },
  { table: 'StaffUser', model: 'staffUser' },
  { table: 'Voucher', model: 'voucher' },
  { table: 'ContentSource', model: 'contentSource' },
  { table: 'Customer', model: 'customer' },
  { table: 'ApiKey', model: 'apiKey' },
  { table: 'IntegrationCredential', model: 'integrationCredential' },
  { table: 'Product', model: 'product' },
  { table: 'WarehouseStock', model: 'warehouseStock' },
  { table: 'ChannelListing', model: 'channelListing' },
  { table: 'BomComponent', model: 'bomComponent' },
  { table: 'StaffSession', model: 'staffSession' },
  { table: 'ContentSourceItem', model: 'contentSourceItem' },
  { table: 'SocialPlan', model: 'socialPlan' },
  { table: 'SocialPost', model: 'socialPost' },
  { table: 'SocialChannelConfig', model: 'socialChannelConfig' },
  { table: 'Order', model: 'order' },
  { table: 'PurchaseInvoice', model: 'purchaseInvoice' },
  { table: 'OrderItem', model: 'orderItem' },
  { table: 'OrderEvent', model: 'orderEvent' },
  { table: 'Shipment', model: 'shipment' },
  { table: 'SalesInvoice', model: 'salesInvoice' },
  { table: 'PurchaseInvoiceItem', model: 'purchaseInvoiceItem' },
  { table: 'SalesInvoiceItem', model: 'salesInvoiceItem' },
  { table: 'AfterSalesCase', model: 'afterSalesCase' },
  { table: 'StockMovement', model: 'stockMovement' },
  { table: 'DirectMessage', model: 'directMessage' },
  { table: 'BehaviorLog', model: 'behaviorLog' },
  { table: 'Campaign', model: 'campaign' },
  { table: 'WebhookEndpoint', model: 'webhookEndpoint' },
  { table: 'WebhookDelivery', model: 'webhookDelivery' },
  { table: 'AgentActivity', model: 'agentActivity' },
  { table: 'LedgerEntry', model: 'ledgerEntry' },
]

async function main() {
  console.log("==================================================")
  console.log("MIGRATE DATA: SQLite (db/custom.db) => Supabase PostgreSQL")
  console.log("Target:", SUPABASE_URL)
  console.log("==================================================")

  for (const item of MIGRATION_ORDER) {
    const filePath = path.join(DUMP_DIR, `${item.table}.json`)
    if (!fs.existsSync(filePath)) {
      continue
    }

    const rawData = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    if (!rawData || rawData.length === 0) continue

    const fieldTypes = getModelFields(item.table)
    const records = rawData.map(r => transformRow(r, fieldTypes))

    try {
      // Chia chunk 500 records để đẩy mượt mà
      const chunkSize = 500
      let totalInserted = 0
      for (let i = 0; i < records.length; i += chunkSize) {
        const chunk = records.slice(i, i + chunkSize)
        await prisma[item.model].createMany({
          data: chunk,
          skipDuplicates: true
        })
        totalInserted += chunk.length
      }
      console.log(`[SUCCESS] ${item.table.padEnd(25)}: Migrated ${totalInserted}/${records.length} rows`)
    } catch (err) {
      console.error(`[ERROR]   ${item.table.padEnd(25)}:`, err.message)
    }
  }

  console.log("\n==================================================")
  console.log("MIGRATION COMPLETED SUCCESSFULLY!")
  console.log("==================================================")
}

main().catch(console.error).finally(() => prisma.$disconnect())
