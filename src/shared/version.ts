/** 语义化版本比较（v0.8.8）：主进程升级判断与渲染层「可升级」角标共用；解析失败的串按 0 处理 */
export function compareVersions(a: string, b: string): number {
  const pa = (a.trim().match(/\d+(\.\d+)*/) ?? ['0'])[0].split('.').map(Number)
  const pb = (b.trim().match(/\d+(\.\d+)*/) ?? ['0'])[0].split('.').map(Number)
  const n = Math.max(pa.length, pb.length)
  for (let i = 0; i < n; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}
