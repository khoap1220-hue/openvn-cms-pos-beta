import { PrismaClient } from '@prisma/client'

const BASE_URL = 'http://localhost:3010'
const prisma = new PrismaClient()

async function run() {
  console.log('=== REVIEWER ADVERSARIAL TEST SUITE ===\n')

  const prefix = `ADV-${Date.now().toString().slice(-6)}`

  // Scenario 1: Quoted strings with commas and escaped quotes
  console.log('--- 1. Quoted string with commas, quotes & Vietnamese text ---')
  const complexSku = `${prefix}-QUOTES`
  const complexCsv = `sku,name,costPrice,sellPrice,stock,unit,type
${complexSku},"Trầm Nụ ""Bảo Liên"", Hương Trầm, Tự Nhiên",35000,120000,15,hộp,SIMPLE
`
  const res1 = await fetch(`${BASE_URL}/api/products/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ csv: complexCsv }),
  })
  const json1 = await res1.json()
  console.log('Import Status:', res1.status, json1)

  // Verify in DB
  const dbProd1 = await prisma.product.findUnique({ where: { sku: complexSku } })
  console.log('DB Name matches exactly:', dbProd1?.name === 'Trầm Nụ "Bảo Liên", Hương Trầm, Tự Nhiên')

  // Verify Export contains RFC 4180 escaped quotes
  const resExp = await fetch(`${BASE_URL}/api/products/export`)
  const expText = await resExp.text()
  const hasEscapedInExport = expText.includes('"Trầm Nụ ""Bảo Liên"", Hương Trầm, Tự Nhiên"')
  console.log('Export contains RFC 4180 escaped name:', hasEscapedInExport)

  // Scenario 2: Atomic rollback test
  console.log('\n--- 2. Atomic Rollback: Mixed valid and invalid rows ---')
  const validSkuA = `${prefix}-VAL-A`
  const validSkuB = `${prefix}-VAL-B`
  const mixedCsv = `sku,name,costPrice,sellPrice,stock,unit,type
${validSkuA},Valid Item A,10000,25000,5,sp,SIMPLE
${prefix}-BAD-PRICE,Item With Negative Sell Price,10000,-5000,5,sp,SIMPLE
${validSkuB},Valid Item B,10000,30000,5,sp,SIMPLE
`
  const res2 = await fetch(`${BASE_URL}/api/products/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ csv: mixedCsv }),
  })
  const json2 = await res2.json()
  console.log('Status code on error batch:', res2.status, '(expected 422)')
  console.log('Reported error line number:', json2.errors?.[0]?.row, '(expected 3)')

  const checkA = await prisma.product.findUnique({ where: { sku: validSkuA } })
  const checkB = await prisma.product.findUnique({ where: { sku: validSkuB } })
  console.log('Valid Item A in DB:', Boolean(checkA), '(expected false)')
  console.log('Valid Item B in DB:', Boolean(checkB), '(expected false)')

  // Scenario 3: Multipart Form-Data
  console.log('\n--- 3. Multipart Form-Data Upload ---')
  const mpSku = `${prefix}-MULTIPART`
  const mpCsv = `sku,name,costPrice,sellPrice,stock,unit,type
${mpSku},Multipart Upload Item,45000,90000,8,sp,SIMPLE
`
  const formData = new FormData()
  formData.append('file', new Blob([mpCsv], { type: 'text/csv' }), 'test-import.csv')

  const res3 = await fetch(`${BASE_URL}/api/products/import`, {
    method: 'POST',
    body: formData,
  })
  const json3 = await res3.json()
  console.log('Multipart status:', res3.status, json3)
  const checkMp = await prisma.product.findUnique({ where: { sku: mpSku } })
  console.log('Multipart item inserted in DB:', Boolean(checkMp), '(expected true)')

  // Scenario 4: Multiple errors in single row
  console.log('\n--- 4. Multiple errors on a single row ---')
  const multiErrCsv = `sku,name,costPrice,sellPrice,stock,unit,type
,,-1000,-2000,0,sp,UNKNOWN_TYPE
`
  const res4 = await fetch(`${BASE_URL}/api/products/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ csv: multiErrCsv }),
  })
  const json4 = await res4.json()
  console.log('Total errors on row 2:', json4.totalErrors, json4.errors?.map((e) => e.field))

  // Scenario 5: Update existing SKU (Upsert behavior)
  console.log('\n--- 5. Upsert: Update existing product via CSV ---')
  const updateCsv = `sku,name,costPrice,sellPrice,stock,unit,type
${complexSku},Tên Sau Cập Nhật,50000,180000,99,hộp,SIMPLE
`
  const res5 = await fetch(`${BASE_URL}/api/products/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ csv: updateCsv }),
  })
  const json5 = await res5.json()
  console.log('Upsert status:', res5.status, json5)
  const updatedDb = await prisma.product.findUnique({ where: { sku: complexSku } })
  console.log('Updated name:', updatedDb?.name, '(expected: Tên Sau Cập Nhật)')
  console.log('Updated sellPrice:', updatedDb?.sellPrice, '(expected: 180000)')
  console.log('Updated stock:', updatedDb?.stock, '(expected: 99)')

  // Cleanup
  console.log('\n--- Cleaning up test records ---')
  await prisma.product.deleteMany({
    where: { sku: { in: [complexSku, validSkuA, validSkuB, mpSku] } },
  })
  await prisma.$disconnect()
  console.log('Adversarial tests finished successfully.')
}

run().catch((err) => {
  console.error('Adversarial test error:', err)
  process.exit(1)
})
