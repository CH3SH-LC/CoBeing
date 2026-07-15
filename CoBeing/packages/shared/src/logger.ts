/**
 * 轻量级日志系统
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export class Logger {
  private level: LogLevel;
  private prefix: string;

  constructor(prefix: string, level: LogLevel = "info") {
    this.prefix = prefix;
    this.level = level;
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  debug(msg: string, ...args: unknown[]): void {
    this.log("debug", msg, ...args);
  }

  info(msg: string, ...args: unknown[]): void {
    this.log("info", msg, ...args);
  }

  warn(msg: string, ...args: unknown[]): void {
    this.log("warn", msg, ...args);
  }

  error(msg: string, ...args: unknown[]): void {
    this.log("error", msg, ...args);
  }

  private log(level: LogLevel, msg: string, ...args: unknown[]): void {
    if (LOG_LEVELS[level] < LOG_LEVELS[this.level]) return;

    const timestamp = new Date().toISOString();
    const formatted = `[${timestamp}] [${level.toUpperCase()}] [${this.prefix}] ${msg}`;

    switch (level) {
      case "debug":
      case "info":
        console.log(formatted, ...args);
        break;
      case "warn":
        console.warn(formatted, ...args);
        break;
      case "error":
        console.error(formatted, ...args);
        break;
    }
  }

  /** 创建子 logger（共享级别，独立前缀） */
  child(subPrefix: string): Logger {
    const logger = new Logger(`${this.prefix}:${subPrefix}`, this.level);
    return logger;
  }
}

/** 全局 logger 工厂 */
let rootLevel: LogLevel = "info";

export function setGlobalLogLevel(level: LogLevel): void {
  rootLevel = level;
}

export function createLogger(prefix: string): Logger {
  return new Logger(prefix, rootLevel);
}
