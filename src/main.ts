import { createApp } from 'vue'
import './style.css'

// 主入口 = 南丰麻将大厅（`components/nanfeng/NanfengApp.vue`，选人数与买码张数后进桌）。
// 旧的莲花广麻大厅暂时保留在 `?game=lotus`，等删旧代码时一起移除。
// 两个入口都用动态 import：默认进来不需要加载另一套玩法的引擎与界面。
const params = new URLSearchParams(window.location.search)
const legacyLotus = params.get('game') === 'lotus'

if (legacyLotus) {
  // 静态标题是给默认（南丰）用的；旧入口进来时改回它的名字，免得两套玩法共用一个标签名。
  document.title = '莲花广麻（旧版）'
  void import('./App.vue').then(({ default: App }) => {
    createApp(App).mount('#app')
  })
} else {
  void import('./components/nanfeng/NanfengApp.vue').then(({ default: NanfengApp }) => {
    createApp(NanfengApp).mount('#app')
  })
}
