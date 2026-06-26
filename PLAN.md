# aptbot MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建 aptbot MVP —— 个人学习/工作助手 agent，支持 CLI + WebUI 双入口，单模型 ReAct 循环，4 个基础工具（bash/read/edit/update_working_memory）与会话短期记忆持久化。

**Architecture:** 自底向上四层：基建层（Config/Persistence/Logger/SignalHandler）→ 核心层（Provider/Tools/Memory/AgentLoop）→ 总线层（MessageBus/ChannelManager）→ 接入层（CLI/WebUI/Channel）。每层仅依赖其下层；同层模块通过明确接口协作；核心层不感知接入层存在。

**Tech Stack:** TypeScript (strict) / Node.js >= 20 / vitest / zod / pino / async-mutex / tiktoken / Ink (CLI) / Lit + Web Components (WebUI) / WebSocket / Caddy (TLS 反代)

## Global Constraints

- **Language:** TypeScript (strict mode), Node.js >= 20，ESM (`"type": "module"`)
- **Test framework:** vitest（globals + node environment，testTimeout 10000ms）
- **Provider boundaries (§10.1.5, §10.3):** TTFB 5000ms、chunk 间隔 1500ms 双时钟控制器；5xx/429 指数退避 1s/2s/4s 最多 3 次；401/403/400 分类为 fatal 不重试；ECONNRESET/ETIMEDOUT 走重试
- **Tool boundaries (§10.1.2, §10.3):** bash 30s 硬超时 SIGTERM→2s→SIGKILL；read >2MB 返回 `file_too_large`，5s 超时；edit per-filePath mutex，5s 超时，old_string 不唯一拒绝；AbortSignal 500ms 内返回 `aborted`
- **Memory boundaries (§10.1.1, §10.11):** JSONL UTF-8 无 BOM、LF 换行、trailing newline；增量流式解析 + 破损容错；`fs.truncateSync` 自动修复；per-sessionId mutex 锁超时 5s；Compaction LLM 失败跳过本轮保留旧 entries
- **Resource limits (§10.2):** Node 512MB（systemd `MemoryMax=512M`），长跑 24h RSS 增长 ≤ 50MB；JSONL 50MB/session（100MB 硬上限）；WS 50 connections；bash 10 并发；入站消息 64KB content + 5MB media；入站频率 10 条/秒；InboundMessage 队列 100；Dispatch 死信队列 100；Steering 队列 5/session
- **Invariants (§10.4):** Event FIFO（单 channel 内严格按生成顺序）；SessionEntry append-only；Working Memory 单调覆盖；JSONL 行完整性（`JSON.stringify` + `\n`）；`tool_call_id` 全局唯一（`crypto.randomUUID()`）；turn 原子性（错误响应不持久化）
- **Token (§10.5):** 优先 `tiktoken` → provider usage 字段 → `chars/4` 降级 + warn；Compaction 触发阈值 80%，目标 30%，LLM maxTokens 2048
- **AbortSignal 传播 (§10.9):** Provider 100ms / Tool 500ms / Memory 50ms / AgentSession 200ms
- **Timestamp (§10.10):** ms 精度，UTC 存储，字段名 `timestamp: number`
- **Path (§10.12):** Session JSONL 路径 `./sessions/<sessionId>.jsonl`，sessionId 为 UUID，正则 `/^[a-f0-9-]{36}$/` 校验，路径上限 255 字符
- **Process signals (§10.13):** SIGINT 10s 超时，SIGTERM 30s 超时，SIGHUP 忽略（MVP），子进程 SIGKILL 清理
- **Process exceptions (§10.14):** `uncaughtException` exit(1)；`unhandledRejection` 记录不退出；RSS 超 450MB warn；单 turn 5min warn / 10min abort
- **Logger (§10.7):** pino 异步写入，stdout + `logs/aptbot.log`，10MB rotation 保留 5 份，apiKey/token 脱敏
- **Config (§10.8):** `./config/aptbot.json`（或 `APTBOT_CONFIG` 覆盖），zod 校验，env var > config file > 默认值，校验失败 exit(1)
- **All tasks MUST follow TDD:** 编写失败测试 → 验证失败 → 实现 → 验证通过 → 提交
- **Each task ends with:** `npm run test -- <path>` 返回 Exit Code = 0
- **本文件是图纸而非代码堆:** 具体函数体、业务逻辑与测试代码刻意省略 —— 它们在 TDD 阶段由测试报错驱动现场编写。此处仅记录文件路径、设计契约（Interface/Types）、行为描述与验证命令。

---

## Phase 0: Project Initialization

### Task 1: Initialize package.json and directory structure

**Files:**
- Create: `package.json`
- Create: `src/.gitkeep`
- Create: `tests/.gitkeep`

**Design Contracts:**
- `package.json` scripts: `test` (`vitest run`), `test:watch` (`vitest`), `build` (`tsc`), `dev` (`tsx src/server.ts`)
- `engines`: `{ "node": ">=20" }`, `"type": "module"`, `"private": true`

**Behavior:** 初始化 ESM 模块类型的 npm 项目并配置上述四个 scripts。脚手架目录树：`src/{infrastructure,core/provider/api,core/provider/providers,core/tool/tools,core/memory,core/agent,bus,cli,webui,shared/commands,shared/ui-state} tests/{infrastructure,core,bus,access,e2e}`。

**TDD Cycle:**
- [x] 创建 `package.json` 与目录骨架
- [x] 验证：`npm run` 列出 scripts 且包含 test/build/dev
- [x] 提交：`chore: initialize project structure`

### Task 2: Configure TypeScript with strict mode

**Files:**
- Create: `tsconfig.json`
- Create: `tsconfig.test.json`

**Design Contracts:**
- `tsconfig.json`: `strict: true`, `target: ES2022`, `module: ESNext`, `moduleResolution: bundler`, `rootDir: ./src`, `outDir: ./dist`
- `tsconfig.test.json`: extends base, `rootDir: .`, includes `src/**/*` and `tests/**/*`, adds `vitest/globals` to types

**Behavior:** 为 src 配置严格模式 TS；测试配置继承基础配置并纳入测试目录。

**TDD Cycle:**
- [x] 创建两个 tsconfig 文件
- [x] 验证：`npx tsc --noEmit -p tsconfig.test.json` 退出码为 0
- [x] 提交：`chore: configure TypeScript strict mode`

### Task 3: Setup vitest with first smoke test

**Files:**
- Create: `vitest.config.ts`
- Create: `tests/smoke.spec.ts`
- Modify: `package.json` (devDependencies: `vitest`, `@types/node`, `tsx`)

**Design Contracts:**
- `vitest.config.ts`: `globals: true`, `environment: 'node'`, `include: ['tests/**/*.spec.ts']`, `testTimeout: 10000`

**Behavior:** Vitest 配置 + 一个最小冒烟测试（`expect(1 + 1).toBe(2)`）确认测试框架可用。

**TDD Cycle:**
- [x] 在 `tests/smoke.spec.ts` 编写失败冒烟测试
- [x] 安装依赖：`npm install -D vitest @types/node tsx`
- [x] 验证通过：`npm run test -- tests/smoke.spec.ts` → 1 test passed, Exit Code 0
- [x] 提交：`chore: setup vitest with smoke test`

---

## Phase 1: Infrastructure Layer

### Task 4: Logger system with rotation and masking (§10.7)

**Files:**
- Create: `src/infrastructure/logger.ts`
- Test: `tests/infrastructure/logger.spec.ts`

**Design Contracts:**

```typescript
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  readonly scope: string;
  trace(msg: string, ...args: unknown[]): void;
  debug(msg: string, ...args: unknown[]): void;
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
  child(scope: string): Logger;
}

export function createLogger(scope: string, threshold?: LogLevel): Logger;
export function maskSecret(value: string): string;
```

**Produces:** `createLogger`, `Logger`, `LogLevel`, `maskSecret`

**Behavior:** §10.7 边界。基于 `pino` 异步写入；stdout + `logs/aptbot.log` 双输出；10MB rotation 保留 5 份（`aptbot.log.1` ~ `aptbot.log.5`）；`maskSecret` 将 `aptbot_xxx` 形态的 token / apiKey 替换为 `aptbot_***`；`LOG_LEVEL` 环境变量切换阈值，默认 info；结构化 JSON 行（`{ts, level, scope, msg, ...props}`）。

**TDD Cycle:**
- [x] 编写失败测试覆盖：scope 保留、`maskSecret('aptbot_abc123')` 返回 `aptbot_***`、level 阈值过滤、child logger 继承 threshold
- [x] 验证失败：`npm run test -- tests/infrastructure/logger.spec.ts` → FAIL（module not found）
- [x] 安装：`npm install pino pino-rolling`
- [x] 实现
- [x] 验证通过：Exit Code 0
- [x] 提交：`feat: add logger with rotation and secret masking (§10.7)`

### Task 5: Config types and zod schema (§10.8)

**Files:**
- Create: `src/infrastructure/config-types.ts`
- Test: `tests/infrastructure/config-types.spec.ts`

**Design Contracts:**

```typescript
export type Api = 'anthropic-messages' | 'openai-responses' | 'openai-completions';

export interface ModelConfig {
  readonly id: string;
  readonly api: Api;
  readonly contextWindow: number;
  readonly maxTokens: number;
}

export interface ProviderConfig {
  readonly id: string;
  readonly name: string;
  readonly baseUrl?: string;
  readonly auth: { apiKey?: string; envVar?: string };
  readonly models: ModelConfig[];
}

export interface AptbotConfig {
  readonly providers: ProviderConfig[];
  readonly defaultModel: string;
  readonly dataDir: string;
  readonly deploy: 'local' | 'cf';
}

export const configSchema: z.ZodType<AptbotConfig>;
export const defaultConfig: AptbotConfig;
export function validateConfig(config: unknown): { success: true; data: AptbotConfig } | { success: false; errors: string[] };
```

**Produces:** `AptbotConfig`, `ProviderConfig`, `ModelConfig`, `configSchema`, `defaultConfig`, `validateConfig`

**Behavior:** §10.8 边界。zod schema 校验：providers 至少 1 个、defaultModel 必填、每个 provider 必须有 id+name+auth、每个 model 必须有 id+api+contextWindow+maxTokens。`validateConfig` 返回 discriminated union，错误时聚合所有 zod issues 为字符串数组。`defaultConfig` 提供可用的 Anthropic 基线配置（`dataDir: './data'`，`deploy: 'local'`）。

