import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logLedger } from '@/lib/ledger'

export const dynamic = 'force-dynamic'

function resolveSqliteDbPath(): string | null {
  const candidates: string[] = []
  const envUrl = process.env.DATABASE_URL?.trim()
  if (envUrl && envUrl.startsWith('file:')) {
    const rawPath = envUrl.slice('file:'.length)
    if (path.isAbsolute(rawPath)) {
      candidates.push(rawPath)
    } else {
      candidates.push(path.resolve(/*turbopackIgnore: true*/ process.cwd(), 'prisma', rawPath))
      candidates.push(path.resolve(/*turbopackIgnore: true*/ process.cwd(), rawPath))
    }
  }
  candidates.push(
    path.join(/*turbopackIgnore: true*/ process.cwd(), 'db', 'custom.db'),
    path.join(/*turbopackIgnore: true*/ process.cwd(), 'prisma', '..', 'db', 'custom.db'),
    path.join(/*turbopackIgnore: true*/ process.cwd(), '..', '..', 'db', 'custom.db')
  )
  for (const p of candidates) {
    if (fs.existsSync(/*turbopackIgnore: true*/ p)) return p
  }
  return null
}

function redactCredentialConfigJson(rawConfig: string | null): string | null {
  if (!rawConfig) return rawConfig
  try {
    const parsed = JSON.parse(rawConfig) as Record<string, unknown>
    const clean: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(parsed)) {
      // Giữ nguyên __vault_v1 (đã mã hóa AES-256-GCM) và __storefront_v1 (cấu hình giao diện công khai)
      if (k === '__vault_v1' || k === '__storefront_v1' || k === '__lease_v1') {
        clean[k] = v
        continue
      }
      if (
        v &&
        typeof v === 'string' &&
        /(secret|token|password|cookie|spc_|api_key|apikey|private)/i.test(k)
      ) {
        clean[k] = '[REDACTED_PLAINTEXT_SECRET]'
      } else {
        clean[k] = v
      }
    }
    return JSON.stringify(clean)
  } catch {
    return '[UNPARSEABLE_CONFIG_REDACTED]'
  }
}

/**
 * GET /api/system/backup
 * - Trên PostgreSQL (Supabase Cloud) hoặc khi truyền `?format=json`:
 *   Xuất trọn bộ 24 bảng nghiệp vụ cốt lõi + hộp thư/bài viết/nhật ký thành tệp JSON
 *   kèm mã kiểm chứng toàn vẹn SHA-256 (ẩn khóa plaintext, giữ nguyên vault mã hóa AES-256-GCM).
 * - Trên SQLite cục bộ (khi không truyền `?format=json`): tải tệp nhị phân `.db`.
 */
