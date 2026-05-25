# GUIDE.md + EXPERIENCE 概要机制 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add GUIDE.md as group-level rule file with discovery chain, and add EXPERIENCE.md summary section so System Prompt only injects summary instead of full content.

**Architecture:** GUIDE.md lives in `data/groups/{groupId}/GUIDE.md` (fallback: `data/GUIDE.md`) and is injected into group loop volatile. EXPERIENCE.md gets `<!-- EXPERIENCE_SUMMARY_START/END -->` markers; `extractExperienceSummary()` extracts only the summary for prompt injection while files permanently retain all entries.

**Tech Stack:** TypeScript, Vitest, Node.js fs

---

## File Structure

| File | Role |
|------|------|
| `config/templates/groups/GUIDE.md` | **Create** — Template for new group GUIDE.md |
| `config/templates/groups/EXPERIENCE.md` | Modify — Add summary markers |
| `config/templates/EXPERIENCE.md` | Modify — Add summary markers |
| `packages/core/src/group/workspace.ts` | Modify — Add `guide` path, readGuide(), writeGuide(), init GUIDE.md |
| `packages/core/src/conversation/prompt-builder.ts` | Modify — Add `extractExperienceSummary()`; inject GUIDE.md into volatile |
| `packages/core/src/agent/agent.ts` | Modify — Pass GUIDE.md content through snapshot to volatile |
| `packages/core/src/memory/memory-store.ts` | Modify — `snapshotForSystemPrompt` uses summary for experience target |
| `packages/core/src/agent/paths.ts` | Modify — `appendExperience` maintains summary section |
| `packages/core/src/group/workspace.ts` | Modify — `appendExperience` maintains summary section |
| `packages/core/src/conversation/prompt-builder.test.ts` | Modify — Add tests for extractExperienceSummary |

---

### Task 1: Create GUIDE.md template + add to GroupWorkspace

**Files:**
- Create: `config/templates/groups/GUIDE.md`
- Modify: `packages/core/src/group/workspace.ts:29-50` (paths), `:52-83` (initialize)

- [ ] **Step 1: Create GUIDE.md template**

Create `config/templates/groups/GUIDE.md`:

```markdown
# {{groupName}} 群组规则

## 协作约定
- 修改共享文件前先检查是否有其他成员正在编辑。
- 重要决策需 @mention 群主确认后再执行。

## 工作流约束
- （根据群组需求自定义）

## 沟通规范
- （根据群组需求自定义）
```

- [ ] **Step 2: Add `guide` to GroupWorkspacePaths and add read/write methods**

In `workspace.ts`, add `guide` path to the `GroupWorkspacePaths` interface (line 27) and constructor (line 48):

In the interface (after `interface: string;`):
```typescript
  guide: string;
```

In the constructor `this.paths = {` block (after `interface: join(...)`):
```typescript
      guide: join(workspaceRoot, "GUIDE.md"),
```

Add `readGuide()` method after `readExperience()` (~line 344):
```typescript
  readGuide(): string | null {
    // 优先群组 workspace，回退 data/ 根目录
    if (existsSync(this.paths.guide)) {
      return readFileSync(this.paths.guide, "utf-8");
    }
    const globalGuide = join("data", "GUIDE.md");
    if (existsSync(globalGuide)) {
      return readFileSync(globalGuide, "utf-8");
    }
    return null;
  }
```

Add `writeGuide()` method:
```typescript
  writeGuide(): void {
    const vars: Record<string, string> = {
      groupName: this.groupName,
    };
    let content = GroupWorkspace.resolveTemplate("GUIDE.md", vars);
    if (!content) {
      content = `# ${this.groupName} 群组规则\n\n## 协作约定\n\n## 工作流约束\n\n## 沟通规范\n`;
    }
    writeFileSync(this.paths.guide, content, "utf-8");
  }
