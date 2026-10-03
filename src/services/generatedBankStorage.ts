/** Converted question banks live in IndexedDB, not in the build-time banks.json. */
import type { DocumentImageAsset } from '../utils/documentAssets'

export const GENERATED_BANKS_CHANGED = 'generated-banks-changed'
export const GENERATED_BANK_PREFIX = 'generated:'

type SavedImage = { fileName: string; blob: Blob }
type SavedBank = { file: string; name: string; content: string; images: SavedImage[] }

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('exam-generated-banks', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('banks', { keyPath: 'file' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore, resolve: (value: T) => void) => void): Promise<T> {
  const db = await openDatabase()
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction('banks', mode)
    let result: T
    transaction.oncomplete = () => { db.close(); resolve(result) }
    transaction.onerror = () => { db.close(); reject(transaction.error) }
    transaction.onabort = () => { db.close(); reject(transaction.error) }
    run(transaction.objectStore('banks'), (value) => { result = value })
  })
}

export async function saveGeneratedBank(name: string, directory: string, content: string, images: Pick<DocumentImageAsset, 'fileName' | 'blob'>[]): Promise<string> {
  const file = `${GENERATED_BANK_PREFIX}${encodeURIComponent(directory)}`
  const bank: SavedBank = {
    file,
    name,
    content,
    images: images.map(({ fileName, blob }) => ({ fileName, blob })),
  }
  await withStore<void>('readwrite', (store) => { store.put(bank) })
  window.dispatchEvent(new CustomEvent<string>(GENERATED_BANKS_CHANGED, { detail: file }))
  return file
}

/** Delete selected locally generated banks in one IndexedDB transaction. */
export async function deleteGeneratedBanks(files: string[], notify = true): Promise<void> {
  if (files.some(file => !file.startsWith(GENERATED_BANK_PREFIX))) throw new Error('只能删除应用内转换的题库')
  await withStore<void>('readwrite', store => {
    for (const file of files) store.delete(file)
  })
  if (notify) window.dispatchEvent(new CustomEvent(GENERATED_BANKS_CHANGED))
}

export async function listGeneratedBanks(): Promise<{ name: string; file: string }[]> {
  return withStore('readonly', (store, resolve) => {
    const request = store.getAll()
    request.onsuccess = () => resolve((request.result as SavedBank[]).map(({ name, file }) => ({ name, file })))
  })
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

export async function readStoredGeneratedBank(file: string): Promise<SavedBank> {
  const bank = await withStore<SavedBank | undefined>('readonly', (store, resolve) => {
    const request = store.get(file)
    request.onsuccess = () => resolve(request.result as SavedBank | undefined)
  })
  if (!bank) throw new Error(`本地题库不存在：${file}`)
  return bank
}

export async function readGeneratedBank(file: string): Promise<unknown> {
  const bank = await readStoredGeneratedBank(file)
  // Keep original JSON intact for downloads; inline image data only in the loaded copy.
  let content = bank.content
  const directory = decodeURIComponent(file.slice(GENERATED_BANK_PREFIX.length))
  for (const image of bank.images) {
    const path = `/images/${directory}/${image.fileName}`
    content = content.split(path).join(await blobToDataUrl(image.blob))
  }
  return JSON.parse(content) as unknown
}
