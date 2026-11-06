const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

console.log('=== [FORENSIC STEP 1] PHYSICAL BACKUP FILE VERIFICATION ===');
const bakPath = path.resolve('db/custom.db.bak.pre-autosocial');
const curPath = path.resolve('db/custom.db');

if (!fs.existsSync(bakPath)) {
  console.error('❌ Backup file does not exist at:', bakPath);
  process.exit(1);
}
const bakStat = fs.statSync(bakPath);
console.log('Backup file size:', bakStat.size, 'bytes');

const fd = fs.openSync(bakPath, 'r');
const headerBuf = Buffer.alloc(16);
fs.readSync(fd, headerBuf, 0, 16, 0);
fs.closeSync(fd);
const magicBytes = headerBuf.toString('utf8', 0, 15);
console.log('Backup SQLite Magic Header:', JSON.stringify(magicBytes));
if (magicBytes !== 'SQLite format 3') {
  console.error('❌ Backup header is NOT valid SQLite format 3!');
  process.exit(1);
} else {
  console.log('✅ SQLite format 3 valid.');
}

const bakHash = crypto.createHash('sha256').update(fs.readFileSync(bakPath)).digest('hex');
console.log('Backup SHA-256:', bakHash);

console.log('\n=== [FORENSIC STEP 2] COMPARE SQLITE SCHEMAS: BACKUP vs CURRENT ===');
const dbBak = new DatabaseSync(bakPath, { readOnly: true });
const dbCur = new DatabaseSync(curPath, { readOnly: true });

const tablesBak = dbBak.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r => r.name);
const tablesCur = dbCur.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r => r.name);

console.log('Tables in Backup (' + tablesBak.length + '):', tablesBak.join(', '));
console.log('Tables in Current (' + tablesCur.length + '):', tablesCur.join(', '));

const addedTables = tablesCur.filter(t => !tablesBak.includes(t));
const removedTables = tablesBak.filter(t => !tablesCur.includes(t));

console.log('\nAdded tables in Current DB:', addedTables);
console.log('Removed tables in Current DB:', removedTables);

if (removedTables.length > 0) {
  console.error('❌ INTEGRITY VIOLATION: Existing tables were removed!', removedTables);
  process.exit(1);
}

// Expected added tables for Auto Social
const expectedAdded = ['Campaign', 'ContentSource', 'ContentSourceItem', 'SocialPlan', 'SocialPost', 'SocialChannelConfig', 'AuditLog'];
for (const exp of expectedAdded) {
  if (!addedTables.includes(exp)) {
    console.error(`❌ Table ${exp} was expected to be added but was not found!`);
  } else {
    console.log(`✅ Table ${exp} is present in Current DB.`);
  }
}

console.log('\n=== [FORENSIC STEP 3] VERIFY PRE-EXISTING TABLES UNALTERED ===');
let schemaTampered = false;
for (const t of tablesBak) {
  if (t.startsWith('sqlite_') || t.startsWith('_prisma')) continue;
  const colsBak = dbBak.prepare(`PRAGMA table_info("${t}")`).all();
  const colsCur = dbCur.prepare(`PRAGMA table_info("${t}")`).all();
  
  const colsBakStr = JSON.stringify(colsBak);
  const colsCurStr = JSON.stringify(colsCur);
  if (colsBakStr !== colsCurStr) {
    console.error(`❌ Table schema mismatch for table "${t}"!`);
    console.error('  Backup columns :', colsBakStr);
    console.error('  Current columns:', colsCurStr);
    schemaTampered = true;
  }
}

if (schemaTampered) {
  console.error('❌ INTEGRITY VIOLATION: Pre-existing table schemas were modified!');
  process.exit(1);
} else {
  console.log('✅ ZERO TAMPERING DETECTED across all pre-existing database tables!');
}

console.log('\n=== [FORENSIC STEP 4] VERIFY NEW TABLES COLUMNS & INDEXES ===');
for (const t of expectedAdded) {
  const cols = dbCur.prepare(`PRAGMA table_info("${t}")`).all();
  const indexes = dbCur.prepare(`PRAGMA index_list("${t}")`).all();
  console.log(`Table ${t}: ${cols.length} columns, ${indexes.length} indexes.`);
}

console.log('\n=== [FORENSIC STEP 5] VERIFY 24 BASELINE BUSINESS COUNTS IN BOTH DATABASES ===');
const baseline = JSON.parse(fs.readFileSync(path.resolve('db/baseline-counts.json'), 'utf8'));
const coreTables = [
  'Product', 'Category', 'Order', 'OrderItem', 'Customer',
  'SalesInvoice', 'PurchaseInvoice', 'StockMovement', 'Warehouse', 'WarehouseStock',
  'Voucher', 'BomComponent', 'AccountingPeriod', 'Partner', 'Channel',
  'ChannelListing', 'Shipment', 'AfterSalesCase', 'AppSetting', 'IntegrationCredential',
  'ApiKey', 'WebhookEndpoint', 'AutomationSetting', 'OrderEvent'
];

let countsMatch = true;
for (const tbl of coreTables) {
  const countBak = dbBak.prepare(`SELECT COUNT(*) as c FROM "${tbl}"`).get().c;
  const countCur = dbCur.prepare(`SELECT COUNT(*) as c FROM "${tbl}"`).get().c;
  const baseCount = baseline[tbl];
  if (countBak !== baseCount || countCur !== baseCount) {
    console.error(`❌ Count mismatch on ${tbl}: Bak=${countBak}, Cur=${countCur}, Baseline=${baseCount}`);
    countsMatch = false;
  }
}

if (countsMatch) {
  console.log('✅ ALL 24 BASELINE TABLES MATCH EXACTLY: count(Bak) == count(Cur) == baseline (Delta = 0)');
} else {
  console.error('❌ INTEGRITY VIOLATION: Baseline counts mismatch!');
  process.exit(1);
}

dbBak.close();
dbCur.close();
console.log('\n>>> FORENSIC PHYSICAL DB AUDIT PASSED 100% <<<');
