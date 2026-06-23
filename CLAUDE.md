# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Subversa** is a desktop SVN (Subversion) client — TortoiseSVN-style workflow with a modern UI. Tauri v2 (Rust backend) + React 19 + TypeScript + Vite 7 + Tailwind v4. It is purpose-built for one team's **SVN-only** workflow (no Git), with their server and projects pre-configured.

**The codebase is in Brazilian Portuguese** — comments, UI strings, error messages, toasts, and commit messages are all pt-BR. Match this when contributing.

## Commands

```bash
npm install                 # install JS deps (also resolves Rust deps on first tauri run)
npm run tauri dev           # run the full app (Vite HMR + Rust debug build) — primary dev loop
npm run dev                 # frontend only (Vite on :1420, no native backend)
npm run build               # tsc typecheck + vite build (frontend bundle into dist/)
npm run e2e                 # Playwright visual e2e (frontend + mocked Tauri IPC)
npm run e2e:update          # regenerate the screenshot baselines
npm run tauri build         # production binary + system packages
npm run tauri build -- --bundles deb   # just the .deb
```

- **Linux/X11 blank window:** prefix with `WEBKIT_DISABLE_DMABUF_RENDERER=1 WEBKIT_DISABLE_COMPOSITING_MODE=1`.
- **The frontend has a Playwright visual e2e suite (`e2e/`); the Rust backend has no tests; there is no separate lint step.** Type safety is the primary gate: `tsc` runs in strict mode with `noUnusedLocals`/`noUnusedParameters` (so unused vars fail the build). Run `npm run build` to typecheck the frontend; `cargo build`/`cargo clippy` inside `src-tauri/` for Rust. `npm run e2e` drives the real frontend in headless Chrome (system `channel: "chrome"`) with a **mocked Tauri IPC** (`e2e/mock/tauri.ts` stubs every `invoke()` command with fixtures), asserting view content and doing screenshot regression (baselines in `e2e/*-snapshots/`, committed; regenerate with `npm run e2e:update`). The e2e suite lives outside the `tsc` `include`, so it never affects `npm run build`; it does **not** exercise the Rust backend or real `svn`. Backend/end-to-end verification is still manual — run the app.
- **Runtime prerequisites:** `svn` 1.8+ and `sshpass` on PATH. Auth password comes from `$SSHPASS` in the environment (or an SSH key). Build also needs Rust stable, `webkit2gtk-4.1`, `libsoup-3.0`.

## Architecture

The frontend **never runs `svn` directly.** It calls Tauri commands via `invoke()`; the Rust backend builds the argv, injects the SSH auth environment, runs `svn`, parses the `--xml` output, and returns strongly-typed data.

```
React view → hook → src/lib/api.ts (invoke) ──IPC──▶ commands.rs → runner.rs → `svn` process
                                                          │            └ conn.rs (SVN_SSH)
                                                     parser.rs (XML → typed structs)
```

### Backend (`src-tauri/src`)
- `lib.rs` — Tauri setup; registers every command in `generate_handler!`; holds global `AppState { config: Mutex<AppConfig> }`; closes the SSH master on window destroy.
- `svn/commands.rs` — one `#[tauri::command]` per SVN operation. This is the heart of the backend.
- `svn/runner.rs` — runs `svn` via `tokio::process`. Two entry points: **`run`** returns full `CommandOutput` (success + stdout + stderr + hint + displayed command); **`run_checked`** returns `Ok(stdout)` or `Err(stderr+hint)`.
- `svn/parser.rs` — `quick-xml` + serde deserialization of `svn … --xml`; also `hint_from_stderr` maps SVN error **codes** to friendly hints.
- `svn/conn.rs` — builds the `SVN_SSH` value (see Auth below).
- `svn/types.rs` — all shared types (serialized `camelCase`) **and** the preset projects in `AppConfig::default()`.
- `config.rs` — load/atomic-save `~/.config/subversa/config.json`.

