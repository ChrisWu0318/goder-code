# Goder Code

**English** | [中文](README.md)
[☕ Sponsorship](#sponsorship)

> A terminal-based AI assistant built on modern AI capabilities, featuring complete REPL conversation, tool system, API communication and MCP integration, with added security features and multi-language support.

Built from the ground up with complete core functionality (REPL conversation, tool system, API communication, MCP integration, etc.), with four practical security features and `/helpc` Chinese help system added on top.

## Quick Start

### Prerequisites

Use the latest version of Bun to avoid compatibility issues.

```bash
bun upgrade
```

- [Bun](https://bun.sh/) >= 1.3.11

### Installation & Running

```bash
# Clone the repository
git clone https://github.com/ChrisWu0318/goder-code.git
cd goder-code

# Install dependencies
bun install

# Dev mode (version number displays 888 when loaded successfully)
bun run dev

# Pipe mode (non-interactive)
echo "Summarize the files in the current directory" | bun run src/entrypoints/cli.tsx -p

# Build (outputs dist/ directory, entry point dist/cli.js + ~450 chunk files)
bun run build
```

Build artifacts support launching with both Bun and Node.js.

### API Authentication

Goder Code supports multiple model providers, configured via environment variables:

#### Anthropic Direct

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
bun run dev
```

#### OpenRouter (Recommended, access to hundreds of models)

```bash
export CLAUDE_CODE_USE_OPENAI_COMPAT=1
export OPENAI_API_KEY="sk-or-v1-xxxxxxxx"
export OPENAI_BASE_URL="https://openrouter.ai/api/v1"
export OPENAI_MODEL="anthropic/claude-sonnet-4"    # Any model can be used, e.g. deepseek/deepseek-chat-v3, qwen/qwen3-235b-a22b
bun run dev
```

#### Local Models (Ollama / vLLM / LiteLLM)

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

#### Write to zsh config (permanent)

Add the environment variables to `~/.zshrc` to avoid manual export each time:

```bash
# Goder Code — OpenRouter configuration
export CLAUDE_CODE_USE_OPENAI_COMPAT=1
export OPENAI_API_KEY="sk-or-v1-xxxxxxxx"
export OPENAI_BASE_URL="https://openrouter.ai/api/v1"
export OPENAI_MODEL="anthropic/claude-sonnet-4"
```

Run `source ~/.zshrc` after saving.

## Goder Code Enhanced Features

Built on top of all core capabilities of the original Claude Code, Goder Code adds the following features:

### Four Core Features

**1. Bash Command Filter** (`src/tools/BashTool/commandFilter.ts`)

Pre-execution security interception with a built-in blacklist of dangerous commands (`rm -rf /`, `mkfs`, fork bomb, etc.). Supports custom allow/deny rules via `~/.claude/settings.json` or environment variables:

```bash
export GODER_BASH_ALLOW="git:*,npm:*"
export GODER_BASH_DENY="rm:-rf /,mkfs:*,dd:if=/dev/zero"
```

**2. Agent Safety Guardrails** (`src/utils/agentGuardrails.ts`)

Prevents runaway API consumption and infinite loops:
- Maximum turn limit (`GODER_MAX_TURNS`, default 100)
- Cost budget control (`GODER_MAX_BUDGET_USD`, default $5)
- Sliding window loop detection (auto-stop on 5 consecutive identical tool calls)
- Consecutive error circuit breaker (auto-stop on 3 consecutive errors)

```bash
export GODER_MAX_TURNS=100
export GODER_MAX_BUDGET_USD=5
```

**3. Smart Compaction** (`src/services/compact/smartCompact.ts`)

Local conversation compression without additional API calls. Four stages: trim large tool results → segment grouping → summary merge → retain last N conversation rounds.

**4. Feature Flag Selective Enablement** (`src/entrypoints/cli.tsx`)

`feature()` changed from always returning `false` to selective enablement via `ENABLED_FEATURES` set, unlocking 7 advanced feature modules.

### Enabled Feature Flags (7)

| Flag | Description |
|------|-------------|
| `BG_SESSIONS` | Background session management (`claude ps` / `logs` / `attach` / `kill` + `--bg` background execution) |
| `BUDDY` | Buddy mascot (Tux penguin) animated interaction |
| `COORDINATOR_MODE` | Multi-agent coordination — main thread dispatches sub-tasks to worker agents |
| `TRANSCRIPT_CLASSIFIER` | Automatic tool permission decisions based on conversation analysis (`claude auto-mode`) |
| `MCP_SKILLS` | MCP server-provided callable skills/prompts |
| `HARD_FAIL` | Strict error handling mode (`--hard-fail` makes errors immediately terminate the process) |
| `VOICE_MODE` | Voice input (hold space to record, Groq/OpenAI Whisper transcription) |

### Voice Input

**5. Voice Mode — Hold Space, Speech to Text** (`src/services/voiceHttpSTT.ts`)

Hold the spacebar to record, release to auto-transcribe and fill into the input box. Uses Groq or OpenAI's Whisper API for speech recognition — no Anthropic account required.

**Quick Start (Groq recommended, free):**

```bash
# 1. Sign up for Groq (free): https://console.groq.com
# 2. Create an API Key, add it to environment variables
export GROQ_API_KEY="gsk_xxxxxxxx"

# 3. Install recording tool (macOS)
brew install sox

# 4. Start and type /voice to enable voice mode
bun run dev
```

**STT Provider Priority:**

| Priority | Environment Variable | Provider | Notes |
|----------|---------------------|----------|-------|
| 1 | `GODER_STT_API_KEY` | Custom | Use with `GODER_STT_PROVIDER` / `GODER_STT_BASE_URL` / `GODER_STT_MODEL` |
| 2 | `GROQ_API_KEY` | Groq Whisper | Free tier, whisper-large-v3-turbo, extremely fast |
| 3 | `OPENAI_API_KEY` (non-OpenRouter) | OpenAI Whisper | whisper-1, $0.006/min |

> **Note:** OpenRouter users need to set `GROQ_API_KEY` separately (free registration), as OpenRouter does not provide STT services.

**Recording Dependencies:**
- macOS: `brew install sox`
- Linux: `sudo apt install sox` or `sudo apt install alsa-utils`

**Usage:**
1. Type `/voice` to enable voice mode
2. Hold spacebar to record, release to auto-submit
3. Supports 19 languages (configure via `/config` → `language`)

### Stability & Robustness Enhancements

**6. Stream Watchdog** (`src/services/api/claude.ts`)

Prevents API streaming responses from getting stuck:
- Enabled by default (original requires `CLAUDE_ENABLE_STREAM_WATCHDOG=1`)
- Idle timeout 90s → 45s, stall detection 30s → 15s
- New stall circuit breaker: auto-terminate stream on 3 consecutive stalls

```bash
export CLAUDE_STREAM_IDLE_TIMEOUT_MS=45000   # Customizable idle timeout
```

**7. OpenAI Compatible Mode Auto Context Window Detection** (`src/utils/context.ts`)

Original defaults to 200K tokens, which doesn't trigger auto-compaction when using third-party models, causing context overflow. Now includes a built-in model name → context window mapping table (supports Claude/GPT/DeepSeek/Qwen/Gemini/Llama/Mistral), unknown models conservatively default to 64K.

```bash
export CLAUDE_CODE_MAX_CONTEXT_TOKENS=128000  # Manual override for context window size
```

**8. Image Paste Timeout Protection** (`src/hooks/usePasteHandler.ts`, `src/utils/imagePaste.ts`)

Fixes the issue where osascript might never return when pasting images, causing the UI to hang on "Pasting text...". Adds a 5-second safety timeout.

**9. Context Chain Integrity Protection** (`src/utils/sessionStorage.ts`, `src/query.ts`)

- `buildConversationChain()` logs errors when parentUuid is not found, instead of silently truncating
- Logs the count of cleared messages when fallback is triggered
- Logs current message count and estimated token value on double compaction failure

**10. Enhanced Tool Error Messages** (`src/tools/FileWriteTool/`, `FileEditTool/`, `NotebookEditTool/`)

Write/Edit/NotebookEdit tool error messages include specific file names and explicitly instruct the model to "fix and retry immediately," preventing the model from drifting to unrelated tasks after tool errors.

**11. System Prompt Anti-Drift Instructions** (`src/constants/prompts.ts`)

- Tool error recovery: requires immediate fix-and-retry after tool errors, no giving up or task switching
- No false refusals: must not claim rule violations on legitimate tasks

### Chinese Help

Type `/helpc` to view the complete Chinese help documentation, including all features, commands, keyboard shortcuts, and configuration instructions.

## Capability Matrix

> ✅ Implemented &ensp; ⚠️ Partially implemented / conditionally enabled &ensp; ❌ Stub / removed / feature flag disabled

### Core Systems

| Capability | Status | Notes |
|------------|--------|-------|
| REPL Interface (Ink terminal rendering) | ✅ | Main screen 5000+ lines, full interaction |
| API Communication — Anthropic Direct | ✅ | API Key + OAuth support |
| API Communication — AWS Bedrock | ✅ | Credential refresh, Bearer Token support |
| API Communication — Google Vertex | ✅ | GCP credential refresh support |
| API Communication — Azure Foundry | ✅ | API Key + Azure AD support |
| API Communication — OpenRouter | ✅ | OpenAI compatible adapter (883 lines), hundreds of models |
| Streaming Conversation & Tool Call Loop (`query.ts`) | ✅ | 1700+ lines, includes auto-compaction, token tracking |
| Session Engine (`QueryEngine.ts`) | ✅ | 1300+ lines, manages conversation state and attribution |
| Context Building (git status / CLAUDE.md / memory) | ✅ | `context.ts` full implementation |
| Permission System (plan/auto/manual modes) | ✅ | 6300+ lines, includes YOLO classifier, path validation, rule matching |
| Hook System (pre/post tool use) | ✅ | settings.json configuration support |
| Session Resume (`/resume`) | ✅ | Independent ResumeConversation screen |
| Doctor Diagnostics (`/doctor`) | ✅ | Version, API, plugin, sandbox checks |
| Auto Compaction (compaction) | ✅ | auto-compact / micro-compact / API compact |
| Background Session Management (`BG_SESSIONS`) | ✅ | `claude ps` / `logs` / `attach` / `kill` + `--bg` background execution |
| Multi-Agent Coordination (`COORDINATOR_MODE`) | ✅ | Claude as coordinator dispatching tasks to Worker Agents, parallel execution |
| Conversation Classifier (`TRANSCRIPT_CLASSIFIER`) | ✅ | Context-based auto approve/deny tool calls, `claude auto-mode` |
| MCP Skills System (`MCP_SKILLS`) | ✅ | MCP servers provide directly callable skill / prompt |
| Strict Error Mode (`HARD_FAIL`) | ✅ | With `--hard-fail` flag, `logError()` immediately terminates process |
| Buddy Mascot (`BUDDY`) | ✅ | Tux penguin animated character + speech bubbles, enhanced terminal interaction |
| Voice Input (`VOICE_MODE`) | ✅ | Hold space to record, Groq/OpenAI Whisper transcription, 19 languages |
| Bash Command Filter | ✅ | Added: pre-execution security interception + custom rules |
| Agent Safety Guardrails | ✅ | Added: cost budget, turn limits, loop detection, circuit breaker |
| Smart Compaction | ✅ | Added: local conversation compression, no API calls needed |
| `/helpc` Chinese Help | ✅ | Added: complete Chinese help documentation |

### Tools — Always Available

| Tool | Status | Notes |
|------|--------|-------|
| BashTool | ✅ | Shell execution, sandbox, permission checks |
| FileReadTool | ✅ | File / PDF / image / Notebook reading |
| FileEditTool | ✅ | String-replacement editing + diff tracking |
| FileWriteTool | ✅ | File creation / overwrite + diff generation |
| NotebookEditTool | ✅ | Jupyter Notebook cell editing |
| AgentTool | ✅ | Sub-agent spawning (fork / async / background / remote) |
| WebFetchTool | ✅ | URL fetch → Markdown → AI summary |
| WebSearchTool | ✅ | Web search + domain filtering |
| AskUserQuestionTool | ✅ | Multi-question interactive prompts + preview |
| SendMessageTool | ✅ | Message sending (peers / teammates / mailbox) |
| SkillTool | ✅ | Slash commands / Skill invocation |
| EnterPlanModeTool | ✅ | Enter plan mode |
| ExitPlanModeTool | ✅ | Exit plan mode |
| BriefTool | ✅ | Short message + attachment sending |
| CronCreateTool | ✅ | Scheduled task creation |
| CronDeleteTool | ✅ | Scheduled task deletion |
| CronListTool | ✅ | Scheduled task listing |
| EnterWorktreeTool | ✅ | Enter Git Worktree |
| ExitWorktreeTool | ✅ | Exit Git Worktree |

### Tools — Conditionally Enabled

| Tool | Enable Condition |
|------|-----------------|
| GlobTool | Enabled by default (when bfs/ugrep not embedded) |
| GrepTool | Enabled by default (same as above) |
| TaskCreateTool / TaskGetTool / TaskUpdateTool / TaskListTool | When TodoV2 is enabled |
| PowerShellTool | Windows platform |
| LSPTool | `ENABLE_LSP_TOOL` environment variable |

### Tools — Feature Flag Disabled (Unavailable)

`SleepTool` · `RemoteTriggerTool` · `MonitorTool` · `SendUserFileTool` · `OverflowTestTool` · `TerminalCaptureTool` · `WebBrowserTool` · `SnipTool` · `WorkflowTool` · `PushNotificationTool` · `SubscribePRTool` · `ListPeersTool` · `CtxInspectTool`

### Slash Commands — Available

`/add-dir` · `/advisor` · `/agents` · `/branch` · `/btw` · `/chrome` · `/clear` · `/color` · `/compact` · `/config` · `/context` · `/copy` · `/cost` · `/desktop` · `/diff` · `/doctor` · `/effort` · `/exit` · `/export` · `/extra-usage` · `/fast` · `/feedback` · `/heapdump` · `/help` · `/helpc` · `/hooks` · `/ide` · `/init` · `/install-github-app` · `/install-slack-app` · `/keybindings` · `/login` · `/logout` · `/loop` · `/mcp` · `/memory` · `/mobile` · `/model` · `/output-style` · `/passes` · `/permissions` · `/plan` · `/plugin` · `/pr-comments` · `/privacy-settings` · `/rate-limit-options` · `/release-notes` · `/reload-plugins` · `/remote-env` · `/rename` · `/resume` · `/review` · `/ultrareview` · `/rewind` · `/sandbox-toggle` · `/security-review` · `/session` · `/skills` · `/stats` · `/status` · `/statusline` · `/stickers` · `/tasks` · `/theme` · `/think-back` · `/upgrade` · `/usage` · `/insights` · `/vim` · `/buddy`

### CLI Subcommands

| Subcommand | Description |
|------------|-------------|
| `claude` (default) | Main REPL / interactive / print mode |
| `claude mcp serve/add/remove/list/get/...` | MCP service management |
| `claude auth login/status/logout` | Authentication management |
| `claude plugin validate/list/install/...` | Plugin management |
| `claude setup-token` | Long-lived token configuration |
| `claude agents` | Agent listing |
| `claude doctor` | Health check |
| `claude update` / `upgrade` | Auto-update |
| `claude install [target]` | Native installation |
| `claude auto-mode` | Conversation classifier mode (`TRANSCRIPT_CLASSIFIER` enabled) |

### Internal Packages (`packages/`)

| Package | Status | Notes |
|---------|--------|-------|
| `color-diff-napi` | ✅ | Full TypeScript implementation (syntax-highlighted diff) |
| `audio-capture-napi` | ✅ | Cross-platform audio recording (SoX/arecord) |
| `image-processor-napi` | ✅ | macOS clipboard image reading (osascript + sharp) |
| `modifiers-napi` | ✅ | macOS modifier key detection (bun:ffi + CoreGraphics) |
| `url-handler-napi` | ❌ | Stub, returns null |
| `@ant/computer-use-input` | ✅ | macOS keyboard/mouse simulation (AppleScript/JXA/CGEvent) |
| `@ant/computer-use-swift` | ✅ | macOS display/app management/screenshot (JXA/screencapture) |
| `@ant/computer-use-mcp` | ⚠️ | Type-safe stub (full type definitions but functions return empty values) |

## Project Structure

```
src/
├── entrypoints/        # Entry points (cli.tsx, init.ts) — includes MACRO/feature polyfill
├── screens/            # REPL interactive interface (5000+ lines)
├── services/
│   ├── api/            # API clients (Anthropic / Bedrock / Vertex / Azure / OpenRouter)
│   ├── compact/        # Conversation compression (auto / micro / API / smart)
│   ├── mcp/            # MCP protocol implementation (12000+ lines)
│   ├── oauth/          # OAuth authentication
│   └── plugins/        # Plugin infrastructure
├── tools/              # 40+ tools (Bash / File / Grep / Agent, etc.)
├── components/         # Ink/React terminal UI components
├── state/              # Zustand state management
├── utils/
│   ├── agentGuardrails.ts   # Agent safety guardrails (added)
│   └── model/providers.ts   # Provider selection logic
├── context.ts          # System prompt construction (git status, date, CLAUDE.md)
├── query.ts            # Core API query function (1700+ lines)
└── QueryEngine.ts      # Conversation orchestration engine (1300+ lines)
packages/               # Monorepo workspace packages
scripts/                # Build and maintenance scripts
build.ts                # Build script (bun build CLI + --feature flags + code splitting)
```

## Configuration

### Bash Command Filter

```bash
# Allow/deny specific command patterns
export GODER_BASH_ALLOW="git:*,npm:*"
export GODER_BASH_DENY="rm:-rf /,mkfs:*,dd:if=/dev/zero"
```

Supports exact matching, prefix wildcards, and regular expressions. Also configurable in `~/.claude/settings.json`.

### Agent Guardrails

```bash
export GODER_MAX_TURNS=100        # Maximum conversation turns (default 100)
export GODER_MAX_BUDGET_USD=5     # Maximum cost budget (default $5)
```

### Voice Input

```bash
# Option 1: Groq (recommended, free)
export GROQ_API_KEY="gsk_xxxxxxxx"

# Option 2: Custom STT provider
export GODER_STT_PROVIDER="groq"                # or "openai"
export GODER_STT_API_KEY="your-api-key"
export GODER_STT_BASE_URL="https://api.groq.com/openai"  # optional
export GODER_STT_MODEL="whisper-large-v3-turbo"           # optional
```

### Strict Error Mode

```bash
bun run dev -- --hard-fail        # Immediately terminate process on error
```

## Technical Notes

### Build System

`build.ts` uses the `bun build` CLI command (not the `Bun.build()` API) for bundling, because the CLI supports `--feature=FLAG` arguments to control the `feature()` function from `bun:bundle`. The `Bun.build()` API does not support the `bun:bundle` plugin, which would cause all feature flags to return `false` at build time, tree-shaking away all feature-gated code.

Build process:
1. Clean the `dist/` directory
2. Run `bun build --splitting --target bun --feature=BUDDY --feature=BG_SESSIONS ...`
3. Post-process: patch `import.meta.require` for Node.js compatibility

Build output is `dist/cli.js` main entry point + ~450 chunk files, supporting both Bun and Node.js startup.

### Runtime Polyfills

The entry file `src/entrypoints/cli.tsx` injects necessary polyfills at the top, enabling dev mode (`bun run dev`) to run without building:
- `feature()` — selective feature flag enablement via `ENABLED_FEATURES` set (reads from environment variables or defaults in dev mode)
- `globalThis.MACRO` — simulates build-time macro injection (VERSION, BUILD_TIME, etc.)
- `BUILD_TARGET`, `BUILD_ENV`, `INTERFACE_TYPE` global constants

### Monorepo

The project uses Bun workspaces to manage internal packages. The stubs previously placed in `node_modules/` have been unified into `packages/`, resolved via `workspace:*`. Internal packages include:
- `color-diff-napi` — Syntax-highlighted diff (full TypeScript implementation)
- `audio-capture-napi` — Cross-platform audio recording
- `image-processor-napi` — macOS clipboard image reading
- `modifiers-napi` — macOS modifier key detection
- `@ant/computer-use-*` — Computer control (keyboard/mouse simulation, display management)

### Type System

Approximately 1341 tsc errors, all from the decompilation process (mainly `unknown`/`never`/`{}` types), which do not affect Bun runtime execution. Type declaration files are in `src/types/`, including global types (`global.d.ts`), internal module types (`internal-modules.d.ts`), and message types (`message.ts`).

## Sponsorship

If you find Goder Code helpful, feel free to buy me a coffee ☕

<table>
<tr>
<td align="center">
<img src="assets/wechat-sponsor.jpg" width="200" alt="WeChat Sponsor QR Code"/><br/>
<strong>WeChat</strong>
</td>
<td align="center">
<img src="assets/alipay-sponsor.jpg" width="200" alt="Alipay Sponsor QR Code"/><br/>
<strong>Alipay</strong>
</td>
</tr>
</table>

## Notes

- This project is intended for learning and research purposes only
- Configuration directory (`~/.claude/`), sessions (`goder-sessions`), and projects (`goder-projects`) use independent namespaces and will not interfere with other tools' data
