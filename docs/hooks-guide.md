# Hooks 指南

aptbot 的 Hook 系统允许你在 agent 主流程的固定时机插入自定义逻辑，例如日志、
指标采集、上下文改写等。Hook 同步执行、可修改上下文（ctx），并以 priority 升序
链式传递。本文档对应实现位于 `src/core/agent/hooks.ts`，设计规范见
`docs/superpowers/specs/2026-06-30-0.2.2-design.md` §4.7。

## 8 个 Hook 点

agent 主循环（`src/core/agent/loop.ts`）在以下 8 个时机触发 hook：

| Hook 点 | 触发时机 | 频率 |
| --- | --- | --- |
| `agent_before` | agent 循环开始前 | 每 session 一次 |
| `agent_after` | agent 循环结束后 | 每 session 一次 |
| `turn_before` | 每个 turn 开始 | 每 turn 一次 |
| `turn_after` | 每个 turn 结束 | 每 turn 一次 |
| `llm_before` | 调用 LLM 前 | 每 turn 一次 |
| `llm_after` | LLM 返回后 | 每 turn 一次 |
| `tool_before` | 工具执行前 | 每次工具调用 |
| `tool_after` | 工具执行后 | 每次工具调用 |

## ctx 结构

每个 hook 点的 ctx 类型不同，定义于 `HookContexts` 接口。所有 ctx 均为普通对象，
**允许 mutate**，并且会**链式传递**：前一个 hook 对 ctx 的修改会被后续 hook 看到，
最终 ctx 也会影响主流程。

| Hook 点 | ctx 字段 |
| --- | --- |
| `agent_before` | `messages` / `systemPrompt` / `session?` |
| `agent_after` | `messages` / `exitReason` / `session?` |
| `turn_before` | `turn` / `messages` / `session?` |
| `turn_after` | `turn` / `response` / `toolCalls` / `session?` |
| `llm_before` | `turn` / `messages` / `provider` |
| `llm_after` | `turn` / `response` / `latencyMs` / `provider` |
| `tool_before` | `toolName` / `args` / `session?` |
| `tool_after` | `toolName` / `args` / `result` / `latencyMs` / `session?` |

其中：

- `messages`：`ContextMessage[]`，当前对话上下文，可在 `*_before` 中改写后影响后续流程。
- `session`：`HookSession`，含只读 `sessionId`，便于关联同一会话的多次 hook。
- `response`：`LLMResponse`，含 `text` / `toolCalls` / `stopReason`，LLM 单次返回摘要。
- `exitReason`：agent 退出原因，取值为 `end_turn` / `max_iterations_exceeded` / `aborted` / `error`。
- `provider`：当前 LLM Provider 实例。
- `result`：`AgentToolResult`，工具执行结果。
- `latencyMs`：耗时（毫秒）。

hook 函数签名约定为 `(ctx) => ctx | void`：返回新对象则替换 ctx，返回 `void`
（或不返回）则保留原 ctx（也可直接在原对象上 mutate）。

## priority 排序规则

- 每个 hook 注册时带一个 `priority` 数值，**默认 100**（`DEFAULT_HOOK_PRIORITY`）。
- 同一 hook 点的所有回调按 **priority 升序** 排列：**值小的先执行**。
- 当多个 hook 的 priority 相同时，按**注册顺序**（先注册先执行）执行。
- ctx 修改不可逆：一旦某个 hook 改写了 ctx，链式传递下去不会被回滚。

## 异常吞掉策略

Hook 系统**绝不影响主流程的稳定性**：

- hook 回调抛出的任何异常都会被 `trigger` 捕获并吞掉。
- 异常信息通过 `console.error` 打印到 **stderr**，格式为
  `[hooks] <event> callback error:` + 错误对象。
- 异常发生后，当前 hook 对 ctx 的修改会被丢弃（因为该 hook 没有正常返回），
  但**后续 hook 与主流程照常继续**。
- 因此 hook 必须快速返回（同步执行、不阻塞），且开发者需自行保证 hook 内部
  逻辑的健壮性——系统没有超时限制。

## 两层目录加载

Hook 插件以文件形式存放，由 `HookRegistry.discoverAndLoad` 在两个目录中扫描加载：

| 层级 | 路径 | 说明 |
| --- | --- | --- |
| workspace | `~/.aptbot/hooks/` | 用户自定义 hook（高优先级） |
| builtin | `.agents/hooks/` | 内置 hook（低优先级） |

加载规则：

1. **builtin 先加载，workspace 后加载**。
2. **同名文件 workspace 覆盖 builtin**：当两层出现同名文件时，仅加载 workspace
   版本（builtin 同名文件被忽略）。
3. 文件名以 `_` 开头的会被跳过；只加载扩展名匹配 `.[mc]?[jt]s`` 的文件
   （`.js` / `.cjs` / `.mjs` / `.ts` / `.mts` / `.cts`）。
4. 文件按文件名升序排序后依次加载。
5. 单个插件文件加载失败（import 抛错）会被吞掉，打印
   `[hooks] plugin '<file>' load failed:` 到 stderr，不影响其它插件。
6. **无沙箱**：hook 文件作为 Node.js 模块加载，可直接访问 Node.js API，拥有完全
   权限，安全性由开发者保证。workspace 层目录建议仅 owner 可写。

## 示例 Hook 文件

以下示例与 `~/.aptbot/hooks/01-log-turn.js` 一致，在每个 turn 开始/结束向 stderr
打印一行日志，priority 为 10（先于默认 100 执行）：

```js
// Example hook plugin: logs each turn start/end to stderr.
// CommonJS module; exports an object with priority + hook point handlers.
module.exports = {
  priority: 10,
  turn_before() {
    process.stderr.write('[hook] turn starting\n');
  },
  turn_after() {
    process.stderr.write('[hook] turn ended\n');
  },
};
```

文件名前缀 `01-` 用于控制加载顺序（按文件名升序加载），`priority` 字段控制同一
hook 点内多个回调的执行顺序。两者结合即可精确编排 hook 的执行先后。
