const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')
const test = require('node:test')
const ts = require('typescript')

function load(filename) {
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: filename,
  })
  const nativeRequire = createRequire(filename)
  const module = { exports: {} }
  new Function('module', 'exports', 'require', outputText)(module, module.exports, request =>
    request.startsWith('.') && !request.endsWith('.json')
      ? load(path.resolve(path.dirname(filename), `${request}.ts`))
      : nativeRequire(request))
  return module.exports
}

const { resolveSharedCard, cardShareMessage } = load(path.resolve(__dirname, '../src/domain/card-share.ts'))
const catalog = require('../cloudfunctions/reminders/cards.json')

test('shared links resolve exactly their selected catalog card, including unclaimed practice cards', () => {
  for (const card of catalog) {
    const link = new URL(cardShareMessage(card).path, 'https://preview.invalid')
    assert.equal(link.pathname, '/pages/share/index')
    assert.deepEqual(resolveSharedCard(link.searchParams.get('cardId')), card)
    assert.deepEqual([...link.searchParams.keys()], ['cardId'])
  }
})

test('invalid share IDs never substitute a different card or coerce external input', () => {
  for (const input of [undefined, null, '', ' ', 'missing', 'D01', 'd01 ', ['d01'], { cardId: 'd01' }, 1, '../d01', 'd01&cardId=d02']) {
    assert.equal(resolveSharedCard(input), null)
  }
  assert.equal(new URL(cardShareMessage(null).path, 'https://preview.invalid').pathname, '/pages/index/index')
})
