import { createApp, type Component } from 'vue'
import './style.css'

// 主入口 = 南丰麻将大厅（`components/nanfeng/NanfengApp.vue`：选人数与买码张数后进桌）。
// 旧的莲花广麻大厅暂时保留在 `?game=lotus`，等删旧代码时一起移除。
// 两个入口都用动态 import：默认进来不需要加载另一套玩法的引擎与界面。
const params = new URLSearchParams(window.location.search)
const legacyLotus = params.get('game') === 'lotus'

/**
 * 启动失败时把错误**显示出来**，而不是留一块黑屏。
 *
 * 挂载期抛错（例如子组件 setup 里 `inject` 拿不到提供者）会让 Vue 直接中断，
 * `#app` 保持空白 —— 只看到黑底的话根本没法判断问题在哪。
 */
function showBootError(error: unknown): void {
  console.error('[启动失败]', error)
  const host = document.getElementById('app')
  if (host === null) return
  host.textContent = ''
  const box = document.createElement('pre')
  box.style.cssText = 'margin:0;padding:18px;min-height:100vh;box-sizing:border-box;'
    + 'background:#1a0d0d;color:#ffb4b4;font:12px/1.7 ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap'
  const detail = error instanceof Error ? `${error.message}\n\n${error.stack ?? ''}` : String(error)
  box.textContent = `启动失败（页面没能挂载）\n\n${detail}`
  host.appendChild(box)
}

/** 挂载；渲染期/生命周期里的未捕获错误也走同一个出口，别留黑屏。 */
function mount(root: Component): void {
  const app = createApp(root)
  app.config.errorHandler = (error) => showBootError(error)
  app.mount('#app')
}

if (legacyLotus) {
  // 静态标题是给默认（南丰）用的；旧入口进来时改回它的名字，免得两套玩法共用一个标签名。
  document.title = '莲花广麻（旧版）'
  void import('./App.vue')
    .then(({ default: App }) => mount(App))
    .catch(showBootError)
} else {
  void import('./components/nanfeng/NanfengApp.vue')
    .then(({ default: NanfengApp }) => mount(NanfengApp))
    .catch(showBootError)
}
