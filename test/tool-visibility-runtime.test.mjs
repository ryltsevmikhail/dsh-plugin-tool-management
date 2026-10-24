// Actual SDK services/scopes, private in-memory sidecar; no running DSH connection.
import assert from 'node:assert/strict'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { Context } from '@deepseek-ai/cordis'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import { createScope } from '@deepseek-ai/dsh-scope'
import { createToolVisibility } from '../lib/mcp/tool-visibility.js'
const tick = () => new Promise(resolve => setImmediate(resolve))

test('real scoped tools converge through actual tools/change debounce after D1 replay fencing', async t => {
  const context = new Context()
  let visibility, scope, unlisten
  t.after(async () => {
    unlisten?.()
    visibility?.disposeVisibility()
    await scope?.dispose()
    await context.fiber.dispose()
  })
  context.plugin(SystemPrompt, {})
  context.plugin(ToolRuntime, {})
  await tick()
  assert.ok(context.tools)
  for (const name of ['mcp__demo__hidden', 'mcp__demo__visible']) {
    context.tools.register({ name, description: name,
      parameters: { type: 'object', properties: {} },
      output: { schema: { type: 'object', properties: {} }, render: () => [] },
      async execute() { return {} },
    })
  }
  let disabled = { demo: ['hidden'] }
  let changes = 0
  const key = {}
  function consumer(ctx) {
    visibility = createToolVisibility({
      tools: ctx.tools, SIDECAR_TTL_MS: 0,
      MCP_DISABLED_TOOLS_FILE: 'disabled', MCP_KNOWN_TOOLS_FILE: 'known',
      ensurePaths: async () => ({}), mcpSidecar: name => name,
      readJsonFile: async () => disabled, writeJsonFile: async () => {},
      withWriteLock: async fn => fn(), normalizeKnownTools: () => [], message: String,
      carrierHiddenTools: async () => [],
    })
    scope = createScope(ctx, key)
    unlisten = ctx.on('tools/change', () => { changes++; visibility.scheduleToolRestrictions() })
    visibility.attachAgent({ ctx: scope.ctx })
  }
  consumer.inject = ['tools']
  context.plugin(consumer)
  await tick()
  assert.ok(visibility)
  await visibility.applyToolRestrictions(); await tick()
  const names = () => context.tools.schemas(key).map(schema => schema.name)
  assert.deepEqual(names(), ['mcp__demo__visible'])
  assert.equal(changes, 1)
  // Several real 300ms debounce windows, not a mocked event bus.
  await delay(1200)
  assert.equal(changes, 1, 'no repeating release/install feedback after unchanged replay')
  assert.deepEqual(names(), ['mcp__demo__visible'])
  disabled = {}
  await visibility.applyToolRestrictions(); await tick()
  assert.deepEqual(names(), ['mcp__demo__hidden', 'mcp__demo__visible'])
})