```

- [ ] **Step 3: Initialize GUIDE.md on group creation**

In `initialize()` method (line 68-83), add after the INTERFACE.md initialization:
```typescript
    if (!existsSync(this.paths.guide)) this.writeGuide();
```

- [ ] **Step 4: Verify compilation**

```bash
cd D:\agent-codes\CoBeing && pnpm --filter @cobeing/core exec tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add config/templates/groups/GUIDE.md packages/core/src/group/workspace.ts
git commit -m "feat: add GUIDE.md template and GroupWorkspace guide path

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 2: Inject GUIDE.md into createGroupLoop volatile

**Files:**
- Modify: `packages/core/src/agent/agent.ts:347-376` (createGroupLoop)
- Modify: `packages/core/src/group/workspace.ts` — (if export needed, already done)
- Modify: `packages/core/src/conversation/prompt-builder.ts` — add `buildGroupVolatile` helper parameter

- [ ] **Step 1: Pass GUIDE.md content via snapshot object**

In `agent.ts`, `createGroupLoop` receives `snapshot: { context?: string }`. Extend it to also carry guide content:

Change the method signature (line 348):
```typescript
  private createGroupLoop(toolExecutor: ToolExecutor, groupId: string, snapshot: { context?: string; guideContent?: string }, workingDir?: string): ConversationLoop {
```

In the promptBuilder callback (line 364-373), inject guide content before snapshot.context:

Change:
```typescript
      promptBuilder: () => {
        const { volatile } = buildCacheablePrompt(
          this.files,
          { name: this.name, role: this.config.role, systemPrompt: this.config.systemPrompt },
          undefined,
          snapshot.context,
        );
        const parts = [this._sharedPrefix, GROUP_MECHANICS_NOTICE, this._agentPrefix];
        if (volatile) parts.push(volatile);
        return parts.join("\n\n");
      },
```

To:
```typescript
      promptBuilder: () => {
        let groupCtx = "";
        if (snapshot.guideContent) {
          groupCtx = "## 群组规则\n\n" + snapshot.guideContent.slice(0, 4000) + "\n\n";
        }
        if (snapshot.context) {
          groupCtx += snapshot.context;
        }
        const { volatile } = buildCacheablePrompt(
          this.files,
          { name: this.name, role: this.config.role, systemPrompt: this.config.systemPrompt },
          undefined,
          groupCtx || undefined,
        );
        const parts = [this._sharedPrefix, GROUP_MECHANICS_NOTICE, this._agentPrefix];
        if (volatile) parts.push(volatile);
        return parts.join("\n\n");
      },
```

- [ ] **Step 2: Find caller of createGroupLoop and pass guideContent**

Search for `createGroupLoop(` calls in agent.ts. Pass `guideContent` in the snapshot. Find the `_groupContextSnapshots` usage pattern (~line 379):

```bash
cd D:\agent-codes\CoBeing && grep -n "createGroupLoop\|_groupContextSnapshots" packages/core/src/agent/agent.ts
```

For each snapshot created, add `guideContent` field initialized to `undefined` (populated by the caller that has access to GroupWorkspace).

- [ ] **Step 3: Verify compilation + test**

```bash
cd D:\agent-codes\CoBeing && pnpm --filter @cobeing/core exec tsc --noEmit && pnpm test
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/agent/agent.ts packages/core/src/conversation/prompt-builder.ts
git commit -m "feat: inject GUIDE.md content into createGroupLoop volatile

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 3: Add extractExperienceSummary utility

**Files:**
- Modify: `packages/core/src/conversation/prompt-builder.ts`

- [ ] **Step 1: Add extractExperienceSummary function**

After the `buildStaticLayer()` function block, add:

```typescript
// ---- EXPERIENCE 概要提取 ----

const EXPERIENCE_SUMMARY_START = "<!-- EXPERIENCE_SUMMARY_START -->";
const EXPERIENCE_SUMMARY_END = "<!-- EXPERIENCE_SUMMARY_END -->";

