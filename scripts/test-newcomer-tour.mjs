import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')

test('新手教程覆盖四个做题模式与设置相关讲解', () => {
  const steps = read('src/composables/useNewcomerTour.ts')

  // 四个做题模式都必须有独立步骤
  for (const mode of ['mode-practice', 'mode-exam', 'mode-endorse', 'mode-specialize']) {
    assert.match(steps, new RegExp(`target: '${mode}'`), `缺少 ${mode} 的讲解步骤`)
  }
  // 标题必须点明模式名称
  for (const label of ['做题模式', '考试模式', '背题模式', '专项练习']) {
    assert.match(steps, new RegExp(label), `缺少「${label}」说明`)
  }

  // 设置里的 AI 配置与终端用途必须讲到
  assert.match(steps, /target: 'ai-model-panel'/)
  assert.match(steps, /target: 'terminal-panel'/)
  assert.match(steps, /API 基础地址/)
  assert.match(steps, /日志/)
})

test('教程每一步的锚点都在界面中真实存在', () => {
  const steps = read('src/composables/useNewcomerTour.ts')
  const targets = [...steps.matchAll(/target:\s*'([^']+)'/g)].map(m => m[1])
  assert.ok(targets.length >= 8, '教程步骤应有足够多的锚点')

  const hay = [
    read('src/components/StartScreen.vue'),
    read('src/components/SettingsPage.vue'),
    read('src/components/AiDocumentConverter.vue'),
    read('src/components/AiModelSettings.vue'),
    read('src/components/BankImportPanel.vue'),
    read('src/components/BankManager.vue'),
    read('src/components/DataSafetyPanel.vue'),
  ].join('\n')

  for (const target of targets) {
    const staticHit = hay.includes(`data-tour="${target}"`)
    const dynamicHit = target.startsWith('settings-nav') && hay.includes('settings-nav-${item.id}')
    assert.ok(staticHit || dynamicHit, `锚点 data-tour="${target}" 未在界面中找到`)
  }
})

