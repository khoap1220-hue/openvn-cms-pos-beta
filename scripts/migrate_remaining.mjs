import { Prisma, PrismaClient } from '@prisma/client'
import fs from 'fs'
import path from 'path'

const SUPABASE_URL = process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL || ""

const prisma = new PrismaClient({
  datasources: { db: { url: SUPABASE_URL } }
})

const DUMP_DIR = String.raw`C:\Users\pkhoa\.gemini\antigravity\brain\b19d8efd-2ac6-4245-8c72-a1e527e91535\scratch\sqlite_dump`
const dmmf = Prisma.dmmf.datamodel

function getModelFields(modelName) {
  const m = dmmf.models.find(x => x.name.toLowerCase() === modelName.toLowerCase())
  if (!m) return {}
  const res = {}
  for (const f of m.fields) res[f.name] = f.type
  return res
}

function transformRow(row, fieldTypes) {
  const res = {}
  for (const [k, v] of Object.entries(row)) {
    const fType = fieldTypes[k]
    if (!fType) continue
    if (v === null || v === undefined) { res[k] = null; continue }
    if (fType === 'Boolean') res[k] = Boolean(v === 1 || v === true || v === 'true')
    else if (fType === 'DateTime') res[k] = new Date(v)
    else if (fType === 'Int') res[k] = Math.round(Number(v))
    else if (fType === 'Float') res[k] = Number(v)
    else res[k] = String(v)
  }
  return res
}

const REMAINING = [
  { table: 'ContentSource', model: 'contentSource' },
  { table: 'ContentSourceItem', model: 'contentSourceItem' },
  { table: 'SocialPlan', model: 'socialPlan' },
  { table: 'SocialPost', model: 'socialPost' },
]

async function main() {
  for (const item of REMAINING) {
    const rawData = JSON.parse(fs.readFileSync(path.join(DUMP_DIR, `${item.table}.json`), 'utf-8'))
    const fieldTypes = getModelFields(item.table)
    const records = rawData.map(r => transformRow(r, fieldTypes))
    await prisma[item.model].createMany({ data: records, skipDuplicates: true })
    console.log(`[SUCCESS] ${item.table}: Migrated ${records.length} rows`)
  }
}

main().catch(console.error).finally(() => prisma.$disconnect())
