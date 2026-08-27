import { useEffect, useRef, useState } from 'react'
import { Modal } from './ui/Modal'

export interface NotesEditorModalProps {
  open: boolean
  title?: string
  initialValue: string
  placeholder?: string
  onClose: (next: string) => void
}

export function NotesEditorModal({
  open,
  title = '备注',
  initialValue,
  placeholder = '备注（可选）',
  onClose,
}: NotesEditorModalProps) {
  const [draft, setDraft] = useState(initialValue)
  const taRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (open) {
      setDraft(initialValue)
      requestAnimationFrame(() => {
        taRef.current?.focus()
        const len = taRef.current?.value.length ?? 0
        taRef.current?.setSelectionRange(len, len)
      })
    }
  }, [open, initialValue])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose(draft)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, draft, onClose])

  if (!open) return null

  return (
    <Modal title={title} onClose={() => onClose(draft)} width={680}>
      <textarea
        ref={taRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={placeholder}
        className="w-full min-h-[320px] max-h-[60vh] text-sm border border-gray-200 rounded-md p-3 focus:border-blue-400 focus:outline-none resize-y leading-relaxed"
      />
      <p className="mt-2 text-[11px] text-gray-400 text-right">
        ESC 或点击空白处关闭（自动保存）
      </p>
    </Modal>
  )
}
