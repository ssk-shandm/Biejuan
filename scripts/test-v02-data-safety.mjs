import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { runInNewContext } from 'node:vm'
import { webcrypto } from 'node:crypto'
import { test } from 'node:test'
import { IDBFactory } from 'fake-indexeddb'
import ts from 'typescript'

function harness({ native = false, values = {}, files = [], publicBanks = [], fetches = {}, failUpgrade = false } = {}) {
  const data = new Map(Object.entries(values))
  const disk = new Map(files.map(file => [file.path, file.data]))
  const calls = []
  const cache = new Map()
  let failValue = null
  let failNative = false
  const storage = {
    get length() { return data.size }, key: i => [...data.keys()][i] ?? null,
    getItem: key => data.get(key) ?? null,
    setItem(key, value) { if (key === failValue) { failValue = null; throw new Error('quota exceeded') }; data.set(key, String(value)) },
    removeItem: key => data.delete(key),
  }
  const invoke = async (command, args = {}) => {
    calls.push({ command, args })
    if (command === 'prepare_learning_upgrade') {
      if (failUpgrade) throw new Error('snapshot disk full')
      return 'upgrade-backups/0.2.0'
    }
    if (command === 'export_content_data') return [...disk].filter(([path]) => !path.startsWith('documents/')).map(([path, data]) => ({ path, data }))
    if (command === 'read_app_document') return disk.has('documents/' + args.name) ? Buffer.from(disk.get('documents/' + args.name), 'base64').toString() : null
    if (command === 'write_app_document') {
      if (failNative) { failNative = false; throw new Error('write denied') }
      disk.set('documents/' + args.name, Buffer.from(args.content).toString('base64')); return
    }
    if (command === 'restore_content_data') {
      if (failNative) { failNative = false; throw new Error('write denied') }
      for (const file of args.files) disk.set(file.path, file.data)
      for (const path of args.removePaths) disk.delete(path)
      return
    }
    throw new Error(command)
  }
  function load(path) {
    const file = resolve(path)
    if (cache.has(file)) return cache.get(file)
    const module = { exports: {} }; cache.set(file, module.exports)
    const source = readFileSync(file, 'utf8')
    runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
      module, exports: module.exports, console, Blob, TextEncoder, TextDecoder, btoa, atob,
      crypto: webcrypto, indexedDB: factory, localStorage: storage,
      window: { ...(native ? { __TAURI_INTERNALS__: {} } : {}), dispatchEvent() {} },
      navigator: { userAgent: 'Windows' },
      CustomEvent: class { constructor(type, options) { this.type = type; Object.assign(this, options) } },
      fetch: async url => { if (!(url in fetches)) throw new Error('unexpected fetch ' + url); return new Response(fetches[url]) },
      require: name => {
        if (name === '@tauri-apps/api/core') return { invoke }
        if (name.endsWith('publicBankStorage')) return { listPublicBanks: async () => publicBanks }
        if (name.startsWith('.')) return load(resolve(dirname(file), name + '.ts'))
        throw new Error(name)
      },
    })
    cache.set(file, module.exports)
    return module.exports
  }
  const factory = new IDBFactory()
  return { load, data, disk, calls, storage, failNextValue: key => { failValue = key }, failNextNative: () => { failNative = true } }
}
const bank = JSON.stringify([{ id: 'q1', number: 1, type: 'single', content: 'Question', options: { A: 'one', B: 'two' }, answer: 'A' }])
const notebooks = (file = 'generated:example') => JSON.stringify({ version: 1, notebooks: [{ id: 'nb', name: '错题本', bankFile: file, createdAt: 1 }], wrongEntries: [{ id: 1, questionNumber: 1, bankFile: file, notebookId: 'nb', addedAt: 1 }], activeNotebookByBank: { [file]: 'nb' }, guessedRight: [] })
const session = JSON.stringify({ answers: [[1, { userAnswer: 'B', isCorrect: false }]], order: [1], currentIndex: 0 })
const file = (path, text) => ({ path, data: Buffer.from(text).toString('base64') })
async function resign(backup) { backup.sha256 = Buffer.from(await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(backup.payload)))).toString('hex'); return backup }

