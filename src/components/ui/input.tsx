import * as React from "react"

import { cn } from "@/lib/utils"

function inferMobileInputAttrs(
  type: React.HTMLInputTypeAttribute | undefined,
  props: React.ComponentProps<"input">
): {
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"]
  enterKeyHint?: React.HTMLAttributes<HTMLInputElement>["enterKeyHint"]
  autoComplete?: string
} {
  const hintText = `${props.placeholder ?? ""} ${props["aria-label"] ?? ""} ${props.name ?? ""} ${props.id ?? ""}`.toLowerCase()

  let inputMode = props.inputMode
  if (!inputMode) {
    if (type === "number") {
      const stepVal = props.step !== undefined ? Number(props.step) : NaN
      inputMode = !Number.isNaN(stepVal) && Number.isInteger(stepVal) && stepVal >= 1 ? "numeric" : "decimal"
    } else if (type === "tel" || /sđt|số điện thoại|điện thoại|\bphone\b|09\d{7,8}/i.test(hintText)) {
      inputMode = "tel"
    } else if (type === "email" || /\bemail\b/i.test(hintText)) {
      inputMode = "email"
    } else if (type === "url" || /^https?:\/\//i.test(props.placeholder ?? "")) {
      inputMode = "url"
    } else if (type === "search") {
      inputMode = "search"
    }
  }

  let enterKeyHint = props.enterKeyHint
  if (!enterKeyHint) {
    if (type === "search" || /^tìm\b|tìm kiếm|quét mã vạch/i.test(hintText)) {
      enterKeyHint = "search"
    }
  }

  let autoComplete = props.autoComplete
  if (!autoComplete) {
    if (inputMode === "tel") autoComplete = "tel"
    else if (inputMode === "email") autoComplete = "email"
  }

  return { inputMode, enterKeyHint, autoComplete }
}

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  const inferred = inferMobileInputAttrs(type, props)

  return (
    <input
      type={type}
      data-slot="input"
      inputMode={inferred.inputMode}
      enterKeyHint={inferred.enterKeyHint}
      autoComplete={inferred.autoComplete}
      className={cn(
        "file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground dark:bg-input/30 border-input flex h-11 w-full min-w-0 rounded-md border bg-transparent px-3 py-1.5 text-base shadow-xs transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 max-md:!text-base md:h-9 md:py-1 md:text-sm",
        "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
        "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
        className
      )}
      {...props}
    />
  )
}

export { Input }
