const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();

async function main() {
  const models = [
    'product', 'category', 'channel', 'channelListing', 'customer',
    'order', 'orderItem', 'stockMovement', 'shipment', 'agentActivity',
    'orderEvent', 'directMessage', 'automationSetting', 'ledgerEntry',
    'partner', 'bomComponent', 'purchaseInvoice', 'purchaseInvoiceItem',
    'salesInvoice', 'salesInvoiceItem', 'accountingPeriod', 'appSetting',
    'afterSalesCase', 'apiKey', 'webhookEndpoint', 'webhookDelivery',
    'integrationCredential', 'warehouse', 'warehouseStock', 'voucher'
  ];
  const counts = {};
  for (const m of models) {
    try {
      counts[m] = await db[m].count();
    } catch (err) {
      counts[m] = `ERROR: ${err.message}`;
    }
  }
  console.log(JSON.stringify(counts, null, 2));
}

main().finally(() => db.$disconnect());
