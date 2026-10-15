#!/usr/bin/env node
/**
 * Prepare sanitized frontend assets used by a release build.
 *
 * Question banks, question images, and wrong-answer notebooks are local user
 * data. They remain available to `npm run dev`, but are intentionally omitted
 * from dist/ and Tauri installers. Users can import their own banks after
 * installation.
 */

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SOURCE_PUBLIC = join(ROOT, 'public')
const STAGING_ROOT = join(ROOT, '.tmp-build')
const STAGING_PUBLIC = join(STAGING_ROOT, 'public')

function copyPublicAssets() {
  rmSync(STAGING_ROOT, { recursive: true, force: true })
  mkdirSync(STAGING_PUBLIC, { recursive: true })

  if (existsSync(SOURCE_PUBLIC)) {
    for (const entry of readdirSync(SOURCE_PUBLIC, { withFileTypes: true })) {
      if (['subjects', 'images', 'wrong-notebooks'].includes(entry.name)) continue
      cpSync(join(SOURCE_PUBLIC, entry.name), join(STAGING_PUBLIC, entry.name), {
        recursive: true,
      })
    }
  }

  // Keep Web listing/location links valid without copying local contents.
  const subjectsDir = join(STAGING_PUBLIC, 'subjects')
  const imagesDir = join(STAGING_PUBLIC, 'images')
  mkdirSync(subjectsDir, { recursive: true })
  mkdirSync(imagesDir, { recursive: true })
  writeFileSync(join(subjectsDir, 'banks.json'), '[]\n', 'utf-8')

  const imageReadme = join(SOURCE_PUBLIC, 'images', 'README.md')
  if (existsSync(imageReadme)) {
    cpSync(imageReadme, join(imagesDir, 'README.md'))
  }
}

copyPublicAssets()
console.log('[prepare-public-build] Prepared sanitized public assets in .tmp-build/public')
console.log('[prepare-public-build] Omitted local question banks, question images, and wrong-answer notebooks')
