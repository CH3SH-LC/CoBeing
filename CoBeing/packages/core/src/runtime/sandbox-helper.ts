/**
 * 沙箱配置辅助函数（纯函数）
 */

/** 如果 Docker 不可用，降级沙箱配置 */
export function ensureSandboxConfig(sandbox: any, dockerAvailable: boolean): any {
  if (!sandbox?.enabled) return sandbox;
  if (!dockerAvailable) return { ...sandbox, enabled: false };
  return sandbox;
}
