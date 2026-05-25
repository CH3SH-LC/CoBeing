const fs = require("fs");

const filePath = process.argv[2];
let content = fs.readFileSync(filePath, "utf-8");

// Replace group section - add group-db.ts and compressed-history.ts
const oldGroupSection =
  "│   │   ├── group-context-v2.ts      #     GroupContextV2 tag-based 消息管理\n" +
  "│   │   ├── manager.ts               #     GroupManager 群组生命周期";

const newGroupSection =
  "│   │   ├── group-context-v2.ts      #     GroupContextV2 tag-based 消息管理\n" +
  "│   │   ├── group-db.ts              #     GroupDB 主库 (messages/visibility/compression_marks)\n" +
  "│   │   ├── compressed-history.ts    #     CompressedHistory 每 Agent 压缩历史\n" +
  "│   │   ├── manager.ts               #     GroupManager 群组生命周期";

if (content.includes(oldGroupSection)) {
  content = content.replace(oldGroupSection, newGroupSection);
  console.log("✓ Updated group section");
} else {
  console.log("✗ Failed: group section not found");
}

// Add summarize-phase.ts to tools section
const oldToolsSection =
  "│   │   ├── group-memory-search.ts   #     group-memory-search — 群组记忆搜索\n" +
  "│   │   └── skill-tools.ts           #     技能统一工具 (skill-execute/list/create)";

const newToolsSection =
  "│   │   ├── group-memory-search.ts   #     group-memory-search — 群组记忆搜索\n" +
  "│   │   ├── summarize-phase.ts       #     summarize-phase — 阶段总结压缩\n" +
  "│   │   └── skill-tools.ts           #     技能统一工具 (skill-execute/list/create)";

if (content.includes(oldToolsSection)) {
  content = content.replace(oldToolsSection, newToolsSection);
  console.log("✓ Updated tools section");
} else {
  console.log("✗ Failed: tools section not found");
}

// Update docs/superpowers/plans
const oldPlansSection =
  "│   │   ├── 2026-04-25-sandbox-phase2.md\n" +
  "│   │   └── specs/";

const newPlansSection =
  "│   │   ├── 2026-04-25-sandbox-phase2.md\n" +
  "│   │   ├── 2026-04-30-group-memory-three-layer.md\n" +
  "│   │   └── specs/";

if (content.includes(oldPlansSection)) {
  content = content.replace(oldPlansSection, newPlansSection);
  console.log("✓ Updated plans section");
} else {
  console.log("✗ Failed: plans section not found");
}

// Update docs/superpowers/specs
const oldSpecsSection =
  "│   │   ├── 2026-04-25-sandbox-phase2-design.md\n" +
  "│   │   └── archive/";

const newSpecsSection =
  "│   │   ├── 2026-04-25-sandbox-phase2-design.md\n" +
  "│   │   ├── 2026-04-30-group-memory-three-layer-design.md\n" +
  "│   │   ├── 2026-04-30-activity-log-design.md\n" +
  "│   │   └── archive/";

if (content.includes(oldSpecsSection)) {
  content = content.replace(oldSpecsSection, newSpecsSection);
  console.log("✓ Updated specs section");
} else {
  console.log("✗ Failed: specs section not found");
}

// Update test listing
const oldTestListing = "ContainerPool      — 4 tests";
const newTestListing = "ContainerPool      — 4 tests\nThreeLayerMemory   — 10 tests";

if (content.includes(oldTestListing)) {
  content = content.replace(oldTestListing, newTestListing);
  console.log("✓ Updated test listing");
} else {
  console.log("✗ Failed: test listing not found");
}

fs.writeFileSync(filePath, content, "utf-8");
console.log("Done");