**TDD Cycle:**
- [x] 编写失败测试覆盖：defaultConfig 含 providers 且合法、合法 config 通过、空 providers 被拒绝、缺失 defaultModel 被拒绝、无效 api 值被拒绝
- [x] 验证失败：`npm run test -- tests/infrastructure/config-types.spec.ts` → FAIL
- [x] 安装：`npm install zod`
- [x] 实现
- [x] 验证通过：Exit Code 0
- [x] 提交：`feat: add config types and zod schema validation (§10.8)`

### Task 6: Config file loader with env var priority (§10.8)

**Files:**
- Create: `src/infrastructure/config-loader.ts`
- Test: `tests/infrastructure/config-loader.spec.ts`

**Design Contracts:**

```typescript
export function loadConfig(path?: string): Promise<AptbotConfig>;
export function resolveApiKey(provider: ProviderConfig): string | undefined;
export const DEFAULT_CONFIG_PATH = './config/aptbot.json';
```

**Consumes:** `AptbotConfig`, `ProviderConfig`, `validateConfig`, `defaultConfig` from Task 5

**Behavior:** §10.8 边界。`loadConfig` 优先读取 `APTBOT_CONFIG` 环境变量作为路径，否则用 `DEFAULT_CONFIG_PATH`。读取 JSON → `validateConfig` 校验 → 与 `defaultConfig` 浅合并 → 返回。文件缺失、JSON 非法或校验失败时抛错并打印 stderr 退出码 1。`resolveApiKey` 实现优先级：`provider.auth.apiKey` → `process.env[provider.auth.envVar]` → undefined。

**TDD Cycle:**
- [x] 编写失败测试覆盖：加载合法 JSON、`APTBOT_CONFIG` 覆盖路径、文件缺失抛错、JSON 非法抛错、校验失败抛错、`resolveApiKey` 优先 envVar
- [x] 验证失败：`npm run test -- tests/infrastructure/config-loader.spec.ts` → FAIL
- [x] 实现
- [x] 验证通过：Exit Code 0
- [x] 提交：`feat: add config loader with env var priority (§10.8)`

### Task 7: JSONL basic append and read with encoding constraints (§10.11)

**Files:**
- Create: `src/infrastructure/jsonl.ts`
- Test: `tests/infrastructure/jsonl.spec.ts`

**Design Contracts:**

```typescript
export function appendJsonl(path: string, entry: unknown): Promise<void>;
export function readJsonl(path: string): Promise<unknown[]>;
```

**Produces:** `appendJsonl`, `readJsonl`

**Behavior:** §10.11 边界。`appendJsonl` 将 entry 用 `JSON.stringify` 序列化 + `\n`（LF），首次写入时 `mkdirp` 递归创建目录（权限 0o755），文件编码 UTF-8 无 BOM，文件末尾保持 trailing newline。`readJsonl` 对不存在的文件返回 `[]`，逐行解析非空行。

**TDD Cycle:**
- [x] 编写失败测试覆盖：追加后读回往返、不存在的文件返回空数组、文件末尾有 `\n`、目录自动创建
- [x] 验证失败：`npm run test -- tests/infrastructure/jsonl.spec.ts` → FAIL
- [x] 实现
- [x] 验证通过：Exit Code 0
- [x] 提交：`feat: add JSONL append/read with encoding constraints (§10.11)`

### Task 8: JSONL corruption-tolerant streaming parse (§10.1.1)

**Files:**
- Modify: `src/infrastructure/jsonl.ts`
- Test: `tests/infrastructure/jsonl-corruption.spec.ts`

**Design Contracts:**

```typescript
export interface JsonlReadResult {
  entries: unknown[];
  skipped: number;
}
export function readJsonlTolerant(path: string): Promise<JsonlReadResult>;
```

**Consumes:** `appendJsonl` from Task 7

**Behavior:** §10.1.1 边界。逐行解析；`JSON.parse` 失败时递增 `skipped` 并继续（不抛错）。返回合法 entries + 跳过的破损行计数。处理空文件（`skipped: 0`）与全破损文件（`entries: []`, `skipped: N`）。完全损坏时由调用方决定备份策略。

**TDD Cycle:**
- [x] 编写失败测试覆盖：跳过破损尾部残行（返回 2 条合法 + skipped 1）、空文件、全破损文件、中间行破损
- [x] 验证失败：`npm run test -- tests/infrastructure/jsonl-corruption.spec.ts` → FAIL（`readJsonlTolerant` not exported）
- [x] 实现
- [x] 验证通过：Exit Code 0
- [x] 提交：`feat: add JSONL corruption-tolerant streaming parse (§10.1.1)`

### Task 9: JSONL auto-truncate repair (§10.1.1)

**Files:**
- Modify: `src/infrastructure/jsonl.ts`
- Test: `tests/infrastructure/jsonl-truncate.spec.ts`

**Design Contracts:**

```typescript
export interface JsonlRepairResult {
  truncated: boolean;
  bytesRemoved: number;
  backedUp?: string;
}
export function repairJsonl(path: string): Promise<JsonlRepairResult>;
```

**Consumes:** `readJsonlTolerant` from Task 8

**Behavior:** §10.1.1 边界。若 `readJsonlTolerant` 报告 `skipped > 0`，则重写文件仅保留合法行（使用 `fs.truncateSync` + `writeFileSync` 截断破损尾部数据）。返回 `{ truncated: true, bytesRemoved: N }`。对已合法的文件为 no-op（`truncated: false`）。完全损坏时备份原文件到 `<path>.corrupt.bak` 后返回空文件。

**TDD Cycle:**
- [x] 编写失败测试覆盖：截断破损尾部数据（文件变为 2 条合法 entries）、合法文件 no-op、完全损坏备份 `.corrupt.bak`
- [x] 验证失败：`npm run test -- tests/infrastructure/jsonl-truncate.spec.ts` → FAIL
- [x] 实现
- [x] 验证通过：Exit Code 0
- [x] 提交：`feat: add JSONL auto-truncate repair via fs.truncateSync (§10.1.1)`

### Task 10: JSONL per-session mutex (§10.1.1)

**Files:**
- Create: `src/infrastructure/jsonl-mutex.ts`
- Test: `tests/infrastructure/jsonl-mutex.spec.ts`

**Design Contracts:**

```typescript
import type { Mutex } from 'async-mutex';

export function getJsonlMutex(sessionId: string): Mutex;
export function withJsonlLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T>;
export const JSONL_LOCK_TIMEOUT_MS = 5000;
```

**Produces:** `getJsonlMutex`, `withJsonlLock`, `JSONL_LOCK_TIMEOUT_MS`

**Behavior:** §10.1.1 边界。per-sessionId mutex 保证并发写入串行化。`withJsonlLock` 在 5000ms 内未获取锁则 reject 并发 `error` 事件。Mutex 实例缓存到 Map，session 结束后由调用方清理。

**TDD Cycle:**
- [x] 编写失败测试覆盖：同 sessionId 串行化、不同 sessionId 并行、锁超时 5s 抛错
- [x] 验证失败：`npm run test -- tests/infrastructure/jsonl-mutex.spec.ts` → FAIL
- [x] 安装：`npm install async-mutex`
- [x] 实现
- [x] 验证通过：Exit Code 0
- [x] 提交：`feat: add per-sessionId JSONL mutex with 5s timeout (§10.1.1)`

### Task 11: AgentMessage and content block types

**Files:**
- Create: `src/core/memory/agent-message.ts`
- Test: `tests/core/memory/agent-message.spec.ts`

**Design Contracts:**

```typescript
export type MessageRole = 'user' | 'assistant' | 'tool';

export interface TextContent { type: 'text'; text: string; }
export interface ImageContent { type: 'image'; source: { type: 'base64'; mediaType: string; data: string }; }
export type ContentBlock = TextContent | ImageContent;

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface AgentMessage {
  id: string;
  role: MessageRole;
  content: string | ContentBlock[];
  toolCallId?: string;
  toolCalls?: ToolCall[];
  stopReason?: string;
  timestamp: number;
}

export function createMessage(role: MessageRole, content: string | ContentBlock[]): AgentMessage;
```

**Produces:** `AgentMessage`, `MessageRole`, `ContentBlock`, `ToolCall`, `createMessage`

**Behavior:** 持久化层 AgentMessage 与 LLM ContextMessage 分离（§3.5）。`createMessage` 自动生成 `id`（`crypto.randomUUID()`）与 `timestamp`（`Date.now()`）。

**TDD Cycle:**
- [x] 编写失败测试覆盖：`createMessage` 生成 UUID、timestamp 为 ms 整数、role 保留、content 字符串与块数组都支持
- [x] 验证失败：`npm run test -- tests/core/memory/agent-message.spec.ts` → FAIL
- [x] 实现
- [x] 验证通过：Exit Code 0
- [x] 提交：`feat: add AgentMessage and content block types`

### Task 12: SessionEntry types and path resolver (§6.2, §10.10, §10.12)

**Files:**
- Create: `src/core/memory/types.ts`
- Test: `tests/core/memory/types.spec.ts`

**Design Contracts:**

```typescript
import type { AgentMessage } from './agent-message';

export type SessionEntry =
  | { type: 'message'; id: string; message: AgentMessage; timestamp: number }
  | { type: 'compaction'; id: string; summary: string; tokensBefore: number; firstKeptEntryId: string; timestamp: number }
  | { type: 'label'; id: string; label: string; timestamp: number }
  | { type: 'working_memory'; id: string; keyInfo: string; timestamp: number };

export interface SessionMetadata {
  readonly id: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly label?: string;
  readonly passedSessions?: number;
}

export interface Session {
  readonly id: string;
  readonly metadata: SessionMetadata;
  getEntries(): Promise<SessionEntry[]>;
  append(entry: SessionEntry): Promise<void>;
  updateMetadata(patch: Partial<SessionMetadata>): Promise<void>;
}

export const SESSION_ID_REGEX = /^[a-f0-9-]{36}$/;
export const SESSIONS_DIR = './sessions';
export const MAX_PATH_LENGTH = 255;
export function getSessionPath(sessionId: string): string;
export function isValidSessionId(id: string): boolean;
export function nowTimestamp(): number;
```

**Consumes:** `AgentMessage` from Task 11

**Produces:** `SessionEntry`, `SessionMetadata`, `Session`, `getSessionPath`, `isValidSessionId`, `nowTimestamp`, `SESSION_ID_REGEX`

**Behavior:** §6.2 / §10.10 / §10.12 边界。`SessionEntry` union 类型，timestamp 为 ms 精度 UTC（`Date.now()`）。`getSessionPath` 返回 `./sessions/<sessionId>.jsonl`，sessionId 必须匹配 `SESSION_ID_REGEX`（UUID），否则抛错（路径遍历防护）；路径长度上限 255 字符。`isValidSessionId` 用于校验入站 ID。

