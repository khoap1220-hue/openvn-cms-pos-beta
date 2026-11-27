import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
  walConfigured: boolean | undefined
}

const isBrowser = typeof window !== 'undefined'

/**
 * Tự động bổ sung `pgbouncer=true` khi `DATABASE_URL` trỏ qua cổng Transaction Pooler
 * (`:6543` / `*.pooler.supabase.com`) nhưng biến môi trường trên Cloud thiếu tham số,
 * ngăn triệt để lỗi Postgres `26000: prepared statement "s0" does not exist` mà không
 * làm thay đổi chuỗi `process.env.DATABASE_URL` gốc (bảo toàn khóa HKDF AES-256-GCM).
 */
export function normalizePrismaDatasourceUrl(rawUrl: string | undefined): string | undefined {
  const trimmed = rawUrl?.trim()
  if (!trimmed || trimmed.startsWith('file:') || trimmed.startsWith('sqlite:')) {
    return trimmed || undefined
  }
  const lower = trimmed.toLowerCase()
  const isPostgres = lower.startsWith('postgresql://') || lower.startsWith('postgres://')
  const isTransactionPooler =
    lower.includes(':6543') ||
    lower.includes('.pooler.supabase.com') ||
    lower.includes('-pooler.')
  if (!isPostgres || !isTransactionPooler) {
    return trimmed
  }
  try {
    const parsed = new URL(trimmed)
    if (!parsed.searchParams.has('pgbouncer')) {
      parsed.searchParams.set('pgbouncer', 'true')
    }
    if (!parsed.searchParams.has('connection_limit')) {
      parsed.searchParams.set('connection_limit', '10')
    }
    if (!parsed.searchParams.has('pool_timeout')) {
      parsed.searchParams.set('pool_timeout', '30')
    }
    if (!parsed.searchParams.has('connect_timeout')) {
      parsed.searchParams.set('connect_timeout', '15')
    }
    return parsed.toString()
  } catch {
    const sep = trimmed.includes('?') ? '&' : '?'
    return trimmed.includes('pgbouncer=') ? trimmed : `${trimmed}${sep}pgbouncer=true`
  }
}

const resolvedDatasourceUrl = !isBrowser
  ? normalizePrismaDatasourceUrl(process.env.DATABASE_URL)
  : undefined

export const db: PrismaClient = isBrowser
  ? (new Proxy({}, { get: () => () => Promise.resolve(null) }) as unknown as PrismaClient)
  : (globalForPrisma.prisma ??
      new PrismaClient({
        ...(resolvedDatasourceUrl ? { datasources: { db: { url: resolvedDatasourceUrl } } } : {}),
        transactionOptions: {
          maxWait: 15_000,
          timeout: 30_000,
        },
        log:
          process.env.PRISMA_LOG_QUERIES === 'true'
            ? ['query', 'error', 'warn']
            : ['error'],
      }))

if (!isBrowser) {
  globalForPrisma.prisma = db

  const dbUrl = process.env.DATABASE_URL || ''
  const isSqlite = dbUrl.startsWith('file:') || dbUrl.startsWith('sqlite:')

  if (!globalForPrisma.walConfigured && isSqlite) {
    globalForPrisma.walConfigured = true
    void db
      .$queryRawUnsafe('PRAGMA journal_mode = WAL;')
      .then(() => db.$executeRawUnsafe('PRAGMA synchronous = NORMAL;'))
      .then(() => db.$executeRawUnsafe('PRAGMA temp_store = MEMORY;'))
      .then(() => db.$executeRawUnsafe('PRAGMA cache_size = -32000;'))
      .catch(() => null)
  }
}
