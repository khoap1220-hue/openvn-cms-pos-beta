import type { NextRequest } from 'next/server'
import { GET as baocaoGet, POST as baocaoPost } from '../baocao/route'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  return baocaoGet(req)
}

export async function POST(req: NextRequest) {
  return baocaoPost(req)
}
