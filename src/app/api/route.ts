import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { ensureMaintenanceStateHydrated } from '@/lib/settings'
import { WEBHOOK_EVENTS, ensureIntegrationsSeeded } from '@/lib/webhook-service'
import { ensureWarehousesAndVouchersSeeded } from '@/lib/warehouse-service'

export const dynamic = 'force-dynamic'

// GET /api — OPENVN Retail & Cross-Shop Alliance API Gateway / Health & Discovery
export async function GET() {
  try {
    const [, , maintenance] = await Promise.all([
      ensureWarehousesAndVouchersSeeded(),
      ensureIntegrationsSeeded(),
      ensureMaintenanceStateHydrated(),
    ])

    const [
      productsCount,
      ordersCount,
      warehousesCount,
      partnerShopsCount,
      vouchersCount,
      channelsCount,
      activeWebhooksCount,
      activeApiKeysCount,
    ] = await Promise.all([
      db.product.count({ where: { status: 'ACTIVE' } }),
      db.order.count(),
      db.warehouse.count({ where: { active: true } }),
      db.warehouse.count({ where: { type: 'PARTNER_SHOP', active: true } }),
      db.voucher.count({ where: { active: true } }),
      db.channel.count({ where: { connected: true } }),
      db.webhookEndpoint.count({ where: { active: true } }),
      db.apiKey.count({ where: { active: true } }),
    ])

    return NextResponse.json({
      ok: true,
      status: 'healthy',
      service: 'OPENVN Retail, POS & Cross-Shop Alliance API Gateway',
      version: '2.6.0',
      maintenanceMode: maintenance.enabled,
      timestamp: new Date().toISOString(),
      metrics: {
        activeProducts: productsCount,
        totalOrders: ordersCount,
        activeWarehouses: warehousesCount,
        partnerShops: partnerShopsCount,
        activeVouchers: vouchersCount,
        connectedChannels: channelsCount,
        activeWebhookEndpoints: activeWebhooksCount,
        activeApiKeys: activeApiKeysCount,
      },
      outboundEvents: WEBHOOK_EVENTS,
      inboundEvents: [
        'INBOUND_PING',
        'INBOUND_ORDER_CREATE',
        'INBOUND_STOCK_UPDATE',
        'INBOUND_ALLIANCE_STOCK_SYNC',
        'INBOUND_SHIPMENT_UPDATE',
        'INBOUND_ZALO_MESSAGE',
        'INBOUND_PAYMENT_CONFIRM',
        'INBOUND_SEPAY_TRANSACTION',
        'INBOUND_VOUCHER_VALIDATE',
      ],
      endpoints: {
        dashboard: '/api/dashboard',
        orders: '/api/orders',
        products: '/api/products',
        inventory: '/api/inventory',
        warehouses: '/api/warehouses',
        vouchers: '/api/vouchers',
        customers: '/api/customers',
        campaigns: '/api/campaigns',
        socialPosts: '/api/social/posts',
        socialTestFanpage: '/api/social/test-fanpage',
        channels: '/api/channels',
        shipments: '/api/shipments',
        salesInvoices: '/api/sales-invoices',
        purchaseInvoices: '/api/purchase-invoices',
        reconciliation: '/api/reconciliation',
        integrations: '/api/integrations',
        webhooksInbound: '/api/webhooks/inbound',
        systemBackup: '/api/system/backup',
        systemMaintenance: '/api/system/maintenance',
      },
    })
  } catch (error) {
    console.error('API root health check error:', error)
    return NextResponse.json(
      { ok: false, status: 'degraded', error: 'Database connection check failed' },
      { status: 500 }
    )
  }
}
