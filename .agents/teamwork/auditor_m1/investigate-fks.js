const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('db/custom.db');

const p = db.prepare("SELECT id, sku FROM Product WHERE sku LIKE 'T-COMPA-%' OR sku LIKE 'T-COMPB-%' OR sku LIKE 'T-COMBO-%'").all();
console.log('Leftover matching T-COMP* products:', p);

for (const prod of p) {
  const ws = db.prepare('SELECT * FROM WarehouseStock WHERE productId = ?').all(prod.id);
  console.log('WarehouseStock for', prod.sku, ':', ws);
  const pi = db.prepare('SELECT * FROM PurchaseInvoiceItem WHERE productId = ?').all(prod.id);
  console.log('PurchaseInvoiceItem for', prod.sku, ':', pi);
}

db.close();
