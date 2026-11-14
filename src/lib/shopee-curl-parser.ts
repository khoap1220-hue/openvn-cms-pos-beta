/**
 * Bộ phân tích đa định dạng lệnh cURL / PowerShell / Fetch / JSON / Header Cookie
 * dành cho Kênh Người Bán Shopee (banhang.shopee.vn).
 *
 * Dùng chung an toàn cho cả Server Route Handler (Node.js) và giao diện Client (Preview tức thì).
 * Tuân thủ Zero-Secret Leak: cung cấp hàm che mờ (mask) giá trị token nhạy cảm trước khi hiển thị/ghi log.
 */

export type ShopeeCookieInputFormat =
  | 'EMPTY'
  | 'CURL_BASH'
  | 'CURL_CMD'
  | 'POWERSHELL'
  | 'FETCH_JS'
  | 'COOKIE_JSON'
  | 'COOKIE_HEADER'

export interface MaskedCookiePreview {
  key: string
  maskedValue: string
}

export interface ParsedShopeeCookieResult {
  valid: boolean
  format: ShopeeCookieInputFormat
  cookies: Record<string, string>
  cookieCount: number
  spcCds: string
  csrfToken: string
  detectedUrl: string | null
  hasSessionToken: boolean
  sessionKeysFound: string[]
  maskedPreview: MaskedCookiePreview[]
  error: string | null
  warning: string | null
}

const KEY_SESSION_COOKIES = [
  'SPC_ST',
  'SPC_SC_SESSION',
  'SPC_EC',
  'SPC_R_T_ID',
  'SPC_T_ID',
  'SPC_SI',
  'SPC_U',
  'SPC_CDS',
  'csrftoken',
] as const

export function maskSecretValue(val: string): string {
  const clean = (val || '').trim()
  if (!clean) return '—'
  if (clean.length <= 8) {
    return `${clean.slice(0, 2)}••••${clean.slice(-1)}`
  }
  return `${clean.slice(0, 4)}••••${clean.slice(-4)}`
}

