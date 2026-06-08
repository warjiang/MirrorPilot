/* eslint-disable react-refresh/only-export-components */
import { useEffect, useState, useCallback } from 'react'
import { CheckCircle2, XCircle } from 'lucide-react'

interface Toast {
  id: number
  message: string
  type: 'success' | 'error'
}

let toastId = 0

const listeners: Set<(toast: Toast) => void> = new Set()

export function toast(message: string, type: 'success' | 'error' = 'success') {
  const t: Toast = { id: ++toastId, message, type }
  listeners.forEach((fn) => fn(t))
}

export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([])

  const addToast = useCallback((t: Toast) => {
    setToasts((prev) => [...prev, t])
    setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== t.id))
    }, 3000)
  }, [])

  useEffect(() => {
    listeners.add(addToast)
    return () => { listeners.delete(addToast) }
  }, [addToast])

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="flex items-center gap-2 rounded-lg border bg-card px-4 py-3 text-sm shadow-lg animate-in slide-in-from-bottom-2 fade-in"
        >
          {t.type === 'success' ? (
            <CheckCircle2 className="size-4 text-success shrink-0" />
          ) : (
            <XCircle className="size-4 text-destructive shrink-0" />
          )}
          {t.message}
        </div>
      ))}
    </div>
  )
}