/**
 * 从 EXPERIENCE.md 内容中提取概要区。
 * 有标记 → 返回标记间内容；无标记 → 返回全量内容（兼容旧文件）。
 * 概要超过 maxChars 时倒序截断（保留最新条目）。
 */
export function extractExperienceSummary(content: string, maxChars: number = 1500): string {
  if (!content) return "";

  const startIdx = content.indexOf(EXPERIENCE_SUMMARY_START);
  const endIdx = content.indexOf(EXPERIENCE_SUMMARY_END);

  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    // 无概要标记 → 回退全量（兼容旧 EXPERIENCE.md）
    return content.length > maxChars ? content.slice(0, maxChars) + "..." : content;
  }

  let summary = content.slice(startIdx + EXPERIENCE_SUMMARY_START.length, endIdx).trim();

  if (summary.length <= maxChars) return summary;

  // 倒序截断：保留最新 N 条（概要区每行以 "- [" 开头）
  const lines = summary.split("\n");
  const headerLines: string[] = [];
  const entryLines: string[] = [];
  let inHeader = true;
  for (const line of lines) {
    if (inHeader && line.trim().startsWith("- [")) {
      inHeader = false;
    }
    if (inHeader) {
      headerLines.push(line);
    } else {
      entryLines.push(line);
    }
  }

  // 从后往前取条目行直到接近 maxChars
  const result: string[] = [...headerLines];
  let charCount = headerLines.join("\n").length;
  const reversed: string[] = [];
  for (let i = entryLines.length - 1; i >= 0; i--) {
    const lineLen = entryLines[i].length + 1;
    if (charCount + lineLen > maxChars) break;
    reversed.unshift(entryLines[i]);
    charCount += lineLen;
  }
  result.push(...reversed);

  return result.join("\n");
}

/**
 * 维护 EXPERIENCE.md 的概要区，在概要区最前面插入新行。
 * 若文件无概要标记 → 自动创建标记包裹现有内容。
 */
export function maintainExperienceSummary(filePath: string, summaryLine: string): void {
  const fs = await import("node:fs");
  // ... see Step 2 for synchronous implementation
}
```

Wait — this needs to be synchronous (current codebase uses sync fs). Let me use sync version.

Actually, `maintainExperienceSummary` is called from `appendExperience` which is sync. Let me write the sync version:

```typescript
/**
 * 维护 EXPERIENCE.md 概要区：在概要区最前面插入新摘要行。
 * 若文件无标记 → 自动创建标记包裹现有内容后插入。
 */
export function maintainExperienceSummarySync(content: string, summaryLine: string): string {
  const startIdx = content.indexOf(EXPERIENCE_SUMMARY_START);
  const endIdx = content.indexOf(EXPERIENCE_SUMMARY_END);

  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    // 旧文件无标记 → 创建标记包裹现有内容，再插入新摘要
    const trimmed = content.trim();
    if (!trimmed) {
      return `${EXPERIENCE_SUMMARY_START}\n## 经验概要\n${summaryLine}\n${EXPERIENCE_SUMMARY_END}\n\n## 详细经验\n`;
    }
    return `${EXPERIENCE_SUMMARY_START}\n## 经验概要\n${summaryLine}\n${EXPERIENCE_SUMMARY_END}\n\n${trimmed}`;
  }

  // 在概要区最前面插入新行
  const before = content.slice(0, startIdx + EXPERIENCE_SUMMARY_START.length);
  const middle = content.slice(startIdx + EXPERIENCE_SUMMARY_START.length, endIdx);
  const after = content.slice(endIdx);

  // 找到 ## 经验概要 之后的位置插入
  const lines = middle.split("\n");
  const summaryHeaderIdx = lines.findIndex(l => l.trim().startsWith("## 经验概要"));
  if (summaryHeaderIdx >= 0) {
    lines.splice(summaryHeaderIdx + 1, 0, summaryLine);
  } else {
    lines.unshift(summaryLine);
  }

  return before + lines.join("\n") + after;
}
```

- [ ] **Step 2: Verify compilation**

```bash
cd D:\agent-codes\CoBeing && pnpm --filter @cobeing/core exec tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/conversation/prompt-builder.ts
git commit -m "feat: add extractExperienceSummary + maintainExperienceSummarySync utilities

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 4: Update MemoryStore snapshotForSystemPrompt for experience

