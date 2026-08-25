#!/usr/bin/env node
/**
 * Fake kernel for KernelBridge integration tests.
 *
 * Reads JSON-RPC request lines from stdin, echoes responses / notifications to stdout,
 * one JSON object per line. Mirrors the real `cobeing-kernel` line protocol.
 */
import { createInterface } from 'node:readline'
import process from 'node:process'

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })

function writeLine(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n')
}

function reply(id, payload) {
  writeLine({ jsonrpc: '2.0', id, ...payload })
}

rl.on('line', (raw) => {
  const line = raw.trim()
  if (!line) return
  let req
  try {
    req = JSON.parse(line)
  } catch {
    reply(0, { error: { code: -32700, message: 'parse error' } })
    return
  }
  const id = req.id
  const method = req.method

  if (method === 'ping') {
    reply(id, { result: { pong: true } })
    return
  }
  if (method === 'emit-notify') {
    // Send a notification first, then the response.
    writeLine({ jsonrpc: '2.0', method: 'notify', params: { content: 'hello from fake kernel' } })
    reply(id, { result: { notified: true } })
    return
  }
  if (method === 'slow') {
    setTimeout(() => reply(id, { result: { done: true } }), 2000)
    return
  }
  if (method === 'boom') {
    reply(id, { error: { code: -32000, message: '业务失败' } })
    return
  }
  if (method === 'stop') {
    reply(id, { result: { stopped: true } })
    process.exit(0)
    return
  }
  reply(id, { error: { code: -32601, message: `method not found: ${method}` } })
})