test('full backup roundtrips generated banks, binary images, notebooks, compound drafts and preferences without AI secrets', async () => {
  const h = harness({ values: {
    wrongNotebookData_v2: notebooks(), practice_session_example: session, darkMode: 'true', desktopQuizPresentation: 'single',
    'exam.llm-converter.config': '{"provider":{"apiKey":"secret"}}', unrelated: 'private',
  } })
  const generated = h.load('src/services/generatedBankStorage.ts')
  await generated.replaceGeneratedBanks([{ file: 'generated:example', name: '中文题库', content: bank, images: [{ fileName: 'figure.png', blob: new Blob([new Uint8Array([0, 1, 128, 255])], { type: 'image/png' }) }] }])
  const api = h.load('src/services/fullBackup.ts')
  const backup = await api.createFullBackup()
  assert.ok(!JSON.stringify(backup).includes('secret'))
  assert.equal(backup.payload.schemaVersion, 2)
  assert.equal(api.backupSummary(backup).images, 1)
  await generated.replaceGeneratedBanks([])
  h.data.set('darkMode', 'false')
  await api.restoreFullBackup(backup)
  const restored = await generated.readStoredGeneratedBank('generated:example')
  assert.equal(restored.name, '中文题库')
  assert.deepEqual([...new Uint8Array(await restored.images[0].blob.arrayBuffer())], [0, 1, 128, 255])
  assert.equal(h.data.get('darkMode'), 'true')
  assert.equal(h.data.get('wrongNotebookData_v2'), notebooks())
  assert.equal(h.data.get('unrelated'), 'private')
  assert.ok(await api.readBeforeRestoreSnapshot())
  assert.equal(h.data.has('exam-restore-pending'), false)
})

test('checksum, unsafe paths, invalid records and unknown future schemas are rejected before writes', async () => {
  const h = harness({ native: true, values: { wrongNotebookData_v2: notebooks() }, files: [file('user/subjects/中文.json', bank)] })
  const api = h.load('src/services/fullBackup.ts')
  const original = await api.createFullBackup()
  for (const change of [
    value => { value.sha256 = 'broken' },
    value => { value.payload.nativeFiles[0].path = 'user/subjects/../../outside.json' },
    value => { value.payload.values.wrongNotebookData_v2 = '{broken' },
    value => { value.payload.schemaVersion = 99 },
    value => { value.payload.values['exam.llm-converter.config'] = 'secret' },
  ]) {
    const modified = structuredClone(original); change(modified)
    if (modified.sha256 !== 'broken') await resign(modified)
    await assert.rejects(api.restoreFullBackup(modified))
  }
  assert.equal(h.calls.filter(call => call.command === 'restore_content_data').length, 0)
  assert.equal(h.data.get('wrongNotebookData_v2'), notebooks())
})

test('failed browser commit rolls banks and records back; crash marker performs the same rollback on restart', async () => {
  const h = harness({ values: { wrongNotebookData_v2: notebooks(), darkMode: 'true' } })
  const api = h.load('src/services/fullBackup.ts')
  const backup = await api.createFullBackup()
  h.data.set('darkMode', 'false')
  h.failNextValue('darkMode')
  await assert.rejects(api.restoreFullBackup(backup), /已回滚/)
  assert.equal(h.data.get('darkMode'), 'false')
  assert.equal(h.data.has('exam-restore-pending'), false)
  h.data.set('darkMode', 'half-restored')
  h.data.set('exam-restore-pending', JSON.stringify({ newPaths: [] }))
  await api.recoverInterruptedRestore()
  assert.equal(h.data.get('darkMode'), 'false')
})

test('native restore retains unrelated content and rolls newly introduced files back after quota failure', async () => {
  const h = harness({ native: true, values: { darkMode: 'true' }, files: [file('user/subjects/original.json', bank)] })
  const api = h.load('src/services/fullBackup.ts')
  const backup = await api.createFullBackup()
  backup.payload.nativeFiles.push(file('user/images/new.png', 'image'))
  backup.payload.values.darkMode = 'false'; await resign(backup)
  h.failNextValue('darkMode')
  await assert.rejects(api.restoreFullBackup(backup), /已回滚/)
  assert.equal(h.disk.has('user/images/new.png'), false)
  assert.equal(h.disk.has('user/subjects/original.json'), true)
  assert.equal(h.data.get('darkMode'), 'true')
})

