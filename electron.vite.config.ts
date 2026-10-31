import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

/**
 * 构建产物注入 CSP（Electron 官方安全清单；v0.8.7 审查修复 #5）。
 * dev 不注入：vite HMR 依赖内联脚本，会被 script-src 'self' 拦截。
 * style 的 unsafe-inline 是 React 内联 style 属性所需。
 */
const injectCsp = {
  name: 'inject-csp',
  transformIndexHtml(html: string, ctx?: { server?: unknown }) {
    if (ctx?.server) return html
    const policy = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'"
    return html.replace('</head>', `  <meta http-equiv="Content-Security-Policy" content="${policy}" />\n  </head>`)
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    plugins: [react(), injectCsp]
  }
})
