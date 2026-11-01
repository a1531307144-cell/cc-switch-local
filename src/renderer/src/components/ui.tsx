import { useState, type ReactNode } from 'react'
import type { VendorInfo } from '../../../shared/vendors'
import { presetIconUrl, isTileIcon } from '../presetIcons'

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

/**
 * 卡片主视觉：所有图标统一装进圆角容器（v0.8.16 视觉统一）——
 * 透明 logo 垫底色居中，自带实心底的图满铺（上游 metadata shape='tile'），
 * 无图标时彩色字母方块兜底。
 */
export function VendorLogo({
  vendor,
  fallbackText,
  iconSlug
}: {
  vendor: VendorInfo | null
  fallbackText: string
  /** 预设/供应商记录携带的图标 slug（cc-switch 图标库） */
  iconSlug?: string
}) {
  const presetUrl = presetIconUrl(iconSlug)
  const vendorUrl = vendor?.icon ? vendorIcons[`../assets/vendors/${vendor.icon}.svg`] : undefined
  const url = presetUrl ?? vendorUrl
  const letter = vendor?.letter ?? (fallbackText.trim().charAt(0).toUpperCase() || '?')
  const color = vendor?.color ?? 'var(--accent)'
  if (!url) {
    return (
      <span className="vendor-logo-box letter" aria-hidden>
        <span className="vendor-letter" style={{ background: color }}>
          {letter}
        </span>
      </span>
    )
  }
  const tile = presetUrl ? isTileIcon(iconSlug) : false
  return (
    <span className={`vendor-logo-box${tile ? ' tile' : ''}`}>
      <img src={url} alt="" draggable={false} />
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

export interface DropdownOption {
  value: string
  label: string
}

/**
 * 与整体设计语言一致的自绘下拉（2026-10-31 用户反馈：原生 select 弹层与应用风格脱节）。
 * 交互与卡片「⋯」菜单一致：点开、选中即收、点外面关。
 */
export function Dropdown({
  value,
  options,
  onChange,
  ariaLabel
}: {
  value: string
  options: DropdownOption[]
  onChange: (v: string) => void
  ariaLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const current = options.find((o) => o.value === value)
  return (
    <div
      className="dd select-dd"
      onBlur={() => {
        window.setTimeout(() => setOpen(false), 120)
      }}
    >
      <button type="button" className="btn select-btn" aria-label={ariaLabel} onClick={() => setOpen((v) => !v)}>
        <span>{current?.label ?? value}</span>
        <span className="select-caret" aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <div className="menu">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              className={`menu-item${o.value === value ? ' selected' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setOpen(false)
                if (o.value !== value) onChange(o.value)
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