**TDD Cycle:**
- [x] 编写失败测试覆盖：合法 UUID 返回路径、含 `..` 的 ID 抛错、含 `/` 的 ID 抛错、路径超 255 字符抛错、`nowTimestamp` 返回整数 ms
- [x] 验证失败：`npm run test -- tests/core/memory/types.spec.ts` → FAIL
- [x] 实现
- [x] 验证通过：Exit Code 0
- [x] 提交：`feat: add SessionEntry types and path resolver (§6.2, §10.10, §10.12)`

### Task 13: FileStorage adapter (§9.4 StorageAdapter interface)

**Files:**
- Create: `src/infrastructure/storage/file-storage.ts`
- Test: `tests/infrastructure/storage/file-storage.spec.ts`

**Design Contracts:**

```typescript
import type { SessionEntry, SessionMetadata } from '../../core/memory/types';

export interface StorageAdapter {
  readSession(id: string): Promise<SessionEntry[]>;
  appendSession(id: string, entry: SessionEntry): Promise<void>;
  listSessions(): Promise<SessionMetadata[]>;
  readWorkingMemory(sessionId: string): Promise<string | null>;
  writeWorkingMemory(sessionId: string, keyInfo: string): Promise<void>;
  deleteSession(id: string): Promise<void>;
}

export class FileStorage implements StorageAdapter {
  constructor(dataDir?: string);
}
```

**Consumes:** `appendJsonl`, `readJsonlTolerant`, `repairJsonl` from Tasks 7-9, `withJsonlLock` from Task 10, `SessionEntry`, `SessionMetadata`, `getSessionPath`, `isValidSessionId` from Task 12

**Produces:** `StorageAdapter` interface, `FileStorage` class

**Behavior:** §9.4 接口契约 + §10.1.1 / §10.1.3 边界。`readSession` 对不存在 ID 返回空数组（不抛错）；对损坏文件先 `repairJsonl` 再读取，完全损坏时备份 `.corrupt.bak` 返回空数组。`appendSession` 通过 `withJsonlLock` 串行化。`listSessions` 扫描 sessions 目录，按 mtime 降序分页（每页 20 条）。`readWorkingMemory` 从 session entries 末尾反向查找最后一条 `working_memory` entry。`writeWorkingMemory` 追加新 entry。`deleteSession` 删除文件（幂等）。

**TDD Cycle:**
- [x] 编写失败测试覆盖：`readSession(不存在 id)` 返回 `[]`、`appendSession` 后能读回、并发 append 串行化、`listSessions` 按 mtime 排序、`readWorkingMemory` 返回最后一条、`deleteSession` 幂等
- [x] 验证失败：`npm run test -- tests/infrastructure/storage/file-storage.spec.ts` → FAIL
- [x] 实现
- [x] 验证通过：Exit Code 0
- [x] 提交：`feat: add FileStorage adapter implementing StorageAdapter (§9.4)`

### Task 14: Process signal handler and exception兜底 (§10.13, §10.14)

**Files:**
- Create: `src/infrastructure/process-handler.ts`
- Test: `tests/infrastructure/process-handler.spec.ts`

**Design Contracts:**

```typescript
export interface ShutdownHandlers {
  onShutdown: () => Promise<void>;
  isShuttingDown: () => boolean;
}

export function installProcessHandlers(handlers: ShutdownHandlers): void;
export function startMemoryMonitor(thresholdMb?: number): NodeJS.Timeout;
export function startTurnWatchdog(onTimeout: () => void): { markTurnStart: () => void; markTurnEnd: () => void };

export const SIGINT_TIMEOUT_MS = 10000;
export const SIGTERM_TIMEOUT_MS = 30000;
export const MEMORY_WARN_THRESHOLD_MB = 450;
export const TURN_WARN_MS = 5 * 60 * 1000;
export const TURN_ABORT_MS = 10 * 60 * 1000;
```

**Consumes:** `Logger` from Task 4

**Produces:** `installProcessHandlers`, `startMemoryMonitor`, `startTurnWatchdog`

**Behavior:** §10.13 / §10.14 边界。`installProcessHandlers` 注册 SIGINT（10s 超时）/ SIGTERM（30s 超时）/ SIGHUP（忽略）/ `uncaughtException`（记录 + flush 日志 + exit(1)）/ `unhandledRejection`（记录不退出）。`onShutdown` 在超时内完成则 exit(0)，超时则强制 exit(1)。`startMemoryMonitor` 每 60s 采样 RSS，超 450MB warn。`startTurnWatchdog` 单 turn 超 5min warn、10min 触发 `onTimeout`。

**TDD Cycle:**
- [x] 编写失败测试覆盖：`isShuttingDown` 在 `onShutdown` 调用后返回 true、内存超阈值触发 warn、turn watchdog 5min warn / 10min abort（用 fake timer）
- [x] 验证失败：`npm run test -- tests/infrastructure/process-handler.spec.ts` → FAIL
- [x] 实现
- [x] 验证通过：Exit Code 0
- [x] 提交：`feat: add process signal handler and exception fallback (§10.13, §10.14)`

---

## Phase 2: Core Layer

### Task 15: Provider type definitions

**Files:**
- Create: `src/core/provider/types.ts`
- Test: `tests/core/provider/types.spec.ts`

**Design Contracts:**

```typescript
import type { ContentBlock } from '../../core/memory/agent-message';
import type { Api } from '../../infrastructure/config-types';

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ContextMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string | ContentBlock[];
  toolCallId?: string;
  toolCalls?: Array<{ id: string; name: string; arguments: string }>;
}

export interface Context {
  systemPrompt?: string;
  messages: ContextMessage[];
  tools?: ToolDefinition[];
}

export interface AssistantMessageEvent {
  type: 'text' | 'tool_call' | 'stop' | 'error';
  text?: string;
  toolCall?: { id: string; name: string; arguments: string };
  stopReason?: string;
  error?: { message: string; retryable: boolean; status?: number };
}

export interface StreamOptions {
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface Model {
  readonly provider: string;
  readonly id: string;
  readonly api: Api;
  readonly contextWindow: number;
  readonly maxTokens: number;
}

export interface Provider {
  readonly id: string;
  readonly name: string;
  readonly baseUrl?: string;
  readonly auth: { apiKey?: string; envVar?: string };
  getModels(): readonly Model[];
  stream(model: Model, context: Context, options?: StreamOptions): AsyncGenerator<AssistantMessageEvent>;
}
```

**Produces:** `Provider`, `Model`, `Context`, `ContextMessage`, `ToolDefinition`, `AssistantMessageEvent`, `StreamOptions`

**Behavior:** Provider 抽象层类型定义。`stream` 返回 AsyncGenerator，按 §3.2 事件顺序 yield `AssistantMessageEvent`。`Api` 从 Task 5 (`config-types.ts`) 导入，避免重复定义。

**TDD Cycle:**
- [x] 编写失败测试覆盖：类型断言（编译期）+ `AssistantMessageEvent` union 各分支可构造
- [x] 验证失败：`npm run test -- tests/core/provider/types.spec.ts` → FAIL
- [x] 实现
- [x] 验证通过：Exit Code 0
- [x] 提交：`feat: add Provider and Model type definitions`

### Task 16: Provider dual-clock streaming controller (§10.1.5, §10.3)

**Files:**
- Create: `src/core/provider/dual-clock.ts`
- Test: `tests/core/provider/dual-clock.spec.ts`

**Design Contracts:**

```typescript
export interface DualClockOptions {
  ttfbMs?: number;
  chunkIntervalMs?: number;
  signal?: AbortSignal;
}

export const DEFAULT_TTFB_MS = 5000;
export const DEFAULT_CHUNK_INTERVAL_MS = 1500;

export function withDualClock<T>(
  source: AsyncGenerator<T>,
  options?: DualClockOptions,
): AsyncGenerator<T>;
```

**Produces:** `withDualClock`, `DualClockOptions`, `DEFAULT_TTFB_MS`, `DEFAULT_CHUNK_INTERVAL_MS`

**Behavior:** §10.1.5 / §10.3 边界。包装上游 AsyncGenerator，应用双时钟：首字节超时（TTFB 5000ms，可配置）与 chunk 间超时（1500ms，可配置）。TTFB 超时或 chunk 间超时抛 `StreamTimeoutError`（含 `retryable: true`）；收到 `signal.abort` 时 100ms 内停止 yield。已 yield 的 chunk 不撤回。

**TDD Cycle:**
- [x] 编写失败测试覆盖：TTFB 超 5s 抛错、chunk 间隔超 1.5s 抛错、正常流通过、abort 后 100ms 内停止
- [x] 验证失败：`npm run test -- tests/core/provider/dual-clock.spec.ts` → FAIL
- [x] 实现
- [x] 验证通过：Exit Code 0
- [x] 提交：`feat: add dual-clock streaming controller TTFB 5s + chunk 1.5s (§10.1.5)`

### Task 17: Provider retry with error classification (§10.1.5)

**Files:**
- Create: `src/core/provider/retry.ts`
- Test: `tests/core/provider/retry.spec.ts`

**Design Contracts:**

```typescript
export type RetryableError = { retryable: true; status: 429 | 500 | 502 | 503 | 504; message: string };
export type FatalError = { retryable: false; status: 400 | 401 | 403; message: string };
export type ProviderError = RetryableError | FatalError;

export const RETRY_DELAYS_MS = [1000, 2000, 4000] as const;
export const MAX_RETRIES = 3;

export function classifyError(status: number, message: string): ProviderError;
export function withRetry<T>(
  fn: () => Promise<T>,
  options?: { signal?: AbortSignal; onRetry?: (err: ProviderError, attempt: number) => void },
): Promise<T>;
```

**Produces:** `classifyError`, `withRetry`, `ProviderError`, `RetryableError`, `FatalError`, `RETRY_DELAYS_MS`, `MAX_RETRIES`

**Behavior:** §10.1.5 边界。`classifyError` 将 HTTP 状态码分类：429/5xx 为 `retryable`，400/401/403 为 `fatal`，ECONNRESET/ETIMEDOUT 归类为 retryable。`withRetry` 对 retryable 错误按 1s/2s/4s 指数退避重试最多 3 次，fatal 错误立即抛出。重试时调用 `onRetry` 回调便于日志。

**TDD Cycle:**
- [x] 编写失败测试覆盖：429 retryable、500 retryable、401 fatal、403 fatal、400 fatal、ECONNRESET retryable、重试 3 次后抛错、fatal 不重试
- [x] 验证失败：`npm run test -- tests/core/provider/retry.spec.ts` → FAIL
- [x] 实现
- [x] 验证通过：Exit Code 0
- [x] 提交：`feat: add provider retry with error classification 401/403/400 fatal (§10.1.5)`

