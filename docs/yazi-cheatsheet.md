# Yazi Terminal File Manager Quick Reference

Blazing-fast file manager written in Rust, Vim-like keybindings.

## Navigation

| Key             | Action                    |
| --------------- | ------------------------- |
| `j` / `k`       | Down / Up                 |
| `l` / `h`       | Enter directory / Parent  |
| `gg` / `G`      | Top / Bottom              |
| `z`             | Jump via zoxide           |
| `Ctrl+o` / `i`  | History back / forward    |
| `.`             | Toggle hidden files       |

## File Operations

| Key   | Action                 |
| ----- | ---------------------- |
| `y`   | Copy (yank)            |
| `x`   | Cut                    |
| `p`   | Paste                  |
| `d`   | Trash                  |
| `D`   | Delete permanently     |
| `r`   | Rename                 |
| `a`   | Create file (`/` for dir) |
| `o`   | Open with default app  |

## Selection

| Key          | Action              |
| ------------ | ------------------- |
| `Space`      | Select / deselect   |
| `v`          | Visual mode (range) |
| `Ctrl+a`     | Select all          |
| `Ctrl+r`     | Invert selection    |

## Search & Filter

| Key       | Action                               |
| --------- | ------------------------------------ |
| `/`       | Find in current dir (incremental)    |
| `n` / `N` | Next / previous match                |
| `s`       | Recursive name search (`fd`)         |
| `S`       | Recursive content search (`ripgrep`) |
| `f`       | Filter (hide non-matching)           |

## Tabs

| Key       | Action              |
| --------- | ------------------- |
| `t`       | New tab             |
| `1`–`9`   | Switch to tab       |
| `[` / `]` | Previous / next tab |

## Tasks

| Key | Action                      |
| --- | --------------------------- |
| `w` | Task manager (bg jobs)      |

## Setup

```bash
# Shell integration — cd into Yazi's last dir on exit
# Add to ~/.zshrc:
function y() {
  local tmp="$(mktemp -t "yazi-cwd.XXXXX")"
  yazi "$@" --cwd-file="$tmp"
  if cwd="$(cat -- "$tmp")" && [ -n "$cwd" ] && [ "$cwd" != "$PWD" ]; then
    cd -- "$cwd"
  fi
  rm -f -- "$tmp"
}

# Git status indicators plugin
ya pack -a yazi-rs/plugins:git
```

Sources:
- [Yazi Features](https://yazi-rs.github.io/features/)
- [Yazi Quick Start](https://yazi-rs.github.io/docs/quick-start/)
- [Yazi Cheatsheet](https://1337skills.com/cheatsheets/yazi/)
