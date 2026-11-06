"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { Maximize2, Minimize2, XIcon } from "lucide-react"

import { cn } from "@/lib/utils"

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/55 backdrop-blur-[1px]",
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
}) {
  const [isMaximized, setIsMaximized] = React.useState(false)

  // Kiểm tra xem có phải hộp thoại xác nhận nhỏ (max-w-sm hoặc max-w-md) không
  const isCompactModal = Boolean(
    className && /\b(sm:)?max-w-(xs|sm|md)\b/.test(className)
  )

  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          "bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 sm:data-[state=closed]:zoom-out-95 sm:data-[state=open]:zoom-in-95 max-sm:data-[state=open]:slide-in-from-bottom-6 max-sm:data-[state=closed]:slide-out-to-bottom-6 fixed z-50 grid w-full gap-4 overflow-x-hidden border shadow-xl duration-200 [&>*]:min-w-0",
          // Mobile (< sm): Bottom Sheet neo đáy màn hình, tôn trọng safe-area và bàn phím ảo (dvh)
          "max-sm:inset-x-0 max-sm:bottom-0 max-sm:top-auto max-sm:max-h-[92dvh] max-sm:max-w-full max-sm:overflow-y-auto max-sm:overscroll-contain max-sm:rounded-t-2xl max-sm:rounded-b-none max-sm:border-x-0 max-sm:border-b-0 max-sm:p-4 max-sm:pb-[max(1rem,env(safe-area-inset-bottom))]",
          // Tablet & Desktop (>= sm): Hộp thoại căn giữa chuẩn
          "sm:top-[50%] sm:left-[50%] sm:max-w-[calc(100%-2rem)] sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-xl sm:p-6",
          isCompactModal
            ? "sm:max-w-md"
            : "sm:max-h-[92vh] sm:max-w-3xl sm:overflow-y-auto lg:max-w-5xl xl:max-w-6xl",
          className,
          !isCompactModal &&
            !isMaximized &&
            "sm:w-[94vw] lg:!max-w-5xl xl:!max-w-6xl",
          isMaximized &&
            "sm:!h-[94vh] sm:!max-h-[95vh] sm:!w-[96vw] sm:!max-w-[1680px] sm:content-start sm:overflow-y-auto"
        )}
        {...props}
      >
        {/* Thanh chỉ báo vuốt Bottom Sheet trên điện thoại */}
        <div
          aria-hidden="true"
          className="mx-auto -mt-1 mb-0.5 h-1.5 w-11 shrink-0 rounded-full bg-muted-foreground/25 sm:hidden"
        />

        {children}

        {showCloseButton && (
          <div className="absolute top-3.5 right-3.5 flex items-center gap-1.5 sm:right-4">
            {!isCompactModal && (
              <button
                type="button"
                onClick={() => setIsMaximized((v) => !v)}
                title={
                  isMaximized
                    ? "Thu về kích thước chuẩn"
                    : "Mở rộng toàn màn hình để thao tác thoải mái"
                }
                className="hidden h-8 items-center gap-1 rounded-md border border-border bg-muted/60 px-2.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:inline-flex"
              >
                {isMaximized ? (
                  <>
                    <Minimize2 className="h-3.5 w-3.5" />
                    <span>Thu chuẩn</span>
                  </>
                ) : (
                  <>
                    <Maximize2 className="h-3.5 w-3.5" />
                    <span>Mở rộng</span>
                  </>
                )}
              </button>
            )}
            <DialogPrimitive.Close
              data-slot="dialog-close"
              aria-label="Đóng hộp thoại"
              className="ring-offset-background focus:ring-ring data-[state=open]:bg-accent data-[state=open]:text-muted-foreground inline-flex h-10 w-10 items-center justify-center rounded-lg border border-border/60 bg-muted/40 opacity-85 transition-all hover:border-border hover:bg-muted hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none sm:h-8 sm:w-8 sm:rounded-md sm:border-transparent sm:bg-transparent [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
            >
              <XIcon />
              <span className="sr-only">Đóng</span>
            </DialogPrimitive.Close>
          </div>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-1.5 pr-12 text-left sm:gap-2 sm:pr-28", className)}
      {...props}
    />
  )
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        "max-sm:sticky max-sm:-bottom-4 max-sm:z-10 max-sm:-mx-4 max-sm:mt-2 max-sm:border-t max-sm:bg-background/95 max-sm:px-4 max-sm:pt-3 max-sm:pb-[max(0.75rem,env(safe-area-inset-bottom))] max-sm:backdrop-blur-md [&_button]:max-sm:min-h-11",
        className
      )}
      {...props}
    />
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-base leading-snug font-semibold sm:text-lg sm:leading-none", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-muted-foreground text-xs leading-relaxed sm:text-sm", className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
