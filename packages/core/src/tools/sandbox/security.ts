import type { SecurityConfig } from "@cobeing/shared";

const DEFAULT_SECURITY: SecurityConfig = {
  enabled: true,
  noNewPrivileges: true,
  readOnlyRootfs: true,
  dropAllCapabilities: true,
};

/**
 * 解析安全配置，处理向后兼容
 * - undefined → 默认启用
 * - SecurityConfig → 透传
 */
export function resolveSecurityConfig(security?: SecurityConfig): SecurityConfig {
  if (!security) {
    return DEFAULT_SECURITY;
  }
  return security;
}

/**
 * 构建 Docker 安全参数
 */
export function buildSecurityArgs(security: SecurityConfig): string[] {
  if (!security.enabled) {
    return [];
  }

  const args: string[] = [];

  if (security.noNewPrivileges) {
    args.push("--security-opt=no-new-privileges:true");
  }

  if (security.readOnlyRootfs) {
    args.push("--read-only");
    // 只读根文件系统需要添加可写的 tmpfs
    args.push("--tmpfs", "/tmp:rw,noexec,nosuid,size=100m");
    args.push("--tmpfs", "/var/tmp:rw,noexec,nosuid,size=100m");
  }

  if (security.dropAllCapabilities) {
    args.push("--cap-drop=ALL");
  }

  return args;
}
