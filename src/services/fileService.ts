/** Platform-neutral file handles used by browser, Windows and Android imports. */
export interface ImportedFile {
  name: string
  mimeType?: string
  size?: number
  /** Desktop-only path, when the native picker provides one. */
  path?: string
  /** Android/content-provider URI, when the native picker provides one. */
  uri?: string
  read(): Promise<ArrayBuffer>
}

export interface AppStorage {
  read(name: string): Promise<string>
  write(name: string, content: string): Promise<void>
  exists(name: string): Promise<boolean>
  remove(name: string): Promise<void>
}

export function fromBrowserFile(file: File): ImportedFile {
  return {
    name: file.name,
    mimeType: file.type || undefined,
    size: file.size,
    read: () => file.arrayBuffer(),
  }
}

export async function readImportedFile(file: File | ImportedFile): Promise<ArrayBuffer> {
  if (typeof File !== 'undefined' && file instanceof File) return fromBrowserFile(file).read()
  return (file as ImportedFile).read()
}

export async function readImportedText(file: File | ImportedFile): Promise<string> {
  return new TextDecoder().decode(await readImportedFile(file))
}

/** LocalStorage-backed fallback for web runtimes. */
export const browserAppStorage: AppStorage = {
  async read(name) {
    const value = localStorage.getItem(name)
    if (value === null) throw new Error(`Storage item not found: ${name}`)
    return value
  },
  async write(name, content) {
    localStorage.setItem(name, content)
  },
  async exists(name) {
    return localStorage.getItem(name) !== null
  },
  async remove(name) {
    localStorage.removeItem(name)
  },
}

function assertStorageName(name: string) {
  if (!name || name.includes('/') || name.includes('\\') || name === '.' || name === '..' || name.includes('..')) {
    throw new Error(`Invalid app storage name: ${name}`)
  }
}

/**
 * Tauri app-private storage adapter. Imports stay lazy so browser builds do
 * not require the native plugins at module evaluation time.
 */
export const tauriAppStorage: AppStorage = {
  async read(name) {
    assertStorageName(name)
    const [{ appDataDir, join }, { exists, readTextFile }] = await Promise.all([
      import('@tauri-apps/api/path'),
      import('@tauri-apps/plugin-fs'),
    ])
    const path = await join(await appDataDir(), name)
    if (!(await exists(path))) throw new Error(`Storage item not found: ${name}`)
    return readTextFile(path)
  },
  async write(name, content) {
    assertStorageName(name)
    const [{ appDataDir, join }, { mkdir, writeTextFile }] = await Promise.all([
      import('@tauri-apps/api/path'),
      import('@tauri-apps/plugin-fs'),
    ])
    const directory = await appDataDir()
    await mkdir(directory, { recursive: true })
    await writeTextFile(await join(directory, name), content)
  },
  async exists(name) {
    assertStorageName(name)
    const [{ appDataDir, join }, { exists }] = await Promise.all([
      import('@tauri-apps/api/path'),
      import('@tauri-apps/plugin-fs'),
    ])
    return exists(await join(await appDataDir(), name))
  },
  async remove(name) {
    assertStorageName(name)
    const [{ appDataDir, join }, { exists, remove }] = await Promise.all([
      import('@tauri-apps/api/path'),
      import('@tauri-apps/plugin-fs'),
    ])
    const path = await join(await appDataDir(), name)
    if (await exists(path)) await remove(path)
  },
}

export function isJsonFile(file: Pick<File, 'name' | 'type'>): boolean {
  return file.type === 'application/json' || file.name.toLowerCase().endsWith('.json')
}
/** Save exported data using Android's document picker, not WebView <a download>. */
export async function saveExportBlob(name: string, blob: Blob): Promise<boolean> {
  if (typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent) && '__TAURI_INTERNALS__' in window) {
    const { save } = await import('@tauri-apps/plugin-dialog')
    const { writeFile } = await import('@tauri-apps/plugin-fs')
    const extension = name.split('.').pop() || 'json'
    const path = await save({ defaultPath: name, filters: [{ name: extension.toUpperCase(), extensions: [extension] }] })
    if (!path) return false
    await writeFile(path, new Uint8Array(await blob.arrayBuffer()))
    return true
  }
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  setTimeout(() => { anchor.remove(); URL.revokeObjectURL(url) }, 1000)
  return true
}
