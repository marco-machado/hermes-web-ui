#!/usr/bin/env node
/**
 * Smoke: connect to the running Hermes gateway with the same wire path as the UI.
 * Does not start the gateway. Reads host/port/token from .env.local / env / .env.example.
 *
 * Usage: node ./scripts/smoke-connect.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function loadEnvFile(name) {
  const path = resolve(root, name)
  if (!existsSync(path)) return {}
  const out = {}
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#') || !t.includes('=')) continue
    const i = t.indexOf('=')
    const k = t.slice(0, i).trim()
    let v = t.slice(i + 1).trim()
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1)
    }
    out[k] = v
  }
  return out
}

const fileEnv = { ...loadEnvFile('.env.example'), ...loadEnvFile('.env.local') }
const host = process.env.VITE_HERMES_HOST || fileEnv.VITE_HERMES_HOST || '127.0.0.1'
const port = process.env.VITE_HERMES_PORT || fileEnv.VITE_HERMES_PORT || '9119'
const token = process.env.VITE_HERMES_TOKEN || fileEnv.VITE_HERMES_TOKEN || ''
const cwd = process.env.VITE_HERMES_CWD || fileEnv.VITE_HERMES_CWD || root

if (!token.trim()) {
  console.error('FAIL: no VITE_HERMES_TOKEN in env or .env.local')
  process.exit(2)
}

const url = `ws://${host}:${port}/api/ws?token=${encodeURIComponent(token.trim())}`

function fail(msg, code = 1) {
  console.error(`FAIL: ${msg}`)
  process.exit(code)
}

const CONNECT_MS = 8_000
const RPC_MS = 15_000

const ws = new WebSocket(url)
let nextId = 1
const pending = new Map()
/** @type {string[]} */
const events = []

function request(method, params = {}, timeoutMs = RPC_MS) {
  const id = `smoke_${nextId++}`
  const frame = { jsonrpc: '2.0', id, method, params }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`${method} timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    pending.set(id, {
      resolve: v => {
        clearTimeout(timer)
        resolve(v)
      },
      reject: e => {
        clearTimeout(timer)
        reject(e)
      },
    })
    ws.send(JSON.stringify(frame))
  })
}

const opened = new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error(`WS open timed out (${CONNECT_MS}ms)`)), CONNECT_MS)
  ws.addEventListener('open', () => {
    clearTimeout(t)
    resolve()
  })
  ws.addEventListener('error', () => {
    clearTimeout(t)
    reject(new Error('WS error during connect (often bad/stale token → 403)'))
  })
})

ws.addEventListener('message', ev => {
  let msg
  try {
    msg = JSON.parse(String(ev.data))
  } catch {
    return
  }
  if (msg.method === 'event' && msg.params?.type) {
    events.push(String(msg.params.type))
  }
  if (msg.id != null && pending.has(msg.id)) {
    const p = pending.get(msg.id)
    pending.delete(msg.id)
    if (msg.error) {
      p.reject(new Error(msg.error.message || JSON.stringify(msg.error)))
    } else {
      p.resolve(msg.result)
    }
  }
})

try {
  console.log(`connecting ${host}:${port} …`)
  await opened
  console.log('WS open')

  // wait briefly for gateway.ready if it races in
  await new Promise(r => setTimeout(r, 200))

  const created = await request('session.create', {
    close_on_disconnect: true,
    source: 'web',
    cwd,
  })
  const sessionId = created?.session_id
  if (!sessionId) fail(`session.create missing session_id: ${JSON.stringify(created)}`)
  console.log(`session.create ok session_id=${sessionId}`)

  // optional lightweight probe — don't burn a full agent turn
  try {
    const status = await request('session.status', { session_id: sessionId }, 5_000)
    console.log('session.status ok', typeof status === 'object' ? Object.keys(status) : status)
  } catch (e) {
    console.log(`session.status skipped/unavailable: ${e instanceof Error ? e.message : e}`)
  }

  if (events.includes('gateway.ready')) {
    console.log('event gateway.ready seen')
  } else {
    console.log(`events so far: ${events.slice(0, 8).join(', ') || '(none yet)'}`)
  }

  ws.close()
  console.log('PASS: gateway connect + session.create')
  process.exit(0)
} catch (e) {
  try {
    ws.close()
  } catch {
    /* ignore */
  }
  fail(e instanceof Error ? e.message : String(e))
}
