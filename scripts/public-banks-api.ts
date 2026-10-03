import { mkdirSync, readdirSync, realpathSync, existsSync, writeFileSync, unlinkSync, renameSync, rmdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import type { Plugin } from 'vite'
import { normalizeQuestionBank } from '../src/utils/questionSchema'

type ImagePayload = { fileName: string; data: string }

function validateName(name: unknown): asserts name is string {
  if (typeof name !== 'string' || !name || Buffer.byteLength(name) > 240 ||
      /[\x00-\x1f\x7f/\\:*?"<>|]/.test(name) || name.startsWith('.') || /[. ]$/.test(name) ||
      /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) {
    throw new Error('不支持的题库或图片文件名')
  }
}

function safeBankName(name: string) {
  const cleaned = Array.from(name).slice(0, 64).join('').replace(/[\x00-\x1f\x7f/\\:*?"<>|%#]/g, '-').trim().replace(/^\.+|\.+$/g, '').replace(/\.json$/i, '') || 'question-bank'
  return /^(banks|con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(cleaned) ? `题库-${cleaned}` : cleaned
}

function checkedDirectory(root: string, name: string) {
  const target = join(root, name)
  mkdirSync(target, { recursive: true })
  const directory = realpathSync(target)
  if (dirname(directory) !== root) throw new Error('题库目录不能指向 public 以外的位置')
  return directory
}

function writeNewFile(target: string, data: string | Buffer) {
  const temporary = `${target}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporary, data, { flag: 'wx' })
    renameSync(temporary, target)
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary)
  }
}

export function publicBanksApi(): Plugin {
  const publicRoot = fileURLToPath(new URL('../public', import.meta.url))
  function listBanks() {
    const directory = join(publicRoot, 'subjects')
    if (!existsSync(directory)) return []
    return readdirSync(directory, { withFileTypes: true })
      .filter(entry => entry.isFile() && /\.json$/i.test(entry.name) && !/^banks\.json$/i.test(entry.name))
      .map(entry => ({ name: entry.name.replace(/\.json$/i, ''), file: `/subjects/${entry.name}` }))
      .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
  }
  return {
    name: 'public-banks-api',
    configureServer(server) {
      server.middlewares.use('/subjects/banks.json', (request, response) => {
        if (request.method !== 'GET') { response.statusCode = 405; response.end(); return }
        response.setHeader('Content-Type', 'application/json; charset=utf-8')
        response.setHeader('Cache-Control', 'no-store')
        response.end(JSON.stringify(listBanks()))
      })
      server.middlewares.use('/api/question-banks', async (request, response) => {
        response.setHeader('Content-Type', 'application/json; charset=utf-8')
        if (request.method !== 'POST') { response.statusCode = 405; response.end(); return }
        const address = request.socket.remoteAddress
        if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address ?? '') ||
            (request.headers.origin && request.headers.origin !== `http://${request.headers.host}` && request.headers.origin !== `https://${request.headers.host}`)) {
          response.statusCode = 403
          response.end(JSON.stringify({ message: '只允许从本机同源网页写入题库' }))
          return
        }
        try {
          const chunks: Buffer[] = []
          let size = 0
          for await (const chunk of request) {
            size += chunk.length
            if (size > 80 * 1024 * 1024) throw new Error('请求总大小超过 80 MB')
            chunks.push(Buffer.from(chunk))
          }
          const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))
          if (typeof payload.name !== 'string' || typeof payload.content !== 'string' || !Array.isArray(payload.images)) throw new Error('保存题库参数不正确')
          validateName(payload.directory)
          if (Buffer.byteLength(payload.content) > 16 * 1024 * 1024) throw new Error('题库 JSON 超过 16 MB')
          if (!normalizeQuestionBank(JSON.parse(payload.content), payload.name).length) throw new Error('题库中没有有效题目')
          const images: { fileName: string; bytes: Buffer }[] = []
          let imageSize = 0
          for (const image of payload.images as ImagePayload[]) {
            validateName(image.fileName)
            if (typeof image.data !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(image.data)) throw new Error('图片编码错误')
            if (images.some(saved => saved.fileName === image.fileName)) throw new Error('图片文件名不能重复')
            const bytes = Buffer.from(image.data, 'base64')
            imageSize += bytes.length
            if (imageSize > 48 * 1024 * 1024) throw new Error('题库图片总大小超过 48 MB')
            images.push({ fileName: image.fileName, bytes })
          }
          mkdirSync(publicRoot, { recursive: true })
          const root = realpathSync(publicRoot)
          const subjects = checkedDirectory(root, 'subjects')
          const imagesRoot = checkedDirectory(root, 'images')
          const base = safeBankName(payload.name)
          let stem = base
          let suffix = 2
          while (existsSync(join(subjects, `${stem}.json`)) || existsSync(join(imagesRoot, stem))) stem = `${base} (${suffix++})`
          const imageDirectory = join(imagesRoot, stem)
          const target = join(subjects, `${stem}.json`)
          if (images.length) mkdirSync(imageDirectory)
          try {
            for (const image of images) writeNewFile(join(imageDirectory, image.fileName), image.bytes)
            writeNewFile(target, payload.content.split(`/images/${payload.directory}/`).join(`/images/${stem}/`))
          } catch (error) {
            for (const image of images) {
              const file = join(imageDirectory, image.fileName)
              if (existsSync(file)) unlinkSync(file)
            }
            if (images.length) rmdirSync(imageDirectory)
            throw error
          }
          const index = join(subjects, 'banks.json')
          const temporary = `${index}.${randomUUID()}.tmp`
          try {
            writeFileSync(temporary, JSON.stringify(listBanks(), null, 2), { flag: 'wx' })
            renameSync(temporary, index)
          } catch (error) {
            server.config.logger.warn(`题库已保存，更新 banks.json 失败：${String(error)}`)
          } finally {
            if (existsSync(temporary)) unlinkSync(temporary)
          }
          response.end(JSON.stringify({ file: `/subjects/${stem}.json`, location: target }))
        } catch (error) {
          response.statusCode = 400
          response.end(JSON.stringify({ message: error instanceof Error ? error.message : String(error) }))
        }
      })
    },
  }
}
