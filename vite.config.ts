/* eslint-disable @typescript-eslint/no-explicit-any */
import { fileURLToPath, URL } from 'node:url'
import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs'
import { join, extname } from 'node:path'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import { publicBanksApi } from './scripts/public-banks-api'

/** Vite 鎻掍欢锛氫负姣忎釜閿欓鏈垱寤虹嫭绔嬬殑 JSON 鏂囦欢锛堝儚 public/subjects/ 涓€鏍凤級 */
function wrongNotebooksApi() {
  const PUBLIC_DIR = fileURLToPath(new URL('./public', import.meta.url))
  const NOTEBOOKS_DIR = join(PUBLIC_DIR, 'wrong-notebooks')

  /** 灏嗘枃浠跺悕瀹夊叏鍖栵紝绉婚櫎闈炴硶瀛楃 */
  function sanitizeFileName(name: string): string {
    return name.replace(/[/\\?%*:|"<>]/g, '_').trim() || 'untitled'
  }

  return {
    name: 'wrong-notebooks-api',
    configureServer(server: any) {
      // POST /api/wrong-notebooks/sync 鈥?鍚屾鍏ㄩ儴閿欓鏈负鐙珛 JSON 鏂囦欢
      server.middlewares.use('/api/wrong-notebooks/sync', (req: any, res: any) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end(JSON.stringify({ ok: false, message: 'Method not allowed' }))
          return
        }
        let body = ''
        req.on('data', (chunk: string) => { body += chunk })
        req.on('end', () => {
          try {
            const data = JSON.parse(body)
            if (!data || !Array.isArray(data.notebooks) || !Array.isArray(data.wrongEntries)) {
              throw new Error('Invalid payload')
            }

            // 纭繚鐩綍瀛樺湪
            if (!existsSync(NOTEBOOKS_DIR)) {
              mkdirSync(NOTEBOOKS_DIR, { recursive: true })
            }

            // 娓呴櫎鏃х殑 notebook 鏂囦欢锛堜繚鐣?_index.json 鍜?_index.json 浠ュ鐨勯潪 notebook 鏂囦欢锛?
            const existingFiles = readdirSync(NOTEBOOKS_DIR)
            const expectedFiles = new Set<string>()
            expectedFiles.add('_index.json')

            // 鎸?notebook 鍒嗙粍鏉＄洰
            const entriesByNotebook = new Map<string, typeof data.wrongEntries>()
            for (const e of data.wrongEntries) {
              const nbId = e.notebookId || '_orphan'
              if (!entriesByNotebook.has(nbId)) entriesByNotebook.set(nbId, [])
              entriesByNotebook.get(nbId)!.push(e)
            }

            // 涓烘瘡涓瑪璁版湰鍐欏叆鐙珛 JSON 鏂囦欢
            const notebookFiles: { id: string; name: string; file: string; bankFile: string; entryCount: number }[] = []
            for (const nb of data.notebooks) {
              const safeName = sanitizeFileName(nb.name)
              const fileName = `${safeName}_${nb.id}.json`
              expectedFiles.add(fileName)
              const entries = entriesByNotebook.get(nb.id) || []
              const nbData = {
                version: 1,
                notebook: nb,
                entries,
              }
              const nbPath = join(NOTEBOOKS_DIR, fileName)
              writeFileSync(nbPath, JSON.stringify(nbData, null, 2), 'utf-8')
              notebookFiles.push({
                id: nb.id,
                name: nb.name,
                file: `/wrong-notebooks/${fileName}`,
                bankFile: nb.bankFile,
                entryCount: entries.length,
              })
              console.log(`[wrong-notebooks-api] 宸蹭繚瀛? ${fileName} (${entries.length} 鏉￠敊棰?`)
            }

            // 鍐欏叆 _index.json锛堝厓鏁版嵁锛?
            const indexData = {
              version: 1,
              savedAt: Date.now(),
              activeNotebookByBank: data.activeNotebookByBank || {},
              guessedRight: data.guessedRight || [],
              notebooks: notebookFiles,
            }
            writeFileSync(join(NOTEBOOKS_DIR, '_index.json'), JSON.stringify(indexData, null, 2), 'utf-8')

            // 鍒犻櫎涓嶅啀灞炰簬浠讳綍绗旇鏈殑鏃ф枃浠?
            for (const f of existingFiles) {
              if (!expectedFiles.has(f) && extname(f) === '.json') {
                unlinkSync(join(NOTEBOOKS_DIR, f))
                console.log(`[wrong-notebooks-api] 宸插垹闄よ繃鏈熸枃浠? ${f}`)
              }
            }

            res.statusCode = 200
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ ok: true, files: notebookFiles.length }))
          } catch (e: any) {
            console.error('[wrong-notebooks-api] 鍚屾澶辫触:', e.message)
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ ok: false, message: e.message }))
          }
        })
      })
    },
  }
}

