'use client'

// BARCODE SCANNER — ô nhập mã vạch dùng chung:
//  • Nhập tay hoặc bút quét USB (scanner bắn Enter cuối mã) → Enter kích hoạt onScan
//  • Quét camera bằng BarcodeDetector API (Chrome/Edge) — mã CODE128/EAN/QR
// Nếu trình duyệt không hỗ trợ camera thì nút quét tự ẩn (chỉ còn nhập tay).

import { useCallback, useEffect, useRef, useState } from 'react'
import { ScanLine, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'

interface DetectedBarcode {
  rawValue: string
}
interface BarcodeDetectorLike {
  detect: (source: HTMLVideoElement) => Promise<DetectedBarcode[]>
}
type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike

export interface BarcodeScannerProps {
  /** gọi khi có mã (Enter hoặc quét camera thành công) */
  onScan: (code: string) => void
  placeholder?: string
  className?: string
  autoFocus?: boolean
  /** mô tả nhỏ dưới ô nhập */
  hint?: string
}

export function BarcodeScanner({ onScan, placeholder, className, autoFocus, hint }: BarcodeScannerProps) {
  const [value, setValue] = useState('')
  const [cameraOpen, setCameraOpen] = useState(false)
  const [detectorSupported, setDetectorSupported] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const { toast } = useToast()

  useEffect(() => {
    const t = setTimeout(() => {
      const ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector
      setDetectorSupported(typeof ctor === 'function')
    }, 0)
    return () => clearTimeout(t)
  }, [])

  const submit = useCallback(
    (code: string) => {
      const clean = code.trim()
      if (!clean) return
      setValue('')
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
  }, [])

  const startCamera = useCallback(async () => {
    const ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector
    if (!ctor) {
      toast({
        title: 'Trình duyệt không hỗ trợ quét camera',
        description: 'Dùng Chrome/Edge mới, hoặc nhập mã vạch bằng tay / bút quét USB.',
        variant: 'destructive',
      })
      return
    }
    setCameraOpen(true)
  }, [toast])

  // vòng lặp quét khi mở camera
  useEffect(() => {
    if (!cameraOpen) return
    let cancelled = false

    const run = async () => {
      try {
        const ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector
        if (!ctor || !videoRef.current) return
        const detector = new ctor({
          formats: ['code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'qr_code'],
        })
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
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
            const results = await detector.detect(videoRef.current)
            if (results.length > 0) {
              const code = results[0].rawValue ?? ''
              stopCamera()
              if (code) submit(code)
            }
          } catch {
            // frame lỗi — bỏ qua, chờ frame tiếp
          }
        }, 300)
      } catch {
        toast({
          title: 'Không thể mở camera',
          description: 'Kiểm tra quyền truy cập camera hoặc dùng nhập tay / bút quét USB.',
          variant: 'destructive',
        })
        stopCamera()
      }
    }
    void run()

    return () => {
      cancelled = true
      stopCamera()
    }
  }, [cameraOpen])

  return (
    <div className={className}>
      <div className="relative">
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
          placeholder={placeholder ?? 'Quét hoặc nhập mã vạch rồi Enter'}
          autoFocus={autoFocus}
          className="pl-8 pr-10"
          inputMode="search"
          aria-label="Mã vạch"
        />
        {detectorSupported && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            onClick={() => void startCamera()}
            title="Quét mã vạch bằng camera"
          >
            <ScanLine className="h-4 w-4" />
          </Button>
        )}
      </div>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}

      {cameraOpen && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/80 p-4">
          <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-slate-700 bg-black shadow-2xl">
            <video ref={videoRef} muted playsInline className="aspect-[3/4] w-full object-cover" />
            <div className="pointer-events-none absolute inset-x-6 top-1/2 h-0.5 -translate-y-1/2 bg-emerald-400/80" />
            <p className="absolute inset-x-0 bottom-3 text-center text-xs text-slate-300">
              Đưa mã vạch vào khung hình — hệ thống tự nhận khi quét được
            </p>
          </div>
          <Button variant="outline" className="mt-4 border-slate-600 bg-transparent text-white hover:bg-slate-800" onClick={stopCamera}>
            <X className="h-4 w-4" />
            Đóng camera
          </Button>
        </div>
      )}
    </div>
  )
}