### Task 18: Provider message sanitization

**Files:**
- Create: `src/core/provider/sanitize.ts`
- Test: `tests/core/provider/sanitize.spec.ts`

**Design Contracts:**

```typescript
import type { Context } from './types';

export function sanitizeContext(context: Context): Context;
```

**Consumes:** `Context`, `ContextMessage` from Task 15

**Produces:** `sanitizeContext`

**Behavior:** §4.4 边界。修复 role alternation（连续 user 消息合并、assistant 后跟 assistant 插入空 user）；空 content 替换为占位符 `' '`；移除 image content 当 provider 不支持；tool 消息必须有 `toolCallId`。

**TDD Cycle:**
- [x] 编写失败测试覆盖：连续 user 合并、空 content 替换、tool 消息无 toolCallId 被过滤
- [x] 验证失败：`npm run test -- tests/core/provider/sanitize.spec.ts` → FAIL
- [x] 实现
- [x] 验证通过：Exit Code 0
- [x] 提交：`feat: add provider message sanitization`

### Task 19: openai-responses API implementation

**Files:**
- Create: `src/core/provider/api/openai-responses.ts`
- Test: `tests/core/provider/api/openai-responses.spec.ts`

**Design Contracts:**

```typescript
import type { Provider, Model, Context, StreamOptions, AssistantMessageEvent } from '../types';

export function createOpenaiResponsesStream(
  baseUrl: string,
  apiKey: string,
  model: Model,
  context: Context,
  options?: StreamOptions,
): AsyncGenerator<AssistantMessageEvent>;
```

**Consumes:** `Provider`, `Model`, `Context`, `StreamOptions`, `AssistantMessageEvent` from Task 15, `withDualClock` from Task 16, `withRetry` from Task 17, `sanitizeContext` from Task 18

**Produces:** `createOpenaiResponsesStream`

**Behavior:** 实现 OpenAI Responses API 协议的流式调用。SSE 解析，按 `AssistantMessageEvent` union 转换事件。应用 `sanitizeContext` 预处理，`withDualClock` 双时钟保护，`withRetry` 重试。401/403/400 立即抛 fatal。

**TDD Cycle:**
- [x] 编写失败测试覆盖：mock fetch 返回 SSE 流，断言 yield 序列（text → tool_call → stop）、401 抛 fatal、500 重试 3 次
- [x] 验证失败：`npm run test -- tests/core/provider/api/openai-responses.spec.ts` → FAIL
- [x] 实现
- [x] 验证通过：Exit Code 0
- [x] 提交：`feat: add openai-responses API stream implementation`

### Task 20: anthropic-messages API implementation

**Files:**
- Create: `src/core/provider/api/anthropic-messages.ts`
- Test: `tests/core/provider/api/anthropic-messages.spec.ts`

**Design Contracts:**

```typescript
export function createAnthropicMessagesStream(
  baseUrl: string,
  apiKey: string,
  model: Model,
  context: Context,
  options?: StreamOptions,
): AsyncGenerator<AssistantMessageEvent>;
```

**Consumes:** 同 Task 19

**Produces:** `createAnthropicMessagesStream`

**Behavior:** 实现 Anthropic Messages API 协议的流式调用。SSE 解析，转换 `content_block_delta` 等事件为 `AssistantMessageEvent`。其余同 Task 19。

**TDD Cycle:**
- [x] 编写失败测试覆盖：mock fetch 返回 Anthropic SSE 流，断言 yield 序列、401 抛 fatal、429 重试
- [x] 验证失败：`npm run test -- tests/core/provider/api/anthropic-messages.spec.ts` → FAIL
- [x] 实现
- [x] 验证通过：Exit Code 0
- [x] 提交：`feat: add anthropic-messages API stream implementation`

### Task 21: Provider declarations and models registry

**Files:**
- Create: `src/core/provider/providers/openai.ts`
- Create: `src/core/provider/providers/anthropic.ts`
- Create: `src/core/provider/providers/deepseek.ts`
- Create: `src/core/provider/models.ts`
- Test: `tests/core/provider/models.spec.ts`

**Design Contracts:**

```typescript
export interface ProviderDeclaration {
  readonly id: string;
  readonly name: string;
  readonly baseUrl?: string;
  readonly auth: { envVar: string };
  readonly models: ReadonlyArray<Model>;
}

export const openaiProvider: ProviderDeclaration;
export const anthropicProvider: ProviderDeclaration;
export const deepseekProvider: ProviderDeclaration;

export class ModelRegistry {
  constructor(providers: ProviderDeclaration[]);
  findModel(modelId: string): { provider: ProviderDeclaration; model: Model } | undefined;
  listModels(): ReadonlyArray<{ provider: ProviderDeclaration; model: Model }>;
}

export function createProvider(decl: ProviderDeclaration, apiKey: string): Provider;
```

**Consumes:** `Provider`, `Model` from Task 15, `createOpenaiResponsesStream` from Task 19, `createAnthropicMessagesStream` from Task 20

**Produces:** `ProviderDeclaration`, `ModelRegistry`, `createProvider`, 3 个内置 provider 声明

**Behavior:** §4.1 / §4.2 Api-Provider 分离。每个 provider 声明含 id+name+baseUrl+auth+models。`createProvider` 根据 `model.api` 选择 stream 工厂（deepseek 复用 openai-responses）。`ModelRegistry.findModel` 按 model id 路由到 provider。

**TDD Cycle:**
- [x] 编写失败测试覆盖：`findModel('gpt-4')` 返回 openai provider、`findModel('claude-3')` 返回 anthropic、`findModel('deepseek-chat')` 返回 deepseek、未知 model 返回 undefined
- [x] 验证失败：`npm run test -- tests/core/provider/models.spec.ts` → FAIL
- [x] 实现
- [x] 验证通过：Exit Code 0
- [x] 提交：`feat: add provider declarations and model registry`

### Task 22: ToolRegistry and AgentTool interface

**Files:**
- Create: `src/core/tool/types.ts`
- Test: `tests/core/tool/types.spec.ts`

**Design Contracts:**

```typescript
import type { ToolDefinition } from '../provider/types';
import type { ContentBlock } from '../../core/memory/agent-message';

export interface AgentTool<TParams = unknown, TDetails = unknown> {
  readonly name: string;
  readonly label: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
  readonly executionMode?: 'sequential' | 'parallel';
  execute(toolCallId: string, params: TParams, signal?: AbortSignal): Promise<AgentToolResult<TDetails>>;
}

export interface AgentToolResult<T = unknown> {
  content: ContentBlock[];
  details: T;
  terminate?: boolean;
  error?: { code: string; message: string };
}

export interface ToolRegistry {
  register(tool: AgentTool): void;
  unregister(name: string): void;
  get(name: string): AgentTool | undefined;
  has(name: string): boolean;
  getDefinitions(): ToolDefinition[];
  getAll(): AgentTool[];
}

export function createToolRegistry(): ToolRegistry;
```

**Produces:** `AgentTool`, `AgentToolResult`, `ToolRegistry`, `createToolRegistry`

**Behavior:** §5.1 / §5.3 设计要点。`createToolRegistry` 返回内存实现；`getDefinitions` 转换为 LLM schema 数组；重复 register 同名工具抛错或覆盖（选覆盖 + warn）。

**TDD Cycle:**
- [x] 编写失败测试覆盖：register 后 get 返回、has 正确、getDefinitions 返回 schema 数组、unregister 后 get 返回 undefined、重复 register 覆盖
- [x] 验证失败：`npm run test -- tests/core/tool/types.spec.ts` → FAIL
- [x] 实现
- [x] 验证通过：Exit Code 0
- [x] 提交：`feat: add ToolRegistry and AgentTool interface`

### Task 23: bash tool with hard timeout and process leak prevention (§10.1.2)

**Files:**
- Create: `src/core/tool/tools/bash.ts`
- Test: `tests/core/tool/tools/bash.spec.ts`

**Design Contracts:**

```typescript
export interface BashParams {
  command: string;
  cwd?: string;
  timeoutMs?: number;
}

export interface BashDetails {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  killed: boolean;
}

export const BASH_TIMEOUT_MS = 30000;
export const BASH_SIGTERM_GRACE_MS = 2000;
export const BASH_MAX_CONCURRENT = 10;

export const bashTool: AgentTool<BashParams, BashDetails>;
```

**Consumes:** `AgentTool`, `AgentToolResult` from Task 22, `Logger` from Task 4

**Produces:** `bashTool`

**Behavior:** §10.1.2 / §10.3 边界。执行 shell 命令，30s 硬超时：SIGTERM → 等 2s → SIGKILL。超时返回 `AgentToolResult.error({ code: 'timeout_error', ... })`。最大 10 并发（用 semaphore）。父进程 exit hook 杀所有子进程（SIGKILL）。stdout/stderr 截断到合理大小（默认 1MB）。AbortSignal 触发时 SIGTERM 子进程。

**TDD Cycle:**
- [x] 编写失败测试覆盖：成功执行 `echo hello` 返回 stdout、30s 超时返回 timeout_error（用短超时 100ms 测试）、abort 触发 SIGTERM、stderr 捕获、exit code 非 0 也返回（不抛错）
- [x] 验证失败：`npm run test -- tests/core/tool/tools/bash.spec.ts` → FAIL
- [x] 实现
- [x] 验证通过：Exit Code 0
- [x] 提交：`feat: add bash tool with 30s hard timeout and SIGTERM→SIGKILL (§10.1.2)`

### Task 24: read tool with size limit and streaming (§10.1.2)

**Files:**
- Create: `src/core/tool/tools/read.ts`
- Test: `tests/core/tool/tools/read.spec.ts`

**Design Contracts:**

```typescript
export interface ReadParams {
  path: string;
  offset?: number;
  limit?: number;
}

export interface ReadDetails {
  lines: number;
  bytes: number;
  truncated: boolean;
}

export const READ_MAX_BYTES = 2 * 1024 * 1024;
export const READ_STREAM_THRESHOLD = 1024 * 1024;
export const READ_TIMEOUT_MS = 5000;

export const readTool: AgentTool<ReadParams, ReadDetails>;
```

**Consumes:** `AgentTool`, `AgentToolResult` from Task 22

**Produces:** `readTool`

**Behavior:** §10.1.2 / §10.3 边界。读取文件内容，支持 offset/limit 分页。>2MB 返回 `AgentToolResult.error({ code: 'file_too_large' })`。>1MB 用流式读取。5s 超时返回 `read_timeout`。路径遍历防护（拒绝 `..`）。AbortSignal 触发时 close fd。

