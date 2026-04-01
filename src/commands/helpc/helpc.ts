import type { LocalCommandCall } from '../../types/command.js'

export const call: LocalCommandCall = async () => {
  const text = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Goder Code — AI 终端编程助手 (中文帮助)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

基于 Claude Code 开源框架编译，支持 OpenAI 兼容 API 后端。

【已启用功能】
  BG_SESSIONS       后台会话 — 支持 tmux 后台运行任务
  COORDINATOR_MODE  多 Agent 协调模式
  TRANSCRIPT_CLASSIFIER  对话分类器
  MCP_SKILLS        MCP 技能系统
  HARD_FAIL         严格错误处理

【安全系统】
  Bash 沙箱         命令执行前过滤，内置 deny list (rm -rf / 等)
                    可配置 allow/deny: ~/.claude/settings.json
                    或环境变量 GODER_BASH_ALLOW / GODER_BASH_DENY
  Agent 护栏        防止无限循环烧钱：
                    - 最大轮数: 100 (GODER_MAX_TURNS)
                    - 成本上限: $5 (GODER_MAX_BUDGET_USD)
                    - 重复检测: 连续5次相同调用自动停止
                    - 连续错误: 3次后停止
  流式看门狗        默认启用，防止连接挂死：
                    - 空闲超时: 45s (CLAUDE_STREAM_IDLE_TIMEOUT_MS)
                    - 卡顿检测: 15s 无数据即报警
                    - 熔断器: 连续3次卡顿自动终止流
                    - 可关闭: CLAUDE_ENABLE_STREAM_WATCHDOG=0
  智能压缩          对话过长时自动分段摘要，不丢失上下文
  上下文窗口        OpenAI 兼容模式自动识别模型上下文大小
                    已内置: Claude/GPT/DeepSeek/Qwen/Gemini/Llama/Mistral
                    手动覆盖: CLAUDE_CODE_MAX_CONTEXT_TOKENS=64000

【常用命令】
  /help             英文帮助
  /helpc            本帮助 (中文)
  /compact          手动压缩对话
  /config           查看/修改配置
  /cost             查看本次会话开销
  /clear            清空对话
  /fast             切换快速模式
  /model            切换模型

【快捷键】
  Ctrl+C            中断当前操作
  Ctrl+D            退出 Goder
  Esc               取消当前输入
  Tab               自动补全命令/文件名

【配置 OpenAI 兼容后端】
  export CLAUDE_CODE_USE_OPENAI_COMPAT=1
  export OPENAI_API_KEY="your-key"
  export OPENAI_BASE_URL="https://openrouter.ai/api/v1"
  export OPENAI_MODEL="your-model-id"

【配置文件】
  ~/.claude/settings.json    全局设置
  项目目录/CLAUDE.md         项目级指令 (每次对话自动加载)

【编译与运行】
  bun install --ignore-scripts
  bun run build
  goder
`
  return { type: 'text', value: text.trim() }
}
