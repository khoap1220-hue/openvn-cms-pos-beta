import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('=== BẮT ĐẦU XÓA TOÀN BỘ DỮ LIỆU MẪU TẠI CMS (SUPABASE POSTGRESQL) ===')

  const result = await prisma.$transaction(async (tx) => {
    const delAfterSales = await tx.afterSalesCase.deleteMany()
    const delOrderEvents = await tx.orderEvent.deleteMany()
    const delShipments = await tx.shipment.deleteMany()
    const delOrderItems = await tx.orderItem.deleteMany()
    const delOrders = await tx.order.deleteMany()
    const delSalesItems = await tx.salesInvoiceItem.deleteMany()
    const delSales = await tx.salesInvoice.deleteMany()
    const delPurchaseItems = await tx.purchaseInvoiceItem.deleteMany()
    const delPurchases = await tx.purchaseInvoice.deleteMany()
    const delMessages = await tx.directMessage.deleteMany()
    const delActivities = await tx.agentActivity.deleteMany()
    const delMovements = await tx.stockMovement.deleteMany()
    const delDeliveries = await tx.webhookDelivery.deleteMany()
    const delLedger = await tx.ledgerEntry.deleteMany()
    const delBehavior = await tx.behaviorLog.deleteMany()
    const delSocialPosts = await tx.socialPost.deleteMany()
    const delSocialPlans = await tx.socialPlan.deleteMany()
    const delContentItems = await tx.contentSourceItem.deleteMany()
    const delContentSources = await tx.contentSource.deleteMany()
    const delCampaigns = await tx.campaign.deleteMany()
    const delCustomers = await tx.customer.deleteMany()
    const delPartners = await tx.partner.deleteMany()
    const delVouchers = await tx.voucher.deleteMany()
    const delBoms = await tx.bomComponent.deleteMany()

    // Xóa các kho mẫu phụ/liên kết, chỉ giữ lại Kho Trung Tâm mặc định (KHO-TRUNG-TAM)
    const centralWh = await tx.warehouse.findFirst({ where: { code: 'KHO-TRUNG-TAM' } })
    if (centralWh) {
      await tx.warehouseStock.deleteMany({ where: { warehouseId: { not: centralWh.id } } })
      await tx.product.updateMany({ data: { ownerWarehouseId: centralWh.id, crossSellRate: null } })
      await tx.warehouse.deleteMany({ where: { id: { not: centralWh.id } } })
      await tx.warehouse.update({
        where: { id: centralWh.id },
        data: { name: 'Kho Trung Tâm', address: 'TP.HCM', managerName: 'Quản kho', isDefault: true },
      })
    }

    // Xóa 22 sản phẩm mẫu (UD-*), chỉ giữ lại sản phẩm thật từ Shopee (BM-SEN-01)
    const sampleProducts = await tx.product.findMany({
      where: { sku: { not: 'BM-SEN-01' } },
      select: { id: true, sku: true },
    })
    const sampleIds = sampleProducts.map((p) => p.id)
    if (sampleIds.length > 0) {
      await tx.channelListing.deleteMany({ where: { productId: { in: sampleIds } } })
      await tx.warehouseStock.deleteMany({ where: { productId: { in: sampleIds } } })
      await tx.product.deleteMany({ where: { id: { in: sampleIds } } })
    }

    // Xóa các danh mục mẫu không chứa sản phẩm thật
    const realProd = await tx.product.findUnique({ where: { sku: 'BM-SEN-01' } })
    if (realProd?.categoryId) {
      await tx.category.deleteMany({ where: { id: { not: realProd.categoryId } } })
      await tx.category.update({
        where: { id: realProd.categoryId },
        data: { name: 'Nến & Đồ đựng nến', slug: 'nen-do-dung-nen' },
      })
    }

    // Đặt lại các kênh chưa kết nối thực tế (chỉ giữ SHOPEE và POS là connected)
    await tx.channel.updateMany({
      where: { key: { notIn: ['SHOPEE', 'POS'] } },
      data: { connected: false, syncedAt: null },
    })

    // Tắt simulation_mode
    await tx.automationSetting.upsert({
      where: { key: 'simulation_mode' },
      update: { enabled: false },
      create: { key: 'simulation_mode', enabled: false },
    })

    // Mở lại các kỳ kế toán
    await tx.accountingPeriod.deleteMany()

    // Tạo bút toán tồn kho đầu kỳ cho BM-SEN-01
    if (realProd && centralWh) {
      await tx.stockMovement.create({
        data: {
          productId: realProd.id,
          warehouseId: centralWh.id,
          type: 'IMPORT',
          quantity: realProd.stock,
          stockAfter: realProd.stock,
          note: 'Tồn kho thực tế đồng bộ từ Shopee Seller Center (thaimy1605)',
        },
      })
    }

    return {
      sampleProductsDeleted: sampleIds.length,
      ordersDeleted: delOrders.count,
      orderItemsDeleted: delOrderItems.count,
      shipmentsDeleted: delShipments.count,
      customersDeleted: delCustomers.count,
      messagesDeleted: delMessages.count,
      activitiesDeleted: delActivities.count,
      salesInvoicesDeleted: delSales.count,
      purchaseInvoicesDeleted: delPurchases.count,
      vouchersDeleted: delVouchers.count,
      campaignsDeleted: delCampaigns.count,
      socialPostsDeleted: delSocialPosts.count,
      contentItemsDeleted: delContentItems.count,
      webhookDeliveriesDeleted: delDeliveries.count,
      ledgerEntriesDeleted: delLedger.count,
      behaviorLogsDeleted: delBehavior.count,
      afterSalesDeleted: delAfterSales.count,
      orderEventsDeleted: delOrderEvents.count,
      movementsDeleted: delMovements.count,
      bomsDeleted: delBoms.count,
      partnersDeleted: delPartners.count,
    }
  }, { timeout: 60000, maxWait: 10000 })

  console.log('✅ ĐÃ XÓA SẠCH DỮ LIỆU MẪU TRÊN SUPABASE POSTGRESQL:')
  console.table(result)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
