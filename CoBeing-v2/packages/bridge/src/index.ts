/**
 * @cobeing/bridge — 内核桥协议（JSON-RPC 2.0 over stdio）
 *
 * - server.ts：transport 无关的 BridgeServer（核心协议实现）
 * - cli.ts：随包 CLI bin（stdio 装配）
 */
export * from './server.js'
export * from './remote.js'
export * from './cli.js'
