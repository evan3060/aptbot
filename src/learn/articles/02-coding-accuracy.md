---
slug: "02-coding-accuracy"
title: "编码准确性：TDD + 版本控制 + UAT 流程"
description: "TDD 红线、Semantic Versioning 与 Keep a Changelog、四类 UAT 核验、封仓收尾与测试基线维护，把 AI 写的代码从能跑提升到可信"
track: ai-coding-practice
chapter: 方法论
order: 15
difficulty: intermediate
estimatedReadingTime: 11
status: published
prerequisites: []
lastUpdated: "2026-07-01"
tags:
  - tdd
  - version-control
  - uat
---

# 编码准确性：TDD + 版本控制 + UAT 流程

上一篇讲流程约束，本篇讲质量保障。AI 写的代码天然有"看起来对"的欺骗性——命名合理、结构整齐、注释齐全，但运行起来才发现引用了不存在的 API、漏掉了边界条件、在未测的路径里埋了 bug。要让代码可信，不能靠"仔细 review"，要靠一套相互嵌套的机制：TDD 守住单元、版本控制守住回退、UAT 守住端到端、测试基线守住不退化。

## TDD 是红线，不是建议

在 AI 辅助开发里，TDD 的地位要从"最佳实践"提升到"红线"。意思是：**严禁跳过测试直接写业务代码**。这条规则没有例外，哪怕"这个函数很简单""这个改动只是改个常量"。

为什么这么硬？因为 AI 的"简单"判断不可信。它会认为"把 timeout 从 30s 改成 60s"很简单，但忽略这个常量同时被流式控制和工具超时共用，改了一处另一处行为变化；它会认为"加个日志打印"很简单，但日志里泄露了敏感字段。TDD 的价值不是"测这个函数对不对"，而是**强制把"行为变化"显式化**——你要改行为，就得先写一个测试描述新行为、看到旧测试 RED、再改代码。

红线意味着工具化执行。superpower 的 test-driven-development skill 会强制 agent 先写测试、运行见证 RED、再写实现。试图跳过会被 skill 拦截。这种工具级强制比"提示词里写一句请用 TDD"可靠得多——提示词是建议，skill 是约束。

## 版本号约定：Semantic Versioning + Keep a Changelog

AI 辅助开发的项目，版本号不是装饰。每次封仓发版，version 必须语义化，CHANGELOG 必须同步更新。

**Semantic Versioning** 的 MAJOR.MINOR.PATCH：

- MAJOR：不兼容的 API 变更。AI 辅助项目里这通常意味着架构层重构。
- MINOR：向后兼容的功能新增。一个迭代周期加入新能力，升 MINOR。
- PATCH：向后兼容的 bug 修复。

**Keep a Changelog** 的格式约定：每个版本条目下分 Added / Changed / Deprecated / Removed / Fixed / Security 六类。AI 写 CHANGELOG 容易犯两个错：一是把所有改动堆在一起无分类，二是写得过于技术细节（"重构了 jsonl 解析器的 buffer 管理"）而忽略用户视角（"修复了大文件解析时的内存峰值"）。CHANGELOG 是给用户看的，不是给 git log 看的。

version 与 CHANGELOG 与 git tag 必须三同步：package.json 的 version 字段、CHANGELOG.md 的条目、`git tag v0.x.y` 的标签，三者缺一不可。封仓时 finishing-a-development-branch skill 会强制检查这三项一致，不一致不允许收尾。

## UAT 核验清单：四类核验

UAT（User Acceptance Testing）不是"跑一遍看看"。是一份结构化清单，分四类核验：

1. **local 核验**：本地开发环境跑通。`npx vitest run` 全量绿、`npx tsc --noEmit` 零错、新功能手动跑一遍核心路径。这是最低门槛。
2. **VPS 核验**：部署到生产环境（或预发）跑通。本地通过不代表 VPS 通过——文件路径差异、Node 版本差异、环境变量缺失、data 目录权限，任何一项都会让 VPS 挂掉。
3. **新功能逐项核验**：按 spec 的验收标准一条条过。spec 里写了"访问 /learn 看到 19 篇文章卡片"，UAT 时就真的访问 /learn 数卡片数。spec 是契约，UAT 是验收，一一对应。
4. **老功能回归核验**：上一版本的能力全部跑一遍。AI 改动时经常"无意中"破坏老功能——比如新增依赖把某个老 API 的行为改了、重构时漏改了一个调用点。回归核验是兜底。

