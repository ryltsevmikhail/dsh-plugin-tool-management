import assert from 'node:assert/strict'
import test from 'node:test'
import { createToolVisibility } from '../lib/mcp/tool-visibility.js'
import { isToolDisabledIn } from '../lib/mcp/manager.js'

const tick = () => new Promise(resolve => setImmediate(resolve))
function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}
const TOOL = 'mcp__demo__hidden'
function fixture(t, { read = async () => ({}), schemas = async () => [{ name: TOOL }], carrier = async () => [] } = {}) {
  const layers = new Map()
  const mutations = []
  let schemaCalls = 0
  const visibility = createToolVisibility({
    SIDECAR_TTL_MS: 1000,
    MCP_DISABLED_TOOLS_FILE: 'disabled', MCP_KNOWN_TOOLS_FILE: 'known',
    ensurePaths: async () => ({}), mcpSidecar: name => name,
    readJsonFile: read, writeJsonFile: async () => {},
    withWriteLock: async fn => fn(), normalizeKnownTools: () => [], message: String,
    tools: { restrict() { throw new Error('must use agent scope') }, schemas() { schemaCalls++; return schemas() } },
    // Existing CPU backport must keep identical per-agent layers despite this async seam.
    carrierHiddenTools: carrier,
  })
  const agent = { ctx: { tools: { restrict({ deny }) {
    const token = Symbol('restriction')
    layers.set(token, [...deny]); mutations.push(['install', [...deny]])
    return () => { layers.delete(token); mutations.push(['release']) }
  } } } }
  visibility.attachAgent(agent)
  t.after(() => visibility.disposeVisibility())
  return {
    visibility, mutations, agent,
    schemaCalls: () => schemaCalls,
    denied: () => [...new Set([...layers.values()].flat())].sort(),
    blocked: () => isToolDisabledIn(visibility.disabledToolsSnapshot(), TOOL),
  }
}

for (const [label, oldMap, latestMap, expectedDeny, blocked] of [
  ['new deny survives old allow', {}, { demo: ['hidden'] }, [TOOL], true],
  ['new allow survives old deny', { demo: ['hidden'] }, {}, [], false],
]) {
  test(`delayed sidecar: ${label}`, async t => {
    const old = deferred(); let reads = 0
    const f = fixture(t, { read: () => ++reads === 1 ? old.promise : Promise.resolve(latestMap) })
    await tick()
    const older = f.visibility.applyToolRestrictions(); await tick()
    await f.visibility.applyToolRestrictions(); await tick()
    old.resolve(oldMap); await older; await tick()
    assert.deepEqual(f.visibility.disabledToolsSnapshot(), latestMap, 'late I/O must not overwrite the guard cache')
    assert.deepEqual(f.denied(), expectedDeny, 'late computation must not overwrite agent restrictions')
    assert.equal(f.blocked(), blocked, 'actual execution-guard predicate must see latest settings')
  })
}

for (const [label, oldMap, latestMap, expectedDeny] of [
  ['new deny survives old allow', {}, { demo: ['hidden'] }, [TOOL]],
  ['new allow survives old deny', { demo: ['hidden'] }, {}, []],
]) {
  test(`delayed schemas: ${label}`, async t => {
    const old = deferred(); let reads = 0; let calls = 0
    const f = fixture(t, {
      read: async () => ++reads === 1 ? oldMap : latestMap,
      schemas: () => ++calls === 1 ? old.promise : Promise.resolve([{ name: TOOL }]),
    })
    await tick()
    const older = f.visibility.applyToolRestrictions(); await tick()
    await f.visibility.applyToolRestrictions(); await tick()
    old.resolve([{ name: TOOL }]); await older; await tick()
    assert.deepEqual(f.visibility.disabledToolsSnapshot(), latestMap)
    assert.deepEqual(f.denied(), expectedDeny)
  })
}

test('committed settings invalidate an older forced read before a new replay', async t => {
  const old = deferred()
  const f = fixture(t, { read: () => old.promise })
  const pending = f.visibility.readDisabledTools(true); await tick()
  f.visibility.setDisabledToolsCache({ demo: ['hidden'] })
  old.resolve({}); await pending
  assert.equal(f.blocked(), true)
  assert.deepEqual(f.visibility.disabledToolsSnapshot(), { demo: ['hidden'] })
})

test('disposal invalidates pending reads before schema work or cache publication', async t => {
  const old = deferred()
  const f = fixture(t, { read: () => old.promise })
  const pending = f.visibility.applyToolRestrictions(); await tick()
  f.visibility.disposeVisibility()
  old.resolve({ demo: ['hidden'] }); await pending; await tick()
  assert.equal(f.schemaCalls(), 0, 'unloaded module must not restart schema enumeration')
  assert.deepEqual(f.visibility.disabledToolsSnapshot(), {})
  assert.deepEqual(f.denied(), [])
})

test('settings publication invalidates a pending agent carrier result before delayed replay', async t => {
  const old = deferred(); let wait = false
  const f = fixture(t, { carrier: () => wait ? old.promise : Promise.resolve([]) })
  await tick(); wait = true
  await f.visibility.applyToolRestrictions(); await tick()
  f.visibility.setDisabledToolsCache({ demo: ['hidden'] })
  old.resolve([TOOL]); await tick()
  assert.equal(f.blocked(), true)
  assert.deepEqual(f.denied(), [], 'superseded carrier must not publish between the settings commit and replay')
})

test('disposed visibility cannot be reattached, rescheduled or republished', async t => {
  let reads = 0
  const f = fixture(t, { read: async () => { reads++; return { demo: ['hidden'] } } })
  await tick()
  f.visibility.disposeVisibility()
  f.visibility.attachAgent(f.agent)
  f.visibility.setDisabledToolsCache({ demo: ['hidden'] })
  f.visibility.scheduleToolRestrictions()
  await f.visibility.applyToolRestrictions()
  await new Promise(resolve => setTimeout(resolve, 350))
  assert.equal(reads, 0)
  assert.deepEqual(f.visibility.disabledToolsSnapshot(), {})
  assert.deepEqual(f.denied(), [])
})

test('identical replays converge without tearing down and reinstalling agent layers', async t => {
  const f = fixture(t, { read: async () => ({ demo: ['hidden'] }) })
  await tick(); await f.visibility.applyToolRestrictions(); await tick()
  assert.deepEqual(f.denied(), [TOOL])
  const count = f.mutations.length
  for (let i = 0; i < 100; i++) { await f.visibility.applyToolRestrictions(); await tick() }
  assert.equal(f.mutations.length, count, 'keep the installed CPU-loop backport behavior')
})
