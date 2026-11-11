// scripts/backup-pre-autosocial.mjs
// Dual-Database Pre-Upgrade Safety Backup (SQLite WAL Checkpoint via node:sqlite + PostgreSQL Health Check + SHA-256 Verification)

import { PrismaClient } from '@prisma/client'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const prisma = new PrismaClient()

async function runBackup() {
  const src = path.resolve('db/custom.db')
  const dst = path.resolve('db/custom.db.bak.pre-autosocial')

  if (!fs.existsSync(src)) {
    throw new Error(`Source database file not found at: ${src}`)
  }

  console.log('=== [STEP 1] FLUSH SQLITE WAL CHECKPOINT & VERIFY PRIMARY DB ===')
  const sqlite = new DatabaseSync(src)
  try {
    const row = sqlite.prepare('PRAGMA wal_checkpoint(FULL);').get()
    const busy = Number(row?.busy ?? 0)
    const log = Number(row?.log ?? 0)
    const checkpointed = Number(row?.checkpointed ?? 0)
    console.log(`SQLite WAL Checkpoint result: busy=${busy}, log=${log}, checkpointed=${checkpointed}`)
    if (busy !== 0) {
      throw new Error(`SQLite database is busy (status: ${busy}), could not complete FULL WAL checkpoint.`)
    }
    console.log('✅ SQLite WAL Checkpoint completed successfully.')
  } finally {
    sqlite.close()
  }

  try {
    await prisma.$queryRawUnsafe('SELECT 1 AS ok')
    console.log('✅ Primary Prisma Database connection verified (SELECT 1 OK).')
  } finally {
    await prisma.$disconnect()
  }

  console.log('\n=== [STEP 2] CREATE PHYSICAL FROZEN BACKUP ===')
  fs.copyFileSync(src, dst)
  console.log('Copied database:')
  console.log(`  Source : ${src}`)
  console.log(`  Backup : ${dst}`)

  console.log('\n=== [STEP 3] VERIFY 3-LAYER BACKUP INTEGRITY ===')
  const srcStat = fs.statSync(src)
  const dstStat = fs.statSync(dst)

  console.log(`Source file size : ${srcStat.size.toLocaleString()} bytes`)
  console.log(`Backup file size : ${dstStat.size.toLocaleString()} bytes`)

  if (srcStat.size === 0) {
    throw new Error('Database file is 0 bytes!')
  }
  if (srcStat.size !== dstStat.size) {
    throw new Error(`Size mismatch! Source: ${srcStat.size}, Backup: ${dstStat.size}`)
  }
  console.log('✅ [Layer 1] File size verified: IDENTICAL')

  // Kiểm tra SQLite Magic Header 16 bytes: "SQLite format 3\0"
  const fd = fs.openSync(dst, 'r')
  const headerBuf = Buffer.alloc(16)
  fs.readSync(fd, headerBuf, 0, 16, 0)
  fs.closeSync(fd)
  const headerStr = headerBuf.toString('utf8', 0, 15)
  if (headerStr !== 'SQLite format 3') {
    throw new Error(`Invalid SQLite header signature: "${headerStr}"`)
  }
  console.log(`✅ [Layer 2] SQLite Header verified: "${headerStr}" (Valid SQLite 3 format)`)

  // Kiểm tra SHA-256 Checksum
  const srcHash = crypto.createHash('sha256').update(fs.readFileSync(src)).digest('hex')
  const dstHash = crypto.createHash('sha256').update(fs.readFileSync(dst)).digest('hex')
  console.log(`  Source SHA-256 : ${srcHash}`)
  console.log(`  Backup SHA-256 : ${dstHash}`)

  if (srcHash !== dstHash) {
    throw new Error('SHA-256 hash mismatch between source and backup!')
  }
  console.log('✅ [Layer 3] SHA-256 Checksum verified: 100% IDENTICAL')

  console.log('\n======================================================')
  console.log('>>> DB SAFETY BACKUP COMPLETED & VERIFIED FOOLPROOF <<<')
  console.log('======================================================')
}

runBackup().catch((err) => {
  console.error('Fatal backup error:', err)
  process.exit(1)
})
