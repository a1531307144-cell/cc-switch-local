/** 极简线性图标（16px，跟随文字色）——只给侧栏/页头用，避免引入图标库依赖 */
const base = {
  width: 16,
  height: 16,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true
}

export function IconChart() {
  return (
    <svg {...base}>
      <path d="M2.5 13.5h11" />
      <path d="M4.5 13v-4.5" />
      <path d="M8 13V6" />
      <path d="M11.5 13V3.5" />
    </svg>
  )
}

export function IconGear() {
  return (
    <svg {...base}>
      <circle cx="8" cy="8" r="2.4" />
      <path d="M8 1.6v1.9M8 12.5v1.9M1.6 8h1.9M12.5 8h1.9M3.5 3.5l1.3 1.3M11.2 11.2l1.3 1.3M12.5 3.5l-1.3 1.3M4.8 11.2l-1.3 1.3" />
    </svg>
  )
}

export function IconChevronLeft() {
  return (
    <svg {...base}>
      <path d="M9.8 3.5 5.3 8l4.5 4.5" />
    </svg>
  )
}

export function IconChevronRight() {
  return (
    <svg {...base}>
      <path d="M6.2 3.5 10.7 8l-4.5 4.5" />
    </svg>
  )
}

export function IconSearch() {
  return (
    <svg {...base}>
      <circle cx="7" cy="7" r="4.2" />
      <path d="m10.3 10.3 3 3" />
    </svg>
  )
}
