// scripts/backup-pre-autosocial.mjs
// Milestone 1 (M1: CRM Campaigns & DB Safety)
// WAL checkpoint & Physical database backup for AUTO SOCIAL module

import { PrismaClient } from '@prisma/client'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const prisma = new PrismaClient()

async function runBackup() {
  console.log('=== [M1 STEP 1] FLUSH WAL CHECKPOINT ===')
  try {
    // Checkpoint toàn bộ frame từ file WAL vào custom.db
    const raw = await prisma.$queryRawUnsafe('PRAGMA wal_checkpoint(FULL);')
    // Cẩn trọng với kiểu BigInt trả về từ Prisma SQLite
    const busy = Number(raw[0]?.busy ?? 0n)
    const log = Number(raw[0]?.log ?? 0n)
    const checkpointed = Number(raw[0]?.checkpointed ?? 0n)
    console.log(`WAL Checkpoint result: busy=${busy}, log=${log}, checkpointed=${checkpointed}`)
    if (busy !== 0) {
      throw new Error(`Database is busy (status: ${busy}), could not complete FULL WAL checkpoint.`)
    }
    console.log('✅ WAL Checkpoint completed successfully.')
  } catch (err) {
    console.error('❌ Failed to execute WAL checkpoint:', err)
    throw err
  } finally {
    // Đóng kết nối Prisma để giải phóng lock file trên Windows SQLite
    await prisma.$disconnect()
  }

  console.log('\n=== [M1 STEP 2] CREATE PHYSICAL FROZEN BACKUP ===')
  const src = path.resolve('db/custom.db')
  const dst = path.resolve('db/custom.db.bak.pre-autosocial')

  if (!fs.existsSync(src)) {
    throw new Error(`Source database file not found at: ${src}`)
  }

  fs.copyFileSync(src, dst)
  console.log(`Copied database:`)
  console.log(`  Source : ${src}`)
  console.log(`  Backup : ${dst}`)

  console.log('\n=== [M1 STEP 3] VERIFY BACKUP INTEGRITY ===')
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
  console.log('✅ File size verified: IDENTICAL')

  // Kiểm tra SQLite Magic Header 16 bytes: "SQLite format 3\0"
  const fd = fs.openSync(dst, 'r')
  const headerBuf = Buffer.alloc(16)
  fs.readSync(fd, headerBuf, 0, 16, 0)
  fs.closeSync(fd)
  const headerStr = headerBuf.toString('utf8', 0, 15)
  if (headerStr !== 'SQLite format 3') {
    throw new Error(`Invalid SQLite header signature: "${headerStr}"`)
  }
  console.log(`✅ SQLite Header verified: "${headerStr}" (Valid SQLite 3 format)`)

  // Kiểm tra SHA-256 Checksum
  console.log('Calculating SHA-256 checksums...')
  const srcHash = crypto.createHash('sha256').update(fs.readFileSync(src)).digest('hex')
  const dstHash = crypto.createHash('sha256').update(fs.readFileSync(dst)).digest('hex')
  console.log(`  Source SHA-256 : ${srcHash}`)
  console.log(`  Backup SHA-256 : ${dstHash}`)

  if (srcHash !== dstHash) {
    throw new Error('SHA-256 hash mismatch between source and backup!')
  }
  console.log('✅ SHA-256 Checksum verified: 100% IDENTICAL')

  console.log('\n======================================================')
  console.log('>>> DB SAFETY BACKUP COMPLETED & VERIFIED FOOLPROOF <<<')
  console.log('======================================================')
}

runBackup().catch((err) => {
  console.error('Fatal backup error:', err)
  process.exit(1)
})