**Files:**
- Modify: `packages/core/src/memory/memory-store.ts:236-244` (snapshotForSystemPrompt)
- Modify: `packages/core/src/memory/memory-store.ts:217-233` (formatForSystemPrompt)

- [ ] **Step 1: Update formatForSystemPrompt for experience target**

In `formatForSystemPrompt()` (line 217), for the `experience` target, use `extractExperienceSummary()` instead of the full snapshot content.

Change the method body. Find the logic that builds the block — currently all targets use `this.snapshot[target]`. For experience target, use `extractExperienceSummary()`:

```typescript
  formatForSystemPrompt(target: MemoryTarget): string {
    let content: string;
    if (target === "experience") {
      // EXPERIENCE 目标使用概要注入
      content = extractExperienceSummary(this.snapshot[target], 1500);
    } else {
      content = this.snapshot[target];
    }
    if (!content) return "";

    const limit = this.charLimits[target];
    const usage = this.snapshot[target].length; // 容量统计用实际长度
    const percent = Math.round((usage / limit) * 100);
    const label = {
      memory: "MEMORY (你的个人笔记)",
      experience: "EXPERIENCE (工作经验概要)",
      user: "USER (用户画像)",
      tools: "TOOLS (工具调用策略)",
    }[target];

    const bar = "═".repeat(50);
    return `${bar}\n${label} [${percent}% — ${usage.toLocaleString()}/${limit.toLocaleString()} chars]\n${bar}\n${content}`;
  }
```

Note: import `extractExperienceSummary` from `../conversation/prompt-builder.js` at the top of memory-store.ts.

- [ ] **Step 2: Verify compilation**

```bash
cd D:\agent-codes\CoBeing && pnpm --filter @cobeing/core exec tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/memory/memory-store.ts
git commit -m "feat: use extractExperienceSummary for experience target in MemoryStore

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 5: Update appendExperience to maintain summary

**Files:**
- Modify: `packages/core/src/agent/paths.ts:168-184` (appendExperience)
- Modify: `packages/core/src/group/workspace.ts:399-412` (appendExperience)
- Modify: `packages/core/src/conversation/prompt-builder.ts` — already done in Task 3

- [ ] **Step 1: Update AgentFiles.appendExperience**

Change `appendExperience()` in paths.ts to call `maintainExperienceSummarySync` after writing the detailed entry.

Current code (line 168-184):
```typescript
  appendExperience(entry: { task: string; problem: string; solution: string; date?: string }): void {
    const existing = this.readExperience();
    const date = entry.date ?? new Date().toISOString().split("T")[0];
    const block = [
      "",
      `## [${date}] ${entry.task.slice(0, 80)}`,
      `- **问题**: ${entry.problem}`,
      `- **解决**: ${entry.solution}`,
      "",
    ].join("\n");

    if (!existing) {
      this.writeExperience(`# EXPERIENCE.md\n\n> Agent 在工程过程中积累的经验${block}`);
    } else {
      fs.appendFileSync(this.paths.experiencePath, block + "\n", "utf-8");
    }
  }