**TDD Cycle:**
- [ ] 编写失败测试覆盖：读取小文件返回 content、>2MB 返回 file_too_large、offset/limit 分页、路径含 `..` 拒绝、不存在的文件返回 error
- [ ] 验证失败：`npm run test -- tests/core/tool/tools/read.spec.ts` → FAIL
- [ ] 实现
- [ ] 验证通过：Exit Code 0
- [ ] 提交：`feat: add read tool with 2MB limit and pagination (§10.1.2)`

### Task 25: edit tool with per-file mutex (§10.1.2)

**Files:**
- Create: `src/core/tool/tools/edit.ts`
- Test: `tests/core/tool/tools/edit.spec.ts`

**Design Contracts:**

```typescript
export interface EditParams {
  path: string;
  oldString: string;
  newString: string;
}

export interface EditDetails {
  bytesBefore: number;
  bytesAfter: number;
  replaced: number;
}

export const EDIT_TIMEOUT_MS = 5000;

export const editTool: AgentTool<EditParams, EditDetails>;
```

**Consumes:** `AgentTool`, `AgentToolResult` from Task 22, `withJsonlLock` 模式参考（per-file mutex）

**Produces:** `editTool`

**Behavior:** §10.1.2 / §10.3 边界。精确字符串替换。per-filePath mutex 串行化同一文件的并发 edit。`old_string` 在文件中出现 0 次返回 `not_found`，出现 >1 次返回 `not_unique` 拒绝。5s 超时返回 `edit_timeout`。AbortSignal 触发时 close fd。

**TDD Cycle:**
- [ ] 编写失败测试覆盖：成功替换、old_string 不存在返回 not_found、old_string 多次出现返回 not_unique、并发 edit 同一文件串行化、5s 超时
- [ ] 验证失败：`npm run test -- tests/core/tool/tools/edit.spec.ts` → FAIL
- [ ] 实现
- [ ] 验证通过：Exit Code 0
- [ ] 提交：`feat: add edit tool with per-file mutex and uniqueness check (§10.1.2)`

### Task 26: update_working_memory tool (§6.5)

**Files:**
- Create: `src/core/tool/tools/update-working-memory.ts`
- Test: `tests/core/tool/tools/update-working-memory.spec.ts`

**Design Contracts:**

```typescript
export interface UpdateWorkingMemoryParams {
  keyInfo: string;
}

export interface UpdateWorkingMemoryDetails {
  truncated: boolean;
  bytesBefore: number;
  bytesAfter: number;
}

export const KEY_INFO_MAX_CHARS = 2000;

export const updateWorkingMemoryTool: AgentTool<UpdateWorkingMemoryParams, UpdateWorkingMemoryDetails>;
```

**Consumes:** `AgentTool`, `AgentToolResult` from Task 22, `StorageAdapter` from Task 13

**Produces:** `updateWorkingMemoryTool`

**Behavior:** §6.5 边界。LLM 调用以更新 key_info。key_info 超 2000 字符截断 + warn，返回 `truncated: true`。覆盖整个 keyInfo（单调更新）。通过 `StorageAdapter.writeWorkingMemory` 持久化为 `working_memory` SessionEntry。

**TDD Cycle:**
- [ ] 编写失败测试覆盖：写入短 keyInfo 成功、超 2000 字符截断 + truncated=true、写入后 readWorkingMemory 能读回
- [ ] 验证失败：`npm run test -- tests/core/tool/tools/update-working-memory.spec.ts` → FAIL
- [ ] 实现
- [ ] 验证通过：Exit Code 0
- [ ] 提交：`feat: add update_working_memory tool with 2000 char truncation (§6.5)`

### Task 27: AgentEvent union types (§3.2)

**Files:**
- Create: `src/core/agent/events.ts`
- Test: `tests/core/agent/events.spec.ts`

**Design Contracts:**

```typescript
export type AgentEvent =
  | { type: 'agent_start' }
  | { type: 'turn_start'; turnId: string }
  | { type: 'message_start'; messageId: string }
  | { type: 'message_delta'; text: string }
  | { type: 'reasoning_delta'; text: string }
  | { type: 'tool_call_start'; toolCallId: string; toolName: string }
  | { type: 'tool_call_delta'; toolCallId: string; arguments: string }
  | { type: 'tool_call_end'; toolCallId: string }
  | { type: 'tool_result'; toolCallId: string; success: boolean; summary: string }
  | { type: 'message_end'; messageId: string; stopReason: string }
  | { type: 'turn_end'; turnId: string }
  | { type: 'agent_end' }
  | { type: 'error'; message: string; retryable: boolean };

export function createTurnId(): string;
export function createMessageId(): string;
export function createToolCallId(): string;
```

**Produces:** `AgentEvent`, `createTurnId`, `createMessageId`, `createToolCallId`

**Behavior:** §3.2 事件 union 类型。所有 ID 用 `crypto.randomUUID()`。

**TDD Cycle:**
- [ ] 编写失败测试覆盖：`createTurnId()` 返回 UUID 格式、各事件分支可构造、`error` 事件含 retryable 字段
- [ ] 验证失败：`npm run test -- tests/core/agent/events.spec.ts` → FAIL
- [ ] 实现
- [ ] 验证通过：Exit Code 0
- [ ] 提交：`feat: add AgentEvent union types (§3.2)`

### Task 28: AgentLoop L1 with maxIterations and AbortSignal (§3.3, §10.1.7)

**Files:**
- Create: `src/core/agent/loop.ts`
- Test: `tests/core/agent/loop.spec.ts`

**Design Contracts:**

```typescript
import type { Provider, Context } from '../provider/types';
import type { ToolRegistry } from '../tool/types';
import type { AgentMessage } from '../memory/agent-message';
import type { AgentEvent } from './events';

export interface AgentLoopConfig {
  provider: Provider;
  model: Model;
  tools: ToolRegistry;
  context: Context;
  systemPrompt: string;
  signal?: AbortSignal;
  maxIterations?: number;
}

export const DEFAULT_MAX_ITERATIONS = 10;
export const MAX_STEERING_QUEUE = 5;

export function agentLoop(config: AgentLoopConfig): AsyncGenerator<AgentEvent, AgentMessage[]>;
```

**Consumes:** `Provider`, `Model`, `Context` from Task 15, `ToolRegistry` from Task 22, `AgentMessage` from Task 11, `AgentEvent` from Task 27

**Produces:** `agentLoop`, `AgentLoopConfig`, `DEFAULT_MAX_ITERATIONS`

**Behavior:** §3.1 Layer 1 / §3.3 / §10.1.7 边界。无状态生成器函数，双 while 循环（steering + follow-up）。事件顺序遵循 §3.2：`agent_start` → 每轮（`turn_start` → `message_start` → deltas → `message_end` → tool calls → `tool_result` → `turn_end`）→ `agent_end`。`maxIterations` 达到上限发 `error` 事件（`message: 'max_iterations_exceeded'`, `retryable: false`）后正常结束。AbortSignal 触发时停止 provider yield、cancel 进行中 tool_call、发 `agent_end` 后退出。generator 提前 `return()` 触发 finally 清理。

**TDD Cycle:**
- [ ] 编写失败测试覆盖：单 turn 事件序列完整、tool_call → tool_result → message_start 顺序、`maxIterations` 达到上限发 error 且 retryable=false、AbortSignal 触发后发 agent_end、generator return() 触发清理
- [ ] 验证失败：`npm run test -- tests/core/agent/loop.spec.ts` → FAIL
- [ ] 实现
- [ ] 验证通过：Exit Code 0
- [ ] 提交：`feat: add AgentLoop L1 with maxIterations and AbortSignal (§3.3, §10.1.7)`

### Task 29: AgentSession L2 with turn atomicity and steering (§3.3, §3.4)

**Files:**
- Create: `src/core/agent/session.ts`
- Test: `tests/core/agent/session.spec.ts`

**Design Contracts:**

```typescript
import type { AgentEvent } from './events';
import type { AgentMessage } from '../memory/agent-message';
import type { StorageAdapter } from '../../infrastructure/storage/file-storage';

export interface AgentSessionConfig {
  storage: StorageAdapter;
  sessionId: string;
  agentLoop: typeof import('./loop').agentLoop;
  provider: Provider;
  model: Model;
  tools: ToolRegistry;
  systemPrompt: string;
  reserveTokens?: number;
}

export interface AgentSession {
  readonly sessionId: string;
  run(userMessage: string): AsyncGenerator<AgentEvent>;
  pushSteering(message: AgentMessage): void;
  getWorkingMemory(): Promise<string | null>;
}

export function createAgentSession(config: AgentSessionConfig): AgentSession;
```

**Consumes:** `agentLoop` from Task 28, `StorageAdapter` from Task 13, `AgentMessage` from Task 11, `AgentEvent` from Task 27

**Produces:** `AgentSession`, `createAgentSession`, `AgentSessionConfig`

**Behavior:** §3.1 Layer 2 / §3.4 错误处理。有状态封装，持有 context/steering 队列/session 存储。`run` 调用 `agentLoop` 并转发事件，turn 结束后持久化 entries。turn 原子性：错误响应不持久化（§10.4）。`pushSteering` 注入消息到队列（上限 5，超出丢弃最旧 + warn），仅在 turn 之间注入。`getWorkingMemory` 从 storage 读取最后一条。

**TDD Cycle:**
- [ ] 编写失败测试覆盖：单 turn 运行后 entries 持久化、错误响应不持久化、`pushSteering` 后下个 turn 包含、steering 队列超 5 丢弃最旧 + warn
- [ ] 验证失败：`npm run test -- tests/core/agent/session.spec.ts` → FAIL
- [ ] 实现
- [ ] 验证通过：Exit Code 0
- [ ] 提交：`feat: add AgentSession L2 with turn atomicity and steering (§3.4)`

### Task 30: SessionRepo and session lifecycle (§6.3)

**Files:**
- Create: `src/core/memory/session-repo.ts`
- Test: `tests/core/memory/session-repo.spec.ts`

**Design Contracts:**

```typescript
import type { StorageAdapter } from '../../infrastructure/storage/file-storage';
import type { Session, SessionMetadata, SessionEntry } from './types';

export interface SessionRepo {
  create(): Promise<Session>;
  open(id: string): Promise<Session>;
  list(): Promise<SessionMetadata[]>;
  delete(id: string): Promise<void>;
}

export function createSessionRepo(storage: StorageAdapter): SessionRepo;
```

**Consumes:** `StorageAdapter` from Task 13, `Session`, `SessionMetadata`, `SessionEntry`, `isValidSessionId` from Task 12

**Produces:** `SessionRepo`, `createSessionRepo`

