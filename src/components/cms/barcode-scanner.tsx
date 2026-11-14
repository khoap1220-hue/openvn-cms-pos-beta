'use client'

/**
 * BARCODE SCANNER — Ô nhập & quét mã vạch đa thiết bị dùng chung:
 *  1. Súng quét mã vạch USB / Bluetooth 2.4GHz HID (bắn chuỗi + Enter tốc độ cao)
 *  2. Quét Camera trực tiếp (Native BarcodeDetector + Pure-TS CODE128/EAN-13 cho iOS Safari / Firefox)
 *  3. Chụp ảnh mã vạch tức thì (<input capture="environment">) chạy mượt cả trên mạng Wi-Fi LAN HTTP
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, ImageUp, ScanLine, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import {
  decodeBarcodeFromImageFile,
  detectBarcodeUniversal,
  playPosBeep,
} from '@/lib/barcode-decoder'

export interface BarcodeScannerProps {
  /** Gọi khi có mã (Enter, quét camera hoặc chụp ảnh mã vạch thành công) */
  onScan: (code: string) => void
  placeholder?: string
  className?: string
  autoFocus?: boolean
  /** Mô tả nhỏ dưới ô nhập */
  hint?: string
}

export function BarcodeScanner({
  onScan,
  placeholder,
  className,
  autoFocus,
  hint,
}: BarcodeScannerProps) {
  const [value, setValue] = useState('')
  const [cameraOpen, setCameraOpen] = useState(false)
  const [cameraHint, setCameraHint] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const { toast } = useToast()

  const submit = useCallback(
    (code: string) => {
      const clean = code.trim()
      if (!clean) return
      setValue('')
      playPosBeep('scan')
      onScan(clean)
    },
    [onScan]
  )

  const stopCamera = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setCameraOpen(false)
    setCameraHint(null)
  }, [])

  const startCamera = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      // Trên HTTP LAN không có HTTPS: mở thẳng camera chụp ảnh hệ điều hành của điện thoại
      setCameraHint(
        'Trình duyệt trên kết nối HTTP nội bộ ưu tiên chế độ Chụp ảnh mã vạch trực tiếp bằng Camera sau.'
      )
      fileInputRef.current?.click()
      return
    }
    setCameraOpen(true)
  }, [])

  const handlePhotoCapture = useCallback(
    async (file: File | null) => {
      if (!file) return
      const decoded = await decodeBarcodeFromImageFile(file)
      if (decoded) {
        stopCamera()
        submit(decoded)
      } else {
        playPosBeep('error')
        toast({
          title: 'Chưa nhận diện được mã vạch trong ảnh',
          description: 'Hãy giữ camera song song với vạch đen trắng, đủ sáng rồi thử lại.',
          variant: 'destructive',
        })
      }
    },
    [stopCamera, submit, toast]
  )

  useEffect(() => {
    if (!cameraOpen) return
    let cancelled = false

    const run = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia || !videoRef.current) {
          setCameraHint('Hãy bấm nút "Chụp ảnh mã vạch" bên dưới để quét qua Camera điện thoại.')
          return
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        const video = videoRef.current
        video.srcObject = stream
        await video.play()

        timerRef.current = setInterval(async () => {
          if (!videoRef.current || videoRef.current.readyState < 2) return
          try {
            const hit = await detectBarcodeUniversal(videoRef.current)
            if (hit) {
              stopCamera()
              submit(hit)
            }
          } catch {
            // Bỏ qua frame lỗi
          }
        }, 260)
      } catch {
        setCameraHint(
          'Không mở được luồng video trực tiếp (do quyền Camera hoặc HTTP LAN). Bạn có thể bấm "Chụp ảnh mã vạch" bên dưới để quét ngay.'
        )
      }
    }
    void run()

    return () => {
      cancelled = true
      stopCamera()
    }
  }, [cameraOpen, stopCamera, submit])

  return (
    <div className={className}>
      <div className="relative flex items-center gap-1">
        <div className="relative flex-1">
          <ScanLine className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                submit(value)
              }
            }}
            placeholder={placeholder ?? 'Quét súng USB, camera ĐT hoặc nhập mã rồi Enter'}
            autoFocus={autoFocus}
            className="pl-8 pr-16"
            inputMode="search"
            aria-label="Mã vạch"
          />
          <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={startCamera}
              title="Mở Camera quét mã vạch / QR"
            >
              <Camera className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={() => fileInputRef.current?.click()}
              title="Chụp hoặc tải ảnh mã vạch (hỗ trợ cả HTTP Wi-Fi LAN)"
            >
              <ImageUp className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null
            e.currentTarget.value = ''
            void handlePhotoCapture(f)
          }}
        />
      </div>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      {cameraHint && !cameraOpen && (
        <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">{cameraHint}</p>
      )}

      {cameraOpen && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/85 p-4">
          <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-slate-700 bg-black shadow-2xl">
            <video ref={videoRef} muted playsInline className="aspect-[3/4] w-full object-cover" />
            <div className="pointer-events-none absolute inset-x-6 top-1/2 h-0.5 -translate-y-1/2 bg-emerald-400/90 shadow-[0_0_12px_rgba(52,211,153,0.9)]" />
            <p className="absolute inset-x-3 bottom-3 rounded-lg bg-black/65 px-2.5 py-1.5 text-center text-xs text-slate-200">
              {cameraHint ??
                'Đưa mã vạch CODE128 / EAN-13 / QR vào vạch xanh — tự nhận ngay trên cả Chrome, Safari & Firefox'}
            </p>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <Button
              type="button"
              className="bg-emerald-600 text-white hover:bg-emerald-500"
              onClick={() => fileInputRef.current?.click()}
            >
              <Camera className="mr-1.5 h-4 w-4" />
              Chụp ảnh mã vạch
            </Button>
            <Button
              type="button"
              variant="outline"
              className="border-slate-600 bg-transparent text-white hover:bg-slate-800"
              onClick={stopCamera}
            >
              <X className="mr-1.5 h-4 w-4" />
              Đóng camera
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
