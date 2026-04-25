import type { NetworkConfig, DomainGroup } from "@cobeing/shared";

export const PRESET_DOMAIN_GROUPS: DomainGroup[] = [
  {
    id: "dev-tools",
    name: "开发工具",
    domains: ["github.com", "gitlab.com", "bitbucket.org"],
  },
  {
    id: "package-managers",
    name: "包管理器",
    domains: ["registry.npmjs.org", "pypi.org", "rubygems.org", "proxy.golang.org"],
  },
  {
    id: "documentation",
    name: "文档站点",
    domains: ["docs.python.org", "developer.mozilla.org", "stackoverflow.com"],
  },
];

/**
 * 解析网络配置，处理向后兼容
 * - boolean true → { enabled: true, mode: "all" }
 * - boolean false → { enabled: false, mode: "none" }
 * - NetworkConfig → 合并域名包
 */
export function resolveNetworkConfig(network: NetworkConfig | boolean): NetworkConfig {
  // 向后兼容：boolean → NetworkConfig
  if (typeof network === "boolean") {
    return { enabled: network, mode: network ? "all" : "none" };
  }

  // 合并域名包到 allowDomains
  if (network.mode === "whitelist" && network.domainGroups?.length) {
    const domains = new Set(network.allowDomains ?? []);
    for (const group of network.domainGroups) {
      for (const domain of group.domains) {
        domains.add(domain);
      }
    }
    return { ...network, allowDomains: [...domains] };
  }

  return network;
}

/**
 * 构建 Docker 网络参数
 */
export function buildNetworkArgs(network: NetworkConfig, agentId: string): string[] {
  const resolved = resolveNetworkConfig(network);

  if (!resolved.enabled || resolved.mode === "none") {
    return ["--network=none"];
  }

  if (resolved.mode === "all") {
    return []; // 默认 bridge 网络
  }

  // whitelist 模式：使用自定义网络
  return ["--network", `sandbox-${agentId}`];
}

/**
 * 构建 iptables 白名单规则
 */
export function buildWhitelistRules(
  containerIp: string,
  allowDomains: string[],
): string[] {
  const rules: string[] = [];

  // 允许 DNS 查询（端口 53）
  rules.push(`iptables -A DOCKER-USER -d ${containerIp} -p udp --dport 53 -j ACCEPT`);
  rules.push(`iptables -A DOCKER-USER -d ${containerIp} -p tcp --dport 53 -j ACCEPT`);

  // 允许白名单域名
  for (const domain of allowDomains) {
    rules.push(`iptables -A DOCKER-USER -d ${containerIp} -m string --string "${domain}" --algo bm -j ACCEPT`);
  }

  // 拒绝其他所有出站
  rules.push(`iptables -A DOCKER-USER -d ${containerIp} -j DROP`);

  return rules;
}