test('read-only web banks and images become portable local banks with remapped history', async () => {
  const path = '/subjects/static.json'
  const h = harness({ publicBanks: [{ name: 'static', file: path }], values: { wrongNotebookData_v2: notebooks(path), ['practice_session_' + path]: session, lastBank: path }, fetches: { [path]: bank.replace('Question', '![image](/images/sample.png)'), '/images/sample.png': new Uint8Array([1, 2, 3]) } })
  const api = h.load('src/services/fullBackup.ts')
  const backup = await api.createFullBackup()
  const id = backup.payload.banks[0].file
  assert.match(id, /^generated:/)
  assert.equal(backup.payload.banks[0].images.length, 1)
  assert.equal(JSON.parse(backup.payload.values.wrongNotebookData_v2).wrongEntries[0].bankFile, id)
  assert.equal(backup.payload.values.lastBank, id)
  assert.ok(backup.payload.values['practice_session_' + id])
  await api.restoreFullBackup(backup)
  await api.createFullBackup()
})

test('failed restore preserves exact static-web bank identities instead of migrating history during rollback', async () => {
  const path = '/subjects/static.json'
  const h = harness({ publicBanks: [{ name: 'static', file: path }], values: { wrongNotebookData_v2: notebooks(path), darkMode: 'true' }, fetches: { [path]: bank } })
  const api = h.load('src/services/fullBackup.ts')
  const backup = await api.createFullBackup()
  h.failNextValue('darkMode')
  await assert.rejects(api.restoreFullBackup(backup), /已回滚/)
  assert.equal(h.data.get('wrongNotebookData_v2'), notebooks(path))
  assert.equal((await h.load('src/services/generatedBankStorage.ts').listGeneratedBanks()).length, 0)
})

test('v0.1.5/v0.1.6 learning keys migrate non-destructively; newer data refuses downgrade', async () => {
  const h = harness({ values: { wrongNotebookData_v2: notebooks(), practice_session_example: session } })
  const persistence = h.load('src/services/learningPersistence.ts')
  await persistence.initializeLearningPersistence()
  assert.equal(h.data.get('practice_session_example'), session)
  assert.equal(h.data.get('wrongNotebookData_v2'), notebooks())
  assert.equal(JSON.parse(h.data.get('exam-data-version')).schemaVersion, 2)
  h.data.set('exam-data-version', '{"schemaVersion":99}')
  await assert.rejects(persistence.initializeLearningPersistence(), /更高版本/)
})

test('upgrade protects original raw records before native hydration and never persists an unhydrated empty envelope', async () => {
  const h = harness({ native: true, values: { wrongEntriesDB: '{legacy-raw', wrongNotebookData_v2: notebooks(), 'exam.llm-converter.config': 'secret' },
    files: [file('documents/quiz-data.json', notebooks())] })
  await h.load('src/services/learningPersistence.ts').initializeLearningPersistence()
  assert.equal(h.calls[0].command, 'prepare_learning_upgrade')
  const originals = JSON.parse(h.calls[0].args.browserValues)
  assert.equal(originals.wrongEntriesDB, '{legacy-raw')
  assert.equal(originals.wrongNotebookData_v2, notebooks())
  assert.ok(!h.calls[0].args.browserValues.includes('secret'))
  assert.equal(h.calls.some(call => call.command === 'write_app_document'), false)
  const failed = harness({ native: true, values: { wrongNotebookData_v2: notebooks() }, failUpgrade: true })
  await assert.rejects(failed.load('src/services/learningPersistence.ts').initializeLearningPersistence(), /snapshot disk full/)
  assert.equal(failed.data.get('wrongNotebookData_v2'), notebooks())
  assert.equal(failed.calls.length, 1)
})

test('newer learning envelope cannot replace a newer notebook with a stale embedded notebook', async () => {
  const local = JSON.stringify({ ...JSON.parse(notebooks()), savedAt: 200 })
  const stale = JSON.stringify({ ...JSON.parse(notebooks()), savedAt: 100, notebooks: [], wrongEntries: [], activeNotebookByBank: {} })
  const h = harness({ native: true, values: { wrongNotebookData_v2: local, 'exam-data-version': '{"schemaVersion":2,"savedAt":50}' },
    files: [file('documents/learning-state.json', JSON.stringify({ schemaVersion: 2, savedAt: 300, values: { wrongNotebookData_v2: stale, darkMode: 'true' } }))] })
  await h.load('src/services/learningPersistence.ts').initializeLearningPersistence()
  assert.equal(h.data.get('wrongNotebookData_v2'), local)
  assert.equal(h.data.get('darkMode'), 'true')
  assert.equal(h.calls.some(call => call.command === 'write_app_document'), false)
})

