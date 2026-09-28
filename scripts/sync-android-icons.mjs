// Keep the generated Android project in sync with the checked-in desktop icon.
// To regenerate the source assets, run:
// npx tauri icon src-tauri/icons/icon.png --output .tmp-build/android-icon-preview
// and copy the resulting android/ directory to src-tauri/icons/android/.
import { existsSync, mkdirSync, readdirSync, copyFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(root, 'src-tauri', 'icons', 'android')
const destination = join(root, 'src-tauri', 'gen', 'android', 'app', 'src', 'main', 'res')

// Desktop builds don't need an Android project. Run again after `tauri android init`.
if (!existsSync(destination)) {
  console.log('Android icon sync skipped: Android project is not initialized.')
} else {
  let count = 0
  for (const folder of readdirSync(source, { withFileTypes: true })) {
    if (!folder.isDirectory()) continue
    const targetFolder = join(destination, folder.name)
    mkdirSync(targetFolder, { recursive: true })
    for (const file of readdirSync(join(source, folder.name), { withFileTypes: true })) {
      if (!file.isFile()) continue
      copyFileSync(join(source, folder.name, file.name), join(targetFolder, file.name))
      count++
    }
  }
  console.log(`Synced ${count} Android launcher icon resources.`)
}