**Behavior:** §6.3 接口。`create` 生成新 UUID 并初始化空 session。`open` 对不存在 ID 创建新 session（幂等语义 §10.1.3）。`list` 委托 storage。`delete` 幂等。`Session.append` 委托 storage。

**TDD Cycle:**
- [ ] 编写失败测试覆盖：`create` 返回新 session、`open(不存在 id)` 创建新 session、`list` 返回数组、`delete` 后 list 不含
- [ ] 验证失败：`npm run test -- tests/core/memory/session-repo.spec.ts` → FAIL
- [ ] 实现
- [ ] 验证通过：Exit Code 0
- [ ] 提交：`feat: add SessionRepo with idempotent open/create (§6.3)`

### Task 31: Compaction with LLM failure fallback (§6.4, §10.1.1)

**Files:**
- Create: `src/core/memory/compaction.ts`
- Test: `tests/core/memory/compaction.spec.ts`

**Design Contracts:**

```typescript
import type { Provider, Model } from '../provider/types';
import type { SessionEntry } from './types';
import type { StorageAdapter } from '../../infrastructure/storage/file-storage';

export interface CompactionSettings {
  enabled: boolean;
  reserveTokens: number;
  keepRecentTokens: number;
}

export const DEFAULT_COMPACTION_SETTINGS: CompactionSettings;
export const COMPACTION_TRIGGER_RATIO = 0.8;
export const COMPACTION_TARGET_RATIO = 0.3;
export const COMPACTION_MAX_TOKENS = 2048;

export function estimateTokens(messages: AgentMessage[], model: Model): number;
export function shouldCompact(tokens: number, contextWindow: number, settings: CompactionSettings): boolean;
export function findCutPoint(entries: SessionEntry[], keepRecentTokens: number): number;
export async function compact(
  entries: SessionEntry[],
  previousSummary: string | null,
  model: Model,
  provider: Provider,
  storage: StorageAdapter,
  sessionId: string,
): Promise<{ success: boolean; reason?: string }>;
```

**Consumes:** `Provider`, `Model` from Task 15, `SessionEntry` from Task 12, `StorageAdapter` from Task 13, `AgentMessage` from Task 11

**Produces:** `compact`, `shouldCompact`, `findCutPoint`, `estimateTokens`, `DEFAULT_COMPACTION_SETTINGS`

**Behavior:** §6.4 / §10.1.1 / §10.5 边界。`estimateTokens` 三级降级：tiktoken → usage → chars/4 + warn。`shouldCompact` 当 tokens ≥ contextWindow × 0.8 时返回 true。`compact` 找 cutPoint → 生成摘要（maxTokens 2048）→ append compaction entry。LLM 调用失败时返回 `{ success: false, reason: 'llm_failed' }`，保留旧 entries 不变（§10.1.1）。

**TDD Cycle:**
- [ ] 编写失败测试覆盖：`shouldCompact` 在 80% 阈值触发、`findCutPoint` 找到 user 消息切点、`compact` 成功后 append compaction entry、LLM 失败后 `success: false` 且旧 entries 完整、`estimateTokens` 降级路径
- [ ] 验证失败：`npm run test -- tests/core/memory/compaction.spec.ts` → FAIL
- [ ] 安装：`npm install tiktoken`（或用 mock）
- [ ] 实现
- [ ] 验证通过：Exit Code 0
- [ ] 提交：`feat: add Compaction with LLM failure fallback and token estimation (§6.4, §10.1.1)`

### Task 32: Working Memory cross-session inheritance (§6.5)

**Files:**
- Create: `src/core/memory/working-memory.ts`
- Test: `tests/core/memory/working-memory.spec.ts`

**Design Contracts:**

```typescript
import type { StorageAdapter } from '../../infrastructure/storage/file-storage';

export interface WorkingMemoryState {
  keyInfo: string;
  passedSessions: number;
  inheritedFrom?: string;
}

export async function inheritWorkingMemory(
  sourceSessionId: string,
  targetSessionId: string,
  storage: StorageAdapter,
): Promise<WorkingMemoryState>;
export async function loadWorkingMemory(sessionId: string, storage: StorageAdapter): Promise<WorkingMemoryState | null>;
```

**Consumes:** `StorageAdapter` from Task 13, `SessionMetadata` from Task 12

**Produces:** `inheritWorkingMemory`, `loadWorkingMemory`, `WorkingMemoryState`

**Behavior:** §6.5 边界。`inheritWorkingMemory` 从 source session 读取最后一条 `working_memory` entry，写入 target session，`passedSessions` +1。source 无 working memory 时返回空 keyInfo 但仍 +1 计数。`loadWorkingMemory` 从 session entries 末尾反向查找。

**TDD Cycle:**
- [ ] 编写失败测试覆盖：source 有 keyInfo 时继承、source 无 keyInfo 时 passedSessions 仍 +1、`loadWorkingMemory` 返回最后一条、target 写入后可读回
- [ ] 验证失败：`npm run test -- tests/core/memory/working-memory.spec.ts` → FAIL
- [ ] 实现
- [ ] 验证通过：Exit Code 0
- [ ] 提交：`feat: add working memory cross-session inheritance (§6.5)`

---

## Phase 3: Bus Layer

### Task 33: Channel and AgentEventEnvelope types (§7.2)

**Files:**
- Create: `src/bus/types.ts`
- Test: `tests/bus/types.spec.ts`

**Design Contracts:**

```typescript
import type { AgentEvent } from '../core/agent/events';

export interface InboundMessage {
  readonly channel: string;
  readonly senderId: string;
  readonly chatId: string;
  readonly content: string;
  readonly media?: MediaContent[];
  readonly metadata: Record<string, unknown>;
  readonly sessionKey?: string;
}

export interface MediaContent {
  type: 'image' | 'file';
  mediaType: string;
  data: string;
  sizeBytes: number;
}

export interface AgentEventEnvelope {
  readonly sessionKey: string;
  readonly chatId: string;
  readonly channel: string;
  readonly event: AgentEvent;
  readonly seq: number;
}

export interface ChannelCapability {
  streaming: boolean;
  reasoning: boolean;
  richUi: boolean;
  fileEditEvents: boolean;
  editMessage: boolean;
  markdown: boolean | 'limited';
}

export interface Channel {
  readonly name: string;
  readonly capabilities: ChannelCapability;
  readonly messageLengthLimit?: number;
  start(bus: MessageBus): Promise<void>;
  stop(): Promise<void>;
  consume(envelope: AgentEventEnvelope): void | Promise<void>;
}

export interface MessageBus {
  publishInbound(msg: InboundMessage): Promise<void>;
  consumeInbound(): Promise<InboundMessage>;
  publishOutbound(envelope: AgentEventEnvelope): Promise<void>;
  consumeOutbound(): Promise<AgentEventEnvelope>;
}

export function matchesCapability(cap: ChannelCapability, event: AgentEvent): boolean;
```

**Produces:** `InboundMessage`, `AgentEventEnvelope`, `ChannelCapability`, `Channel`, `MessageBus`, `matchesCapability`

**Behavior:** §7.2 / §7.4 类型定义。`matchesCapability` 按 §7.4 能力过滤规则实现：`message_delta` 需 streaming、`reasoning_*` 需 reasoning、`tool_*` richUi payload 需 richUi（否则降级）、其他始终投递。

**TDD Cycle:**
- [ ] 编写失败测试覆盖：`matchesCapability` 各事件类型分支、streaming=false 时 message_delta 不匹配、richUi=false 时 tool_call 不匹配
- [ ] 验证失败：`npm run test -- tests/bus/types.spec.ts` → FAIL
- [ ] 实现
- [ ] 验证通过：Exit Code 0
- [ ] 提交：`feat: add Channel and AgentEventEnvelope types (§7.2)`

### Task 34: MessageBus in-memory implementation (§7.3, §10.1.6)

**Files:**
- Create: `src/bus/message-bus.ts`
- Test: `tests/bus/message-bus.spec.ts`

**Design Contracts:**

```typescript
import type { InboundMessage, AgentEventEnvelope, MessageBus } from './types';

export const INBOUND_QUEUE_MAX = 100;
export const OUTBOUND_QUEUE_MAX = 1000;

export class InMemoryMessageBus implements MessageBus {
  constructor();
  publishInbound(msg: InboundMessage): Promise<void>;
  consumeInbound(): Promise<InboundMessage>;
  publishOutbound(envelope: AgentEventEnvelope): Promise<void>;
  consumeOutbound(): Promise<AgentEventEnvelope>;
}
```

**Consumes:** `MessageBus`, `InboundMessage`, `AgentEventEnvelope` from Task 33

**Produces:** `InMemoryMessageBus`, `INBOUND_QUEUE_MAX`, `OUTBOUND_QUEUE_MAX`

**Behavior:** §7.3 / §10.1.6 边界。inbound 队列上限 100，溢出返回 `inbound_queue_full` 错误并丢弃最旧的非 `agent_start` 消息。outbound 队列上限 1000，溢出丢弃最旧的 `message_delta`/`reasoning_delta`，保留 `tool_call`/`tool_result`/`message_end`（§10.1.4）。FIFO 保证。

**TDD Cycle:**
- [ ] 编写失败测试覆盖：publish/consume 往返、inbound 队列满抛 `inbound_queue_full`、outbound 溢出丢弃 delta 保留 tool_result、FIFO 顺序
- [ ] 验证失败：`npm run test -- tests/bus/message-bus.spec.ts` → FAIL
- [ ] 实现
- [ ] 验证通过：Exit Code 0
- [ ] 提交：`feat: add InMemoryMessageBus with queue overflow handling (§7.3, §10.1.6)`

### Task 35: ChannelManager with dispatch loop and dead letter (§7.2, §10.1.6)

**Files:**
- Create: `src/bus/channel-manager.ts`
- Test: `tests/bus/channel-manager.spec.ts`

**Design Contracts:**

```typescript
import type { Channel, AgentEventEnvelope } from './types';
import type { MessageBus } from './types';

export const DEAD_LETTER_MAX = 100;

export interface ChannelManager {
  register(channel: Channel): void;
  startAll(): Promise<void>;
  stopAll(): Promise<void>;
  bindSession(sessionKey: string, channel: Channel): void;
  unbindSession(sessionKey: string, channel: Channel): void;
  runDispatchLoop(): Promise<void>;
  getDeadLetters(): readonly AgentEventEnvelope[];
}

export function createChannelManager(bus: MessageBus): ChannelManager;
```

**Consumes:** `Channel`, `MessageBus`, `matchesCapability` from Task 33, `InMemoryMessageBus` from Task 34

**Produces:** `ChannelManager`, `createChannelManager`, `DEAD_LETTER_MAX`

