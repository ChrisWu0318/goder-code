---
name: migrate
description: "Cross-AI conversation migration. Import chat history from Gemini, ChatGPT, Claude.ai, or any AI into the current Goder session via clipboard or file. Use when you want to continue a conversation started in another AI tool."
---

# /migrate — Cross-AI Conversation Migration

Import conversations from other AI tools (Gemini, ChatGPT, Claude.ai, Kimi, DeepSeek, etc.) into the current Goder session, so you can seamlessly continue working.

## Usage

```
/migrate              ← read from clipboard (Cmd+C the conversation first)
/migrate path/to/file ← read from a .txt, .md, or .json file
```

## How It Works

### Step 1: Read the conversation

**Clipboard mode (default):**
Run the following Bash command to capture clipboard content:
```bash
pbpaste
```

**File mode (when args provided):**
Read the file at the given path using the Read tool.

If the content is empty or too short (< 20 characters), tell the user:
> "Clipboard is empty. Please copy your conversation from the other AI first (select all → Cmd+C), then run /migrate again."

### Step 2: Detect the source AI

Look at the captured text and identify which AI it came from based on patterns:

| Pattern | Source |
|---------|--------|
| Lines starting with "**Gemini:**" or "Model:" with Google-style formatting | Gemini |
| Lines starting with "**ChatGPT:**" or "ChatGPT said:" | ChatGPT |
| Lines starting with "**Claude:**" or "Claude said:" | Claude.ai |
| Lines starting with "**Kimi:**" or "Kimi said:" | Kimi |
| Lines starting with "**DeepSeek:**" or "DeepSeek said:" | DeepSeek |
| Other patterns or mixed | Auto-detect / Generic |

Tell the user what source was detected.

### Step 3: Extract and summarize

The raw conversation may be very long. You MUST produce a structured context summary, NOT inject the raw text. Analyze the conversation and extract:

1. **Project Context** — What project/task is being discussed? What's the tech stack?
2. **Key Decisions** — What architectural or design decisions were made?
3. **Current State** — What has been completed? What's in progress?
4. **Pending Issues** — What problems remain unsolved? What was the user stuck on?
5. **File Paths** — Any specific files, directories, or code referenced
6. **Code Snippets** — Any important code that was written or discussed (keep only the essential ones)

### Step 4: Inject as context

Output the summary in this format and tell the user the migration is complete:

```
## Migrated Context from [Source AI]

### Project
[What's being built]

### Tech Stack
[Languages, frameworks, tools]

### Decisions Made
- [Decision 1]
- [Decision 2]

### Completed Work
- [What's done]

### Current State / In Progress
- [What's being worked on]

### Pending Issues
- [What's unresolved]

### Key Code
[Any critical code snippets, keep minimal]
```

After outputting the summary, say:
> "Migration complete. I now have the full context from your [Source] conversation. You can continue working — just tell me what to do next."

### Step 5: Save to memory (optional)

If the migrated context contains project-level information that would be useful across sessions, save it to a memory file at:
```
~/.claude/projects/{project}/memory/migrated_context.md
```

## Important Rules

- NEVER inject raw conversation text directly — always summarize and structure it
- If the conversation is about code, verify referenced files actually exist in the current project before making claims about them
- If the clipboard contains non-conversation content (random text, code only, etc.), still try to extract useful context from it
- Keep the summary under 500 words — concise beats complete
- Preserve the user's original language (Chinese/English/mixed)

## Examples

**Example 1: Gemini web chat**
```
User copies conversation from Gemini about building a React dashboard
→ /migrate
→ Detects Gemini, extracts project context, summarizes decisions
→ "Migration complete. I see you were building a React dashboard with Tailwind..."
```

**Example 2: File import**
```
User exports ChatGPT conversation to chatgpt-export.md
→ /migrate chatgpt-export.md
→ Reads file, detects ChatGPT format, extracts context
→ "Migration complete. Continuing from your ChatGPT session about the API refactor..."
```