```

Replace with:
```typescript
  appendExperience(entry: { task: string; problem: string; solution: string; date?: string }): void {
    const existing = this.readExperience();
    const date = entry.date ?? new Date().toISOString().split("T")[0];
    const block = [
      "",
      `## [${date}] ${entry.task.slice(0, 80)}`,
      `- **问题**: ${entry.problem}`,
      `- **解决**: ${entry.solution}`,
      "",
    ].join("\n");

    const summaryLine = `- [${date}] ${entry.task.slice(0, 100)}`;

    if (!existing) {
      const initial = `# EXPERIENCE.md\n\n> Agent 在工程过程中积累的经验\n\n<!-- EXPERIENCE_SUMMARY_START -->\n## 经验概要\n${summaryLine}\n<!-- EXPERIENCE_SUMMARY_END -->\n\n## 详细经验\n${block}`;
      this.writeExperience(initial);
    } else {
      // 追加详细经验
      fs.appendFileSync(this.paths.experiencePath, block + "\n", "utf-8");
      // 维护概要区
      const full = this.readExperience();
      const updated = maintainExperienceSummarySync(full, summaryLine);
      if (updated !== full) {
        this.writeExperience(updated);
      }
    }
  }
```

Add import at top of paths.ts:
```typescript
import { maintainExperienceSummarySync } from "../conversation/prompt-builder.js";
```

- [ ] **Step 2: Update GroupWorkspace.appendExperience**

Change `appendExperience()` in workspace.ts (line 399-412). After writing the content, also maintain the summary section.

Current code writes directly to the experience file. After the `writeFileSync` call, add summary maintenance:

```typescript
  appendExperience(section: "关键决策" | "协作教训" | "有效模式", entry: string): void {
    let content = this.readExperience() || "";
    const sectionHeader = `## ${section}`;
    const idx = content.indexOf(sectionHeader);
    const timestamp = new Date().toISOString().slice(0, 10);
    const line = `\n- [${timestamp}] ${entry}`;
    
    if (idx >= 0) {
      const afterHeader = idx + sectionHeader.length;
      const nextSection = content.indexOf("\n## ", afterHeader);
      const insertPoint = nextSection >= 0 ? nextSection : content.length;
      content = content.slice(0, insertPoint) + line + content.slice(insertPoint);
    } else {
      // Section header not found, append to end
      content += `\n${sectionHeader}${line}`;
    }
    writeFileSync(this.paths.experience, content, "utf-8");
    
    // 维护概要区
    const summaryLine = `- [${timestamp}] [${section}] ${entry.slice(0, 80)}`;
    const updated = maintainExperienceSummarySync(content, summaryLine);
    if (updated !== content) {
      writeFileSync(this.paths.experience, updated, "utf-8");
    }
  }
```

Add import at top of workspace.ts:
```typescript
import { maintainExperienceSummarySync } from "../conversation/prompt-builder.js";
```

- [ ] **Step 3: Verify compilation**

```bash
cd D:\agent-codes\CoBeing && pnpm --filter @cobeing/core exec tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/agent/paths.ts packages/core/src/group/workspace.ts
git commit -m "feat: maintain EXPERIENCE summary section in appendExperience

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 6: Update EXPERIENCE.md templates + add tests

**Files:**
- Modify: `config/templates/EXPERIENCE.md`
- Modify: `config/templates/groups/EXPERIENCE.md` (if exists)
- Modify: `packages/core/src/conversation/prompt-builder.test.ts`

- [ ] **Step 1: Update EXPERIENCE.md templates**

Update `config/templates/EXPERIENCE.md` — add summary markers:

```markdown
# EXPERIENCE.md — 工作经验

<!-- EXPERIENCE_SUMMARY_START -->
## 经验概要
<!-- EXPERIENCE_SUMMARY_END -->

_记录你在工作中积累的经验和教训。_

## 领域经验

_在你的专业领域中积累的经验。_

- （暂无经验记录）

## 协作经验

_与其他 Agent 协作时积累的经验。_

- （暂无协作经验）

## 教训

_犯过的错误和学到的教训。_

- （暂无）

---

_经验是你最宝贵的财富。每次完成复杂任务后，花一点时间总结。让未来的你不再重复犯错。_
```

