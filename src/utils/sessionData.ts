function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
function positive(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) > 0 }

export function validateSessionData(value: unknown, key: string): void {
  const fail = () => { throw new Error(`练习进度字段损坏：${key}`) }
  if (!record(value) || (value.schemaVersion !== undefined && value.schemaVersion !== 2)
    || !Number.isInteger(value.currentIndex) || Number(value.currentIndex) < 0 || !Array.isArray(value.answers)) return fail()
  if ((!Array.isArray(value.order) && !key.startsWith('wrong_session_'))
    || (Array.isArray(value.order) && (value.order.some(number => !positive(number)) || new Set(value.order).size !== value.order.length))) return fail()
  const seen = new Set<number>()
  for (const pair of value.answers) {
    if (!Array.isArray(pair) || pair.length !== 2 || !positive(pair[0]) || seen.has(pair[0]) || !record(pair[1])) return fail()
    seen.add(pair[0])
    const entry = pair[1]
    if (entry.userAnswer !== null && typeof entry.userAnswer !== 'string'
      && !(Array.isArray(entry.userAnswer) && entry.userAnswer.every(item => typeof item === 'string'))) return fail()
    if (entry.isCorrect !== null && typeof entry.isCorrect !== 'boolean') return fail()
    if (entry.showResult !== undefined && typeof entry.showResult !== 'boolean') return fail()
    if (entry.subDrafts !== undefined && (!record(entry.subDrafts) || Object.entries(entry.subDrafts).some(([id, text]) => !positive(Number(id)) || typeof text !== 'string'))) return fail()
    if (entry.subAnswers !== undefined) {
      if (!Array.isArray(entry.subAnswers) && !record(entry.subAnswers)) return fail()
      const subs = Array.isArray(entry.subAnswers) ? entry.subAnswers : Object.entries(entry.subAnswers)
      const ids = new Set<number>()
      for (const pair of subs) {
        if (!Array.isArray(pair) || !positive(Number(pair[0])) || ids.has(Number(pair[0])) || !record(pair[1])
          || typeof pair[1].userAnswer !== 'string' || (pair[1].isCorrect !== null && typeof pair[1].isCorrect !== 'boolean')) return fail()
        ids.add(Number(pair[0]))
      }
    }
  }
}
