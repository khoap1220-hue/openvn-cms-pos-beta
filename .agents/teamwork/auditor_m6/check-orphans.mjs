import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function allProducts() {
  const products = await db.product.findMany({ select: { id: true, sku: true, name: true } })
  console.log('All 12 products:', JSON.stringify(products, null, 2))
  await db.$disconnect()
}

allProducts().catch(console.error)