Check if `config/templates/groups/EXPERIENCE.md` exists and update similarly if so.

- [ ] **Step 2: Add tests for extractExperienceSummary**

In `prompt-builder.test.ts`, add after the `GROUP_MECHANICS_NOTICE` describe block:

```typescript
describe("extractExperienceSummary", () => {
  it("returns content between summary markers", () => {
    const content = `# EXPERIENCE\n<!-- EXPERIENCE_SUMMARY_START -->\n## 概要\n- [2026-05-25] 测试经验\n<!-- EXPERIENCE_SUMMARY_END -->\n\n## 正文\n详细内容`;
    const result = extractExperienceSummary(content);
    expect(result).toContain("## 概要");
    expect(result).toContain("测试经验");
    expect(result).not.toContain("详细内容");
  });

  it("returns full content when no markers present (backward compat)", () => {
    const content = "# 旧格式 EXPERIENCE\n\n- 没有标记的经验";
    const result = extractExperienceSummary(content);
    expect(result).toContain("旧格式");
  });

  it("returns empty string for empty input", () => {
    expect(extractExperienceSummary("")).toBe("");
  });

  it("truncates from end when over maxChars (keeps newest)", () => {
    const lines: string[] = [];
    for (let i = 1; i <= 50; i++) {
      lines.push(`- [2026-01-${String(i).padStart(2, "0")}] 经验条目 ${i}`);
    }
    const content = `<!-- EXPERIENCE_SUMMARY_START -->\n## 经验概要\n${lines.join("\n")}\n<!-- EXPERIENCE_SUMMARY_END -->`;
    const result = extractExperienceSummary(content, 300);
    // 倒序截断：应包含最新条目（50）而非最早（1）
    expect(result).toContain("经验条目 50");
    expect(result).not.toContain("经验条目 1");
    expect(result.length).toBeLessThanOrEqual(400);
  });
});

describe("maintainExperienceSummarySync", () => {
  it("inserts summary line into file with existing markers", () => {
    const content = `# EXPERIENCE\n<!-- EXPERIENCE_SUMMARY_START -->\n## 经验概要\n- [2026-05-24] 旧经验\n<!-- EXPERIENCE_SUMMARY_END -->\n\n## 详细\n正文`;
    const result = maintainExperienceSummarySync(content, "- [2026-05-25] 新经验");
    expect(result).toContain("新经验");
    expect(result).toContain("旧经验");
    expect(result).toContain("正文");
  });

  it("creates markers when file has no markers", () => {
    const content = "# 没有标记的旧文件\n\n## 正文\n内容";
    const result = maintainExperienceSummarySync(content, "- [2026-05-25] 第一条");
    expect(result).toContain("<!-- EXPERIENCE_SUMMARY_START -->");
    expect(result).toContain("第一条");
    expect(result).toContain("没有标记的旧文件");
  });
});
```

Add import for new functions:
```typescript
import { ..., extractExperienceSummary, maintainExperienceSummarySync } from "./prompt-builder.js";
```

- [ ] **Step 3: Run tests**

```bash
cd D:\agent-codes\CoBeing && pnpm test
```

Expected: 290 + 6 new = 296 pass.

- [ ] **Step 4: Commit**

```bash
git add config/templates/EXPERIENCE.md config/templates/groups/EXPERIENCE.md packages/core/src/conversation/prompt-builder.test.ts
git commit -m "test: add extractExperienceSummary + maintainExperienceSummarySync tests, update templates

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 7: Full build + regression verification

**Files:** No file changes — verification only.

- [ ] **Step 1: Full build**

```bash
cd D:\agent-codes\CoBeing && pnpm build
```

Expected: 6 packages build successfully.

- [ ] **Step 2: Full test suite**

```bash
cd D:\agent-codes\CoBeing && pnpm test
```

Expected: all tests pass (296+).

- [ ] **Step 3: Commit any remaining changes**

```bash
git status
# If clean, no commit needed
```
