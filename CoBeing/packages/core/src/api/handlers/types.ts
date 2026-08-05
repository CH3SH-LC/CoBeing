/**
 * WS 命令 handler 类型 — B1 ws-server 拆分基础设施
 *
 * handler 以 `function (this: CoreWSServer, ws, msg)` 形式声明，
 * 分发时经 `handler.call(server, ws, msg)` 调用，使 case 体内的
 * `this.X` 与 `msg.payload` 引用可原样保留，最大程度降低转写风险。
 */
import type { WebSocket } from "ws";
import type { WSMessage } from "../types.js";
import type { CoreWSServer } from "../ws-server.js";

export type WsCommandHandler = (this: CoreWSServer, ws: WebSocket, msg: WSMessage) => Promise<void> | void;

export type HandlerRegistrar = (type: string, handler: WsCommandHandler) => void;
