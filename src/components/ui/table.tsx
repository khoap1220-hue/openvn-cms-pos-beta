"use client"

import * as React from "react"
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  Columns3,
  Download,
  Eye,
  EyeOff,
  LayoutList,
  Lock,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Table2,
  Trash2,
  X,
} from "lucide-react"

import { cn } from "@/lib/utils"

export interface ColumnMeta {
  index: number
  id: string
  label: string
  defaultHidden: boolean
  locked: boolean
  isAction: boolean
}

export type CustomColumnType = "text" | "number" | "tag" | "checkbox"

export interface CustomColumnDef {
  id: string
  label: string
  type: CustomColumnType
}

export type RowDensity = "compact" | "normal" | "comfortable"
export type MobileTableMode = "cards" | "table"

interface TableColumnContextValue {
  enabled: boolean
  mobileCardActive: boolean
  columns: ColumnMeta[]
  visibleSet: Set<number>
  columnOrder: number[]
  customColumns: CustomColumnDef[]
  customCellValues: Record<string, string>
  setCustomCellValue: (rowKey: string, colId: string, value: string) => void
  removeCustomColumn: (colId: string) => void
  density: RowDensity
}

const TableColumnContext = React.createContext<TableColumnContextValue | null>(null)
const TableSectionContext = React.createContext<"header" | "body" | "footer" | null>(null)

function extractTextFromNode(node: React.ReactNode): string {
  if (node == null || typeof node === "boolean") return ""
  if (typeof node === "string" || typeof node === "number") return String(node).trim()
  if (Array.isArray(node)) {
    return node
      .map(extractTextFromNode)
      .filter(Boolean)
      .join(" ")
      .trim()
  }
  if (React.isValidElement(node)) {
    const props = node.props as Record<string, unknown>
    return extractTextFromNode(props.children as React.ReactNode)
  }
  return ""
}

function hasCheckboxElement(node: React.ReactNode): boolean {
  if (!node) return false
  if (Array.isArray(node)) return node.some(hasCheckboxElement)
  if (React.isValidElement(node)) {
    const props = node.props as Record<string, unknown>
    const ariaLabel = String(props["aria-label"] ?? "").toLowerCase()
    if (ariaLabel.includes("chọn tất cả") || ariaLabel.includes("select all")) return true
    if (props.onCheckedChange !== undefined || props.checked !== undefined) return true
    return hasCheckboxElement(props.children as React.ReactNode)
  }
  return false
}

function extractColumnsFromTableChildren(children: React.ReactNode): ColumnMeta[] {
  const topNodes = React.Children.toArray(children)
  for (const node of topNodes) {
    if (!React.isValidElement(node)) continue
    const nodeProps = node.props as Record<string, unknown>
    const rows = React.Children.toArray(nodeProps.children as React.ReactNode)
    for (const row of rows) {
      if (!React.isValidElement(row)) continue
      const rowProps = row.props as Record<string, unknown>
      const cells = React.Children.toArray(rowProps.children as React.ReactNode)
      if (cells.length === 0) continue

      // Kiểm tra có phải hàng tiêu đề chứa TableHead không
      const firstCell = cells[0]
      if (!React.isValidElement(firstCell)) continue
      const total = cells.length

      return cells.map((cell, idx) => {
        if (!React.isValidElement(cell)) {
          return {
            index: idx,
            id: `col_${idx}`,
            label: `Cột ${idx + 1}`,
            defaultHidden: false,
            locked: false,
            isAction: false,
          }
        }
        const cProps = cell.props as Record<string, unknown>
        const explicitLabel = typeof cProps.colLabel === "string" ? cProps.colLabel.trim() : ""
        const ariaLabel = typeof cProps["aria-label"] === "string" ? cProps["aria-label"].trim() : ""
        const textContent = extractTextFromNode(cProps.children as React.ReactNode)
        const isCheckbox = idx === 0 && hasCheckboxElement(cProps.children as React.ReactNode)

        let label = explicitLabel || textContent || ariaLabel
        const lower = label.toLowerCase()
        const isLast = idx === total - 1
        const isAction =
          isLast &&
          (!label ||
            lower === "hành động" ||
            lower === "thao tác" ||
            lower === "chi tiết" ||
            lower === "tác vụ")

        if (isCheckbox && !explicitLabel) {
          label = "Chọn ô"
        } else if (!label && isLast) {
          label = "Thao tác"
        } else if (!label) {
          label = `Cột ${idx + 1}`
        }

        const defaultHidden = Boolean(cProps.defaultHidden)
        const firstCellChildren = React.isValidElement(cells[0])
          ? ((cells[0].props as Record<string, unknown>).children as React.ReactNode)
          : null
        const locked =
          cProps.locked !== undefined
            ? Boolean(cProps.locked)
            : isCheckbox || isAction || (idx === 0 && !defaultHidden) || (idx === 1 && hasCheckboxElement(firstCellChildren))

        return {
          index: idx,
          id: `col_${idx}_${label.replace(/\s+/g, "_").toLowerCase()}`,
          label,
          defaultHidden,
          locked,
          isAction,
        }
      })
    }
  }
  return []
}

