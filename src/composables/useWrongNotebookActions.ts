import type { Ref } from 'vue'
import type { Question } from '../types'
import { showConfirm, showToast } from './useToast'
import { useQuizStore } from '../stores/quizStore'
import { isJsonFile, readImportedText, saveExportBlob } from '../services/fileService'

/** Shared wrong-notebook actions used by desktop and mobile shells. */
export function useWrongNotebookActions(
  questions: Ref<Question[]>,
) {
  const quizStore = useQuizStore()

  async function deleteNotebookById(notebookId: string) {
    const notebook = quizStore.notebooks.find((item) => item.id === notebookId)
    if (!notebook) return
    const count = quizStore.getEntriesByNotebook(notebookId).length
    const ok = await showConfirm(
      `确定要删除错题本「${notebook.name}」吗？其中的 ${count} 道错题也将被删除。`,
    )
    if (ok) quizStore.deleteNotebook(notebookId)
  }

  function exportNotebook(notebookId: string) {
    quizStore.exportNotebook(notebookId, questions.value)
  }

  async function handleBackupAll() {
    const json = quizStore.exportAllDataAsJson()
    const dateStr = new Date().toISOString().slice(0, 10)
    try {
      await saveExportBlob(`错题本备份_${dateStr}.json`, new Blob([json], { type: 'application/json' }))
    } catch (error) {
      console.error('Backup export failed:', error)
      showToast('错题本备份保存失败')
    }
  }

  async function handleRestoreAll(event: Event) {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    if (!file) {
      input.value = ''
      return
    }
    if (!isJsonFile(file)) {
      showToast('请选择一个有效的 JSON 文件')
      input.value = ''
      return
    }
    const ok = await showConfirm('确定要用备份文件覆盖全部错题本数据吗？当前所有错题数据将被替换。')
    if (!ok) {
      input.value = ''
      return
    }
    try {
      const result = quizStore.importAllDataFromJson(await readImportedText(file))
      showToast(result.message)
    } catch (error) {
      console.error(error)
      showToast('恢复失败：文件格式不正确')
    } finally {
      input.value = ''
    }
  }

  return {
    deleteNotebookById,
    exportNotebook,
    handleBackupAll,
    handleRestoreAll,
  }
}