test('learning write failures and protected snapshots prevent the updater save handshake', async () => {
  const h = harness({ native: true, values: { wrongNotebookData_v2: notebooks() } })
  const api = h.load('src/services/learningPersistence.ts')
  await api.initializeLearningPersistence()
  h.failNextNative()
  await assert.rejects(api.persistLearningState(), /write denied/)
  await assert.rejects(api.drainLearningWrites({ requireSaved: true }), /write denied/)
  await api.persistLearningState()
  await api.drainLearningWrites({ requireSaved: true })
  h.data.set('exam-restore-pending', '{}')
  await assert.rejects(api.drainLearningWrites({ requireSaved: true }), /保护或恢复/)

  const broken = harness({ native: true, files: [file('documents/learning-state.json', '{broken')] })
  const protectedApi = broken.load('src/services/learningPersistence.ts')
  await protectedApi.initializeLearningPersistence()
  await protectedApi.persistLearningState()
  await assert.rejects(protectedApi.drainLearningWrites({ requireSaved: true }), /保护或恢复/)
  await protectedApi.drainLearningWrites()
  assert.equal(broken.calls.some(call => call.command === 'write_app_document'), false)
})

test('valid backups can repair corrupt current records while preserving damaged originals in a raw snapshot', async () => {
  const h = harness({ values: { wrongNotebookData_v2: notebooks(), darkMode: 'true' } })
  const api = h.load('src/services/fullBackup.ts')
  const backup = await api.createFullBackup()
  h.data.set('wrongNotebookData_v2', '{broken original')
  await api.restoreFullBackup(backup)
  assert.equal(h.data.get('wrongNotebookData_v2'), notebooks())
  const snapshot = await api.readBeforeRestoreSnapshot()
  assert.equal(snapshot.payload.rawSnapshot, true)
  assert.equal(snapshot.payload.values.wrongNotebookData_v2, '{broken original')
  await assert.rejects(api.validateFullBackup(snapshot), /排错快照/)
})

test('bank session cleanup does not confuse overlapping filenames with notebook or type suffixes', () => {
  const { isBankSessionKey } = harness().load('src/utils/bankSessionKeys.ts')
  assert.equal(isBankSessionKey('practice_session_a.json', '{}', 'a.json', []), true)
  assert.equal(isBankSessionKey('wrong_session_a.json_nb_1', '{}', 'a.json', ['nb_1']), true)
  assert.equal(isBankSessionKey('wrong_session_a.json_more.json_nb_1', '{}', 'a.json', ['nb_1']), false)
  assert.equal(isBankSessionKey('specialize_session_a.json_单选题_多选题', '{}', 'a.json', []), true)
  assert.equal(isBankSessionKey('specialize_session_a.json_more.json_单选题', '{}', 'a.json', []), false)
  const api = harness().load('src/services/fullBackup.ts')
  const key = 'wrong_session_a.json_more.json_nb'
  const values = api.remapBankReferences({ wrongNotebookData_v2: notebooks('a.json_more.json'), [key]: session }, 'a.json', 'generated:new')
  assert.equal(values[key], session)
})

test('bank origins distinguish imports, AI conversions, manual files and development resources and enter backups', async () => {
  const h = harness()
  const sources = h.load('src/services/bankSources.ts')
  sources.rememberBankSource('/user-subjects/import.json', 'import')
  sources.rememberBankSource('generated:converted', 'ai')
  assert.equal(sources.bankSourceLabel('/user-subjects/import.json'), '文件导入')
  assert.equal(sources.bankSourceLabel('generated:converted'), 'AI 转换')
  assert.equal(sources.bankSourceLabel('/user-subjects/manual.json'), '用户目录 / 手动放入')
  assert.equal(sources.bankSourceLabel('/subjects/development.json', true), '开发目录')
  const backup = await h.load('src/services/fullBackup.ts').createFullBackup()
  assert.ok(backup.payload.values.bankSources_v2)
})

