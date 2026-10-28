import type { ReactNode } from 'react'
import type { VendorInfo } from '../../../shared/vendors'

// 构建时内置的厂商图标（simple-icons，CC0）——运行时不向任何第三方请求图标
const vendorIcons = import.meta.glob('../assets/vendors/*.svg', {
  eager: true,
  query: '?url',
  import: 'default'
}) as Record<string, string>

export function VendorChip({ vendor }: { vendor: VendorInfo }) {
  const url = vendor.icon ? vendorIcons[`../assets/vendors/${vendor.icon}.svg`] : undefined
  return (
    <span className="vendor-chip" title={`已识别厂商：${vendor.name}`}>
      {url ? (
        <img src={url} alt="" draggable={false} />
      ) : (
        <span className="vendor-letter" style={{ background: vendor.color }}>
          {vendor.letter}
        </span>
      )}
      <span>{vendor.name}</span>
    </span>
  )
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="btn ghost sm" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
