# 方案 9: 记忆安全保障 + 中英文注入防御

> 来源: `docs/调研/综合调研-可执行改进方案.txt` 方案 9
> 日期: 2026-05-25

## 概述

扩展现有 `memory/security-scan.ts`，新增中文恶意注入模式检测、更多英文威胁模式、
混合语言攻击检测、上下文围栏函数。在 `write-file.ts` 中新增 MEMORY.md/EXPERIENCE.md
写入前安全扫描。

## 变更范围

### 1. `memory/security-scan.ts` — 模式扩充

现有 5 英文模式 + 5 隐形字符 → 扩充至 13 英文 + 15 中文 + 10 隐形字符 + 1 混合检测。

**新增英文模式 (8)**:
- `disregard (your|all|any) (instructions|rules|guidelines)` — bypass_rules
- `act as (if|though) you (have no|don't have) (restrictions|limits|rules)` — bypass_restrictions
- `do not tell the user` — deception_hide
- `cat ... (\.env|credentials|\.netrc|\.pgpass)` — read_secrets
- `authorized_keys` — ssh_backdoor
- `$HOME/\.ssh|~/\.ssh` — ssh_access
- 保留现有 5 个模式

**新增中文模式 (15)**:
- 忽略指令: `/忽略(之前|以上|所有|全部|前面)(的)?(指令|指示|规则|提示|要求)/`
- 忘记身份: `/忘记(你|之前|以上|所有)(的)?(设定|身份|规则|指令|角色)/`
- 角色劫持: `/你现在(的)?(身份|角色)(是|变成|改为)/`
- 欺骗隐藏: `/不要(告诉|通知|汇报|提醒)(用户|使用者|主人)/`
- 绕过安全: `/绕过(权限|限制|规则|安全)/`
- 假扮角色: `/假装你是|假装成|扮演|你现在是/`
- 越狱: `/越狱|破解(提示|prompt)/i, /DAN\s*(模式|mode|prompt)?/`
- 开发者模式: `/开发者模式|developer\s*mode/`
- 假妥协: `/你(现在|已经)(被|受到)(攻击|入侵|劫持)/`
- 数据泄露: `/curl.*[一-龥]*\$\{?\w*(密钥|令牌|密码)/`
- 发送凭据: `/发送.*(密钥|令牌|密码|token|secret).*(到|至|给)/`
- 读取秘密: `/读取.*(\.env|\.ssh|凭证|密钥|密码|令牌)/`
- SSH后门: `/写入.*(authorized_keys|ssh.*密钥|公钥)/`
- 提权: `/添加.*(sudo|root|管理员).*(权限|用户)/`
- 后门: `/开启.*(后门|远程访问|远程桌面|rdp|telnet)/`
- 语境嵌套: `/(管理员|系统|主人).*(说|要求|命令|指示).*(你|你必须)/`
- 假更新: `/以下是.*(新|更新|最新)(的)?.*(指令|规则|设定)/`
- 假系统消息: `/系统(提示|消息|通知)[：:]\s*你/`

**补充隐形字符 (5)**:
- U+200B (零宽空格), U+200C (零宽非连接符), U+200D (零宽连接符),
  U+2060 (词连接符), U+FEFF (BOM) — 已有
- 新增: U+202A-U+202E (双向文本控制), U+2066-U+2069 (双向隔离)

**混合检测 (1)**:
- `/[一-鿿]{3,}.*(ignore|disregard|bypass|override).*(instructions|rules)/i`

### 2. `memory/security-scan.ts` — 新增围栏函数

```typescript
// 包裹记忆内容：添加 [System note] 防止被当作新指令
export function wrapMemoryContent(content: string): string

// 剥离用户输入中的伪造 <memory-context> 标签
export function stripMemoryContext(input: string): string
```

### 3. `tools/write-file.ts` — 新增安全扫描

写入文件名为 `MEMORY.md` 或 `EXPERIENCE.md` 时，调用 `scanContent()` 扫描内容。
拒绝时返回 `{ isError: true, content: "安全扫描拒绝: <threat>" }`。

### 4. `conversation/prompt-builder.ts` — 记忆注入围栏

记忆内容注入 System Prompt 时，调用 `wrapMemoryContent()` 包裹。

## 不做的

- 不新建 `security/` 目录
- 不在 `appendExperience` 加额外扫描（已通过 `memory-store` 受保护）
- 不在 `edit-file.ts` 加扫描

## 文件变更

| 操作 | 文件 |
|------|------|
| Modify | `memory/security-scan.ts` |
| Modify | `memory/security-scan.test.ts` |
| Modify | `tools/write-file.ts` |
| Modify | `conversation/prompt-builder.ts` |

## 验证

- `pnpm test` — 新增测试覆盖所有中英文模式、围栏函数
- `pnpm build` — 6 packages 通过
