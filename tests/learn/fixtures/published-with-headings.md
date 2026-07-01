---
slug: published-with-headings
title: 含标题与代码块的已发布文章
description: 用于验证 marked 自定义 renderer 的渲染产物（h2/h3 id、pre data-language）。
track: agent-practice
chapter: 渲染测试
order: 1
difficulty: beginner
estimatedReadingTime: 5
status: published
prerequisites: []
lastUpdated: "2026-07-01"
tags: [rendering]
---

# 已发布文章正文

## Hello World

这是第一段正文，需要超过 100 字符以满足 published 文章的最低长度要求。这里继续补充内容，确保字符数达标，避免触发短正文警告。

### Sub Section Title

子章节用于验证 h3 也会获得 id 属性。

```typescript
const answer = 42;
console.log(answer);
```

```bash
echo hello
```
