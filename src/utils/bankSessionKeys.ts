const TYPES = new Set(['单选题', '多选题', '判断题', '填空题', '简答题', '程序分析题', '编程题', '综合题', '综合应用题'])

/** Match legacy keys without treating another bank's filename prefix as a notebook/type suffix. */
export function isBankSessionKey(key: string, raw: string | null, bankFile: string, notebookIds: string[]): boolean {
  if (['practice_session_', 'wrong_session_', 'practice_shuffle_pref_', 'exam_session_', 'endorse_session_'].some(prefix => key === prefix + bankFile)) return true
  for (const prefix of ['wrong_session_', 'specialize_session_']) {
    const start = prefix + bankFile + '_'
    if (!key.startsWith(start)) continue
    try {
      const state = JSON.parse(raw || '{}')
      if (typeof state.bankFile === 'string') return state.bankFile === bankFile
    } catch { /* Use the legacy suffix grammar for damaged records. */ }
    const suffix = key.slice(start.length)
    if (prefix === 'wrong_session_') return notebookIds.includes(suffix)
    return suffix.length > 0 && suffix.split('_').every(type => TYPES.has(type))
  }
  return false
}
