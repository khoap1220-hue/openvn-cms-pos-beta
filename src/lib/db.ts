import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
  walConfigured: boolean | undefined
}

const isBrowser = typeof window !== 'undefined'

export const db: PrismaClient = isBrowser
  ? (new Proxy({}, { get: () => () => Promise.resolve(null) }) as unknown as PrismaClient)
  : (globalForPrisma.prisma ??
      new PrismaClient({
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
