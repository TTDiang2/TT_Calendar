import type { ReactNode } from 'react'

export function Modal({
  title,
  children,
  onClose,
  width = 440,
}: {
  title: string
  children: ReactNode
  onClose: () => void
  width?: number
}) {
  return (
    <div
      className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl flex flex-col max-h-[90vh]"
        style={{ width }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[color:var(--cal-border)]">
          <h2 className="text-base font-semibold cal-ink">{title}</h2>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center cal-muted hover:cal-ink hover:bg-gray-100 rounded-md text-lg"
          >
            ×
          </button>
        </div>
        <div className="p-5 overflow-y-auto">{children}</div>
      </div>
    </div>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs cal-muted">{label}</span>
      {children}
    </label>
  )
}
