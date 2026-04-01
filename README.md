# Goder Code

> 一个对 Anthropic 官方 Claude Code CLI 的逆向工程 / 反编译项目，在还原核心功能的基础上新增安全特性与中文支持。

基于 Anthropic 官方 [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI 的分发产物反编译还原，恢复了完整的核心功能（REPL 对话、工具系统、API 通信、MCP 集成等），并在此基础上添加了四项实用安全特性和 `/helpc` 中文帮助系统。

## 快速开始

### 环境要求

请使用最新版本的 Bun，避免遇到兼容性问题。

```bash
bun upgrade
```

- [Bun](https://bun.sh/) >= 1.3.11

### 安装与运行

```bash
# 克隆项目
git clone https://github.com/ChrisWu0318/goder-code.git
cd goder-code

# 安装依赖
bun install

# 开发模式（版本号显示 888 说明加载成功）
bun run dev

# 管道模式（非交互式）
echo "帮我总结一下当前目录的文件" | bun run src/entrypoints/cli.tsx -p

# 构建（输出 dist/ 目录，入口为 dist/cli.js + ~450 个 chunk 文件）
bun run build
```

构建产物同时支持 Bun 和 Node 启动。

### API 认证

Goder Code 支持多种模型 Provider，通过环境变量配置：

#### Anthropic 直连

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
bun run dev
```

#### OpenRouter（推荐，可访问数百个模型）

```bash
export CLAUDE_CODE_USE_OPENAI_COMPAT=1
export OPENAI_API_KEY="sk-or-v1-xxxxxxxx"
export OPENAI_BASE_URL="https://openrouter.ai/api/v1"
export OPENAI_MODEL="anthropic/claude-sonnet-4"    # 可换成任何模型，如 deepseek/deepseek-chat-v3、qwen/qwen3-235b-a22b
bun run dev
```

#### 本地模型（Ollama / vLLM / LiteLLM）

```bash
export CLAUDE_CODE_USE_OPENAI_COMPAT=1
export OPENAI_API_KEY="ollama"
export OPENAI_BASE_URL="http://localhost:11434/v1"
export OPENAI_MODEL="qwen3:235b"
bun run dev
```

#### AWS Bedrock

```bash
export CLAUDE_CODE_USE_BEDROCK=1
export AWS_ACCESS_KEY_ID="..."
export AWS_SECRET_ACCESS_KEY="..."
bun run dev
```

#### Google Vertex

```bash
export CLAUDE_CODE_USE_VERTEX=1
export CLOUD_ML_REGION="us-east5"
bun run dev
```

#### 写入 zsh 配置（永久生效）

把环境变量加到 `~/.zshrc`，避免每次手动 export：

```bash
# Goder Code — OpenRouter 配置
export CLAUDE_CODE_USE_OPENAI_COMPAT=1
export OPENAI_API_KEY="sk-or-v1-xxxxxxxx"
export OPENAI_BASE_URL="https://openrouter.ai/api/v1"
export OPENAI_MODEL="anthropic/claude-sonnet-4"
```

保存后执行 `source ~/.zshrc` 即可。

## Goder Code 增强特性

在还原原版 Claude Code 全部核心能力的基础上，Goder Code 新增了以下特性：

### 四项核心功能

**1. Bash 命令过滤器** (`src/tools/BashTool/commandFilter.ts`)

预执行安全拦截，内置危险命令黑名单（`rm -rf /`、`mkfs`、fork bomb 等），支持通过 `~/.claude/settings.json` 或环境变量自定义允许/拒绝规则：

```bash
export GODER_BASH_ALLOW="git:*,npm:*"
export GODER_BASH_DENY="rm:-rf /,mkfs:*,dd:if=/dev/zero"
```

**2. Agent 安全护栏** (`src/utils/agentGuardrails.ts`)

防止失控的 API 消耗和无限循环：
- 最大轮次限制（`GODER_MAX_TURNS`，默认 100）
- 成本预算控制（`GODER_MAX_BUDGET_USD`，默认 $5）
- 滑动窗口循环检测（5 次连续相同工具调用自动停止）
- 连续错误熔断（3 次连续错误自动停止）

```bash
export GODER_MAX_TURNS=100
export GODER_MAX_BUDGET_USD=5
```

**3. 智能压缩** (`src/services/compact/smartCompact.ts`)

本地对话压缩，无需额外 API 调用，四个阶段：裁剪大型工具结果 → 分段分组 → 摘要合并 → 保留最近 N 轮对话。

**4. Feature Flag 选择性启用** (`src/entrypoints/cli.tsx`)

`feature()` 从始终返回 `false` 改为通过 `ENABLED_FEATURES` 集合选择性启用，解锁 7 个高级功能模块。

### 已启用的 Feature Flags (7 个)

| Flag | 说明 |
|------|------|
| `BG_SESSIONS` | 后台会话管理（`claude ps` / `logs` / `attach` / `kill` + `--bg` 后台运行） |
| `BUDDY` | 伴侣精灵（Tux 企鹅）动画交互 |
| `COORDINATOR_MODE` | 多代理协调，主线程分配子任务给 worker agent |
| `TRANSCRIPT_CLASSIFIER` | 基于对话分析的自动工具权限决策（`claude auto-mode`） |
| `MCP_SKILLS` | MCP 服务器提供的可调用 skills/prompts |
| `HARD_FAIL` | 严格错误处理模式（`--hard-fail` 使错误立即终止进程） |
| `VOICE_MODE` | 语音输入（按住空格录音，Groq/OpenAI Whisper 转文字） |

### 语音输入

**5. Voice Mode — 按住空格，语音转文字** (`src/services/voiceHttpSTT.ts`)

按住空格键录音，松开自动转文字并填入输入框。使用 Groq 或 OpenAI 的 Whisper API 进行语音识别，无需 Anthropic 账号。

**快速开始（推荐 Groq，免费）：**

```bash
# 1. 注册 Groq（免费）: https://console.groq.com
# 2. 创建 API Key，添加到环境变量
export GROQ_API_KEY="gsk_xxxxxxxx"

# 3. 安装录音工具（macOS）
brew install sox

# 4. 启动后输入 /voice 开启语音模式
bun run dev
```

**STT Provider 优先级：**

| 优先级 | 环境变量 | Provider | 说明 |
|--------|----------|----------|------|
| 1 | `GODER_STT_API_KEY` | 自定义 | 配合 `GODER_STT_PROVIDER` / `GODER_STT_BASE_URL` / `GODER_STT_MODEL` |
| 2 | `GROQ_API_KEY` | Groq Whisper | 免费额度，whisper-large-v3-turbo，速度极快 |
| 3 | `OPENAI_API_KEY`（非 OpenRouter） | OpenAI Whisper | whisper-1，$0.006/min |

> **注意：** 使用 OpenRouter 的用户需要单独设置 `GROQ_API_KEY`（免费注册），因为 OpenRouter 不提供 STT 服务。

**录音依赖：**
- macOS: `brew install sox`
- Linux: `sudo apt install sox` 或 `sudo apt install alsa-utils`

**使用方式：**
1. 输入 `/voice` 开启语音模式
2. 按住空格键录音，松开自动提交
3. 支持 19 种语言（通过 `/config` 设置 `language`）

### 稳定性与健壮性增强

**6. 流式看门狗** (`src/services/api/claude.ts`)

防止 API 流式响应卡死：
- 默认启用（原版需手动设 `CLAUDE_ENABLE_STREAM_WATCHDOG=1`）
- 空闲超时 90s → 45s，卡顿检测 30s → 15s
- 新增卡顿熔断器：连续 3 次 stall 自动终止流

```bash
export CLAUDE_STREAM_IDLE_TIMEOUT_MS=45000   # 可自定义空闲超时
```

**7. OpenAI 兼容模式上下文窗口自动识别** (`src/utils/context.ts`)

原版默认 200K tokens，使用第三方模型时不会触发自动压缩导致上下文溢出。现已内置模型名 → 上下文窗口映射表（支持 Claude/GPT/DeepSeek/Qwen/Gemini/Llama/Mistral），未知模型保守默认 64K。

```bash
export CLAUDE_CODE_MAX_CONTEXT_TOKENS=128000  # 手动覆盖上下文窗口大小
```

**8. 图片粘贴超时保护** (`src/hooks/usePasteHandler.ts`, `src/utils/imagePaste.ts`)

修复粘贴图片时 osascript 可能永远不返回导致 UI 卡在 "Pasting text…" 的问题，添加 5 秒安全超时。

**9. 上下文链完整性保护** (`src/utils/sessionStorage.ts`, `src/query.ts`)

- `buildConversationChain()` 中 parentUuid 找不到时记录错误而非静默截断
- fallback 触发时记录被清空的消息数量
- 双重压缩失败时记录当前消息数和 token 估计值

**10. 工具错误消息强化** (`src/tools/FileWriteTool/`, `FileEditTool/`, `NotebookEditTool/`)

Write/Edit/NotebookEdit 工具的错误消息包含具体文件名，并明确指示模型 "立即修复并重试"，防止模型在工具错误后跑偏到无关任务。

**11. 系统提示防跑偏指令** (`src/constants/prompts.ts`)

- 工具错误恢复：要求 tool error 后立即修复重试，不得放弃或切换任务
- 禁止虚假拒绝：不得在合法任务上声称违反规则

### 中文帮助

输入 `/helpc` 查看完整的中文帮助文档，包含所有功能、命令、快捷键和配置说明。

## 能力清单

> ✅ 已实现 &emsp; ⚠️ 部分实现 / 条件启用 &emsp; ❌ stub / 移除 / feature flag 关闭

### 核心系统

| 能力 | 状态 | 说明 |
|------|------|------|
| REPL 交互界面（Ink 终端渲染） | ✅ | 主屏幕 5000+ 行，完整交互 |
| API 通信 — Anthropic Direct | ✅ | 支持 API Key + OAuth |
| API 通信 — AWS Bedrock | ✅ | 支持凭据刷新、Bearer Token |
| API 通信 — Google Vertex | ✅ | 支持 GCP 凭据刷新 |
| API 通信 — Azure Foundry | ✅ | 支持 API Key + Azure AD |
| API 通信 — OpenRouter | ✅ | OpenAI 兼容适配器（883 行），支持数百模型 |
| 流式对话与工具调用循环 (`query.ts`) | ✅ | 1700+ 行，含自动压缩、token 追踪 |
| 会话引擎 (`QueryEngine.ts`) | ✅ | 1300+ 行，管理对话状态与归因 |
| 上下文构建（git status / CLAUDE.md / memory） | ✅ | `context.ts` 完整实现 |
| 权限系统（plan/auto/manual 模式） | ✅ | 6300+ 行，含 YOLO 分类器、路径验证、规则匹配 |
| Hook 系统（pre/post tool use） | ✅ | 支持 settings.json 配置 |
| 会话恢复 (`/resume`) | ✅ | 独立 ResumeConversation 屏幕 |
| Doctor 诊断 (`/doctor`) | ✅ | 版本、API、插件、沙箱检查 |
| 自动压缩 (compaction) | ✅ | auto-compact / micro-compact / API compact |
| 后台会话管理 (`BG_SESSIONS`) | ✅ | `claude ps` / `logs` / `attach` / `kill` + `--bg` 后台运行 |
| 多 Agent 协调模式 (`COORDINATOR_MODE`) | ✅ | Claude 作为协调者分派任务给 Worker Agent，支持并行执行 |
| 对话分类器 (`TRANSCRIPT_CLASSIFIER`) | ✅ | 基于上下文自动判断是否批准/拒绝工具调用，`claude auto-mode` |
| MCP 技能系统 (`MCP_SKILLS`) | ✅ | MCP 服务器提供可被模型直接调用的 skill / prompt |
| 严格错误模式 (`HARD_FAIL`) | ✅ | 配合 `--hard-fail` 参数，`logError()` 立即终止进程 |
| 伴侣精灵 (`BUDDY`) | ✅ | Tux 企鹅动画角色 + 气泡反应，增强终端交互体验 |
| 语音输入 (`VOICE_MODE`) | ✅ | 按住空格录音，Groq/OpenAI Whisper 转文字，支持 19 种语言 |
| Bash 命令过滤器 | ✅ | 新增：预执行安全拦截 + 自定义规则 |
| Agent 安全护栏 | ✅ | 新增：成本预算、轮次限制、循环检测、熔断 |
| 智能压缩 | ✅ | 新增：本地对话压缩，无需 API 调用 |
| `/helpc` 中文帮助 | ✅ | 新增：完整中文帮助文档 |

### 工具 — 始终可用

| 工具 | 状态 | 说明 |
|------|------|------|
| BashTool | ✅ | Shell 执行，沙箱，权限检查 |
| FileReadTool | ✅ | 文件 / PDF / 图片 / Notebook 读取 |
| FileEditTool | ✅ | 字符串替换式编辑 + diff 追踪 |
| FileWriteTool | ✅ | 文件创建 / 覆写 + diff 生成 |
| NotebookEditTool | ✅ | Jupyter Notebook 单元格编辑 |
| AgentTool | ✅ | 子代理派生（fork / async / background / remote） |
| WebFetchTool | ✅ | URL 抓取 → Markdown → AI 摘要 |
| WebSearchTool | ✅ | 网页搜索 + 域名过滤 |
| AskUserQuestionTool | ✅ | 多问题交互提示 + 预览 |
| SendMessageTool | ✅ | 消息发送（peers / teammates / mailbox） |
| SkillTool | ✅ | 斜杠命令 / Skill 调用 |
| EnterPlanModeTool | ✅ | 进入计划模式 |
| ExitPlanModeTool | ✅ | 退出计划模式 |
| BriefTool | ✅ | 简短消息 + 附件发送 |
| CronCreateTool | ✅ | 定时任务创建 |
| CronDeleteTool | ✅ | 定时任务删除 |
| CronListTool | ✅ | 定时任务列表 |
| EnterWorktreeTool | ✅ | 进入 Git Worktree |
| ExitWorktreeTool | ✅ | 退出 Git Worktree |

### 工具 — 条件启用

| 工具 | 启用条件 |
|------|----------|
| GlobTool | 默认启用（未嵌入 bfs/ugrep 时） |
| GrepTool | 默认启用（同上） |
| TaskCreateTool / TaskGetTool / TaskUpdateTool / TaskListTool | TodoV2 启用时 |
| PowerShellTool | Windows 平台 |
| LSPTool | `ENABLE_LSP_TOOL` 环境变量 |

### 工具 — Feature Flag 关闭（不可用）

`SleepTool` · `RemoteTriggerTool` · `MonitorTool` · `SendUserFileTool` · `OverflowTestTool` · `TerminalCaptureTool` · `WebBrowserTool` · `SnipTool` · `WorkflowTool` · `PushNotificationTool` · `SubscribePRTool` · `ListPeersTool` · `CtxInspectTool`

### 斜杠命令 — 可用

`/add-dir` · `/advisor` · `/agents` · `/branch` · `/btw` · `/chrome` · `/clear` · `/color` · `/compact` · `/config` · `/context` · `/copy` · `/cost` · `/desktop` · `/diff` · `/doctor` · `/effort` · `/exit` · `/export` · `/extra-usage` · `/fast` · `/feedback` · `/heapdump` · `/help` · `/helpc` · `/hooks` · `/ide` · `/init` · `/install-github-app` · `/install-slack-app` · `/keybindings` · `/login` · `/logout` · `/loop` · `/mcp` · `/memory` · `/mobile` · `/model` · `/output-style` · `/passes` · `/permissions` · `/plan` · `/plugin` · `/pr-comments` · `/privacy-settings` · `/rate-limit-options` · `/release-notes` · `/reload-plugins` · `/remote-env` · `/rename` · `/resume` · `/review` · `/ultrareview` · `/rewind` · `/sandbox-toggle` · `/security-review` · `/session` · `/skills` · `/stats` · `/status` · `/statusline` · `/stickers` · `/tasks` · `/theme` · `/think-back` · `/upgrade` · `/usage` · `/insights` · `/vim` · `/buddy`

### CLI 子命令

| 子命令 | 说明 |
|--------|------|
| `claude`（默认） | 主 REPL / 交互 / print 模式 |
| `claude mcp serve/add/remove/list/get/...` | MCP 服务管理 |
| `claude auth login/status/logout` | 认证管理 |
| `claude plugin validate/list/install/...` | 插件管理 |
| `claude setup-token` | 长效 Token 配置 |
| `claude agents` | 代理列表 |
| `claude doctor` | 健康检查 |
| `claude update` / `upgrade` | 自动更新 |
| `claude install [target]` | Native 安装 |
| `claude auto-mode` | 对话分类器模式（`TRANSCRIPT_CLASSIFIER` 已启用） |

### 内部包 (`packages/`)

| 包 | 状态 | 说明 |
|------|------|------|
| `color-diff-napi` | ✅ | 完整 TypeScript 实现（语法高亮 diff） |
| `audio-capture-napi` | ✅ | 跨平台音频录制（SoX/arecord） |
| `image-processor-napi` | ✅ | macOS 剪贴板图片读取（osascript + sharp） |
| `modifiers-napi` | ✅ | macOS 修饰键检测（bun:ffi + CoreGraphics） |
| `url-handler-napi` | ❌ | stub，返回 null |
| `@ant/computer-use-input` | ✅ | macOS 键鼠模拟（AppleScript/JXA/CGEvent） |
| `@ant/computer-use-swift` | ✅ | macOS 显示器/应用管理/截图（JXA/screencapture） |
| `@ant/computer-use-mcp` | ⚠️ | 类型安全 stub（完整类型定义但函数返回空值） |

## 项目结构

```
src/
├── entrypoints/        # 启动入口（cli.tsx, init.ts）— 含 MACRO/feature polyfill
├── screens/            # REPL 交互界面（5000+ 行）
├── services/
│   ├── api/            # API 客户端（Anthropic / Bedrock / Vertex / Azure / OpenRouter）
│   ├── compact/        # 对话压缩（auto / micro / API / smart）
│   ├── mcp/            # MCP 协议实现（12000+ 行）
│   ├── oauth/          # OAuth 认证
│   └── plugins/        # 插件基础设施
├── tools/              # 40+ 工具（Bash / File / Grep / Agent 等）
├── components/         # Ink/React 终端 UI 组件
├── state/              # Zustand 状态管理
├── utils/
│   ├── agentGuardrails.ts   # Agent 安全护栏（新增）
│   └── model/providers.ts   # Provider 选择逻辑
├── context.ts          # 系统提示词构建（git 状态、日期、CLAUDE.md）
├── query.ts            # 核心 API 查询函数（1700+ 行）
└── QueryEngine.ts      # 对话编排引擎（1300+ 行）
packages/               # Monorepo workspace 子包
scripts/                # 构建与维护脚本
build.ts                # 构建脚本（bun build CLI + --feature flags + code splitting）
```

## 配置

### Bash 命令过滤

```bash
# 允许/拒绝特定命令模式
export GODER_BASH_ALLOW="git:*,npm:*"
export GODER_BASH_DENY="rm:-rf /,mkfs:*,dd:if=/dev/zero"
```

支持精确匹配、前缀通配和正则表达式。也可在 `~/.claude/settings.json` 中配置。

### Agent 护栏

```bash
export GODER_MAX_TURNS=100        # 最大对话轮次（默认 100）
export GODER_MAX_BUDGET_USD=5     # 最大费用预算（默认 $5）
```

### 语音输入

```bash
# 方式 1: Groq（推荐，免费）
export GROQ_API_KEY="gsk_xxxxxxxx"

# 方式 2: 自定义 STT provider
export GODER_STT_PROVIDER="groq"                # 或 "openai"
export GODER_STT_API_KEY="your-api-key"
export GODER_STT_BASE_URL="https://api.groq.com/openai"  # 可选
export GODER_STT_MODEL="whisper-large-v3-turbo"           # 可选
```

### 严格错误模式

```bash
bun run dev -- --hard-fail        # 遇到错误立即终止进程
```

## 技术说明

### 构建系统

`build.ts` 使用 `bun build` CLI 命令（而非 `Bun.build()` API）进行打包，因为 CLI 支持 `--feature=FLAG` 参数控制 `bun:bundle` 的 `feature()` 函数。`Bun.build()` API 不支持 `bun:bundle` 插件，会导致所有 feature flag 在打包时返回 `false`，tree-shake 掉所有 feature-gated 代码。

构建流程：
1. 清理 `dist/` 目录
2. 调用 `bun build --splitting --target bun --feature=BUDDY --feature=BG_SESSIONS ...`
3. 后处理：为 Node.js 兼容性修补 `import.meta.require`

构建产物为 `dist/cli.js` 主入口 + 约 450 个 chunk 文件，同时支持 Bun 和 Node.js 启动。

### 运行时 Polyfill

入口文件 `src/entrypoints/cli.tsx` 顶部注入了必要的 polyfill，使开发模式（`bun run dev`）无需构建即可运行：
- `feature()` — 通过 `ENABLED_FEATURES` 集合选择性启用 feature flag（开发模式下从环境变量或默认值读取）
- `globalThis.MACRO` — 模拟构建时宏注入（VERSION、BUILD_TIME 等）
- `BUILD_TARGET`、`BUILD_ENV`、`INTERFACE_TYPE` 全局常量

### Monorepo

项目采用 Bun workspaces 管理内部包。原先手工放在 `node_modules/` 下的 stub 已统一迁入 `packages/`，通过 `workspace:*` 解析。内部包包括：
- `color-diff-napi` — 语法高亮 diff（完整 TypeScript 实现）
- `audio-capture-napi` — 跨平台音频录制
- `image-processor-napi` — macOS 剪贴板图片读取
- `modifiers-napi` — macOS 修饰键检测
- `@ant/computer-use-*` — 计算机控制（键鼠模拟、显示器管理）

### 类型系统

约 1341 个 tsc 错误，均来自反编译过程（主要是 `unknown`/`never`/`{}` 类型），不影响 Bun 运行时执行。类型声明文件位于 `src/types/`，包括全局类型（`global.d.ts`）、内部模块类型（`internal-modules.d.ts`）和消息类型（`message.ts`）。

## 赞赏

如果觉得 Goder Code 对你有帮助，欢迎请我喝杯咖啡 ☕

<table>
<tr>
<td align="center">
<img src="assets/wechat-sponsor.jpg" width="200" alt="微信赞赏码"/><br/>
<strong>微信</strong>
</td>
<td align="center">
<img src="assets/alipay-sponsor.jpg" width="200" alt="支付宝收款码"/><br/>
<strong>支付宝</strong>
</td>
</tr>
</table>

## 注意事项

- 本项目是逆向工程产物，仅供学习和研究用途
- 配置目录（`~/.claude/`）、会话（`goder-sessions`）、项目（`goder-projects`）使用独立命名空间，不会污染原版 Claude Code 的数据
- 原版 Claude Code 的所有权利归 [Anthropic](https://www.anthropic.com/) 所有
