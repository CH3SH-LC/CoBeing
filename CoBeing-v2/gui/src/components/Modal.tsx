import type { ReactNode } from 'react'

interface ModalProps {
  title: string
  onClose: () => void
  children: ReactNode
  actions?: ReactNode
}

/** 通用磨砂浮层（用户偏好：overlay 磨砂 + 卡片层级） */
export function Modal({ title, onClose, children, actions }: ModalProps) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        {children}
        {actions && <div className="modal-actions">{actions}</div>}
      </div>
    </div>
  )
}