**Behavior:** §7.2 / §10.1.6 边界。`startAll` 并行启动所有 channel，单个失败不阻塞其他（记录 `channel_start_failed`）。`bindSession` 幂等：重复 bind 同 channel 不报错。`unbindSession` 幂等：解绑未注册 sessionKey 不报错。`runDispatchLoop` 按 capability 过滤 + 路由 + 重试。所有 channel 投递失败时保留到死信队列（上限 100）+ 发 `dispatch_dead_letter` warn。`Channel.consume` 异常时跳过该 channel 不影响其他。

**TDD Cycle:**
- [ ] 编写失败测试覆盖：`bindSession` 重复不报错、`unbindSession` 未注册不报错、`startAll` 单个失败不阻塞、dispatch 按 capability 过滤、所有失败入死信队列、`consume` 异常跳过该 channel
- [ ] 验证失败：`npm run test -- tests/bus/channel-manager.spec.ts` → FAIL
- [ ] 实现
- [ ] 验证通过：Exit Code 0
- [ ] 提交：`feat: add ChannelManager with dispatch loop and dead letter (§7.2, §10.1.6)`

---

## Phase 4: Access Layer

### Task 36: CommandRegistry and 7 slash commands (§8.2, §8.4)

**Files:**
- Create: `src/shared/commands/registry.ts`
- Create: `src/shared/commands/builtin/new.ts`
- Create: `src/shared/commands/builtin/clear.ts`
- Create: `src/shared/commands/builtin/help.ts`
- Create: `src/shared/commands/builtin/model.ts`
- Create: `src/shared/commands/builtin/session.ts`
- Create: `src/shared/commands/builtin/continue.ts`
- Create: `src/shared/commands/builtin/exit.ts`
- Test: `tests/shared/commands/registry.spec.ts`

**Design Contracts:**

```typescript
export interface Command {
  readonly name: string;
  readonly description: string;
  readonly aliases?: string[];
  execute(args: string[], ctx: CommandContext): Promise<CommandResult>;
}

export interface CommandResult {
  output?: string;
  action?: 'exit' | 'new_session' | 'clear' | 'continue';
  continueSessionId?: string;
}

export interface CommandContext {
  sessionId: string;
  model: string;
  storage: StorageAdapter;
}

export interface CommandRegistry {
  register(cmd: Command): void;
  get(name: string): Command | undefined;
  has(name: string): boolean;
  list(): Command[];
  resolve(input: string): { command: Command; args: string[] } | null;
}

export function createCommandRegistry(): CommandRegistry;
```

**Consumes:** `StorageAdapter` from Task 13, `inheritWorkingMemory` from Task 32

**Produces:** `Command`, `CommandResult`, `CommandContext`, `CommandRegistry`, `createCommandRegistry`, 7 个内置命令

**Behavior:** §8.2 / §8.4 边界。`resolve` 解析 `/cmd args` 或别名。未知命令返回 `null`（由调用方显示 `unknown_command`）。`/continue <id>` 调用 `inheritWorkingMemory`，不存在的 id 返回友好错误。`/exit` 返回 `action: 'exit'`。`/help` 列出所有命令。

**TDD Cycle:**
- [ ] 编写失败测试覆盖：`resolve('/new')` 返回 new 命令、别名解析、未知命令返回 null、`/continue <不存在 id>` 返回错误 output、`/exit` 返回 action=exit、`/help` 输出含所有命令名
- [ ] 验证失败：`npm run test -- tests/shared/commands/registry.spec.ts` → FAIL
- [ ] 实现
- [ ] 验证通过：Exit Code 0
- [ ] 提交：`feat: add CommandRegistry with 7 builtin slash commands (§8.2, §8.4)`

### Task 37: coreReducer UIState machine (§8.3)

**Files:**
- Create: `src/shared/ui-state/reducer.ts`
- Test: `tests/shared/ui-state/reducer.spec.ts`

**Design Contracts:**

```typescript
import type { AgentEvent } from '../../core/agent/events';

export interface MessageViewItem {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  toolCalls?: Array<{ id: string; name: string; status: 'running' | 'success' | 'failed' }>;
  isStreaming?: boolean;
}

export interface UIState {
  messages: MessageViewItem[];
  isWorking: boolean;
  error?: string;
}

export const initialUIState: UIState;

export function coreReducer(state: UIState, event: AgentEvent): UIState;
```

**Consumes:** `AgentEvent` from Task 27

**Produces:** `UIState`, `MessageViewItem`, `coreReducer`, `initialUIState`

**Behavior:** §8.3 状态转换。`turn_start` → isWorking=true；`message_start` → 追加流式 assistant 消息（isStreaming=true）；`message_delta` → 追加文本到当前消息；`message_end` → 标记 isStreaming=false；`tool_call_start` → 追加 toolCall 项 status=running；`tool_result` → 更新 status；`turn_end` → isWorking=false；`error` → 设置 error 字段且 isWorking=false。纯函数，不可变更新。

**TDD Cycle:**
- [ ] 编写失败测试覆盖：`turn_start` 后 isWorking=true、`message_delta` 累积文本、`message_end` 后 isStreaming=false、`turn_end` 后 isWorking=false、`error` 事件后 isWorking=false 且 error 被设置、连续多个 `tool_call_start` 顺序保持
- [ ] 验证失败：`npm run test -- tests/shared/ui-state/reducer.spec.ts` → FAIL
- [ ] 实现
- [ ] 验证通过：Exit Code 0
- [ ] 提交：`feat: add coreReducer UIState machine (§8.3)`

### Task 38: WebSocket server with inbound limits and resync (§10.1.4)

**Files:**
- Create: `src/access/websocket-server.ts`
- Test: `tests/access/websocket-server.spec.ts`

**Design Contracts:**

```typescript
import type { MessageBus } from '../bus/types';

export const WS_MAX_CONNECTIONS = 50;
export const WS_INBOUND_CONTENT_MAX_BYTES = 64 * 1024;
export const WS_INBOUND_MEDIA_MAX_BYTES = 5 * 1024 * 1024;
export const WS_INBOUND_RATE_LIMIT_PER_SEC = 10;
export const WS_HEARTBEAT_TIMEOUT_MS = 60000;
export const WS_OUTBOUND_BUFFER_MAX = 1000;

export interface WebSocketServerOptions {
  port: number;
  bus: MessageBus;
  authToken?: string;
}

export function startWebSocketServer(options: WebSocketServerOptions): Promise<WebSocketServer>;
export interface WebSocketServer {
  stop(): Promise<void>;
  getActiveConnections(): number;
}
```

**Consumes:** `MessageBus` from Task 33, `InboundMessage` from Task 33, `AgentEventEnvelope` from Task 33, `Logger` from Task 4

**Produces:** `startWebSocketServer`, `WebSocketServer`

**Behavior:** §10.1.4 边界。最大 50 连接。入站消息 content 上限 64KB，media 单文件 5MB，超出返回 `inbound_too_large` 并关闭连接。入站频率 10 条/秒，超出返回 `rate_limited` 警告，连续 3 次超限关闭。60s 心跳超时关闭。客户端断连后事件缓冲到 outbound 队列（上限 1000），溢出丢弃 delta 保留关键事件。重连后客户端发 `lastEventSeq`，服务端重放缓冲；seq 已丢弃则发 `resync_required`。连接关闭时 `removeAllListeners` + `terminate()`。

**TDD Cycle:**
- [ ] 编写失败测试覆盖：客户端断连后 agent loop 继续、入站消息超 64KB 返回 inbound_too_large、频率超 10/秒返回 rate_limited、重连后 backlog 重放、seq 已丢弃发 resync_required、连接数超 50 拒绝新连接
- [ ] 验证失败：`npm run test -- tests/access/websocket-server.spec.ts` → FAIL
- [ ] 安装：`npm install ws` `npm install -D @types/ws`
- [ ] 实现
- [ ] 验证通过：Exit Code 0
- [ ] 提交：`feat: add WebSocket server with inbound limits and resync (§10.1.4)`

### Task 39: CLI entry with Ink and 6 components (§8.1, §8.5)

**Files:**
- Create: `src/cli/index.tsx`
- Create: `src/cli/components/assistant-message.tsx`
- Create: `src/cli/components/user-message.tsx`
- Create: `src/cli/components/tool-execution.tsx`
- Create: `src/cli/components/working-loader.tsx`
- Create: `src/cli/components/footer.tsx`
- Create: `src/cli/components/input-editor.tsx`
- Test: `tests/access/cli.spec.tsx`

**Design Contracts:**

```typescript
export interface CLIApp {
  start(): Promise<void>;
}

export function createCLIApp(config: {
  session: AgentSession;
  registry: CommandRegistry;
  channel: Channel;
  model: string;
}): CLIApp;
```

**Consumes:** `AgentSession` from Task 29, `CommandRegistry` from Task 36, `Channel` from Task 33, `coreReducer` from Task 37, `AgentEventEnvelope` from Task 33

**Produces:** `createCLIApp`, 6 个 Ink 组件

**Behavior:** §8.1 / §8.5 CLI 实现。Ink + Yoga 渲染。CLI 作为 Channel 注册到 ChannelManager。`/exit` 触发 `process.exit(0)`。流式渲染 `message_delta` 累积。斜杠命令通过 `CommandRegistry.resolve` 分发。

**TDD Cycle:**
- [ ] 编写失败测试覆盖：渲染 AssistantMessage 含文本、UserMessage 含输入、ToolExecution 显示 tool name + status、WorkingLoader 在 isWorking=true 时显示、Footer 显示 model、InputEditor 接收输入、`/exit` 触发 action=exit
- [ ] 验证失败：`npm run test -- tests/access/cli.spec.tsx` → FAIL
- [ ] 安装：`npm install ink yoga react` `npm install -D @types/react`
- [ ] 实现
- [ ] 验证通过：Exit Code 0
- [ ] 提交：`feat: add CLI entry with Ink and 6 components (§8.1, §8.5)`

### Task 40: WebUI entry with Lit and 6 components (§8.1, §8.5)

**Files:**
- Create: `src/webui/index.ts`
- Create: `src/webui/components/assistant-message.ts`
- Create: `src/webui/components/user-message.ts`
- Create: `src/webui/components/tool-execution.ts`
- Create: `src/webui/components/working-indicator.ts`
- Create: `src/webui/components/footer-bar.ts`
- Create: `src/webui/components/input-box.ts`
- Create: `src/webui/index.html`
- Test: `tests/access/webui.spec.ts`

**Design Contracts:**

```typescript
export interface WebUIApp {
  start(): Promise<void>;
}

export function createWebUIApp(config: {
  wsUrl: string;
  registry: CommandRegistry;
  authToken?: string;
}): WebUIApp;
```

