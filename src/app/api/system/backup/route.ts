import fs from 'fs'
import path from 'path'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logLedger } from '@/lib/ledger'

export const dynamic = 'force-dynamic'

function resolveDbPath(): string {
  const candidates: string[] = []
  const envUrl = process.env.DATABASE_URL?.trim()
  if (envUrl && envUrl.startsWith('file:')) {
    const rawPath = envUrl.slice('file:'.length)
    if (path.isAbsolute(rawPath)) {
      candidates.push(rawPath)
    } else {
      candidates.push(path.resolve(/*turbopackIgnore: true*/ process.cwd(), 'prisma', rawPath))
      candidates.push(path.resolve(/*turbopackIgnore: true*/ process.cwd(), rawPath))
    }
  }
  candidates.push(
    path.join(process.cwd(), 'db', 'custom.db'),
    path.join(process.cwd(), 'prisma', '..', 'db', 'custom.db'),
    path.join(process.cwd(), '..', '..', 'db', 'custom.db'),
  )
  for (const p of candidates) {
    if (fs.existsSync(/*turbopackIgnore: true*/ p)) return p
  }
  return candidates[0]
}

// GET /api/system/backup — tải bản sao lưu cơ sở dữ liệu SQLite (.db)
export async function GET() {
  try {
    await db.$queryRawUnsafe('PRAGMA wal_checkpoint(PASSIVE)').catch(() => null)

    const dbPath = resolveDbPath()
    if (!fs.existsSync(/*turbopackIgnore: true*/ dbPath)) {
      return NextResponse.json({ error: 'Không tìm thấy file cơ sở dữ liệu để sao lưu' }, { status: 404 })
    }

    const buffer = fs.readFileSync(/*turbopackIgnore: true*/ dbPath)
    const now = new Date()
    const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`
    const filename = `uudam-cms-backup-${ymd}.db`

    await logLedger({
      scope: 'SYSTEM',
      action: 'DB_BACKUP_DOWNLOADED',
      actor: 'OPERATOR',
      actorName: 'Quản trị viên',
      originSource: 'MANUAL_ADMIN',
      title: `Tải bản sao lưu cơ sở dữ liệu (${filename})`,
      detail: { filename, sizeBytes: buffer.byteLength },
    }).catch(() => null)

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(buffer.byteLength),
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    console.error('System backup GET error:', error)
    return NextResponse.json({ error: 'Không thể tạo bản sao lưu cơ sở dữ liệu' }, { status: 500 })
  }
}
