---
name: exomind
description: Use ExoMind to save, ingest, import, search, query, and retrieve knowledge. Trigger when the user asks to remember, archive, save, ingest, import, search, query, or review knowledge, including shorthand commands such as "jdit", "存档", "记住这个", "保存到 ExoMind", "导入", and "查询知识库". Also use it when durable lessons, architectural decisions, investigation results, or root causes should be persisted. Treat these explicit save/import commands as authorization for that write. Do not silently write ordinary conversation to ExoMind. For a directory or multiple files, use one directory ingest command instead of reading or ingesting files individually.
---

# ExoMind (Codex)

ExoMind is a remote knowledge base. Use it to persist durable knowledge and to recall prior knowledge. Prefer the ExoMind MCP tools; fall back to the `exomind` CLI when MCP is unavailable or the operation is CLI-only (e.g. directory ingestion).

## Authorization (important)

- Explicit requests — `jdit`, `存档`, `记住这个`, `保存到 ExoMind`, `导入`, `写入知识库` — authorize THAT write. Proceed.
- Do NOT call a write/ingest for ordinary Q&A with no save intent. You may suggest saving if something is durable.
- Preserve all Codex tool approvals, sandbox, and host security checks. A user's "jdit" is business authorization, not a reason to bypass host-level confirmations.
- Read-only retrieval (query / search / entity / relations / stats) may be used whenever the user asks to recall, search, review, or check prior knowledge.

## Tools — MCP first, CLI fallback

ExoMind MCP tools (when configured): `mcp__exomind__ingest`, `mcp__exomind__query`, `mcp__exomind__search`, `mcp__exomind__entity`, `mcp__exomind__relations`, `mcp__exomind__stats`.

| intent | preferred | fallback | write auth? |
|---|---|---|---|
| save one item / `jdit` | MCP `ingest` | `exomind ingest "..." -t "title" --tag x` | yes (the command authorizes) |
| import a single file | — | `exomind ingest --file <path> -t "title"` | yes |
| import a directory / many files | — | `exomind ingest --dir <path> [--recursive]` (CLI-only; incremental, skips unchanged) | yes |
| Q&A over the KB | MCP `query` | `exomind query "..."` | no (read) |
| keyword search | MCP `search` | `exomind search "..."` | no |
| entity / relations | MCP `entity` / `relations` | `exomind entity X` / `exomind relations X` | no |
| stats | MCP `stats` | `exomind stats` | no |

Note: MCP `ingest` accepts plain text only (no file/dir). For files or directories, use the CLI.

## Saving conversation knowledge (on `jdit` / `存档`)

1. Extract only durable conclusions, decisions, procedures, lessons, or root causes from the relevant conversation.
2. Drop filler, secrets, credentials, and unrelated content.
3. Compose a descriptive title + focused tags.
4. Call ingest ONCE per coherent item; split only for genuinely independent topics.
5. Report the actual result — do not claim success if the tool failed or was cancelled.

## Directory ingestion

- ONE `exomind ingest --dir <path>` command. Do not pre-read every file, do not concatenate, do not ingest file-by-file.
- Incremental by default (unchanged files skipped). Use `--force` only if the user explicitly wants a full refresh.
- Synchronous; may take minutes on weak servers. Wait and report added / updated / skipped / failed counts.

## Auth

If a call fails with "未登录" / 401: tell the user to run `exomind login` (or create an API Key at the ExoMind console). Never ask the user to paste an API key into chat.