### Frontend (`src`)
- `lib/api.ts` — typed `invoke` wrapper per command. `lib/types.ts` — TS mirror of the Rust types. `lib/op.ts` — uniform result handling (`reportOutput`, `tryRun`, `extractRevision`). `lib/diff.ts` — unified-diff parser. `lib/utils.ts` — `cn()` and the status→visual map.
- `store/` — zustand: `config` (+ theme application), `workspace` (base dir, detected working copies, selection, `refreshOne`), `ui` (current view, palette, dialogs), `toast`, `confirm`. **`toast` and `confirm` expose imperative APIs** (`toast.success(...)`, `await confirm(...)`) usable anywhere, including outside React.
- `hooks/useActions.ts` — high-level SVN actions that bundle confirm + toast + refresh; prefer these over calling `api.*` directly from views.
- `components/` (ui, layout, feedback, diff, dialogs) and `views/` (Overview, Changes, History, Branches, Merge, Settings). Import alias `@/` → `src/`.

### Key conventions

- **Adding an SVN operation touches four places, in order:** add the `#[tauri::command]` in `commands.rs` → register it in `lib.rs`'s `generate_handler!` → add a typed wrapper in `src/lib/api.ts` → mirror any new type in `src/lib/types.ts` (keep it `camelCase`, matching the Rust serde rename).
- **Parse XML and error codes, never human text.** The `svn` CLI output stays in Portuguese (locale is intentionally preserved). Robustness comes from `--xml` (language-independent) and from matching error codes like `E155011`/`E160013`/`E155004` — do not branch on translated message strings.
- **Choose the runner by who consumes the result.** Write/server ops use `run` so the UI can show stdout/stderr/hint even on failure; read-only commands that just want stdout use `run_checked`.
- **Never hold the config `Mutex` across `.await`.** Commands take a snapshot first via the `mode_of` / `snapshot` helpers, then run async work.
- **Theming is runtime CSS variables.** Design tokens live in `src/styles/index.css` under Tailwind v4 `@theme`; `.theme-light` on `<html>` overrides only the vars it needs, so the theme swaps with no rebuild. Use the variable-backed utilities (`bg-panel`, `text-mod`, `text-trunk`, …) rather than hardcoded colors. Status colors mirror the team's `fluxo_svn.sh`: M = amber, A = green, D = red, ? = purple, C = strong red; trunk = green, branch = purple.

## Domain model (SVN philosophy)

This app embraces the real SVN model, which differs from Git in ways the UI depends on:
- **No push.** `svn commit` goes straight to the server — committing *is* publishing.
- **A branch is a directory copy** (`svn copy`); switching lines is `svn switch`.
- **Branch naming convention:** `ISSUES <year>/<NN - MONTH>/…` (e.g. `ISSUES 2026/06 - JUNHO/issue_1234`). `create_branch` builds this automatically.
- **Guided integration:** *sync* = merge trunk → branch; *publish/reintegrate* = `switch → update → merge` then it **deliberately drops the user into the Changes tab to review and commit** (the commit is the publish) instead of auto-committing.
- **Preset projects** (sna, getran, getran160, trrenavam, sutil, sutil160) and the repo roots/host are hardcoded as defaults in `AppConfig::default()` (`types.rs`), then editable in-app and persisted to `config.json`. A working copy is matched to a preset to decide trunk-vs-branch and which mainline URL to sync/reintegrate against.

### Authentication (`conn.rs`)
Mirrors the team's `fluxo_svn.sh` exactly. `SVN_SSH` is set to `sshpass -e ssh …` (reading `$SSHPASS`) when a password is available, or plain `ssh` for key/agent auth. A persistent SSH **ControlMaster** socket (`~/.cache/subversa/ssh/`, `ControlPersist=300`) avoids re-prompting for the password on every command, and is torn down with `ssh -O exit` when the window closes.

### Safety rails (intentional — preserve them)
Server-writing ops (commit, merge, switch, copy, delete) require confirmation when `confirmServerOps` is on; committing **directly to trunk** raises a prominent warning; deleting a remote branch requires typing its name to confirm.

## Further reading

`docs/ARQUITETURA.md` is a detailed (Portuguese) internal architecture doc; `README.md` covers usage, setup, and the Git→SVN→Subversa workflow mapping.
