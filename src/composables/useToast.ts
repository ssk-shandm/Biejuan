import { ref } from 'vue'

export interface ToastItem {
  id: number
  message: string
  isConfirm: boolean
  resolve: ((value: boolean) => void) | null
}

export type GlobalToastKind = 'info' | 'success' | 'error'

export interface GlobalToastItem {
  id: number
  message: string
  kind: GlobalToastKind
}

let nextId = 1
const toasts = ref<ToastItem[]>([])
const globalToasts = ref<GlobalToastItem[]>([])
const globalToastTimers = new Map<number, ReturnType<typeof setTimeout>>()

/** 显示一条消息（点击遮罩即可关闭）；同一内容的 toast 不会重复弹出 */
export function showToast(message: string): Promise<void> {
  // 避免快速连续按 Enter 导致弹出多个相同警告
  if (toasts.value.some(t => !t.isConfirm && t.message === message)) {
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    const id = nextId++
    toasts.value.push({
      id,
      message,
      isConfirm: false,
      resolve: () => resolve(),
    })
  })
}

/** Display a non-blocking notification in the global top-right corner. */
export function showGlobalToast(
  message: string,
  kind: GlobalToastKind = 'info',
  duration = 5000,
) {
  if (globalToasts.value.some(toast => toast.message === message && toast.kind === kind)) return

  const id = nextId++
  globalToasts.value.push({ id, message, kind })
  if (duration > 0) {
    globalToastTimers.set(id, setTimeout(() => dismissGlobalToast(id), duration))
  }
}

/** Dismiss a global top-right notification. */
export function dismissGlobalToast(id: number) {
  const timer = globalToastTimers.get(id)
  if (timer) {
    clearTimeout(timer)
    globalToastTimers.delete(id)
  }
  const idx = globalToasts.value.findIndex(toast => toast.id === id)
  if (idx >= 0) globalToasts.value.splice(idx, 1)
}

/** Display a confirmation dialog and resolve with the user choice. */
export function showConfirm(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const id = nextId++
    toasts.value.push({
      id,
      message,
      isConfirm: true,
      resolve,
    })
  })
}

/** 关闭一个 toast */
export function dismissToast(id: number) {
  const idx = toasts.value.findIndex(t => t.id === id)
  if (idx >= 0) {
    const t = toasts.value.splice(idx, 1)[0]
    if (t?.resolve) {
      t.resolve(false) // 点击遮罩 = 取消
    }
  }
}

/** 确认按钮 */
export function confirmToast(id: number) {
  const idx = toasts.value.findIndex(t => t.id === id)
  if (idx >= 0) {
    const t = toasts.value.splice(idx, 1)[0]
    if (t?.resolve) {
      t.resolve(true)
    }
  }
}

/** 只读 toast 列表（供组件渲染） */
export function useToastList() {
  return toasts
}

/** ???????????? ToastContainer ???? */
export function useGlobalToastList() {
  return globalToasts
}
