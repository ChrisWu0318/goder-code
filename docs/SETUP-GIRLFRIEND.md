# Goder Code 安装指南（macOS）

## 前提

确认已安装 Homebrew（终端跑 `brew --version`，有版本号就行）。
如果没有，跑这个一键装：

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Apple Silicon Mac 装完追加两行：
```bash
echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
eval "$(/opt/homebrew/bin/brew shellenv)"
```

## 安装

### 1. 安装 Bun（运行时）

```bash
brew install oven-sh/bun/bun
```

验证：
```bash
bun --version
```

### 2. 拉取代码

```bash
git clone https://github.com/ChrisWu0318/goder-code.git
cd goder-code
```

### 3. 安装依赖（用 bun，不用 npm）

> **注意：不要用 npm install**，用 bun 更快且不需要编译器。

```bash
bun install
```

等 10-20 秒搞定。

### 4. 构建（用 bun，不用编译器）

> **注意：bun 自带预编译 runtime，不需要 Xcode CLT。**

```bash
bun run build
```

### 5. 启动

```bash
bun run src/entrypoints/cli.tsx
```

## 配置 API Key

### 如果用 OpenAI 兼容模型（硅基流动/月之暗面等）

编辑 `~/.claude/settings.json`：
```json
{
  "env": {
    "OPENAI_API_KEY": "sk-你的key",
    "OPENAI_BASE_URL": "https://你的api地址"
  }
}
```

### 如果用 Anthropic 官方（Claude）

```bash
export ANTHROPIC_API_KEY="sk-ant-你的key"
```

## 快捷方式（以后每次用）

```bash
cd goder-code
bun run src/entrypoints/cli.tsx
```

可以把这几行加到 `~/.zshrc` 里方便以后用：
```bash
alias goder='cd ~/goder-code && bun run src/entrypoints/cli.tsx'
```

以后打 `goder` 就启动了。

## 报错排查

| 报错 | 解决 |
|------|------|
| `bun: command not found` | 跑 `brew install oven-sh/bun/bun` |
| `Module not found` | 删掉 `node_modules/` 重新 `bun install` |
| 卡在构建 | 直接跑 `bun run src/entrypoints/cli.tsx` 跳过 build |
| `Cannot find module` | `bun install && bun run build` 重新来 |
| `xcode-select` 报错 | 不需要 Xcode，bun 是预编译的 |

**核心要点：goder 用 bun 跑，不需要 xcode-select，不需要编译器。**
