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
npm run check               # everything: build + unit tests (frontend) + fmt + clippy + cargo test (Rust)
npm run test:unit           # Vitest unit tests for src/lib (diff, merge3, op, utils)
npm run e2e                 # Playwright visual e2e (frontend + mocked Tauri IPC)
npm run e2e:update          # regenerate the screenshot baselines
npm run tauri build         # production binary + system packages
npm run tauri build -- --bundles deb   # just the .deb
```

- **Linux/X11 blank window:** prefix with `WEBKIT_DISABLE_DMABUF_RENDERER=1 WEBKIT_DISABLE_COMPOSITING_MODE=1`.
- **Quality gates — `npm run check` runs all of them:** frontend `tsc` strict build (`noUnusedLocals`/`noUnusedParameters` fail the build) + **Vitest unit tests** (colocated `src/lib/*.test.ts`: diff parser, diff3, `extractRevision`, status map), then Rust `cargo fmt --check`, `cargo clippy -D warnings` and `cargo test` (XML parser fixtures, hunk/patch rebuilding, URL/path validation, encoding roundtrips, `peg_safe`, cancellation). `npm run e2e` drives the real frontend in headless Chrome (system `channel: "chrome"`) with a **mocked Tauri IPC** — `e2e/mock/tauri.ts` stubs every `invoke()` command; **a new backend command MUST be stubbed there or e2e fails** — asserting view content and doing screenshot regression (baselines in `e2e/*-snapshots/`, committed; regenerate deliberately with `npm run e2e:update` and review the diffs). CI (`.github/workflows/ci.yml`) runs all of the above plus a `.deb` bundle job on push. The e2e suite lives outside the `tsc` `include`; it does **not** exercise the Rust backend or real `svn` — that verification is manual (run the app).
- The `overrides.esbuild` pin in `package.json` deliberately lifts Vite's transitive esbuild; check `npm ls esbuild` before touching it.
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
- `svn/runner.rs` — runs `svn` via `tokio::process`. Entry points: **`run`** returns full `CommandOutput` (success + stdout + stderr + hint + displayed command); **`run_checked`** returns `Ok(stdout)` or `Err(stderr+hint)`; **`run_raw_checked_limited`** returns raw bytes (encoding-faithful diff/cat); **`run_with_progress`** streams stdout line-by-line (feeds `op-progress`) and accepts a cancel token. Output is size-capped per operation; every execution is audit-logged; 30-min hard timeout.
- `svn/parser.rs` — `quick-xml` + serde deserialization of `svn … --xml`; also `hint_from_stderr` maps SVN error **codes** to friendly hints.
- `svn/conn.rs` — builds the `SVN_SSH` value (see Auth below).
- `svn/cancel.rs` — cooperative cancellation of long ops: token registry keyed by the `op-progress` id + `cancel_op` command; the runner races `tokio::select!` against the token and kills the `svn` child (the tunnel ssh dies via EOF; the shared ControlMaster survives on purpose).
- `svn/audit.rs` — telemetry funnel: every executed command (display line, success, code, duration) goes to a ring buffer + rotating file and to the UI (Registro view).
- `svn/backup.rs` — full working-copy snapshots (restore points) before destructive ops, with progress events and pruning (`backupKeep`).
- `svn/hunk.rs` — byte-accurate unified-diff parsing/rebuilding for single-hunk revert (`svn patch --reverse-diff`), Latin-1 safe.
- `svn/undo.rs` — in-memory Ctrl+Z stack for reverts (per-file blobs on disk, session-only).
- `svn/shelf.rs` — named **persistent** shelves ("guardar para depois", stash-like), built on the same capture/apply primitives as undo; stored under `~/.local/share/subversa/shelves`.
- `svn/types.rs` — all shared types (serialized `camelCase`) **and** the preset projects in `AppConfig::default()`.
- `config.rs` — load/atomic-save `~/.config/subversa/config.json`.

### Frontend (`src`)
- `lib/api.ts` — typed `invoke` wrapper per command. `lib/types.ts` — TS mirror of the Rust types. `lib/op.ts` — uniform result handling (`reportOutput`, `tryRun`, `extractRevision`). `lib/diff.ts` — unified-diff parser. `lib/utils.ts` — `cn()` and the status→visual map.
- `store/` — zustand: `config` (+ theme application), `workspace` (base dir, detected working copies, selection, `refreshOne`, refresh epochs against stale races), `ui` (current view, palette, dialogs), `toast`, `confirm`, `repoBrowser` (repo tree), `undo` (Ctrl+Z stack). **`toast` and `confirm` expose imperative APIs** (`toast.success(...)`, `await confirm(...)`) usable anywhere, including outside React.
- `hooks/useActions.ts` — high-level SVN actions that bundle confirm + toast + refresh; prefer these over calling `api.*` directly from views.
- `components/` (ui, layout, feedback, diff, dialogs, repos, history, merge, editor, blame) and `views/` (Overview, Changes, History, Incoming, Branches, Merge, Repos, Backups, CommandLog, Settings, Setup). Import alias `@/` → `src/`.

### Key conventions

- **Adding an SVN operation touches four places, in order:** add the `#[tauri::command]` in `commands.rs` → register it in `lib.rs`'s `generate_handler!` → add a typed wrapper in `src/lib/api.ts` → mirror any new type in `src/lib/types.ts` (keep it `camelCase`, matching the Rust serde rename).
- **Parse XML and error codes, never human text.** The `svn` CLI output stays in Portuguese (locale is intentionally preserved). Robustness comes from `--xml` (language-independent) and from matching error codes like `E155011`/`E160013`/`E155004` — do not branch on translated message strings.
- **Choose the runner by who consumes the result.** Write/server ops use `run` so the UI can show stdout/stderr/hint even on failure; read-only commands that just want stdout use `run_checked`.
- **Never hold the config `Mutex` across `.await`.** Commands take a snapshot first via the `mode_of` / `snapshot` helpers, then run async work.
- **Every user/WC-derived svn target goes through `peg_safe`** (commands.rs) exactly **once**, at arg-assembly after validation: it appends a trailing `@` when the last path segment contains `@` (the canonical peg-revision escape). The only intentional peg is `diff_urls` (`URL@REV` typed by the user) — never peg-escape it, and never apply `peg_safe` twice (`@@` would be wrong).
- **Long operations stream `op-progress` and are cancellable** (`cancel.rs`): `run_streaming_op` registers the op id and passes the token to `run_with_progress`; a cancelled op rejects with the sentinel `"operação cancelada…"`, which `tryRun` (op.ts) turns into an info toast. Any **new** backend command must also be stubbed in `e2e/mock/tauri.ts`.
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
Server-writing ops (commit, merge, switch, copy, delete) require confirmation when `confirmServerOps` is on; committing **directly to trunk** raises a prominent warning; deleting a remote branch requires typing its name to confirm. Destructive local ops offer a **restore point** first (backup.rs); reverts get a session **Ctrl+Z** (undo.rs); "Guardar para depois" (shelf.rs) is the durable stash. `StrictHostKeyChecking=accept-new` (TOFU) in conn.rs is a **deliberate** trade-off mirroring the team's `fluxo_svn.sh` — do not change it to `yes` (it would break first-run in a GUI with no way to accept the key).

## Further reading

`docs/ARQUITETURA.md` is a detailed (Portuguese) internal architecture doc; `README.md` covers usage, setup, and the Git→SVN→Subversa workflow mapping.