function stripResponsiveHiddenClass(className?: string): string | undefined {
  if (!className) return className
  return className
    .replace(/\bhidden\b/g, "")
    .replace(/\b(sm|md|lg|xl|2xl):table-cell\b/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function makeStorageKey(tableId: string | undefined, columns: ColumnMeta[]): string {
  if (tableId) return `uudam_cols_v2_${tableId}`
  const sig = columns.map((c) => c.label).join("|")
  let hash = 0
  for (let i = 0; i < sig.length; i++) {
    hash = (hash << 5) - hash + sig.charCodeAt(i)
    hash |= 0
  }
  return `uudam_cols_v2_${Math.abs(hash)}_${columns.length}`
}

export interface TableProps extends React.ComponentProps<"table"> {
  /** Định danh bảng để lưu cấu hình cột riêng biệt */
  tableId?: string
  /** Bật thanh tùy chỉnh thêm/bớt cột dữ liệu (mặc định tự bật cho bảng >= 4 cột ngoài Dialog) */
  enableColumnCustomizer?: boolean
  /** Tắt thanh tùy chỉnh cột nếu là bảng phụ nhỏ */
  disableColumnCustomizer?: boolean
}

const QUICK_CUSTOM_COLUMN_PRESETS: Array<{ label: string; type: CustomColumnType }> = [
  { label: "Ghi chú kiểm tra", type: "text" },
  { label: "Người phụ trách", type: "text" },
  { label: "Mức ưu tiên", type: "tag" },
  { label: "Đã đối soát", type: "checkbox" },
]

function Table({
  className,
  tableId,
  enableColumnCustomizer,
  disableColumnCustomizer,
  children,
  ...props
}: TableProps) {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const columns = React.useMemo(() => extractColumnsFromTableChildren(children), [children])
  const storageKey = React.useMemo(() => makeStorageKey(tableId, columns), [tableId, columns])

  const defaultVisibleIndices = React.useMemo(
    () => columns.filter((c) => !c.defaultHidden).map((c) => c.index),
    [columns]
  )
  const defaultOrder = React.useMemo(() => columns.map((c) => c.index), [columns])

  const [inDialog, setInDialog] = React.useState(false)
  const [visibleIndices, setVisibleIndices] = React.useState<number[]>(defaultVisibleIndices)
  const [columnOrder, setColumnOrder] = React.useState<number[]>(defaultOrder)
  const [customColumns, setCustomColumns] = React.useState<CustomColumnDef[]>([])
  const [customCellValues, setCustomCellValues] = React.useState<Record<string, string>>({})
  const [density, setDensity] = React.useState<RowDensity>("normal")
  const [mobileMode, setMobileMode] = React.useState<MobileTableMode>("cards")

  const [panelOpen, setPanelOpen] = React.useState(false)
  const [addColOpen, setAddColOpen] = React.useState(false)
  const [newColLabel, setNewColLabel] = React.useState("")
  const [newColType, setNewColType] = React.useState<CustomColumnType>("text")
  const [searchCol, setSearchCol] = React.useState("")

  // Kiểm tra xem bảng có nằm trong Dialog nhỏ không
  React.useEffect(() => {
    if (containerRef.current) {
      const dialogParent = containerRef.current.closest('[role="dialog"]')
      setInDialog(Boolean(dialogParent))
    }
  }, [])

  // Đồng bộ khi danh sách cột gốc của bảng thay đổi
  React.useEffect(() => {
    setVisibleIndices(defaultVisibleIndices)
    setColumnOrder(defaultOrder)
  }, [ storageKey, defaultVisibleIndices, defaultOrder ])

  // Khôi phục cấu hình cột đã lưu từ localStorage
  React.useEffect(() => {
    if (typeof window === "undefined" || columns.length === 0) return
    try {
      const raw = window.localStorage.getItem(storageKey)
      if (!raw) return
      const parsed = JSON.parse(raw) as {
        visibleIndices?: number[]
        columnOrder?: number[]
        customColumns?: CustomColumnDef[]
        customCellValues?: Record<string, string>
        density?: RowDensity
        mobileMode?: MobileTableMode
      }
      if (Array.isArray(parsed.visibleIndices) && parsed.visibleIndices.length > 0) {
        const valid = parsed.visibleIndices.filter((idx) => idx >= 0 && idx < columns.length)
        if (valid.length > 0) setVisibleIndices(valid)
      }
      if (Array.isArray(parsed.columnOrder) && parsed.columnOrder.length === columns.length) {
        setColumnOrder(parsed.columnOrder)
      }
      if (Array.isArray(parsed.customColumns)) {
        setCustomColumns(parsed.customColumns)
      }
      if (parsed.customCellValues && typeof parsed.customCellValues === "object") {
        setCustomCellValues(parsed.customCellValues)
      }
      if (parsed.density === "compact" || parsed.density === "normal" || parsed.density === "comfortable") {
        setDensity(parsed.density)
      }
      if (parsed.mobileMode === "cards" || parsed.mobileMode === "table") {
        setMobileMode(parsed.mobileMode)
      }
    } catch {
      // Bỏ qua nếu dữ liệu localStorage lỗi
    }
  }, [storageKey, columns.length])

  const persistState = React.useCallback(
    (next: {
      visibleIndices?: number[]
      columnOrder?: number[]
      customColumns?: CustomColumnDef[]
      customCellValues?: Record<string, string>
      density?: RowDensity
      mobileMode?: MobileTableMode
    }) => {
      if (typeof window === "undefined") return
      try {
        const payload = {
          visibleIndices: next.visibleIndices ?? visibleIndices,
          columnOrder: next.columnOrder ?? columnOrder,
          customColumns: next.customColumns ?? customColumns,
          customCellValues: next.customCellValues ?? customCellValues,
          density: next.density ?? density,
          mobileMode: next.mobileMode ?? mobileMode,
        }
        window.localStorage.setItem(storageKey, JSON.stringify(payload))
      } catch {
        // Ignore quota errors
      }
    },
    [storageKey, visibleIndices, columnOrder, customColumns, customCellValues, density, mobileMode]
  )

  const customizerActive =
    !disableColumnCustomizer &&
    (enableColumnCustomizer === true || (!inDialog && columns.length >= 6))

  const visibleSet = React.useMemo(() => new Set(visibleIndices), [visibleIndices])

  const handleToggleColumn = React.useCallback(
    (colIdx: number) => {
      const col = columns[colIdx]
      if (!col) return
      setVisibleIndices((prev) => {
        const exists = prev.includes(colIdx)
        if (exists) {
          // Không cho phép ẩn cột bị khóa hoặc khi chỉ còn 2 cột hiển thị
          if (col.locked || prev.length <= 2) return prev
          const next = prev.filter((i) => i !== colIdx)
          persistState({ visibleIndices: next })
          return next
        } else {
          const next = [...prev, colIdx]
          persistState({ visibleIndices: next })
          return next
        }
      })
    },
    [columns, persistState]
  )

  const handleMoveColumn = React.useCallback(
    (colIdx: number, direction: "left" | "right") => {
      setColumnOrder((prev) => {
        const pos = prev.indexOf(colIdx)
        if (pos === -1) return prev
        const targetPos = direction === "left" ? pos - 1 : pos + 1
        if (targetPos < 0 || targetPos >= prev.length) return prev
        const next = [...prev]
        const [removed] = next.splice(pos, 1)
        next.splice(targetPos, 0, removed)
        persistState({ columnOrder: next })
        return next
      })
    },
    [persistState]
  )

  const handleShowAllColumns = React.useCallback(() => {
    const all = columns.map((c) => c.index)
    setVisibleIndices(all)
    persistState({ visibleIndices: all })
  }, [columns, persistState])

  const handleCompactPreset = React.useCallback(() => {
    // Giữ lại các cột locked + tối đa 4 cột đầu tiên không ẩn mặc định
    const core = columns
      .filter((c, i) => c.locked || (!c.defaultHidden && i < 5))
      .map((c) => c.index)
    const next = core.length >= 2 ? core : defaultVisibleIndices
    setVisibleIndices(next)
    persistState({ visibleIndices: next })
  }, [columns, defaultVisibleIndices, persistState])

  const handleResetDefault = React.useCallback(() => {
    setVisibleIndices(defaultVisibleIndices)
    setColumnOrder(defaultOrder)
    setDensity("normal")
    persistState({
      visibleIndices: defaultVisibleIndices,
      columnOrder: defaultOrder,
      density: "normal",
    })
  }, [defaultVisibleIndices, defaultOrder, persistState])

  const handleAddCustomColumn = React.useCallback(
    (labelInput?: string, typeInput?: CustomColumnType) => {
      const finalLabel = (labelInput ?? newColLabel).trim()
      const finalType = typeInput ?? newColType
      if (!finalLabel) return
      const newCol: CustomColumnDef = {
        id: `custom_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        label: finalLabel,
        type: finalType,
      }
      setCustomColumns((prev) => {
        const next = [...prev, newCol]
        persistState({ customColumns: next })
        return next
      })
      setNewColLabel("")
      setAddColOpen(false)
    },
    [newColLabel, newColType, persistState]
  )

  const handleRemoveCustomColumn = React.useCallback(
    (colId: string) => {
      setCustomColumns((prev) => {
        const next = prev.filter((c) => c.id !== colId)
        persistState({ customColumns: next })
        return next
      })
    },
    [persistState]
  )

  const handleSetCustomCellValue = React.useCallback(
    (rowKey: string, colId: string, value: string) => {
      const cellKey = `${rowKey}::${colId}`
      setCustomCellValues((prev) => {
        const next = { ...prev, [cellKey]: value }
        persistState({ customCellValues: next })
        return next
      })
    },
    [persistState]
  )

  const handleChangeDensity = React.useCallback(
    (nextDensity: RowDensity) => {
      setDensity(nextDensity)
      persistState({ density: nextDensity })
    },
    [persistState]
  )

  const handleExportVisibleCsv = React.useCallback(() => {
    if (!containerRef.current) return
    const tableEl = containerRef.current.querySelector("table")
    if (!tableEl) return
    const rows = Array.from(tableEl.querySelectorAll("tr"))
    const csvLines = rows.map((tr) => {
      const cells = Array.from(tr.querySelectorAll("th, td"))
      return cells
        .map((cell) => {
          const inputEl = cell.querySelector("input, select") as HTMLInputElement | null
          const rawText = inputEl
            ? inputEl.type === "checkbox"
              ? inputEl.checked
                ? "Có"
                : "Không"
              : inputEl.value
            : (cell.textContent ?? "").replace(/\s+/g, " ").trim()
          return `"${rawText.replace(/"/g, '""')}"`
        })
        .join(",")
    })
    const csvContent = "\uFEFF" + csvLines.join("\n")
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `du-lieu-bang-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [])

  const mobileCardActive = customizerActive && mobileMode === "cards"

  const handleChangeMobileMode = React.useCallback(
    (nextMode: MobileTableMode) => {
      setMobileMode(nextMode)
      persistState({ mobileMode: nextMode })
    },
    [persistState]
  )

  const contextValue = React.useMemo<TableColumnContextValue>(
    () => ({
      enabled: customizerActive,
      mobileCardActive,
      columns,
      visibleSet,
      columnOrder,
      customColumns,
      customCellValues,
      setCustomCellValue: handleSetCustomCellValue,
      removeCustomColumn: handleRemoveCustomColumn,
      density,
    }),
    [
      customizerActive,
      mobileCardActive,
      columns,
      visibleSet,
      columnOrder,
      customColumns,
      customCellValues,
      handleSetCustomCellValue,
      handleRemoveCustomColumn,
      density,
    ]
  )

  const totalColumnsCount = columns.length + customColumns.length
  const activeColumnsCount = visibleIndices.length + customColumns.length
  const hiddenColumnsCount = columns.length - visibleIndices.length
  const isModified =
    visibleIndices.length !== defaultVisibleIndices.length ||
    visibleIndices.some((i) => !defaultVisibleIndices.includes(i)) ||
    columnOrder.some((idx, pos) => idx !== defaultOrder[pos]) ||
    customColumns.length > 0 ||
    density !== "normal"

  const orderedColumns = React.useMemo(
    () => columnOrder.map((idx) => columns[idx]).filter(Boolean),
    [columnOrder, columns]
  )

  const filteredOrderedColumns = React.useMemo(() => {
    const q = searchCol.trim().toLowerCase()
    if (!q) return orderedColumns
    return orderedColumns.filter((c) => c.label.toLowerCase().includes(q))
  }, [orderedColumns, searchCol])

  return (
    <TableColumnContext.Provider value={contextValue}>
      <div
        ref={containerRef}
        data-slot="table-container"
        className="relative w-full overflow-x-auto"
      >
        {customizerActive && (
          <div
            data-slot="table-column-customizer"
            className="sticky left-0 z-10 border-b border-border/80 bg-slate-50/90 px-3 py-1.5 text-xs backdrop-blur-sm dark:bg-slate-900/70"
          >
            {/* Thanh gọn trên Điện thoại (< md): Chế độ Thẻ dọc / Bảng + 1 nút Tùy chỉnh duy nhất */}
            <div className="flex items-center justify-between gap-1.5 md:hidden">
              <div
                role="group"
                aria-label="Chế độ hiển thị trên điện thoại"
                className="inline-flex shrink-0 items-center rounded-lg border border-border bg-background p-0.5 shadow-2xs"
              >
                <button
                  type="button"
                  onClick={() => handleChangeMobileMode("cards")}
                  className={cn(
                    "inline-flex min-h-8 items-center gap-1 rounded-md px-2.5 text-[11px] font-semibold whitespace-nowrap transition-colors",
                    mobileMode === "cards"
                      ? "bg-[#0066CC] text-white shadow-2xs"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <LayoutList className="h-3.5 w-3.5 shrink-0" />
                  <span>Thẻ dọc</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleChangeMobileMode("table")}
                  className={cn(
                    "inline-flex min-h-8 items-center gap-1 rounded-md px-2.5 text-[11px] font-semibold whitespace-nowrap transition-colors",
                    mobileMode === "table"
                      ? "bg-[#0066CC] text-white shadow-2xs"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Table2 className="h-3.5 w-3.5 shrink-0" />
                  <span>Bảng</span>
                </button>
              </div>

              <button
                type="button"
                onClick={() => {
                  setPanelOpen((v) => !v)
                  if (panelOpen) setAddColOpen(false)
                }}
                className={cn(
                  "inline-flex min-h-8 items-center gap-1 rounded-lg border px-2.5 text-[11px] font-semibold whitespace-nowrap transition-colors",
                  panelOpen || addColOpen
                    ? "border-[#0066CC] bg-[#0066CC] text-white"
                    : "border-border bg-background text-foreground"
                )}
              >
                <SlidersHorizontal className="h-3 w-3 shrink-0" />
                <span>Cột ({activeColumnsCount}/{totalColumnsCount})</span>
                {panelOpen ? <ChevronUp className="h-3 w-3 shrink-0" /> : <ChevronDown className="h-3 w-3 shrink-0" />}
              </button>
            </div>

            {/* Thanh gọn trên Tablet/Laptop/Desktop (>= md): Progressive Disclosure — chỉ hiện trạng thái + 1 nút mở tùy chỉnh */}
            <div className="hidden items-center justify-between gap-2 md:flex">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                  <Columns3 className="h-3.5 w-3.5 text-[#0066CC]" />
                  <span>
                    Hiển thị <strong className="font-semibold text-foreground">{activeColumnsCount}/{totalColumnsCount}</strong> cột
                  </span>
                </span>

                {hiddenColumnsCount > 0 && (
                  <button
                    type="button"
                    onClick={handleShowAllColumns}
                    className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
                  >
                    <Eye className="h-3 w-3" />
                    Hiện đủ {columns.length} cột (+{hiddenColumnsCount})
                  </button>
                )}

                {/* Chip các cột tự tạo bởi người dùng (nếu có) */}
                {customColumns.map((cc) => (
                  <span
                    key={cc.id}
                    className="inline-flex items-center gap-1 rounded-full border border-violet-300 bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-800 dark:border-violet-800 dark:bg-violet-950/60 dark:text-violet-200"
                  >
                    <Sparkles className="h-2.5 w-2.5 text-violet-600" />
                    <span>{cc.label}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveCustomColumn(cc.id)}
                      title={`Xóa cột tự tạo "${cc.label}"`}
                      className="ml-0.5 rounded-full p-0.5 hover:bg-violet-200 dark:hover:bg-violet-800"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </span>
                ))}
              </div>

              {/* Cụm nút tác vụ gọn bên phải */}
              <div className="flex shrink-0 items-center gap-1.5">
                {isModified && (
                  <button
                    type="button"
                    onClick={handleResetDefault}
                    title="Khôi phục bố cục cột mặc định"
                    className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <RotateCcw className="h-3 w-3" />
                    Mặc định
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => {
                    setPanelOpen((v) => !v)
                    if (panelOpen) setAddColOpen(false)
                  }}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[11px] font-semibold transition-colors",
                    panelOpen
                      ? "border-[#0066CC] bg-[#0066CC] text-white"
                      : "border-border bg-background text-foreground hover:bg-muted"
                  )}
                >
                  <SlidersHorizontal className="h-3 w-3" />
                  <span>Tùy chỉnh cột</span>
                  {panelOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                </button>
              </div>
            </div>

            {/* Khung tạo cột dữ liệu tùy chỉnh mới (+ Thêm cột mới) */}
            {addColOpen && (
              <div className="mt-2.5 rounded-lg border border-violet-200 bg-white p-3 shadow-sm dark:border-violet-900 dark:bg-slate-950">
                <div className="flex flex-col gap-2.5 sm:flex-row sm:items-end sm:justify-between">
                  <div className="flex flex-1 flex-wrap items-end gap-2">
                    <div className="min-w-[200px] flex-1">
                      <label className="mb-1 block text-[11px] font-semibold text-foreground">
                        Tên cột dữ liệu mới cần thêm vào bảng
                      </label>
                      <input
                        type="text"
                        value={newColLabel}
                        onChange={(e) => setNewColLabel(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault()
                            handleAddCustomColumn()
                          }
                        }}
                        placeholder="VD: Ghi chú kiểm hàng, Người phụ trách, Link đối chiếu..."
                        className="h-8 w-full rounded-md border border-input bg-background px-2.5 text-xs focus:border-violet-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold text-foreground">
                        Kiểu dữ liệu
                      </label>
                      <select
                        value={newColType}
                        onChange={(e) => setNewColType(e.target.value as CustomColumnType)}
                        className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                      >
                        <option value="text">Văn bản / Ghi chú</option>
                        <option value="tag">Nhãn trạng thái (Bình thường / Ưu tiên / Gấp)</option>
                        <option value="number">Số / Tiền tệ</option>
                        <option value="checkbox">Ô đánh dấu (Đã kiểm / Chưa)</option>
                      </select>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleAddCustomColumn()}
                      disabled={!newColLabel.trim()}
                      className="inline-flex h-8 items-center gap-1 rounded-md bg-violet-600 px-3 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Tạo & Thêm vào bảng
                    </button>
                  </div>

                  {/* Mẫu cột thêm nhanh 1 chạm */}
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="text-[11px] text-muted-foreground mr-1">Mẫu nhanh:</span>
                    {QUICK_CUSTOM_COLUMN_PRESETS.map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => handleAddCustomColumn(preset.label, preset.type)}
                        className="inline-flex items-center gap-1 rounded border border-violet-200 bg-violet-50/70 px-2 py-1 text-[11px] font-medium text-violet-800 hover:bg-violet-100 dark:border-violet-800 dark:bg-violet-950/50 dark:text-violet-300"
                      >
                        <Plus className="h-2.5 w-2.5" />
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Bảng điều khiển chi tiết: Tìm cột, Bật/Tắt, Đổi thứ tự Trái/Phải, Mật độ dòng, Xuất CSV */}
            {panelOpen && (
              <div className="mt-2.5 rounded-lg border border-border bg-white p-3 shadow-sm dark:bg-slate-950">
                <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2 border-b pb-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      value={searchCol}
                      onChange={(e) => setSearchCol(e.target.value)}
                      placeholder="Tìm nhanh tên cột..."
                      className="h-7 w-44 rounded-md border border-input bg-background px-2 text-xs"
                    />
                    <button
                      type="button"
                      onClick={handleShowAllColumns}
                      className="inline-flex h-7 items-center gap-1 rounded border px-2 text-[11px] font-medium hover:bg-muted"
                    >
                      <Eye className="h-3 w-3 text-emerald-600" /> Hiện tất cả ({columns.length})
                    </button>
                    <button
                      type="button"
                      onClick={handleCompactPreset}
                      className="inline-flex h-7 items-center gap-1 rounded border px-2 text-[11px] font-medium hover:bg-muted"
                    >
                      <EyeOff className="h-3 w-3 text-amber-600" /> Chế độ Thu gọn
                    </button>
                    <button
                      type="button"
                      onClick={handleResetDefault}
                      className="inline-flex h-7 items-center gap-1 rounded border px-2 text-[11px] font-medium hover:bg-muted"
                    >
                      <RotateCcw className="h-3 w-3" /> Mặc định
                    </button>
                    <button
                      type="button"
                      onClick={() => setAddColOpen((v) => !v)}
                      className={cn(
                        "inline-flex h-7 items-center gap-1 rounded border px-2 text-[11px] font-semibold transition-colors",
                        addColOpen
                          ? "border-violet-500 bg-violet-600 text-white"
                          : "border-violet-300 bg-violet-50/90 text-violet-800 hover:bg-violet-100 dark:border-violet-800 dark:bg-violet-950/50 dark:text-violet-200"
                      )}
                    >
                      <Plus className="h-3 w-3" /> Thêm cột mới
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center gap-1 rounded-md border bg-muted/40 p-0.5">
                      <span className="px-1.5 text-[11px] text-muted-foreground">Mật độ dòng:</span>
                      {(
                        [
                          { key: "compact", label: "Gọn" },
                          { key: "normal", label: "Chuẩn" },
                          { key: "comfortable", label: "Thoáng" },
                        ] as const
                      ).map((d) => (
                        <button
                          key={d.key}
                          type="button"
                          onClick={() => handleChangeDensity(d.key)}
                          className={cn(
                            "rounded px-2 py-0.5 text-[11px] font-medium transition-colors",
                            density === d.key
                              ? "bg-[#0066CC] text-white"
                              : "text-muted-foreground hover:text-foreground"
                          )}
                        >
                          {d.label}
                        </button>
                      ))}
                    </div>

                    <button
                      type="button"
                      onClick={handleExportVisibleCsv}
                      className="inline-flex h-7 items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2.5 text-[11px] font-semibold text-blue-700 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950/60 dark:text-blue-300"
                    >
                      <Download className="h-3 w-3" />
                      Xuất CSV ({activeColumnsCount} cột đang chọn)
                    </button>
                  </div>
                </div>

                {/* Lưới danh sách cột + nút dịch chuyển Trái / Phải */}
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                  {filteredOrderedColumns.map((col) => {
                    const isVisible = visibleSet.has(col.index)
                    const orderPos = columnOrder.indexOf(col.index)
                    return (
                      <div
                        key={col.id}
                        className={cn(
                          "flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 transition-colors",
                          isVisible
                            ? "border-blue-200/90 bg-blue-50/40 dark:border-blue-900/60 dark:bg-blue-950/20"
                            : "border-dashed border-border bg-muted/20 opacity-75"
                        )}
                      >
                        <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                          <input
                            type="checkbox"
                            checked={isVisible}
                            disabled={col.locked && isVisible}
                            onChange={() => handleToggleColumn(col.index)}
                            className="h-3.5 w-3.5 rounded border-gray-300 accent-[#0066CC]"
                          />
                          <span className="truncate font-medium text-foreground">{col.label}</span>
                          {col.defaultHidden && (
                            <span className="shrink-0 rounded bg-emerald-100 px-1 py-0.2 text-[9px] font-semibold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                              Mở rộng
                            </span>
                          )}
                        </label>
                        <div className="flex shrink-0 items-center gap-0.5">
                          <button
                            type="button"
                            disabled={orderPos <= 0}
                            onClick={() => handleMoveColumn(col.index, "left")}
                            title="Dịch cột sang trái"
                            className="rounded p-1 hover:bg-muted disabled:opacity-30"
                          >
                            <ArrowLeft className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            disabled={orderPos >= columnOrder.length - 1}
                            onClick={() => handleMoveColumn(col.index, "right")}
                            title="Dịch cột sang phải"
                            className="rounded p-1 hover:bg-muted disabled:opacity-30"
                          >
                            <ArrowRight className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        <table
          data-slot="table"
          className={cn(
            "w-full caption-bottom text-sm",
            customizerActive && activeColumnsCount <= 6 && "!min-w-full",
            className,
            mobileCardActive && "max-md:block max-md:w-full max-md:!min-w-0"
          )}
          {...props}
        >
          {children}
        </table>
      </div>
    </TableColumnContext.Provider>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  const colCtx = React.useContext(TableColumnContext)
  return (
    <TableSectionContext.Provider value="header">
      <thead
        data-slot="table-header"
        className={cn(
          "[&_tr]:border-b",
          colCtx?.mobileCardActive && "max-md:hidden",
          className
        )}
        {...props}
      />
    </TableSectionContext.Provider>
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  const colCtx = React.useContext(TableColumnContext)
  return (
    <TableSectionContext.Provider value="body">
      <tbody
        data-slot="table-body"
        className={cn(
          "[&_tr:last-child]:border-0",
          colCtx?.mobileCardActive &&
            "max-md:flex max-md:flex-col max-md:gap-2.5 max-md:bg-slate-50/60 max-md:p-2.5 dark:max-md:bg-slate-900/35",
          className
        )}
        {...props}
      />
    </TableSectionContext.Provider>
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <TableSectionContext.Provider value="footer">
      <tfoot
        data-slot="table-footer"
        className={cn(
          "bg-muted/50 border-t font-medium [&>tr]:last:border-b-0",
          className
        )}
        {...props}
      />
    </TableSectionContext.Provider>
  )
}

function TableRow({ className, children, ...props }: React.ComponentProps<"tr">) {
  const colCtx = React.useContext(TableColumnContext)
  const section = React.useContext(TableSectionContext)

  if (!colCtx || !colCtx.enabled || colCtx.columns.length === 0) {
    return (
      <tr
        data-slot="table-row"
        className={cn(
          "hover:bg-muted/50 data-[state=selected]:bg-muted border-b transition-colors",
          className
        )}
        {...props}
      >
        {children}
      </tr>
    )
  }

  const childArray = React.Children.toArray(children)

  // Nếu hàng chỉ có 1 ô (ví dụ: Empty state colSpan), giữ nguyên và cập nhật colSpan khớp số cột đang hiện
  if (childArray.length <= 1) {
    const onlyChild = childArray[0]
    if (React.isValidElement(onlyChild)) {
      const cProps = onlyChild.props as Record<string, unknown>
      if (typeof cProps.colSpan === "number" && cProps.colSpan > 1) {
        return (
          <tr
            data-slot="table-row"
            className={cn(
              "hover:bg-muted/50 data-[state=selected]:bg-muted border-b transition-colors",
              className
            )}
            {...props}
          >
            {React.cloneElement(onlyChild as React.ReactElement<{ colSpan?: number }>, {
              colSpan: colCtx.visibleSet.size + colCtx.customColumns.length,
            })}
          </tr>
        )
      }
    }
    return (
      <tr
        data-slot="table-row"
        className={cn(
          "hover:bg-muted/50 data-[state=selected]:bg-muted border-b transition-colors",
          className
        )}
        {...props}
      >
        {children}
      </tr>
    )
  }

  // Tạo khóa định danh dòng ổn định từ 2 ô đầu tiên để lưu giá trị cột tự tạo
  const rowKey =
    (extractTextFromNode(childArray[0]) + "_" + extractTextFromNode(childArray[1]))
      .replace(/\s+/g, "_")
      .slice(0, 64) || "row"

  const densityClass =
    colCtx.density === "compact"
      ? "[&>td]:py-1 [&>th]:h-8 text-xs"
      : colCtx.density === "comfortable"
        ? "[&>td]:py-3.5 [&>th]:h-12"
        : ""

  // Sắp xếp và lọc các cột theo cấu hình của người dùng
  const renderedCells: React.ReactNode[] = []
  const lastColMeta = colCtx.columns[colCtx.columns.length - 1]
  const hasTrailingActionCol = Boolean(lastColMeta?.isAction)

  const renderCustomColCells = () =>
    colCtx.customColumns.map((cc) => {
      if (section === "header") {
        return (
          <th
            key={cc.id}
            data-slot="table-head"
            className="text-foreground h-10 bg-violet-50/40 px-2 text-left align-middle font-medium whitespace-nowrap dark:bg-violet-950/20"
          >
            <div className="inline-flex items-center gap-1.5">
              <Sparkles className="h-3 w-3 text-violet-600" />
              <span>{cc.label}</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  colCtx.removeCustomColumn(cc.id)
                }}
                title={`Xóa cột "${cc.label}"`}
                className="rounded p-0.5 text-muted-foreground hover:bg-red-100 hover:text-red-600"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          </th>
        )
      }
      if (section === "footer") {
        return <td key={cc.id} data-slot="table-cell" className="p-2 align-middle" />
      }
      const cellKey = `${rowKey}::${cc.id}`
      const val = colCtx.customCellValues[cellKey] ?? ""
      return (
        <td
          key={cc.id}
          data-slot="table-cell"
          onClick={(e) => e.stopPropagation()}
          className="p-2 align-middle whitespace-nowrap"
        >
          {cc.type === "checkbox" ? (
            <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                checked={val === "true"}
                onChange={(e) =>
                  colCtx.setCustomCellValue(rowKey, cc.id, e.target.checked ? "true" : "false")
                }
                className="h-4 w-4 rounded accent-violet-600"
              />
              <span className="text-muted-foreground">{val === "true" ? "Đã duyệt" : "Chưa"}</span>
            </label>
          ) : cc.type === "tag" ? (
            <select
              value={val || "Bình thường"}
              onChange={(e) => colCtx.setCustomCellValue(rowKey, cc.id, e.target.value)}
              className="h-7 rounded border border-input bg-background px-1.5 text-xs font-medium"
            >
              <option value="Bình thường">Bình thường</option>
              <option value="Ưu tiên">⭐ Ưu tiên</option>
              <option value="Khẩn cấp">🔥 Khẩn cấp</option>
              <option value="Hoàn tất">✓ Hoàn tất</option>
            </select>
          ) : (
            <input
              type={cc.type === "number" ? "number" : "text"}
              value={val}
              onChange={(e) => colCtx.setCustomCellValue(rowKey, cc.id, e.target.value)}
              placeholder={`Nhập ${cc.label.toLowerCase()}...`}
              className="h-7 w-32 rounded border border-transparent bg-muted/40 px-2 text-xs transition-colors hover:border-input focus:border-violet-500 focus:bg-background focus:outline-none"
            />
          )}
        </td>
      )
    })

  let customInserted = false
  const isMobileBodyCard = Boolean(colCtx.mobileCardActive && section === "body")
  const firstColIsCheckbox = colCtx.columns[0]?.label === "Chọn ô"
  let visibleDataRank = 0

  for (const colIdx of colCtx.columnOrder) {
    if (!colCtx.visibleSet.has(colIdx)) continue
    if (
      hasTrailingActionCol &&
      colIdx === colCtx.columns.length - 1 &&
      !customInserted &&
      colCtx.customColumns.length > 0
    ) {
      renderedCells.push(...renderCustomColCells())
      customInserted = true
    }

    const colMeta = colCtx.columns[colIdx]
    const isCheckboxCell = colIdx === 0 && firstColIsCheckbox
    const isActionCell = Boolean(colMeta?.isAction)
    const isPrimaryTitleCell = !isCheckboxCell && !isActionCell && visibleDataRank === 0
    if (!isCheckboxCell && !isActionCell) {
      visibleDataRank += 1
    }

    const cellNode = childArray[colIdx]
    if (React.isValidElement(cellNode)) {
      const cProps = cellNode.props as Record<string, unknown>
      const cleanedClassName = stripResponsiveHiddenClass(cProps.className as string | undefined)
      const mobileCellClasses = isMobileBodyCard
        ? isCheckboxCell
          ? "max-md:col-span-1 max-md:flex max-md:w-auto max-md:items-center max-md:gap-2 max-md:border-b max-md:border-border/50 max-md:p-0 max-md:pb-2 max-md:!text-left max-md:after:text-xs max-md:after:font-medium max-md:after:text-muted-foreground max-md:after:content-['Chọn']"
          : isPrimaryTitleCell && firstColIsCheckbox
            ? "max-md:col-span-1 max-md:flex max-md:flex-col max-md:items-end max-md:justify-center max-md:border-b max-md:border-border/50 max-md:p-0 max-md:pb-2 max-md:!text-right max-md:whitespace-normal max-md:max-w-none"
            : isPrimaryTitleCell
              ? "max-md:col-span-2 max-md:border-b max-md:border-border/50 max-md:p-0 max-md:pb-2 max-md:!text-left max-md:whitespace-normal max-md:max-w-none"
              : isActionCell
                ? "max-md:col-span-2 max-md:mt-0.5 max-md:flex max-md:flex-wrap max-md:items-center max-md:justify-end max-md:gap-2 max-md:border-t max-md:border-border/60 max-md:p-0 max-md:pt-2.5 max-md:[&_button]:min-h-9 max-md:[&_button]:px-3"
                : "max-md:flex max-md:min-w-0 max-md:max-w-none max-md:flex-col max-md:items-start max-md:overflow-hidden max-md:p-0 max-md:!text-left max-md:whitespace-normal max-md:[&>*]:flex-wrap max-md:before:mb-0.5 max-md:before:block max-md:before:text-[10px] max-md:before:font-semibold max-md:before:tracking-wide max-md:before:text-muted-foreground max-md:before:uppercase max-md:before:content-[attr(data-label)]"
        : undefined

      renderedCells.push(
        React.cloneElement(
          cellNode as React.ReactElement<{ className?: string; key?: React.Key; "data-label"?: string }>,
          {
            key: `col_${colIdx}`,
            "data-label": isMobileBodyCard && colMeta ? colMeta.label : undefined,
            className: cn(cleanedClassName, mobileCellClasses),
          }
        )
      )
    } else if (cellNode !== undefined) {
      renderedCells.push(cellNode)
    }
  }

  if (!customInserted && colCtx.customColumns.length > 0) {
    renderedCells.push(...renderCustomColCells())
  }

  return (
    <tr
      data-slot="table-row"
      className={cn(
        "hover:bg-muted/50 data-[state=selected]:bg-muted border-b transition-colors",
        densityClass,
        isMobileBodyCard &&
          "max-md:grid max-md:grid-cols-2 max-md:items-start max-md:gap-x-3 max-md:gap-y-2.5 max-md:rounded-xl max-md:!border max-md:border-border/90 max-md:bg-card max-md:p-3.5 max-md:shadow-2xs",
        className
      )}
      {...props}
    >
      {renderedCells}
    </tr>
  )
}

export interface TableHeadProps extends React.ComponentProps<"th"> {
  /** Nếu true, cột dữ liệu này mặc định được ẩn gọn, người dùng có thể bấm "+ Tên cột" để thêm vào bảng */
  defaultHidden?: boolean
  /** Nhãn tên cột hiển thị trên thanh tùy chỉnh cột */
  colLabel?: string
  /** Khóa không cho phép ẩn cột định danh chính */
  locked?: boolean
}

function TableHead({
  className,
  defaultHidden: _defaultHidden,
  colLabel: _colLabel,
  locked: _locked,
  ...props
}: TableHeadProps) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "text-foreground h-10 px-2 text-left align-middle font-medium whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        className
      )}
      {...props}
    />
  )
}

export interface TableCellProps extends React.ComponentProps<"td"> {
  defaultHidden?: boolean
}

function TableCell({
  className,
  defaultHidden: _defaultHidden,
  ...props
}: TableCellProps) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("text-muted-foreground mt-4 text-sm", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