**Consumes:** `CommandRegistry` from Task 36, `coreReducer` from Task 37, `AgentEventEnvelope` from Task 33

**Produces:** `createWebUIApp`, 6 个 Lit 组件

**Behavior:** §8.1 / §8.5 WebUI 实现。Lit + Web Components。WebSocket 连接到 server，消费 `AgentEventEnvelope`。`coreReducer` 维护 UIState，组件订阅 state 切片。流式渲染 `message_delta`。斜杠命令本地解析（不需要回环 server）。

**TDD Cycle:**
- [ ] 编写失败测试覆盖：`<assistant-message>` 渲染 text、`<user-message>` 渲染输入、`<tool-execution>` 显示 status、`<working-indicator>` 在 isWorking=true 时可见、`<footer-bar>` 显示 model、`<input-box>` 派发 submit 事件
- [ ] 验证失败：`npm run test -- tests/access/webui.spec.ts` → FAIL
- [ ] 安装：`npm install lit`
- [ ] 实现
- [ ] 验证通过：Exit Code 0
- [ ] 提交：`feat: add WebUI entry with Lit and 6 components (§8.1, §8.5)`

### Task 41: Server entry wiring all layers

**Files:**
- Create: `src/server.ts`
- Test: `tests/e2e/wiring.spec.ts`

**Design Contracts:**

```typescript
export interface ServerConfig {
  port: number;
  deploy: 'local' | 'cf';
  authToken?: string;
}

export function startServer(config: ServerConfig): Promise<void>;
```

**Consumes:** 全部前序任务的产物

**Produces:** `startServer`, `ServerConfig`

**Behavior:** 启动入口，组装所有层：loadConfig → createFileStorage → createToolRegistry(bash/read/edit/update_working_memory) → createProvider → createAgentSession → createInMemoryMessageBus → createChannelManager → register WebSocketChannel + CLIChannel → startWebSocketServer → installProcessHandlers → startMemoryMonitor。

**TDD Cycle:**
- [ ] 编写失败测试覆盖：`startServer` 后 WebSocket 可连接、SIGINT 触发优雅关闭、所有组件被注入
- [ ] 验证失败：`npm run test -- tests/e2e/wiring.spec.ts` → FAIL
- [ ] 实现
- [ ] 验证通过：Exit Code 0
- [ ] 提交：`feat: add server entry wiring all layers`

### Task 42: E2E test covering MVP acceptance #1-11 (§11.3)

**Files:**
- Create: `tests/e2e/full-loop.spec.ts`
- Test: `tests/e2e/full-loop.spec.ts`

**Design Contracts:**
- 覆盖 §11.3 全部 11 项验收标准

**Consumes:** 全部前序任务

**Behavior:** §11.3 验收闭环。mock LLM 返回预设响应，验证：
1. 基础对话：用户输入 → LLM 流式响应 → 消息完整显示
2. 工具调用：LLM 调用 bash → 执行 → 结果回传 → LLM 继续生成
3. 多轮对话：连续 3 轮 context 累积
4. 持久化：进程重启后恢复历史
5. Working Memory：`update_working_memory` → 重启后 keyInfo 恢复
6. 错误恢复：LLM 返回 500 → Provider 重试 → 恢复
7. WebSocket 断连重连：断连 → 重连 → backlog 重放
8. CLI 命令：7 个命令全部可用
9. WebUI 基础：浏览器访问 → 流式显示
10. Compaction：长对话触发 → summary 生成 → 上下文下降
11. 跨 session 继承：`/continue <oldId>` → keyInfo 一致 + passedSessions +1

**TDD Cycle:**
- [ ] 编写 E2E 测试覆盖 MVP 验收 #1-11
- [ ] 运行：`npm run test -- tests/e2e/full-loop.spec.ts` → 若前序任务均完成则通过
- [ ] 运行全量：`npm run test` → All tests passed, Exit Code 0
- [ ] 提交：`test: add E2E integration test for full agent loop (§11.3 MVP #1-11)`

---

## Self-Review Summary

### Spec Coverage

- ✅ **Phase 0 项目初始化**：package.json (T1)、TypeScript strict (T2)、vitest (T3)
- ✅ **Phase 1 基建层**：Logger §10.7 (T4)、Config §10.8 (T5-T6)、JSONL §10.11 + §10.1.1 (T7-T10)、AgentMessage (T11)、SessionEntry §6.2/§10.10/§10.12 (T12)、FileStorage §9.4 (T13)、Process §10.13/§10.14 (T14)
- ✅ **Phase 2 核心层**：Provider types (T15)、dual-clock §10.1.5 (T16)、retry §10.1.5 (T17)、sanitize (T18)、openai-responses (T19)、anthropic-messages (T20)、providers/registry (T21)、ToolRegistry (T22)、bash §10.1.2 (T23)、read §10.1.2 (T24)、edit §10.1.2 (T25)、update_working_memory §6.5 (T26)、AgentEvent §3.2 (T27)、AgentLoop L1 §3.3/§10.1.7 (T28)、AgentSession L2 §3.4 (T29)、SessionRepo §6.3 (T30)、Compaction §6.4/§10.1.1 (T31)、WorkingMemory §6.5 (T32)
- ✅ **Phase 3 总线层**：Channel/Envelope §7.2 (T33)、MessageBus §7.3/§10.1.6 (T34)、ChannelManager §7.2/§10.1.6 (T35)
- ✅ **Phase 4 接入层**：CommandRegistry §8.2/§8.4 (T36)、coreReducer §8.3 (T37)、WebSocket §10.1.4 (T38)、CLI §8.1/§8.5 (T39)、WebUI §8.1/§8.5 (T40)、Server wiring (T41)、E2E §11.3 (T42)

### Engineering Boundaries Injection (§10 / §11)

- ✅ §10.1.1 Memory 边界：T8 (corruption-tolerant), T9 (repair), T10 (mutex), T31 (Compaction LLM failure)
- ✅ §10.1.2 Tool 边界：T23 (bash 30s), T24 (read 2MB), T25 (edit mutex)
- ✅ §10.1.3 Session 恢复：T13 (FileStorage 完全损坏备份), T30 (idempotent open)
- ✅ §10.1.4 WebSocket 边界：T38 (inbound limits, heartbeat, resync)
- ✅ §10.1.5 Provider 流式边界：T16 (dual-clock), T17 (401/403/400 fatal, 429/5xx retry)
- ✅ §10.1.6 Channel/MessageBus 边界：T34 (queue overflow), T35 (dead letter, idempotent bind)
- ✅ §10.1.7 AgentLoop 边界：T28 (maxIterations, AbortSignal, steering queue)
- ✅ §10.2 资源上限：T14 (memory monitor), T38 (WS limits), T10 (mutex timeout)
- ✅ §10.3 超时：T16 (TTFB/chunk), T23 (bash 30s), T24 (read 5s), T25 (edit 5s), T38 (heartbeat 60s)
- ✅ §10.4 不变量：T28 (event FIFO), T13 (append-only), T26 (working memory monotonic), T29 (turn atomicity)
- ✅ §10.5 Token 计算：T31 (3-level estimation, Compaction budget 2048)
- ✅ §10.6 事件循环与 FD：T7 (mkdirp), T24 (streaming read), T38 (removeAllListeners)
- ✅ §10.7 Logger：T4 (rotation, masking, async)
- ✅ §10.8 Config Schema：T5 (zod), T6 (env var priority)
- ✅ §10.9 AbortSignal 传播：T16 (Provider 100ms), T23/T24/T25 (Tool 500ms), T13 (Memory 50ms via mutex), T28 (Session 200ms)
- ✅ §10.10 Timestamp：T12 (ms UTC, `timestamp: number`)
- ✅ §10.11 JSONL 编码：T7 (UTF-8 no BOM, LF, trailing newline)
- ✅ §10.12 文件路径：T12 (UUID regex, path traversal, 255 char limit)
- ✅ §10.13 进程信号：T14 (SIGINT 10s, SIGTERM 30s, SIGHUP ignore)
- ✅ §10.14 进程级异常：T14 (uncaughtException exit, unhandledRejection log, memory monitor, turn watchdog)

### Assertion Coverage (§11.2)

- ✅ AgentLoop：T28 (maxIterations, AbortSignal)
- ✅ Provider：T17 (401/403/400, TTFB, chunk), T19/T20 (重试)
- ✅ Tool：T23 (bash 超时), T24 (read 大文件), T25 (edit 幂等), T26 (truncation)
- ✅ Memory：T8/T9 (JSONL 损坏), T13 (完全损坏备份), T31 (Compaction LLM 失败), T26 (key_info 截断)
- ✅ Channel：T34 (queue overflow), T35 (dead letter), T38 (resync_required, inbound_too_large)
- ✅ Config：T5 (schema), T6 (env var priority)
- ✅ CommandRegistry：T36 (unknown command, aliases, /continue 不存在 id)
- ✅ UIState coreReducer：T37 (所有事件转换)
- ✅ StorageAdapter：T13 (readSession 不存在返回空, appendSession 原子性)

### MVP Acceptance (§11.3)

- T42 E2E 覆盖 #1-11 全部验收项
- #1-4: 基础对话/工具调用/多轮/持久化
- #5: Working Memory (T26 + T32)
- #6: 错误恢复 (T17)
- #7: WebSocket 断连重连 (T38)
- #8: CLI 命令 (T36)
- #9: WebUI 基础 (T40)
- #10: Compaction (T31)
- #11: 跨 session 继承 (T32 + T36 /continue)

### Placeholder Scan

- 任务步骤中无 TBD/TODO
- 无具体函数体或业务逻辑 —— 仅 Interface/Types 契约
- 所有测试命令已指定
- 行为描述简短且聚焦契约

### Type Consistency

- `AgentTool` 接口一致：T22（定义）→ T23-T26（实现工具）→ T28（loop 调用）
- `SessionEntry` 一致：T12（定义）→ T13（storage）→ T29-T31（append/consume）
- `AgentEvent` 一致：T27（定义）→ T28（yield）→ T29（转发）→ T33（envelope）→ T37（reducer）
- `Provider` / `Model` / `Context` 一致：T15（定义）→ T16-T21（实现）→ T28-T31（消费）
- `MessageBus` 一致：T33（定义）→ T34（实现）→ T35（manager）→ T38-T40（消费）
- `StorageAdapter` 一致：T13（定义）→ T26（tool）→ T29-T32（memory）→ T36（command）
- `AgentEventEnvelope` 一致：T33（定义）→ T34（bus）→ T35（dispatch）→ T38-T40（channel）
- `timestamp: number` 命名一致：T11（AgentMessage）→ T12（SessionEntry 定义）→ T13（storage）