export async function GET(req: NextRequest) {
  try {
    const envUrl = (process.env.DATABASE_URL || '').trim().toLowerCase()
    const isPostgres = envUrl.startsWith('postgresql://') || envUrl.startsWith('postgres://')
    const wantJson = isPostgres || req.nextUrl.searchParams.get('format') === 'json'

    const now = new Date()
    const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`

    if (!wantJson) {
      await db.$queryRawUnsafe('PRAGMA wal_checkpoint(PASSIVE)').catch(() => null)
      const sqlitePath = resolveSqliteDbPath()
      if (sqlitePath) {
        const buffer = fs.readFileSync(/*turbopackIgnore: true*/ sqlitePath)
        const filename = `uudam-cms-backup-${ymd}.db`
        await logLedger({
          scope: 'SYSTEM',
          action: 'DB_BACKUP_DOWNLOADED',
          actor: 'OPERATOR',
          actorName: 'Quản trị viên',
          originSource: 'MANUAL_ADMIN',
          title: `Tải bản sao lưu SQLite (${filename})`,
          detail: { filename, format: 'sqlite', sizeBytes: buffer.byteLength },
        }).catch(() => null)

        return new NextResponse(buffer, {
          status: 200,
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': `attachment; filename="${filename}"`,
            'Content-Length': String(buffer.byteLength),
            'Cache-Control': 'no-store',
          },
        })
      }
    }

    // Truy vấn theo lô tối đa 6 bảng/lượt để tương thích nhẹ nhàng với PgBouncer Transaction Pooler (:6543)
    const [categories, warehouses, partners, channels, accountingPeriods, vouchers] =
      await Promise.all([
        db.category.findMany({ orderBy: { id: 'asc' } }),
        db.warehouse.findMany({ orderBy: { id: 'asc' } }),
        db.partner.findMany({ orderBy: { id: 'asc' } }),
        db.channel.findMany({ orderBy: { id: 'asc' } }),
        db.accountingPeriod.findMany({ orderBy: { id: 'asc' } }),
        db.voucher.findMany({ orderBy: { id: 'asc' } }),
      ])

    const [products, warehouseStocks, bomComponents, channelListings, customers, orders] =
      await Promise.all([
        db.product.findMany({ orderBy: { id: 'asc' } }),
        db.warehouseStock.findMany({ orderBy: { id: 'asc' } }),
        db.bomComponent.findMany({ orderBy: { id: 'asc' } }),
        db.channelListing.findMany({ orderBy: { id: 'asc' } }),
        db.customer.findMany({ orderBy: { id: 'asc' } }),
        db.order.findMany({ orderBy: { id: 'asc' } }),
      ])

    const [
      orderItems,
      orderEvents,
      shipments,
      afterSalesCases,
      salesInvoices,
      purchaseInvoices,
    ] = await Promise.all([
      db.orderItem.findMany({ orderBy: { id: 'asc' } }),
      db.orderEvent.findMany({ orderBy: { id: 'asc' } }),
      db.shipment.findMany({ orderBy: { id: 'asc' } }),
      db.afterSalesCase.findMany({ orderBy: { id: 'asc' } }),
      db.salesInvoice.findMany({ orderBy: { id: 'asc' } }),
      db.purchaseInvoice.findMany({ orderBy: { id: 'asc' } }),
    ])

    const [
      stockMovements,
      rawAppSettings,
      rawCredentials,
      rawApiKeys,
      rawWebhooks,
      automationSettings,
    ] = await Promise.all([
      db.stockMovement.findMany({ orderBy: { id: 'asc' } }),
      db.appSetting.findMany({ orderBy: { key: 'asc' } }),
      db.integrationCredential.findMany({ orderBy: { id: 'asc' } }),
      db.apiKey.findMany({ orderBy: { id: 'asc' } }),
      db.webhookEndpoint.findMany({ orderBy: { id: 'asc' } }),
      db.automationSetting.findMany(),
    ])

    const [directMessages, socialPosts, recentLedgers] = await Promise.all([
      db.directMessage.findMany({ orderBy: { createdAt: 'desc' }, take: 1000 }),
      db.socialPost.findMany({ orderBy: { id: 'asc' } }).catch(() => []),
      db.ledgerEntry.findMany({ orderBy: { createdAt: 'desc' }, take: 1000 }),
    ])

    const appSettings = rawAppSettings.map((s) => ({
      ...s,
      value:
        /(secret|token|password|api_key|apikey)/i.test(s.key) && s.value
          ? '[REDACTED_SECRET_SETTING]'
          : s.value,
    }))

    const integrationCredentials = rawCredentials.map((c) => ({
      ...c,
      config: redactCredentialConfigJson(c.config),
    }))

    const apiKeys = rawApiKeys.map((k) => ({
      ...k,
      key: k.key ? `${k.key.slice(0, 8)}••••••••[REDACTED]` : '',
    }))

    const webhookEndpoints = rawWebhooks.map((w) => ({
      ...w,
      secret: w.secret ? '[REDACTED_WEBHOOK_SECRET]' : '',
    }))

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
      AppSetting: appSettings,
      IntegrationCredential: integrationCredentials,
      ApiKey: apiKeys,
      WebhookEndpoint: webhookEndpoints,
      AutomationSetting: automationSettings,
      DirectMessage: directMessages,
      SocialPost: socialPosts,
      LedgerEntry: recentLedgers,
    }

    const tableCounts = Object.fromEntries(
      Object.entries(tables).map(([name, rows]) => [name, rows.length])
    )
    const tablesSerialized = JSON.stringify(tables)
    const checksumSha256 = crypto.createHash('sha256').update(tablesSerialized).digest('hex')

    const backupEnvelope = {
      schemaVersion: '2.0-cloud-continuity',
      engine: isPostgres ? 'postgresql' : 'sqlite-json',
      exportedAt: now.toISOString(),
      coreBusinessTablesCount: 24,
      checksumSha256,
      tableCounts,
      tables,
    }

    const bodyText = JSON.stringify(backupEnvelope, null, 2)
    const byteLength = Buffer.byteLength(bodyText, 'utf8')
    const filename = `openvn-cloud-backup-${ymd}.json`

    await logLedger({
      scope: 'SYSTEM',
      action: 'DB_BACKUP_DOWNLOADED',
      actor: 'OPERATOR',
      actorName: 'Quản trị viên',
      originSource: 'MANUAL_ADMIN',
      title: `Tải bản sao lưu toàn vẹn 24 bảng (${filename})`,
      detail: {
        filename,
        format: 'json-24-tables',
        checksumSha256,
        sizeBytes: byteLength,
      },
    }).catch(() => null)

    return new NextResponse(bodyText, {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(byteLength),
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    console.error('System backup GET error:', error)
    return NextResponse.json(
      { error: 'Không thể tạo bản sao lưu cơ sở dữ liệu lúc này.' },
      { status: 500 }
    )
  }
}