test('教程只在目标外绘制一层轻遮罩，无目标时不压暗页面', () => {
  const tour = read('src/components/NewcomerTour.vue') + read('src/components/TourCard.vue')

  assert.match(tour, /tour-mask/, '缺少遮罩层')
  assert.match(tour, /tour-highlight/, '缺少高亮框')
  assert.match(tour, /tour-label/, '缺少悬浮标签')
  assert.match(tour, /<svg v-if="highlight" class="tour-mask"/, '仅存在有效目标时绘制遮罩')
  assert.match(tour, /fill-rule="evenodd"/, '目标区域必须完全镂空')
  assert.doesNotMatch(tour, /9999px|tour-fallback-ring|#5eead4|#101722/, '不应叠加暗层、虚假目标或终端风配色')
  assert.match(tour, /background: var\(--color-bg-container\)/, '提示卡应使用应用主题')
  assert.match(tour, /跳过指引/, '缺少跳过按钮')
  assert.match(tour, /'完成' : '下一步'/, '缺少下一步/完成按钮')
  assert.match(tour, /Teleport to="body"/, '教程应传送到 body 之上，避免被容器裁剪')
})

test('教程首次自动播放但只播一次，且可从设置手动重看', () => {
  const app = read('src/App.vue')
  const state = read('src/composables/useTourState.ts')
  const settings = read('src/components/SettingsPage.vue')

  // 持久化“已看过”
  assert.match(state, /localStorage/, '教程完成状态需要持久化')
  assert.match(state, /markTourDone/, '缺少标记完成的方法')

  // 仅安装版（桌面 Tauri）首次自动播放
  assert.match(app, /isDesktopTauri/, '应区分安装版与 Web 版')
  assert.match(app, /tourDone\.value/, '应检查是否已看过')
  assert.match(app, /startTour/, '应能主动启动教程')

  // 设置里有入口
  assert.match(settings, /id: 'tour'/, '设置中应有新手教程分区')
  assert.match(settings, /startTour/, '设置中应有启动教程的按钮事件')
})

test('教程在窄屏使用底部标签，避免遮挡高亮目标', () => {
  const tour = read('src/components/NewcomerTour.vue')
  assert.match(tour, /isNarrow/, '应检测窄屏')
  assert.match(tour, /viewport.value.height - height -/, '窄屏应定位到底部安全区域')
})

test('教程会跳过零尺寸目标，避免高亮到左上角', () => {
  const tour = read('src/components/NewcomerTour.vue')
  assert.match(tour, /box\.width > 0 && box\.height > 0/, '应忽略未布局的目标元素')
  assert.match(tour, /version !== syncVersion/, '过期异步测量不可覆盖新步骤')
  assert.match(tour, /ResizeObserver/, '布局改变后应重新测量')
})

const geometryModule = { exports: {} }
runInNewContext(ts.transpileModule(read('src/utils/tourGeometry.ts'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: geometryModule.exports, module: geometryModule })
const { getTourHighlight, getTourLabelPosition, getTourMaskPath } = geometryModule.exports

test('高亮范围裁剪到视口，隐藏或屏外目标不产生假高亮', () => {
  const viewport = { width: 1000, height: 700 }
  const clipped = getTourHighlight({ left: -10, top: -20, width: 300, height: 200 }, viewport)
  assert.equal(clipped.left, 2)
  assert.equal(clipped.top, 2)
  assert.equal(getTourHighlight({ left: 10, top: 10, width: 0, height: 20 }, viewport), null)
  assert.equal(getTourHighlight({ left: 1200, top: 0, width: 100, height: 40 }, viewport), null)
  const path = getTourMaskPath(clipped, viewport)
  assert.equal((path.match(/M/g) || []).length, 2, '遮罩路径应同时包含视口和目标挖洞')
  assert.match(path, /^M0 0H1000V700H0Z M/)
})

test('提示卡按实测尺寸避开目标，并保持在窗口内', () => {
  const viewport = { width: 1200, height: 800 }
  const label = { width: 336, height: 380 }
  const targets = [
    { left: 400, top: 200, width: 300, height: 60 },
    { left: 880, top: 600, width: 300, height: 100 },
    { left: 100, top: 420, width: 1000, height: 60 },
  ]
  for (const target of targets) {
    const position = getTourLabelPosition(target, label, viewport)
    assert.ok(position.left >= 16 && position.top >= 16)
    assert.ok(position.left + label.width <= viewport.width - 16)
    assert.ok(position.top + label.height <= viewport.height - 16)
    const overlaps = position.left < target.left + target.width && position.left + label.width > target.left
      && position.top < target.top + target.height && position.top + label.height > target.top
    assert.equal(overlaps, false, '有空间时不应遮挡介绍中的区域')
  }
  const centered = getTourLabelPosition(null, label, viewport)
  assert.equal(centered.left, (viewport.width - label.width) / 2)
  assert.equal(centered.top, (viewport.height - label.height) / 2)
})

test('文案不误导刷新、自动收错题、密钥格式或保存结果', () => {
  const steps = read('src/composables/useNewcomerTour.ts')
  assert.doesNotMatch(steps, /30 秒|以 sk- 开头|做错的题会自动|转换完会自动保存|下拉选择后点/)
  assert.match(steps, /不必刷新/)
  assert.match(steps, /添加到错题本/)
  assert.match(steps, /保存成功后/)
  assert.match(steps, /确认允许将文本发送/)
})

test('教程先整体后局部，首页模式从上到下，设置工具按学习流程排列', () => {
  const module = { exports: {} }
  runInNewContext(ts.transpileModule(read('src/composables/useNewcomerTour.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports: module.exports, module })
  const visits = []
  const steps = module.exports.buildTourSteps({
    goHome: () => visits.push('home'),
    openSettings: section => visits.push(section),
    modelReady: false,
  })
  assert.deepEqual(Array.from(steps, step => step.key), [
    'welcome', 'mode-exam', 'mode-endorse', 'mode-practice', 'mode-specialize', 'mode-wrong',
    'settings-nav', 'preferences', 'converter', 'ai-model', 'prompt-export',
    'resources', 'bank-import', 'bank-manage', 'backup', 'terminal', 'done',
  ])
  for (const step of steps) step.prepare?.()
  assert.deepEqual(visits.slice(7, 16), [
    'preferences', 'ai-convert', 'ai-model', 'ai-model', 'resources', 'resources', 'resources', 'resources', 'runtime-terminal',
  ])
  assert.match(steps.find(step => step.key === 'prompt-export').points.join(''), /自动分段.*流式.*截断/)
  assert.match(steps.find(step => step.key === 'bank-manage').points.join(''), /无法撤销/)
  assert.match(steps.find(step => step.key === 'backup').points.join(''), /不包含 AI 配置/)
})

test('切换时保留上一张卡片位置，目标就绪后提交步骤并提供平滑过渡', () => {
  const tour = read('src/components/NewcomerTour.vue')
  const sync = tour.slice(tour.indexOf('async function syncStep'), tour.indexOf('function next'))
  assert.doesNotMatch(sync, /rect\.value = null/, '等待页面时不能临时退回居中首步位置')
  assert.ok(sync.indexOf('await step.prepare') < sync.indexOf('await animateTo'))
  assert.match(tour, /void syncStep\(currentIndex\.value \+ 1\)/)
  assert.doesNotMatch(tour, /watch\(currentIndex/, '提交步骤不能再次触发初始化')
  assert.match(tour, /getTourMotionFrame/)
  assert.match(tour, /prefers-reduced-motion/)
})

test('下一步先在隐藏测量卡中测出最终宽高，动画不再观察自身或受自动高度影响', () => {
  const tour = read('src/components/NewcomerTour.vue')
  assert.match(tour, /class="tour-label tour-measure".*aria-hidden="true" inert/)
  assert.match(tour, /height: `\$\{scene.value.label.height\}px`/)
  assert.match(tour, /measureDestination\(index, target\)/)
  assert.match(tour, /stableFrames >= 3/, '切页动画结束并稳定后再读取目标')
  assert.doesNotMatch(tour, /observe\(labelRef|transitionend|animationend|<Transition/, '禁止内容退场或自身动画反馈改变目的地')
  assert.match(tour, /<rect class="tour-highlight"/, '边框和挖洞共用一个 SVG 坐标系')
  assert.doesNotMatch(tour, /transition:/, '不得叠加独立 CSS 几何动画')
})

const motionModule = { exports: {} }
runInNewContext(ts.transpileModule(read('src/utils/tourMotion.ts'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: motionModule.exports, module: motionModule })
const { getTourMotionFrame, getTourContentOpacity } = motionModule.exports

test('提示框四维几何与蓝框使用同一进度，大小变化连续且中途无停顿或反向', () => {
  const from = { label: { left: 900, top: 400, width: 336, height: 500 },
    highlight: { left: 600, top: 320, width: 500, height: 400 }, spotlightOpacity: 1 }
  const to = { label: { left: 100, top: 20, width: 280, height: 180 },
    highlight: { left: 450, top: 140, width: 300, height: 60 }, spotlightOpacity: 1 }
  for (let frame = 1; frame <= 60; frame++) {
    const previous = getTourMotionFrame(from, to, (frame - 1) / 60)
    const current = getTourMotionFrame(from, to, frame / 60)
    for (const group of ['label', 'highlight']) {
      for (const key of ['left', 'top', 'width', 'height']) {
        assert.ok(current[group][key] < previous[group][key], `${group}.${key} 不得停顿或反向`)
        assert.ok(Math.abs(current[group][key] - previous[group][key]) < Math.abs(from[group][key] - to[group][key]) * .026)
        const progress = (current[group][key] - from[group][key]) / (to[group][key] - from[group][key])
        const labelProgress = (current.label.top - from.label.top) / (to.label.top - from.label.top)
        assert.ok(Math.abs(progress - labelProgress) < 1e-12, '高亮和卡片不能各自计时')
      }
    }
  }
  assert.equal(getTourContentOpacity(.2), 0, '只有在不可见时才能替换内容，避免重排闪动')
  assert.equal(getTourContentOpacity(1), 1)
  const noHighlight = { ...from, highlight: null, spotlightOpacity: 0 }
  assert.equal(getTourMotionFrame(noHighlight, to, 0).spotlightOpacity, 0)
  assert.equal(getTourMotionFrame(noHighlight, to, .5).spotlightOpacity, .5)
  assert.equal(getTourMotionFrame(to, noHighlight, 1).highlight, null)
})