四类核验缺一不可。只做 local 不做 VPS，会在部署日翻车；只做新功能不回归，会在用户反馈里翻车。UAT 清单写成 markdown 文件（比如 `docs/superpowers/plans/0.x.y-uat-checklist.md`），逐项打勾，全部通过才发版。

## finishing-a-development-branch 封仓收尾

封仓不是"提交最后一个 commit"，是一套结构化收尾流程。finishing-a-development-branch skill 定义了封仓检查项：

- 所有 subtask 完成（看板全 `[x]`）
- 测试全绿 + tsc 零错
- CHANGELOG / README / ARCHITECTURE 文档同步
- package.json version 升位
- git tag 创建
- 分支合并方向确认（merge to main / 开 PR）

这套流程的价值是**防止"差不多就发"**。AI 在最后阶段容易松懈——"测试都过了，文档下次再补""tag 等想起来再打"。finishing-a-development-branch 把这些"下次"逼成"现在"，因为每一项都是封仓的硬条件。

文档同步尤其重要。CHANGELOG 不更新，用户不知道这版改了什么；README 不更新，新功能没人知道存在；ARCHITECTURE 不更新，三个月后你自己都忘了为什么引入这层抽象。这三份文档是项目的"对外面孔"和"对内记忆"，封仓时必须与代码同步。

## E2E 测试设计原则

E2E（端到端）测试覆盖 happy path 与 error path，避免 zero expect。

**happy path**：用户最常走的路径，从入口到出口完整跑通。比如"用户访问 /learn → 点击文章卡片 → 看到正文 → 提交反馈 → 收到成功提示"。这条路径任何一个环节断了，核心体验就崩了。

**error path**：异常场景。文章 slug 不存在返回 404、反馈 message 为空返回 400、连续提交触发限流 429、无 auth 访问管理接口返回 401。error path 测试是 AI 最容易漏的——它写代码时默认一切正常，不会主动想到"如果用户输入空字符串会怎样"。

**zero expect 反模式**：测试里只有 `await page.goto(url)` 没有 `expect`。这种测试永远通过，毫无价值。每个测试必须有明确的断言——页面包含某段文字、状态码等于某值、数据库多了一条记录。

E2E 测试贵在维护成本，所以要有取舍。不追求 100% 覆盖，但核心路径 + 关键错误路径必须覆盖。视觉细节（字号、颜色、间距）不写 E2E，留给手动 UAT 或未来视觉回归。

## 测试基线维护：不退化红线

每个版本有一个测试基线数字（比如 v0.2.2 是 936/938 passing）。下一版本的目标是**总数只增不减、通过率不退化**。

不退化红线的含义：

- 不允许删除老测试来"修绿"。测试红了一定是代码坏了，不是测试坏了。
- 不允许 skip 测试来"绕绿"。`it.skip` 是临时手段，封仓前必须恢复。
- 新功能必须配新测试。代码量增加测试量不增加，覆盖率必然下降。
- flaky 测试必须治理。偶发失败的测试比不测试还糟——它让"红"失去警示意义。flaky 要么修、要么隔离、要么删除，不能放着不管。

测试基线在 spec 里写明（"0.2.3 目标：新增约 85-95 项测试，总数达 ~1030-1050"），封仓时核对。未达目标的版本不发，这是给自己的硬约束。

## 小结

编码准确性不是某一项技术，而是四层防线：TDD 守住每个函数、版本控制守住每次回退、UAT 守住每条路径、测试基线守住每个版本。任何一层松懈，AI 写的代码就会从"可信"滑回"看起来对"。

下一篇我们看 spec 文档这条线——一份 spec 从 brainstorming 诞生到归档，全生命周期如何管理。
