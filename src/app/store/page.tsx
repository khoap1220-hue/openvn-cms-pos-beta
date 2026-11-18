'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  BookOpen,
  CheckCircle2,
  LayoutDashboard,
  Minus,
  Package,
  Plus,
  Search,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Trash2,
  Truck,
} from 'lucide-react'
import { PwaHeaderControls } from '@/components/cms/pwa-app-center'
import { ProductAvatar } from '@/components/cms/product-avatar'
import { ThemeToggle } from '@/components/cms/theme-toggle'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { apiGet, apiPost } from '@/lib/api'
import { trackClientBehavior } from '@/lib/behavior-client'
import { formatVND } from '@/lib/format'
import { initPwaClientRuntime } from '@/lib/pwa-notifications'
import { useShopProfile } from '@/lib/shop-profile'
import type { Category, Channel, Product } from '@/lib/types'
import { cn } from '@/lib/utils'

interface StoreCartItem {
  product: Product
  quantity: number
}

export default function OnlineStorefrontPage() {
  const { toast } = useToast()
  const { profile: shopProfile } = useShopProfile()

  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [websiteChannelId, setWebsiteChannelId] = useState<string>('')
  const [loading, setLoading] = useState(true)

  const [search, setSearch] = useState('')
  const [selectedCat, setSelectedCat] = useState<string>('ALL')
  const [cart, setCart] = useState<StoreCartItem[]>([])
  const [cartOpen, setCartOpen] = useState(false)

  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [shippingAddress, setShippingAddress] = useState('')
  const [orderNote, setOrderNote] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<'COD' | 'BANK_TRANSFER'>('COD')
  const [submitting, setSubmitting] = useState(false)
  const [completedOrderCode, setCompletedOrderCode] = useState<string | null>(null)

  const loadStoreCatalog = useCallback(async () => {
    setLoading(true)
    try {
      const [prodRes, catRes, chRes] = await Promise.all([
        apiGet<{ products?: Product[] }>('/api/products?status=ACTIVE'),
        apiGet<{ categories?: Category[] }>('/api/categories').catch(() => ({ categories: [] })),
        apiGet<{ channels?: Channel[] }>('/api/channels').catch(() => ({ channels: [] })),
      ])
      const activeProds = (prodRes.products ?? []).filter((p) => p.status === 'ACTIVE')
      setProducts(activeProds)
      setCategories(catRes.categories ?? [])
      const webCh =
        (chRes.channels ?? []).find((c) => c.key === 'WEBSITE') ??
        (chRes.channels ?? [])[0] ??
        null
      if (webCh) setWebsiteChannelId(webCh.id)
    } catch {
      // ignore offline error
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    initPwaClientRuntime()
    trackClientBehavior({
      category: 'NAVIGATION',
      action: 'VIEW_MODULE',
      module: 'storefront',
      path: '/store',
      summary: 'Xem Cửa hàng Trực tuyến (/store)',
    })
    document.title = `Cửa hàng Trực tuyến — ${shopProfile.brandName}`
    void loadStoreCatalog()
  }, [loadStoreCatalog, shopProfile.brandName])

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase()
    return products.filter((p) => {
      if (selectedCat !== 'ALL' && p.categoryId !== selectedCat) return false
      if (!q) return true
      return (
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        (p.description ?? '').toLowerCase().includes(q)
      )
    })
  }, [products, search, selectedCat])

  const totalCartItems = useMemo(
    () => cart.reduce((sum, it) => sum + it.quantity, 0),
    [cart]
  )
  const cartSubtotal = useMemo(
    () => cart.reduce((sum, it) => sum + it.product.sellPrice * it.quantity, 0),
    [cart]
  )
  const shippingFee = cartSubtotal >= 500_000 || cartSubtotal === 0 ? 0 : 30_000
  const grandTotal = cartSubtotal + shippingFee

  const addToCart = (product: Product) => {
    setCompletedOrderCode(null)
    setCart((prev) => {
      const idx = prev.findIndex((it) => it.product.id === product.id)
      if (idx === -1) return [...prev, { product, quantity: 1 }]
      return prev.map((it, i) => (i === idx ? { ...it, quantity: it.quantity + 1 } : it))
    })
    toast({
      title: `Đã thêm vào giỏ hàng`,
      description: `${product.name} · ${formatVND(product.sellPrice)}`,
    })
  }

  const updateCartQty = (productId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((it) =>
          it.product.id === productId ? { ...it, quantity: it.quantity + delta } : it
        )
        .filter((it) => it.quantity > 0)
    )
  }

  const handleCheckout = async () => {
    if (cart.length === 0) return
    if (!customerName.trim() || !customerPhone.trim() || !shippingAddress.trim()) {
      toast({
        title: 'Vui lòng điền đủ thông tin nhận hàng',
        description: 'Nhập Họ tên, Số điện thoại và Địa chỉ giao hàng để đặt đơn.',
        variant: 'destructive',
      })
      return
    }
    setSubmitting(true)
    try {
      const res = await apiPost<{ order?: { code?: string }; code?: string }>('/api/orders', {
        channelId: websiteChannelId || 'website',
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim(),
        address: shippingAddress.trim(),
        note: orderNote.trim() || 'Đặt từ Cửa hàng Trực tuyến (/store)',
        paymentMethod,
        shippingFee,
        items: cart.map((it) => ({
          productId: it.product.id,
          sku: it.product.sku,
          name: it.product.name,
          price: it.product.sellPrice,
          quantity: it.quantity,
        })),
      })
      const orderCode = res?.order?.code || res?.code || `DH-${Date.now().toString().slice(-6)}`
      setCompletedOrderCode(orderCode)
      setCart([])
      toast({
        title: `Đặt hàng thành công (${orderCode})`,
        description: 'Cửa hàng đã tiếp nhận đơn và sẽ liên hệ xác nhận giao hàng sớm nhất.',
      })
    } catch (e) {
      toast({
        title: 'Không thể gửi đơn đặt hàng',
        description: e instanceof Error ? e.message : 'Vui lòng kiểm tra lại thông tin và thử lại.',
        variant: 'destructive',
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-svh flex-col bg-background">
      {/* Header Cửa hàng Trực tuyến dành cho Khách mua lẻ */}
      <header className="sticky top-0 z-30 border-b bg-card/95 backdrop-blur-md">
        <div className="mx-auto flex min-h-15 max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-2 sm:px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#0088FF] to-[#0052A8] text-white shadow-xs">
              <ShoppingBag className="h-4.5 w-4.5" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-base font-bold tracking-tight text-foreground">
                  {shopProfile.brandName}
                </span>
                <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-[10px] font-semibold text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300">
                  Cửa hàng Trực tuyến
                </Badge>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Freeship toàn quốc đơn từ 500.000 ₫ · Đổi trả tận nơi trong 7 ngày
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="ghost" size="sm" className="h-10 gap-1.5 text-xs">
              <Link href="/blog">
                <BookOpen className="h-3.5 w-3.5 text-emerald-600" />
                <span>Góc Tĩnh Tâm</span>
              </Link>
            </Button>

            <Button asChild variant="outline" size="sm" className="h-10 gap-1.5 text-xs">
              <Link href="/">
                <LayoutDashboard className="h-3.5 w-3.5 text-[#0066CC]" />
                <span className="hidden sm:inline">Quản trị CMS</span>
              </Link>
            </Button>

            <Button
              type="button"
              size="sm"
              onClick={() => {
                if (typeof window !== 'undefined') {
                  window.dispatchEvent(new CustomEvent('openvn:close-pos-dialogs'))
                }
                setCartOpen(true)
              }}
              className="h-10 gap-1.5 bg-[#0066CC] px-3.5 text-xs font-semibold text-white hover:bg-[#0055B3]"
            >
              <ShoppingCart className="h-4 w-4" />
              <span>Giỏ hàng ({totalCartItems})</span>
            </Button>

            <PwaHeaderControls variant="cms" onModalOpen={() => setCartOpen(false)} />
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* Banner Giới thiệu Bộ sưu tập */}
      <section className="border-b bg-gradient-to-r from-sky-50/80 via-background to-emerald-50/50 py-8 dark:from-slate-900 dark:via-background dark:to-slate-900/60">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
            <div className="space-y-1.5">
              <div className="inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-white/80 px-3 py-1 text-xs font-semibold text-[#0066CC] dark:border-sky-900 dark:bg-slate-900 dark:text-sky-300">
                <Sparkles className="h-3.5 w-3.5" />
                <span>Bộ sưu tập Thủ công · Chính hãng 100%</span>
              </div>
              <h1 className="text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">
                Không Gian Thư Thái &amp; Quà Tặng Tinh Tế
              </h1>
              <p className="max-w-2xl text-sm text-muted-foreground">
                Khám phá các mẫu khay, cốc, hũ nến thạch cao thủ công, trà đạo và phụ kiện bài trí an nhiên từ {shopProfile.brandName}.
              </p>
            </div>

            <div className="relative w-full max-w-sm">
              <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Tìm sản phẩm theo tên hoặc mã SKU..."
                aria-label="Tìm kiếm sản phẩm trong cửa hàng"
                className="h-10 bg-card pl-9"
              />
            </div>
          </div>

          {/* Bộ lọc Danh mục */}
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setSelectedCat('ALL')}
              className={cn(
                'inline-flex min-h-10 items-center rounded-full border px-4 text-xs font-semibold transition-colors',
                selectedCat === 'ALL'
                  ? 'border-[#0066CC] bg-[#0066CC] text-white'
                  : 'bg-card text-foreground hover:bg-muted'
              )}
            >
              Tất cả ({products.length})
            </button>
            {categories.map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => setSelectedCat(cat.id)}
                className={cn(
                  'inline-flex min-h-10 items-center rounded-full border px-4 text-xs font-semibold transition-colors',
                  selectedCat === cat.id
                    ? 'border-[#0066CC] bg-[#0066CC] text-white'
                    : 'bg-card text-foreground hover:bg-muted'
                )}
              >
                {cat.name}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Lưới Sản phẩm */}
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6">
        {loading ? (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-72 animate-pulse rounded-2xl border bg-muted/40" />
            ))}
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="rounded-2xl border border-dashed py-16 text-center">
            <Package className="mx-auto mb-3 h-10 w-10 text-muted-foreground/50" />
            <p className="text-base font-semibold">Không tìm thấy sản phẩm phù hợp</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Hãy thử từ khóa khác hoặc chọn xem Tất cả danh mục.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filteredProducts.map((p) => (
              <Card
                key={p.id}
                className="group flex flex-col overflow-hidden border-border/80 transition-shadow hover:shadow-md"
              >
                <div className="relative flex aspect-square items-center justify-center overflow-hidden bg-muted/40 p-3">
                  {p.image ? (
                    <img
                      src={p.image}
                      alt={p.name}
                      className="h-full w-full rounded-xl object-cover transition-transform duration-300 group-hover:scale-105"
                      loading="lazy"
                    />
                  ) : (
                    <ProductAvatar name={p.name} className="h-20 w-20 text-xl" />
                  )}
                  {p.category?.name && (
                    <Badge className="absolute top-3 left-3 bg-slate-900/80 text-[10px] text-white backdrop-blur-xs">
                      {p.category.name}
                    </Badge>
                  )}
                </div>
                <CardContent className="flex flex-1 flex-col justify-between gap-3 p-4">
                  <div className="space-y-1">
                    <p className="font-mono text-[10.5px] text-muted-foreground">{p.sku}</p>
                    <h2 className="line-clamp-2 text-sm font-semibold leading-snug text-foreground">
                      {p.name}
                    </h2>
                  </div>
                  <div className="flex items-center justify-between gap-2 border-t pt-3">
                    <p className="text-base font-extrabold text-[#0066CC] dark:text-sky-400">
                      {formatVND(p.sellPrice)}
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => addToCart(p)}
                      className="h-10 gap-1.5 bg-[#0066CC] px-3 text-xs font-semibold text-white hover:bg-[#0055B3]"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Chọn mua
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>

      <footer className="border-t bg-card py-6 text-xs text-muted-foreground">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-2 px-4 sm:flex-row sm:px-6">
          <p>
            © {new Date().getFullYear()} <strong className="text-foreground">{shopProfile.brandName}</strong> · Cửa hàng Trực tuyến Chính thức
          </p>
          <div className="flex items-center gap-4">
            <Link href="/blog" className="hover:text-foreground hover:underline">
              Blog &amp; Góc Tĩnh Tâm
            </Link>
            <Link href="/pos" className="hover:text-foreground hover:underline">
              Quầy Thu ngân POS (Nội bộ)
            </Link>
          </div>
        </div>
      </footer>

      {/* Hộp thoại Giỏ hàng & Đặt hàng Trực tuyến */}
      <Dialog open={cartOpen} onOpenChange={setCartOpen}>
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShoppingCart className="h-5 w-5 text-[#0066CC]" />
              Giỏ hàng &amp; Đặt mua Trực tuyến
            </DialogTitle>
            <DialogDescription>
              Kiểm tra sản phẩm đã chọn và điền địa chỉ nhận hàng tận nơi.
            </DialogDescription>
          </DialogHeader>

          {completedOrderCode ? (
            <div className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50/80 p-5 text-center dark:border-emerald-900 dark:bg-emerald-950/30">
              <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" />
              <p className="text-base font-bold text-emerald-900 dark:text-emerald-200">
                Đặt hàng thành công!
              </p>
              <p className="text-xs text-emerald-800 dark:text-emerald-300">
                Mã đơn hàng của bạn: <strong className="font-mono text-sm">{completedOrderCode}</strong>
              </p>
              <Button
                type="button"
                className="h-10 bg-[#0066CC] text-white hover:bg-[#0055B3]"
                onClick={() => {
                  setCompletedOrderCode(null)
                  setCartOpen(false)
                }}
              >
                Tiếp tục mua sắm
              </Button>
            </div>
          ) : cart.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Giỏ hàng đang trống — hãy chọn sản phẩm yêu thích để đặt mua.
            </div>
          ) : (
            <div className="space-y-4">
              <div className="max-h-52 space-y-2 overflow-y-auto pr-1">
                {cart.map((it) => (
                  <div
                    key={it.product.id}
                    className="flex items-center justify-between gap-2 rounded-xl border bg-muted/30 p-2.5 text-xs"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{it.product.name}</p>
                      <p className="text-muted-foreground">{formatVND(it.product.sellPrice)}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        size="icon"
                        variant="outline"
                        className="h-8 w-8"
                        aria-label="Giảm số lượng"
                        onClick={() => updateCartQty(it.product.id, -1)}
                      >
                        <Minus className="h-3 w-3" />
                      </Button>
                      <span className="w-7 text-center font-bold">{it.quantity}</span>
                      <Button
                        type="button"
                        size="icon"
                        variant="outline"
                        className="h-8 w-8"
                        aria-label="Tăng số lượng"
                        onClick={() => updateCartQty(it.product.id, 1)}
                      >
                        <Plus className="h-3 w-3" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-rose-600"
                        aria-label="Xóa khỏi giỏ"
                        onClick={() => updateCartQty(it.product.id, -it.quantity)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="store-cust-name">Họ và tên người nhận *</Label>
                  <Input
                    id="store-cust-name"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="Nguyễn Minh Trân"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="store-cust-phone">Số điện thoại *</Label>
                  <Input
                    id="store-cust-phone"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    placeholder="0909..."
                  />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label htmlFor="store-cust-addr">Địa chỉ giao hàng chi tiết *</Label>
                  <Input
                    id="store-cust-addr"
                    value={shippingAddress}
                    onChange={(e) => setShippingAddress(e.target.value)}
                    placeholder="Số nhà, đường, phường/xã, quận/huyện, tỉnh/thành..."
                  />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label htmlFor="store-cust-note">Ghi chú đơn hàng (tùy chọn)</Label>
                  <Textarea
                    id="store-cust-note"
                    rows={2}
                    value={orderNote}
                    onChange={(e) => setOrderNote(e.target.value)}
                    placeholder="Gói quà tặng, giờ giao mong muốn..."
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setPaymentMethod('COD')}
                  className={cn(
                    'min-h-10 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors',
                    paymentMethod === 'COD'
                      ? 'border-[#0066CC] bg-sky-50 text-[#0066CC] dark:bg-sky-950/50 dark:text-sky-300'
                      : 'bg-card text-muted-foreground'
                  )}
                >
                  Thanh toán khi nhận hàng (COD)
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentMethod('BANK_TRANSFER')}
                  className={cn(
                    'min-h-10 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors',
                    paymentMethod === 'BANK_TRANSFER'
                      ? 'border-[#0066CC] bg-sky-50 text-[#0066CC] dark:bg-sky-950/50 dark:text-sky-300'
                      : 'bg-card text-muted-foreground'
                  )}
                >
                  Chuyển khoản VietQR
                </button>
              </div>

              <div className="space-y-1 rounded-xl border bg-muted/40 p-3 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Tạm tính ({totalCartItems} sản phẩm):</span>
                  <span className="font-medium">{formatVND(cartSubtotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Truck className="h-3.5 w-3.5" /> Phí giao hàng:
                  </span>
                  <span className="font-medium">
                    {shippingFee === 0 ? 'Miễn phí (Đơn ≥ 500k)' : formatVND(shippingFee)}
                  </span>
                </div>
                <div className="flex justify-between border-t pt-1.5 text-sm font-bold text-foreground">
                  <span>Tổng thanh toán:</span>
                  <span className="text-[#0066CC] dark:text-sky-400">{formatVND(grandTotal)}</span>
                </div>
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  disabled={submitting}
                  onClick={() => void handleCheckout()}
                  className="h-11 w-full bg-[#0066CC] text-sm font-bold text-white hover:bg-[#0055B3]"
                >
                  {submitting ? 'Đang xử lý đơn hàng...' : `Đặt mua ngay · ${formatVND(grandTotal)}`}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