export function parseRawCookiePairs(cookieStr: string): Record<string, string> {
  const out: Record<string, string> = {}
  const trimmed = cookieStr.replace(/^\s*cookie\s*:\s*/i, '').trim()
  if (!trimmed) return out

  for (const segment of trimmed.split(';')) {
    const part = segment.trim()
    if (!part) continue
    const eqIdx = part.indexOf('=')
    if (eqIdx <= 0) continue
    const k = part.slice(0, eqIdx).trim()
    const v = part.slice(eqIdx + 1).trim()
    // Loại bỏ khóa có khoảng trắng hoặc ký tự điều khiển (tránh nhận nhầm câu văn bản thường)
    if (!k || /[\s"'<>\\]/.test(k)) continue
    out[k] = v
  }
  return out
}

function unescapeCmdCaret(str: string): string {
  return str
    .replace(/\^\r?\n\s*/g, ' ')
    .replace(/\^"/g, '\\"')
    .replace(/\^([&|<>^%!])/g, '$1')
}

function unescapeBashAnsiC(str: string): string {
  return str
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .replace(/\\r/g, '\r')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\\\/g, '\\')
}

function extractSpcCdsFromUrl(urlStr: string | null): string {
  if (!urlStr) return ''
  try {
    const u = new URL(urlStr)
    return u.searchParams.get('SPC_CDS') || u.searchParams.get('spc_cds') || ''
  } catch {
    const m = urlStr.match(/[?&]SPC_CDS=([^&#\s"']+)/i)
    return m ? decodeURIComponent(m[1]) : ''
  }
}

function extractFirstShopeeUrl(text: string): string | null {
  const m = text.match(/https?:\/\/(?:[a-z0-9-]+\.)*shopee\.vn[^\s"'`^\\)]*/i)
  return m ? m[0] : null
}

function tryParseJsonCookies(trimmed: string): {
  matched: boolean
  cookies: Record<string, string>
  spcCds: string
  csrfToken: string
} {
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return { matched: false, cookies: {}, spcCds: '', csrfToken: '' }
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown
    const cookies: Record<string, string> = {}
    let spcCds = ''
    let csrfToken = ''

    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (!item || typeof item !== 'object') continue
        const rec = item as { name?: unknown; value?: unknown; domain?: unknown }
        if (typeof rec.name !== 'string' || typeof rec.value !== 'string') continue
        if (typeof rec.domain === 'string' && rec.domain && !rec.domain.includes('shopee')) {
          continue
        }
        cookies[rec.name.trim()] = rec.value
      }
      return { matched: Object.keys(cookies).length > 0, cookies, spcCds, csrfToken }
    }

    if (parsed && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>
      if (typeof obj.spc_cds === 'string') spcCds = obj.spc_cds.trim()
      if (typeof obj.csrf_token === 'string') csrfToken = obj.csrf_token.trim()

      const sourceMap =
        obj.cookies && typeof obj.cookies === 'object' && !Array.isArray(obj.cookies)
          ? (obj.cookies as Record<string, unknown>)
          : obj

      for (const [k, v] of Object.entries(sourceMap)) {
        if (['spc_cds', 'csrf_token', 'updated_at', 'source'].includes(k)) continue
        if (typeof v === 'string' || typeof v === 'number') {
          cookies[k.trim()] = String(v)
        }
      }
      return { matched: Object.keys(cookies).length > 0, cookies, spcCds, csrfToken }
    }
  } catch {
    // Không phải JSON hợp lệ -> chuyển sang bộ parser tiếp theo
  }
  return { matched: false, cookies: {}, spcCds: '', csrfToken: '' }
}

function parsePowerShellInput(raw: string): {
  cookies: Record<string, string>
  csrfToken: string
  detectedUrl: string | null
} {
  const cookies: Record<string, string> = {}
  let csrfToken = ''

  // 1. Bóc tách $session.Cookies.Add((New-Object System.Net.Cookie("NAME", "VALUE", ...)))
  const netCookieRe =
    /System\.Net\.Cookie\(\s*"((?:[^"`]|`.)*)"\s*,\s*"((?:[^"`]|`.)*)"/gi
  let match: RegExpExecArray | null
  while ((match = netCookieRe.exec(raw)) !== null) {
    const name = match[1].replace(/`"/g, '"').replace(/``/g, '`').trim()
    const val = match[2].replace(/`"/g, '"').replace(/``/g, '`')
    if (name) cookies[name] = val
  }

  // 2. Bóc tách -Headers @{ "Cookie"="..." ; "X-CSRFToken"="..." }
  const psHeaderRe = /["']([A-Za-z0-9_-]+)["']\s*=\s*["']((?:[^"'`]|`.)*)["']/g
  while ((match = psHeaderRe.exec(raw)) !== null) {
    const hName = match[1].toLowerCase()
    const hVal = match[2].replace(/`"/g, '"').replace(/``/g, '`')
    if (hName === 'cookie') {
      Object.assign(cookies, parseRawCookiePairs(hVal))
    } else if (hName === 'x-csrftoken' || hName === 'csrftoken') {
      csrfToken = hVal.trim()
    }
  }

  return {
    cookies,
    csrfToken,
    detectedUrl: extractFirstShopeeUrl(raw),
  }
}

function extractQuotedTokensAfterFlag(
  input: string,
  flagPattern: string
): string[] {
  const results: string[] = []
  const re = new RegExp(
    `(?:^|\\s)(?:${flagPattern})(?:\\s+|=)(?:\\$'((?:[^'\\\\]|\\\\.)*)'|'((?:[^']|'\\\\'')*)'|"((?:[^"\\\\]|\\\\.)*)")`,
    'gi'
  )
  let m: RegExpExecArray | null
  while ((m = re.exec(input)) !== null) {
    if (m[1] !== undefined) {
      results.push(unescapeBashAnsiC(m[1]))
    } else if (m[2] !== undefined) {
      results.push(m[2].replace(/'\\''/g, "'"))
    } else if (m[3] !== undefined) {
      results.push(m[3].replace(/\\"/g, '"').replace(/\\\\/g, '\\'))
    }
  }
  return results
}

function parseCurlInput(
  raw: string,
  isCmdStyle: boolean
): {
  cookies: Record<string, string>
  csrfToken: string
  detectedUrl: string | null
} {
  const normalized = isCmdStyle
    ? unescapeCmdCaret(raw)
    : raw.replace(/\\\r?\n\s*/g, ' ')

  const cookies: Record<string, string> = {}
  let csrfToken = ''

  // 1. Trích xuất tất cả -H / --header
  const headerValues = extractQuotedTokensAfterFlag(normalized, '-H|--header')
  for (const h of headerValues) {
    const colonIdx = h.indexOf(':')
    if (colonIdx <= 0) continue
    const hName = h.slice(0, colonIdx).trim().toLowerCase()
    const hVal = h.slice(colonIdx + 1).trim()
    if (hName === 'cookie') {
      Object.assign(cookies, parseRawCookiePairs(hVal))
    } else if (hName === 'x-csrftoken' || hName === 'csrftoken') {
      csrfToken = hVal
    }
  }

  // 2. Trích xuất tất cả -b / --cookie (Chrome DevTools bản mới thường xuất -b '...' thay vì -H 'Cookie: ...')
  const cookieFlagValues = extractQuotedTokensAfterFlag(normalized, '-b|--cookie')
  for (const cVal of cookieFlagValues) {
    Object.assign(cookies, parseRawCookiePairs(cVal))
  }

  return {
    cookies,
    csrfToken,
    detectedUrl: extractFirstShopeeUrl(normalized),
  }
}

function parseFetchJsInput(raw: string): {
  cookies: Record<string, string>
  csrfToken: string
  detectedUrl: string | null
} {
  const cookies: Record<string, string> = {}
  let csrfToken = ''

  const propRe =
    /["']?(cookie|x-csrftoken|csrftoken)["']?\s*:\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')/gi
  let m: RegExpExecArray | null
  while ((m = propRe.exec(raw)) !== null) {
    const key = m[1].toLowerCase()
    const rawVal = m[2] !== undefined ? m[2] : m[3] || ''
    const val = rawVal.replace(/\\"/g, '"').replace(/\\'/g, "'").replace(/\\\\/g, '\\')
    if (key === 'cookie') {
      Object.assign(cookies, parseRawCookiePairs(val))
    } else {
      csrfToken = val.trim()
    }
  }

  return {
    cookies,
    csrfToken,
    detectedUrl: extractFirstShopeeUrl(raw),
  }
}

export function parseShopeeCurlOrCookieInput(rawInput: string): ParsedShopeeCookieResult {
  const trimmed = (rawInput || '').trim()
  if (!trimmed) {
    return {
      valid: false,
      format: 'EMPTY',
      cookies: {},
      cookieCount: 0,
      spcCds: '',
      csrfToken: '',
      detectedUrl: null,
      hasSessionToken: false,
      sessionKeysFound: [],
      maskedPreview: [],
      error: 'Vui lòng dán lệnh cURL hoặc chuỗi Cookie từ Kênh Người Bán Shopee.',
      warning: null,
    }
  }

  let format: ShopeeCookieInputFormat = 'COOKIE_HEADER'
  let cookies: Record<string, string> = {}
  let spcCds = ''
  let csrfToken = ''
  let detectedUrl: string | null = null

  // 1. Thử JSON (Cookie-Editor / EditThisCookie / .shopee_session.json)
  const jsonTry = tryParseJsonCookies(trimmed)
  if (jsonTry.matched) {
    format = 'COOKIE_JSON'
    cookies = jsonTry.cookies
    spcCds = jsonTry.spcCds
    csrfToken = jsonTry.csrfToken
  } else if (
    /Invoke-WebRequest|Invoke-RestMethod|System\.Net\.Cookie|\$session\.Cookies/i.test(trimmed)
  ) {
    // 2. PowerShell (Copy as PowerShell trên Windows Chrome/Edge)
    format = 'POWERSHELL'
    const ps = parsePowerShellInput(trimmed)
    cookies = ps.cookies
    csrfToken = ps.csrfToken
    detectedUrl = ps.detectedUrl
  } else if (/^\s*curl(?:\.exe)?\b/i.test(trimmed)) {
    // 3. cURL (Bash hoặc Windows CMD)
    const isCmdStyle = /\^"|\^\r?\n|^\s*curl(?:\.exe)?\s+"/i.test(trimmed) && !/\$'/.test(trimmed)
    format = isCmdStyle ? 'CURL_CMD' : 'CURL_BASH'
    const parsedCurl = parseCurlInput(trimmed, isCmdStyle)
    cookies = parsedCurl.cookies
    csrfToken = parsedCurl.csrfToken
    detectedUrl = parsedCurl.detectedUrl
  } else if (/^\s*(?:await\s+)?fetch\s*\(/i.test(trimmed)) {
    // 4. Copy as fetch / Node.js fetch
    format = 'FETCH_JS'
    const parsedFetch = parseFetchJsInput(trimmed)
    cookies = parsedFetch.cookies
    csrfToken = parsedFetch.csrfToken
    detectedUrl = parsedFetch.detectedUrl
  } else {
    // 5. Chuỗi Cookie thô (Cookie: SPC_ST=...; SPC_CDS=...)
    format = 'COOKIE_HEADER'
    cookies = parseRawCookiePairs(trimmed)
    detectedUrl = extractFirstShopeeUrl(trimmed)
  }

  if (!spcCds) {
    spcCds = extractSpcCdsFromUrl(detectedUrl) || cookies['SPC_CDS'] || ''
  }
  if (!csrfToken) {
    csrfToken = cookies['csrftoken'] || ''
  }

  // Bổ sung ngược vào dict cookies nếu URL/header có SPC_CDS hoặc csrftoken
  if (spcCds && !cookies['SPC_CDS']) {
    cookies['SPC_CDS'] = spcCds
  }
  if (csrfToken && !cookies['csrftoken']) {
    cookies['csrftoken'] = csrfToken
  }

  const cookieCount = Object.keys(cookies).length
  const sessionKeysFound = KEY_SESSION_COOKIES.filter((k) => Boolean(cookies[k]))
  const hasSessionToken = Boolean(
    cookies['SPC_ST'] || cookies['SPC_SC_SESSION'] || cookies['SPC_EC']
  )

  const maskedPreview: MaskedCookiePreview[] = sessionKeysFound.map((k) => ({
    key: k,
    maskedValue: maskSecretValue(cookies[k]),
  }))

  if (cookieCount === 0) {
    return {
      valid: false,
      format,
      cookies: {},
      cookieCount: 0,
      spcCds,
      csrfToken,
      detectedUrl,
      hasSessionToken: false,
      sessionKeysFound: [],
      maskedPreview: [],
      error:
        'Không tìm thấy Cookie nào trong nội dung vừa dán. Hãy chọn 1 dòng request tới banhang.shopee.vn trong tab Network (F12) → Copy → Copy as cURL.',
      warning: null,
    }
  }

  if (!hasSessionToken) {
    return {
      valid: false,
      format,
      cookies,
      cookieCount,
      spcCds,
      csrfToken,
      detectedUrl,
      hasSessionToken: false,
      sessionKeysFound,
      maskedPreview,
      error:
        'Đã đọc được Cookie nhưng thiếu khóa phiên đăng nhập Shopee Seller (SPC_ST / SPC_SC_SESSION / SPC_EC). Hãy đảm bảo bạn đã đăng nhập banhang.shopee.vn và chọn request có tên miền banhang.shopee.vn.',
      warning: null,
    }
  }

  let warning: string | null = null
  if (cookies['SPC_U'] && cookies['SPC_U'] === '3813970') {
    return {
      valid: false,
      format,
      cookies,
      cookieCount,
      spcCds,
      csrfToken,
      detectedUrl,
      hasSessionToken,
      sessionKeysFound,
      maskedPreview,
      error: 'Phát hiện Cookie mẫu thử nghiệm cũ (SPC_U=3813970). Vui lòng dán Cookie thật của shop.',
      warning: null,
    }
  }

  if (!spcCds) {
    warning =
      'Không thấy SPC_CDS trong lệnh vừa dán — hệ thống sẽ tự động dùng SPC_CDS mặc định của phiên hiện tại.'
  }

  return {
    valid: true,
    format,
    cookies,
    cookieCount,
    spcCds,
    csrfToken,
    detectedUrl,
    hasSessionToken,
    sessionKeysFound,
    maskedPreview,
    error: null,
    warning,
  }
}