function llmConfigApi() {
  const CONFIG_PATH = fileURLToPath(new URL('./config/llm-config.json', import.meta.url))

  return {
    name: 'llm-config-api',
    configureServer(server: any) {
      server.middlewares.use('/api/llm-config', (req: any, res: any) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        if (req.method === 'GET') {
          try {
            res.statusCode = 200
            res.end(JSON.stringify({
              content: readFileSync(CONFIG_PATH, 'utf-8'),
              location: CONFIG_PATH,
            }))
          } catch (error: any) {
            res.statusCode = 500
            res.end(JSON.stringify({ message: error.message }))
          }
          return
        }

        if (req.method !== 'PUT') {
          res.statusCode = 405
          res.end(JSON.stringify({ ok: false, message: 'Method not allowed' }))
          return
        }

        let body = ''
        req.on('data', (chunk: Buffer) => {
          body += chunk.toString('utf-8')
          if (body.length > 256 * 1024) req.destroy()
        })
        req.on('end', () => {
          try {
            JSON.parse(body)
            writeFileSync(CONFIG_PATH, `${body.trim()}\n`, 'utf-8')
            res.statusCode = 200
            res.end(JSON.stringify({ ok: true, location: CONFIG_PATH }))
          } catch (error: any) {
            res.statusCode = 400
            res.end(JSON.stringify({ ok: false, message: error.message }))
          }
        })
      })
    },
  }
}
/**
 * Vite 椤圭洰閰嶇疆鏂囦欢
 * @see https://vite.dev/config/
 */
export default defineConfig(({ mode }) => ({
  base: './',
  // Production builds use a sanitized public tree so local question banks and
  // their images never get copied into dist/. Development keeps using public/.
  publicDir: mode === 'production' ? '.tmp-build/public' : 'public',
  plugins: [
    vue(),
    vueDevTools(),
    wrongNotebooksApi(),
    llmConfigApi(),
    publicBanksApi(),
  ],
  build: {
    // Mermaid 鍜?PDF.js 閮芥槸鎸夐渶鍔犺浇鐨勭嫭绔?chunk锛涘畠浠殑瑙ｆ瀽鍣ㄨ秴杩?Vite 榛樿 500 KB锛?
    // 鎻愰珮鎻愮ず闃堝€间笉浼氭妸杩欎簺璧勬簮鍚堝苟杩涢灞忥紝鍙槸閬垮厤璇鎬х殑鏋勫缓璀﹀憡銆?
    chunkSizeWarningLimit: 1800,
  },
  server: {
    watch: {
      // src-tauri/target 涓嬬殑鏋勫缓浜х墿浼氳 Cargo 鍙嶅鍐欏叆/鍗犵敤锛?
      // Vite 鐩戝惉鍒拌繖浜涙枃浠朵細鍦?Windows 涓婅Е鍙?EBUSY 宕╂簝 dev server銆?
      ignored: ['**/src-tauri/target/**', '**/src-tauri/gen/**'],
    },
    // 绉诲姩绔紙Android锛夋墦鍖呮殏缂擄紝浠ヤ笅 HMR host 鐗瑰垽浠呯敤浜庡畨鍗?WebView 鍦烘櫙锛屽厛娉ㄩ噴鎺夈€?
    // Tauri 绉诲姩绔細鎶?devUrl 鐨?host 鎹㈡垚灞€鍩熺綉 IP锛堣 TAURI_DEV_HOST锛夛紝
    // 浣?@vite/client 榛樿浠嶇敤 localhost 寤虹珛 HMR websocket锛屽畨鍗?WebView 杩炰笉涓娿€?
    // ...(process.env.TAURI_DEV_HOST
    //   ? { hmr: { protocol: 'ws', host: process.env.TAURI_DEV_HOST, port: 5173 } }
    //   : {}),
  },
  resolve: {
    alias: {
      // 璁剧疆 `@` 璺緞鍒悕鎸囧悜 src 鐩綍锛屼究浜庢ā鍧楀鍏?
      '@': fileURLToPath(new URL('./src', import.meta.url))
    },
  },
}))