test('UTF-8 imports accept BOM and reject broken byte sequences instead of silently replacing Chinese characters', async () => {
  const { readImportedText } = harness().load('src/services/fileService.ts')
  const bytes = new TextEncoder().encode('\uFEFF中文题库')
  assert.equal(await readImportedText({ name: '中文.json', read: async () => bytes.buffer }), '中文题库')
  await assert.rejects(readImportedText({ name: 'bad.json', read: async () => new Uint8Array([0xff, 0xfe, 0xff]).buffer }))
})

test('malformed native learning roots and null metadata never clear valid browser records', async () => {
  const h = harness({ native: true, values: { darkMode: 'true' }, files: [file('documents/learning-state.json', JSON.stringify({ schemaVersion: 2, savedAt: 999, values: [] }))] })
  const api = h.load('src/services/learningPersistence.ts')
  await api.initializeLearningPersistence()
  assert.equal(h.data.get('darkMode'), 'true')
  assert.equal(h.calls.some(call => call.command === 'write_app_document'), false)
  const broken = harness({ values: { 'exam-data-version': 'null', darkMode: 'true' } })
  await broken.load('src/services/learningPersistence.ts').initializeLearningPersistence()
  assert.equal(broken.data.get('darkMode'), 'true')
  assert.equal(broken.data.get('exam-data-version'), 'null')
})

test('import preflight reports all invalid IDs, types, options and answers, and accepts BOM and Chinese filenames', () => {
  const h = harness()
  const { inspectBank, bankIssueReport } = h.load('src/utils/bankImport.ts')
  const good = inspectBank('\uFEFF' + bank, '中文题库.json')
  assert.equal(good.issues.length, 0)
  assert.equal(good.types['单选题'], 1)
  for (const text of ['[]', '{broken', '{}']) assert.ok(inspectBank(text, 'bad.json').issues.length)
  const invalid = JSON.parse(bank)
  invalid.push({ ...invalid[0], type: 'unknown' })
  invalid.push({ ...invalid[0], options: { A: '' }, answer: 'C' })
  const report = inspectBank(JSON.stringify(invalid), 'bad.json')
  assert.ok(report.issues.length >= 5)
  assert.match(bankIssueReport(report), /第 2 题/)
  assert.match(bankIssueReport(report), /建议/)
})

test('legacy whole-answer comprehensive questions load as open responses without changing source data or identity', () => {
  const h = harness()
  const { inspectBank } = h.load('src/utils/bankImport.ts')
  const { normalizeQuestionBank } = h.load('src/utils/questionSchema.ts')
  for (const type of ['综合题', '综合应用题', 'SQL综合题']) {
    for (const subs of [undefined, []]) {
      const source = [{ id: 'legacy-210', number: 210, type, question: '旧综合题', answer: '整题参考答案', subQuestions: subs }]
      const content = JSON.stringify(source)
      const report = inspectBank(content, '旧版题库.json')
      assert.equal(report.issues.length, 0)
      const question = normalizeQuestionBank(source)[0]
      assert.equal(question.type, '简答题')
      assert.equal(question.number, 210)
      assert.equal(question.id, 'legacy-210')
      assert.equal(question.answer, '整题参考答案')
      assert.equal(JSON.stringify(source), content)
    }
    const structured = [{ type, content: '场景', subQuestions: [{ content: '子题', answer: '答案' }] }]
    assert.equal(inspectBank(JSON.stringify(structured), 'structured.json').issues.length, 0)
    assert.notEqual(normalizeQuestionBank(structured)[0].type, '简答题')
  }
  assert.equal(normalizeQuestionBank([{ type: '代码应用题', content: '代码练习', answer: '参考代码' }])[0].type, '编程题')
  for (const type of ['compound', '复合题']) {
    const report = inspectBank(JSON.stringify([{ type, content: '缺失子题', answer: '不能代替子题' }]), 'invalid.json')
    assert.ok(report.issues.some(issue => issue.field === 'subQuestions'))
  }
  assert.ok(inspectBank(JSON.stringify([{ type: '综合题', content: '无答案' }]), 'invalid.json').issues.some(issue => issue.field === 'answer'))
})
