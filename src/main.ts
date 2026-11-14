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

/**
 * 运行期错误（点击、定时器、异步回调里抛的）：**不拆页面**，只在角落挂一条可关的提示。
 *
 * 之前把它和"挂载失败"共用同一个出口，结果点一下「创建房间」抛错就把整页替换成红字
 * （还顶着"页面没能挂载"这句不成立的文案）。
 */
function reportRuntimeError(error: unknown): void {
  console.error('[运行出错]', error)
  const id = 'dsh-runtime-error'
  document.getElementById(id)?.remove()
  const box = document.createElement('div')
  box.id = id
  box.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:9999;max-width:min(620px,calc(100vw - 24px));'
    + 'padding:10px 34px 10px 12px;border-radius:8px;background:rgba(120,24,24,.94);color:#ffe8e8;'
    + 'border:1px solid rgba(255,160,160,.6);font:12px/1.6 ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap'
  box.textContent = `出错了：${error instanceof Error ? error.message : String(error)}`
  const close = document.createElement('button')
  close.textContent = '×'
  close.setAttribute('aria-label', '关闭')
  close.style.cssText = 'position:absolute;top:4px;right:6px;padding:0 4px;background:transparent;border:0;'
    + 'color:#ffe8e8;font-size:16px;line-height:1.2;cursor:pointer'
  close.onclick = () => box.remove()
  box.appendChild(close)
  document.body.appendChild(box)
}

/** 挂载；只有**挂载本身**失败才整页报错（那时页面本来就是空的）。 */
function mount(root: Component): void {
  const app = createApp(root)
  app.config.errorHandler = (error) => reportRuntimeError(error)
  try {
    app.mount('#app')
  } catch (error) {
    showBootError(error)
  }
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
