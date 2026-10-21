/** Steps follow the visible page order: overview first, then individual controls. */
import type { TourStep } from '../types'

export type TourContext = {
  goHome: () => void
  openSettings: (section: string) => void
  modelReady: boolean
}

export function buildTourSteps(context: TourContext): TourStep[] {
  return [
    {
      key: 'welcome',
      title: '从主页开始',
      description: '主页是学习的起点：上方选择题库，下方选择学习模式。切换已有题库只需下拉选择，不必刷新；还没有题库也没关系，稍后会介绍如何转换和导入。',
      points: ['接下来按页面从上往下认识五种模式，再看看设置中的工具', '随时可以跳过；需要时在「设置 → 新手教程」重新查看'],
      prepare: () => context.goHome(),
    },
    {
      key: 'mode-exam',
      target: 'mode-exam',
      title: '考试模式',
      description: '先作答，再统一交卷。交卷前不显示参考答案，交卷后查看得分和答题结果，适合考前自测。',
      prepare: () => context.goHome(),
    },
    {
      key: 'mode-endorse',
      target: 'mode-endorse',
      title: '背题模式',
      description: '直接阅读题目、答案和已有解析，不需要作答。适合先熟悉知识点，或快速复习一遍。',
      prepare: () => context.goHome(),
    },
    {
      key: 'mode-practice',
      target: 'mode-practice',
      title: '做题模式',
      description: '适合日常练习。选择类题目作答后显示结果；需要输入答案的题目，点击提交后查看结果或参考答案。',
      points: ['练习进度会保存，之后可以继续做题'],
      prepare: () => context.goHome(),
    },
    {
      key: 'mode-specialize',
      target: 'mode-specialize',
      title: '专项练习',
      description: '先勾选当前题库中要练的题型，再开始练习。比如只练选择题或简答题，集中复习不熟悉的部分。',
      prepare: () => context.goHome(),
    },
    {
      key: 'mode-wrong',
      target: 'mode-wrong',
      title: '错题模式',
      description: '选择错题本，重新练习已收集的错题。练习后使用「添加到错题本」收集错题，不是答错后自动收集。',
      points: ['支持多个错题本，以及错题的导入和导出'],
      prepare: () => context.goHome(),
    },
    {
      key: 'settings-nav',
      target: 'settings-nav',
      title: '设置：管理学习工具与资料',
      description: '设置不只是外观选项，也集中放着文档转换、AI 连接、题库管理和备份。左侧切换分类，右侧查看对应内容。',
      points: ['先看偏好，再了解资料如何变成可练习的题库'],
      prepare: () => context.openSettings('tour'),
      onlyOn: 'desktop',
    },
    {
      key: 'preferences',
      target: 'preferences-panel',
      title: '偏好设置',
      description: '在这里调整做题呈现、黑夜模式和启动时的更新检查。传统呈现逐题查看，滚动呈现连续浏览；切换呈现不会改变答题规则。',
      prepare: () => context.openSettings('preferences'),
      onlyOn: 'desktop',
    },
    {
      key: 'converter',
      target: 'converter-drop',
      title: '文档转换：把资料变成题库',
      description: '选择或拖入文档，等待文字提取完成。确认允许将文本发送给所配置的模型服务后，点击「开始转换为题库 JSON」。',
      points: ['支持 DOCX、PPTX、PDF、XLSX 和文本等格式；旧版 Office 文件需先另存为新格式', '应用会分段处理资料并校验输出；转换后仍需核对题目和答案', '保存成功后，可返回主页选择；使用该工具前需先配置 AI'],
      prepare: () => context.openSettings('ai-convert'),
    },
    {
      key: 'ai-model',
      target: 'ai-model-panel',
      title: 'AI 模型配置',
      description: '在这里连接文档转换使用的模型服务，填写 API 基础地址、模型名称和 API 密钥，再保存并测试连接。已有题库可以直接学习，不需要配置 AI。',
      points: ['地址和密钥由服务商提供；可「获取列表」选择模型，也可手动填写', '请勿分享密钥或包含密钥的配置文件；费用以服务商说明为准'],
      prepare: () => context.openSettings('ai-model'),
    },
    {
      key: 'prompt-export',
      target: 'prompt-export',
      title: '不会配置？导出 Prompt 手动转换',
      description: '点击「导出 Prompt」，把提示词和资料提供给你常用的聊天 AI，让它生成题库 JSON。无需在本应用中配置 AI。',
      points: ['手动流程没有应用内的自动分段、流式接收和校验修复；长资料可能漏题或截断 JSON，聊天窗口逐字显示也不代表没有长度限制', '请分小批转换、核对题目和答案，将完整输出以 UTF-8 保存为 .json 文件', '转换后在「题库资源 → 导入 JSON 题库」中校验并确认导入'],
      prepare: () => context.openSettings('ai-model'),
    },
    {
      key: 'resources',
      target: 'resource-actions',
      title: '题库资源：统一管理本机题库',
      description: '这里可以导入题库、查看当前题库、批量删除，以及备份学习数据。也可以打开桌面端题库和图库目录，管理本地文件。',
      points: ['手动向题库目录放入 JSON 后，点击「刷新题库」重新扫描'],
      prepare: () => context.openSettings('resources'),
      onlyOn: 'desktop',
    },
    {
      key: 'bank-import',
      target: 'bank-import',
      title: '导入转换好的 JSON',
      description: '自己让 AI 转换的 JSON，或已有的题库文件，都从「导入 JSON 题库」选择。先查看校验预览，通过后点击「确认导入」，再回主页选择题库。',
      points: ['有问题时可导出问题报告，修正文件后重新导入；原文件不会被修改', '此入口不会自动复制文件旁的图片，图片需要已在图库中或使用内嵌图片'],
      prepare: () => context.openSettings('resources'),
      onlyOn: 'desktop',
    },
    {
      key: 'bank-manage',
      target: 'bank-manage',
      title: '当前题库：支持多选删除',
      description: '勾选一个或多个可删除题库，再点击「删除所选题库」。安装包自带的只读题库不能删除。',
      points: ['删除会同时移除相关错题本、错题记录和练习进度，无法撤销，请先备份', '可能被其他题库共用的图片不会一起删除'],
      prepare: () => context.openSettings('resources'),
      onlyOn: 'desktop',
    },
    {
      key: 'backup',
      target: 'backup-panel',
      title: '数据备份：给学习记录留一份副本',
      description: '「导出全量备份」保存题库、图片、错题本、练习进度和显示偏好。换设备、系统清理或删除题库前，建议先把备份另存到安全位置。',
      points: ['备份不等于云同步，也不包含 AI 配置和 API 密钥；远程图片只保留链接', '「选择备份恢复」会先展示预览，确认后替换相应本机数据，请仔细检查'],
      prepare: () => context.openSettings('resources'),
      onlyOn: 'desktop',
    },
    {
      key: 'terminal',
      target: 'terminal-panel',
      title: '运行终端：遇到问题时查看记录',
      description: '这里显示文档转换、模型请求等日志。转换失败时，可以先看最近的错误提示；日常练习不需要一直打开它。',
      points: ['需要协助时可「打包保存日志」，分享前请检查是否包含不想公开的资料'],
      prepare: () => context.openSettings('runtime-terminal'),
      onlyOn: 'desktop',
    },
    {
      key: 'done',
      title: '可以开始学习了',
      description: '已有题库就直接选模式练习；需要整理资料时，可用文档转换，或导出 Prompt 交给聊天 AI，再把 JSON 导入题库资源。',
      points: ['需要时，可在「设置 → 新手教程」重新查看'],
      prepare: () => context.goHome(),
    },
  ]
}
