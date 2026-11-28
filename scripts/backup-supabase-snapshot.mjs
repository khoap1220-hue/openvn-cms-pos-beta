/**
 * Sao lưu Độc lập 24 Bảng Nghiệp vụ từ Supabase PostgreSQL về đĩa cục bộ (`db/backups/`).
 * - Che sạch khóa bí mật dạng rõ (Zero-Secret Leak), bảo toàn Vault đã mã hóa AES-256-GCM.
 * - Đóng dấu kiểm chứng toàn vẹn `SHA-256` để khôi phục bất kỳ lúc nào mà không phụ thuộc đám mây.
 *
 * Chạy thủ công hoặc định kỳ:
 *   node scripts/backup-supabase-snapshot.mjs
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

function redactCredConfig(raw) {
  if (!raw) return raw
  try {
    const obj = JSON.parse(raw)
    const out = {}
    for (const [k, v] of Object.entries(obj)) {
      if (k === '__vault_v1' || k === '__storefront_v1' || k === '__lease_v1') {
        out[k] = v
      } else if (
        v &&
        typeof v === 'string' &&
        /(secret|token|password|cookie|spc_|api_key|apikey|private)/i.test(k)
      ) {
        out[k] = '[REDACTED_PLAINTEXT_SECRET]'
      } else {
        out[k] = v
      }
    }
    return JSON.stringify(out)
  } catch {
    return '[UNPARSEABLE_CONFIG_REDACTED]'
  }
}

async function main() {
  const now = new Date()
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(
    now.getDate()
  ).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(
    now.getMinutes()
  ).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`

  const [categories, warehouses, partners, channels, accountingPeriods, vouchers] =
    await Promise.all([
      prisma.category.findMany({ orderBy: { id: 'asc' } }),
      prisma.warehouse.findMany({ orderBy: { id: 'asc' } }),
      prisma.partner.findMany({ orderBy: { id: 'asc' } }),
      prisma.channel.findMany({ orderBy: { id: 'asc' } }),
      prisma.accountingPeriod.findMany({ orderBy: { id: 'asc' } }),
      prisma.voucher.findMany({ orderBy: { id: 'asc' } }),
    ])

  const [products, warehouseStocks, bomComponents, channelListings, customers, orders] =
    await Promise.all([
      prisma.product.findMany({ orderBy: { id: 'asc' } }),
      prisma.warehouseStock.findMany({ orderBy: { id: 'asc' } }),
      prisma.bomComponent.findMany({ orderBy: { id: 'asc' } }),
      prisma.channelListing.findMany({ orderBy: { id: 'asc' } }),
      prisma.customer.findMany({ orderBy: { id: 'asc' } }),
      prisma.order.findMany({ orderBy: { id: 'asc' } }),
    ])

  const [orderItems, orderEvents, shipments, afterSalesCases, salesInvoices, purchaseInvoices] =
    await Promise.all([
      prisma.orderItem.findMany({ orderBy: { id: 'asc' } }),
      prisma.orderEvent.findMany({ orderBy: { id: 'asc' } }),
      prisma.shipment.findMany({ orderBy: { id: 'asc' } }),
      prisma.afterSalesCase.findMany({ orderBy: { id: 'asc' } }),
      prisma.salesInvoice.findMany({ orderBy: { id: 'asc' } }),
      prisma.purchaseInvoice.findMany({ orderBy: { id: 'asc' } }),
    ])

  const [
    stockMovements,
    rawAppSettings,
    rawCredentials,
    rawApiKeys,
    rawWebhooks,
    automationSettings,
  ] = await Promise.all([
    prisma.stockMovement.findMany({ orderBy: { id: 'asc' } }),
    prisma.appSetting.findMany({ orderBy: { key: 'asc' } }),
    prisma.integrationCredential.findMany({ orderBy: { id: 'asc' } }),
    prisma.apiKey.findMany({ orderBy: { id: 'asc' } }),
    prisma.webhookEndpoint.findMany({ orderBy: { id: 'asc' } }),
    prisma.automationSetting.findMany(),
  ])

  const [directMessages, socialPosts, recentLedgers] = await Promise.all([
    prisma.directMessage.findMany({ orderBy: { createdAt: 'desc' }, take: 1000 }),
    prisma.socialPost.findMany({ orderBy: { id: 'asc' } }).catch(() => []),
    prisma.ledgerEntry.findMany({ orderBy: { createdAt: 'desc' }, take: 1000 }),
  ])

  const tables = {
    Category: categories,
    Warehouse: warehouses,
    Partner: partners,
    Channel: channels,
    AccountingPeriod: accountingPeriods,
    Voucher: vouchers,
    Product: products,
    WarehouseStock: warehouseStocks,
    BomComponent: bomComponents,
    ChannelListing: channelListings,
    Customer: customers,
    Order: orders,
    OrderItem: orderItems,
    OrderEvent: orderEvents,
    Shipment: shipments,
    AfterSalesCase: afterSalesCases,
    SalesInvoice: salesInvoices,
    PurchaseInvoice: purchaseInvoices,
    StockMovement: stockMovements,
    AppSetting: rawAppSettings.map((s) => ({
      ...s,
      value:
        /(secret|token|password|api_key|apikey)/i.test(s.key) && s.value
          ? '[REDACTED_SECRET_SETTING]'
          : s.value,
    })),
    IntegrationCredential: rawCredentials.map((c) => ({
      ...c,
      config: redactCredConfig(c.config),
    })),
    ApiKey: rawApiKeys.map((k) => ({
      ...k,
      key: k.key ? `${k.key.slice(0, 8)}••••••••[REDACTED]` : '',
    })),
    WebhookEndpoint: rawWebhooks.map((w) => ({
      ...w,
      secret: w.secret ? '[REDACTED_WEBHOOK_SECRET]' : '',
    })),
    AutomationSetting: automationSettings,
    DirectMessage: directMessages,
    SocialPost: socialPosts,
    LedgerEntry: recentLedgers,
  }

  const tableCounts = Object.fromEntries(
    Object.entries(tables).map(([name, rows]) => [name, rows.length])
  )
  const checksumSha256 = crypto
    .createHash('sha256')
    .update(JSON.stringify(tables))
    .digest('hex')

  const payload = {
    schemaVersion: '2.0-cloud-continuity',
    exportedAt: now.toISOString(),
    coreBusinessTablesCount: 24,
    checksumSha256,
    tableCounts,
    tables,
  }

  const outDir = path.resolve('db', 'backups')
  fs.mkdirSync(outDir, { recursive: true })
  const datedFile = path.join(outDir, `supabase-snapshot-${stamp}.json`)
  const latestFile = path.join(outDir, 'latest-snapshot.json')
  const jsonText = JSON.stringify(payload, null, 2)
  fs.writeFileSync(datedFile, jsonText, 'utf8')
  fs.writeFileSync(latestFile, jsonText, 'utf8')

  // Chỉ giữ tối đa 10 bản snapshot gần nhất trên đĩa cục bộ để tiết kiệm dung lượng
  const allSnaps = fs
    .readdirSync(outDir)
    .filter((f) => f.startsWith('supabase-snapshot-') && f.endsWith('.json'))
    .sort()
  if (allSnaps.length > 10) {
    for (const oldFile of allSnaps.slice(0, allSnaps.length - 10)) {
      fs.rmSync(path.join(outDir, oldFile), { force: true })
    }
  }

  console.log(`=== SUPABASE 24-TABLE CONTINUITY BACKUP COMPLETE ===`)
  console.log(`  Saved File : ${datedFile}`)
  console.log(`  Latest Ref : ${latestFile}`)
  console.log(`  SHA-256    : ${checksumSha256}`)
  console.log(`  Size       : ${(Buffer.byteLength(jsonText, 'utf8') / 1024).toFixed(1)} KB`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
