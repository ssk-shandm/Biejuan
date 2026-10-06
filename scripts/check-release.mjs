#!/usr/bin/env node
/** Run after npm run build; checks artifacts without copying any personal data. */
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
for (const directory of ['.tmp-build/public', 'dist']) {
  const path = join(root, directory)
  assert.ok(existsSync(path), directory + ' is missing; run npm run build first')
  const subjects = join(path, 'subjects')
  assert.deepEqual(readdirSync(subjects).sort(), ['banks.json'], directory + ': personal question banks must not ship')
  assert.deepEqual(JSON.parse(readFileSync(join(subjects, 'banks.json'), 'utf8')), [])
  const images = readdirSync(join(path, 'images'))
  assert.ok(images.every(name => name === 'README.md'), directory + ': personal question images must not ship')
  assert.equal(existsSync(join(path, 'wrong-notebooks')), false, directory + ': wrong notebooks must not ship')
  const defaults = JSON.parse(readFileSync(join(path, 'config/examples/llm-user-config.example.json'), 'utf8'))
  assert.equal(String(defaults.provider.apiKey ?? '').trim(), '', directory + ': default API key must be empty')
}
console.log('[release:check] OK - staged and Web assets exclude personal banks, images and notebooks; public defaults contain no API key')
