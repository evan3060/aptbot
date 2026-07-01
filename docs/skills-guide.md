# Skills 指南

Skills 系统让 aptbot 能够按需加载独立的技能指令（markdown 文档），并通过 L1 索引
将技能元信息注入系统提示，由模型自行决定何时读取完整内容。本文档对应实现位于
`src/core/skills/`，设计规范见 `docs/superpowers/specs/2026-06-30-0.2.2-design.md`
§4.8 与 §4.9。

## SKILL.md frontmatter 规范

每个 skill 是一个目录，内含一个 `SKILL.md` 文件，路径形如
`<skills-root>/<skill-name>/SKILL.md`。文件以 YAML frontmatter（用 `---` 分隔）
开头，紧跟 markdown body：

```
---
name: my-skill
description: 简短描述
disableModelInvocation: false
---

# Markdown body
```

frontmatter 字段规范：

| 字段 | 必填 | 校验规则 |
| --- | --- | --- |
| `name` | 否（缺省时取父目录名） | 仅 `a-z0-9-`，长度 ≤ 64 字符；不能以 `-` 开头/结尾；不能出现连续 `--` |
| `description` | 是 | 非空，长度 ≤ 1024 字符 |
| `disableModelInvocation` | 否 | 布尔值 `true` / `false`；为 `true` 时不注入系统提示，但仍可显式调用 |
| `tags` | 否 | 数组语法 `tags: [a, b, c]`，手写标签，用于 L1 索引展示 |

frontmatter 解析由 `parseFrontmatter` 实现，不依赖外部 YAML 库；支持双引号或单引号
包裹的值，布尔值会转换为 `boolean`。

## 校验规则与 SkillDiagnostic

加载过程**不抛错**，所有问题以 `SkillDiagnostic`（`type: 'warning'`）形式返回：

- `read_failed`：读取 `SKILL.md` 失败。
- `parse_failed`：frontmatter 解析失败（缺少开头 `---`、缺少闭合 `---` 等）。
- `invalid_metadata`：`name` 不符合校验规则，或 `description` 为空/超长。
- `file_info_failed` / `list_failed`：目录列举或文件 stat 失败（`not_found` 不报错）。

**解析失败的 skill 会被跳过**（不进入 skills 列表），但其 warning 会保留在
`LoadSkillsResult.diagnostics` 中，供上层按需展示。skill 目录不存在时返回空列表，
不报错。

`name` 校验规则（`validateSkillName`）：

- 非空且长度 ≤ 64；
- 仅匹配 `[a-z0-9-]+`；
- 不以 `-` 开头或结尾；
- 不包含连续 `--`。

`description` 校验规则（`validateSkillDescription`）：非空且长度 ≤ 1024 字符。

## 两层加载

`loadSkills` 在两个目录中扫描，**workspace 覆盖 builtin 同名**：

| 层级 | 路径 | 说明 |
| --- | --- | --- |
| workspace | `~/.aptbot/skills/` | 用户自定义 skill（高优先级） |
| builtin | `src/skills/` | 内置 skill（低优先级） |

加载规则：

1. dirs 数组**逆序遍历**：builtin 先入 map，workspace 后入覆盖（保证 workspace 优先）。
2. 每层仅扫描**单层**子目录中的 `SKILL.md`（不递归子目录的子目录）。
3. 同名 skill 覆盖时记录 info 日志：`skill "<name>" overridden by <path>`。
4. 子目录无 `SKILL.md` 时跳过（非错误）；目录不存在时返回空列表。
5. skill 加载**仅解析 frontmatter，不执行任何代码**。

## L1 索引字段

加载完成的 `Skill` 对象除 frontmatter 字段外，还携带 L1 索引元信息（加载时计算，
热重载时重新计算）：

| 字段 | 说明 |
| --- | --- |
| `contentLines` | body 按行分割后的行数（含末尾空串，对齐 `body.split('\n').length`） |
| `contentBytes` | body 的 UTF-8 字节数 |
| `tags` | 手写标签（来自 frontmatter，自动生成留待后续） |
| `lastUsed` | 最近使用时间戳（ms），由 `read_file` 工具特判维护，初始为 `undefined` |

## 4K token 预算截断策略

`formatSkillsForSystemPrompt` 将 L1 索引注入系统提示，规则如下：

1. 过滤掉 `disableModelInvocation === true` 的 skill。
2. 按 `lastUsed` **降序**排列（最近使用的在前；`undefined` 按 0 处理，排最后）。
3. token 估算采用 `chars / 4`（`MAX_INDEX_TOKENS = 4000`，不引入 tiktoken 依赖）。
4. 顺序累积 token：未超 4K 预算的进入**完整条目列表**；超限的降级为**仅名字列表**。
5. **边界条件**：第一个 skill（`lastUsed` 最高）即使单个就超 4K 预算，仍作为完整
   条目注入；后续 skill 仅在预算内才注入完整条目，否则进入名字列表。
6. 名字列表以 `Additional skills (read SKILL.md for details): a, b, c` 形式附在完整
   条目之后，保证 agent 至少知道有哪些 skill 存在。
7. 0 个可见 skill 时返回空字符串。

每条 L1 索引行格式为：

```
- **name** — desc (N行/M字节) [tag1,tag2]  `path`
```

## read_file 特判更新 lastUsed

`SkillState.markUsed(filePath)` 用于在 `read_file` 工具读取 skill 文件时特判更新
`lastUsed`：

- `read_file` 读取的路径命中某个 skill 的 `filePath` 时，调用 `markUsed`，将该 skill
  的 `lastUsed` 设为 `Date.now()`。
- `lastUsed` 的更新会触发 L1 索引重排序（下次生成系统提示时按新 `lastUsed` 降序），
  使最近用过的 skill 排到前面，更易被模型再次选中。
- **跨 reload 保留**：热重载（`SkillState.reload()`）时按 `name` 合并旧 skill 的
  `lastUsed`，使其持续累积。
- **跨进程重启不保留**：MVP 阶段 `lastUsed` 为内存态，不持久化到文件，进程重启后
  重置为 `undefined`。
- 特判仅对 skill 文件生效，读取普通文件不会更新 `lastUsed`。

## 显式调用

除模型自主读取外，skill 也可被显式调用：`formatSkillInvocation` 将 skill content
包装为 `<skill name="..." location="...">` XML 块注入对话，可附加额外指令。
`disableModelInvocation` 仅控制是否进入 L1 索引（系统提示），不影响显式调用。

## 示例 SKILL.md

以下示例与 `~/.aptbot/skills/example/SKILL.md` 一致，演示最小 frontmatter 与
body 结构：

```
---
name: example
description: An example skill for testing the Skills system
disableModelInvocation: false
---

# Example Skill

This is an example skill used for testing the Skills system.

It demonstrates the expected `SKILL.md` frontmatter format (name /
description / disableModelInvocation) together with a minimal markdown body.
Use it as a template when authoring your own skills under
`~/.aptbot/skills/<skill-name>/SKILL.md`.
```

将上述文件放到 `~/.aptbot/skills/example/SKILL.md` 即可被加载；如需新增自己的 skill，
复制该目录结构并修改 frontmatter 与 body 即可。
