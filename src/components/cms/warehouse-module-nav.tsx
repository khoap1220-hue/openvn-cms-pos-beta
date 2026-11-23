'use client'

import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Boxes,
  ClipboardCheck,
  FileSpreadsheet,
  Warehouse,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ViewId } from '@/components/cms/app-sidebar'

export type WarehouseModuleId =
  | 'purchase'
  | 'stock-export'
  | 'inventory'
  | 'stock-balance'
  | 'bom'

interface WarehouseModuleItem {
  id: WarehouseModuleId
  label: string
  subLabel: string
  icon: typeof Warehouse
  activeClass: string
  iconClass: string
}

const WAREHOUSE_MODULES: WarehouseModuleItem[] = [
  {
    id: 'purchase',
    label: '1. Nhập kho',
    subLabel: 'Nhập NVL, hàng mua & HĐ NCC',
    icon: ArrowDownToLine,
    activeClass:
      'border-emerald-600 bg-emerald-600 text-white shadow-sm dark:border-emerald-500 dark:bg-emerald-600',
    iconClass: 'text-emerald-600 dark:text-emerald-400',
  },
  {
    id: 'stock-export',
    label: '2. Xuất kho',
    subLabel: 'Xuất sử dụng, hủy & Chuyển kho',
    icon: ArrowUpFromLine,
    activeClass:
      'border-orange-600 bg-orange-600 text-white shadow-sm dark:border-orange-500 dark:bg-orange-600',
    iconClass: 'text-orange-600 dark:text-orange-400',
  },
  {
    id: 'inventory',
    label: '3. Tồn kho',
    subLabel: 'Bảng tồn chi tiết & Sổ thẻ kho',
    icon: Warehouse,
    activeClass:
      'border-[#0066CC] bg-[#0066CC] text-white shadow-sm dark:border-sky-500 dark:bg-[#0066CC]',
    iconClass: 'text-[#0066CC] dark:text-sky-400',
  },
  {
    id: 'stock-balance',
    label: '4. Cân bằng kho',
    subLabel: 'Kiểm kê thực tế & Xử lý lệch',
    icon: ClipboardCheck,
    activeClass:
      'border-violet-600 bg-violet-600 text-white shadow-sm dark:border-violet-500 dark:bg-violet-600',
    iconClass: 'text-violet-600 dark:text-violet-400',
  },
  {
    id: 'bom',
    label: '5. Sản xuất',
    subLabel: 'Trừ NVL ➔ Cộng TP & Định mức',
    icon: Boxes,
    activeClass:
      'border-blue-700 bg-blue-700 text-white shadow-sm dark:border-blue-500 dark:bg-blue-700',
    iconClass: 'text-blue-700 dark:text-blue-400',
  },
]

export function WarehouseModuleNav({
  active,
  onNavigate,
  lowStockCount = 0,
  canOpenReports = true,
}: {
  active: WarehouseModuleId
  onNavigate?: (view: ViewId) => void
  lowStockCount?: number
  canOpenReports?: boolean
}) {
  const showBaocaoShortcut = Boolean(onNavigate && canOpenReports)

  return (
    <div className="mb-4 rounded-xl border border-border/80 bg-card p-1.5 shadow-xs sm:mb-5 sm:p-2">
      <div
        className={cn(
          'no-scrollbar flex items-center gap-1.5 overflow-x-auto pb-0.5 xl:grid xl:overflow-visible xl:pb-0',
          showBaocaoShortcut ? 'xl:grid-cols-6' : 'xl:grid-cols-5'
        )}
      >
        {WAREHOUSE_MODULES.map((item) => {
          const Icon = item.icon
          const isActive = active === item.id
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigate?.(item.id)}
              title={`${item.label} — ${item.subLabel}`}
              className={cn(
                'group relative flex shrink-0 items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left transition-all xl:shrink xl:py-2',
                isActive
                  ? item.activeClass
                  : 'border-transparent bg-muted/40 text-foreground hover:border-border hover:bg-muted'
              )}
            >
              <div
                className={cn(
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-md border transition-colors xl:h-8 xl:w-8 xl:rounded-lg',
                  isActive
                    ? 'border-white/25 bg-white/15 text-white'
                    : 'border-border/60 bg-background ' + item.iconClass
                )}
              >
                <Icon className="h-3.5 w-3.5 xl:h-4 xl:w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="whitespace-nowrap text-xs font-bold leading-tight">
                    {item.label}
                  </span>
                  {item.id === 'inventory' && lowStockCount > 0 && (
                    <span
                      className={cn(
                        'inline-flex items-center rounded-full px-1.5 py-0.2 text-[10px] font-bold',
                        isActive
                          ? 'bg-white text-[#0066CC]'
                          : 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                      )}
                    >
                      {lowStockCount}
                    </span>
                  )}
                </div>
                <p
                  className={cn(
                    'mt-0.5 hidden truncate text-[11px] leading-tight 2xl:block',
                    isActive ? 'text-white/85' : 'text-muted-foreground'
                  )}
                >
                  {item.subLabel}
                </p>
              </div>
            </button>
          )
        })}

        {showBaocaoShortcut && onNavigate && (
          <button
            type="button"
            onClick={() => {
              if (typeof window !== 'undefined') {
                window.sessionStorage.setItem('cms_open_report_tab', 'baocao')
                window.dispatchEvent(new CustomEvent('cms:open-report-tab', { detail: 'baocao' }))
              }
              onNavigate('reports')
            }}
            title="Sổ Vận hành Bơ Mộc (baocao · 13 Sheet) — Tồn vật tư, Mẻ đúc & Xuất Excel"
            data-testid="warehouse-open-baocao-btn"
            className="group relative flex shrink-0 items-center gap-2 rounded-lg border border-emerald-200/80 bg-emerald-50/60 px-2.5 py-1.5 text-left text-emerald-900 transition-all hover:border-emerald-400 hover:bg-emerald-100/80 xl:shrink xl:py-2 dark:border-emerald-900/60 dark:bg-emerald-950/35 dark:text-emerald-200"
          >
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-emerald-300/70 bg-background text-emerald-600 xl:h-8 xl:w-8 xl:rounded-lg dark:border-emerald-800 dark:text-emerald-400">
              <FileSpreadsheet className="h-3.5 w-3.5 xl:h-4 xl:w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <span className="whitespace-nowrap text-xs font-bold leading-tight">
                6. Sổ baocao
              </span>
              <p className="mt-0.5 hidden truncate text-[11px] leading-tight text-emerald-700/85 2xl:block dark:text-emerald-300/80">
                13 Sheet · Xuất baocao.xlsx
              </p>
            </div>
          </button>
        )}
      </div>
    </div>
  )
}
