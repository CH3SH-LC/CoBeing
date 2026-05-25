# Markdown 渲染 + 代码高亮设计

日期: 2026-04-20
状态: 已通过

## 概述

在聊天消息中集成 Markdown 渲染，支持 GFM 语法（标题、列表、表格、链接等）和代码块语法高亮。代码块包含语言标签和复制按钮。

## 技术方案

使用已安装的 `react-markdown` + `remark-gfm` + `rehype-highlight`，创建两个组件：

- **`MarkdownContent`** — 封装 react-markdown，渲染内联 Markdown，代码块委托给 CodeBlock
- **`CodeBlock`** — 深色背景代码块，顶部栏含语言标签 + 复制按钮

## 代码块设计

```
┌─ python ──────────────────── [复制] ┐
│  def hello():                        │
│      print("Hello, World!")          │
└──────────────────────────────────────┘
```

- 复制按钮点击后显示 ✓，2s 后恢复
- 使用 highlight.js atom-one-dark 主题

## 文件变更

| 操作 | 文件 | 职责 |
|------|------|------|
| 创建 | `src/components/shared/CodeBlock.tsx` | 代码块组件 |
| 创建 | `src/components/shared/MarkdownContent.tsx` | Markdown 渲染器 |
| 修改 | `src/components/chat/ChatView.tsx` | 替换纯文本为 MarkdownContent |
| 修改 | `src/styles/globals.css` | 添加 highlight.js 主题样式 |
