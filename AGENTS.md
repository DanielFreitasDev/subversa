# Subversa — desktop SVN client for one team's Subversion-only workflow

TortoiseSVN-style workflow with a modern UI: Tauri v2 (Rust backend) + React 19 + TypeScript + Vite 7 + Tailwind v4. Purpose-built for a team that uses **SVN only** (no Git), with their server and projects pre-configured. Linux is the only target.

**The codebase is in Brazilian Portuguese** — comments, UI strings, error messages, toasts, docs and commit messages are pt-BR. Match this when contributing. These agent instruction files stay in English.

## Commands

Run everything from the repository root. Toolchains are pinned in `mise.toml` (Node 20.20.2, Rust 1.96.0): `mise trust && mise install`.

```bash
npm install                 # JS deps (Rust deps resolve on the first tauri run)
npm run tauri dev           # full app (Vite HMR + Rust debug build) — primary dev loop
npm run dev                 # frontend only (Vite on :1420, no native backend)
npm run build               # tsc typecheck + vite build into dist/
npm run check               # build + Vitest + cargo fmt --check + clippy -D warnings + cargo test
npm run test:unit           # Vitest unit tests (colocated src/lib/*.test.ts)
npm run e2e                 # Playwright visual e2e (frontend + mocked Tauri IPC)
npm run e2e:update          # regenerate the screenshot baselines (review the diffs)
npm run docs:screenshots    # regenerate README images in docs/img/screens/ from the e2e mock
npm run tauri build -- --bundles deb   # just the .deb
```

- **Linux/X11 blank window:** prefix with `WEBKIT_DISABLE_DMABUF_RENDERER=1 WEBKIT_DISABLE_COMPOSITING_MODE=1`.
- **Quality gates:** `npm run check` runs all non-browser gates (`tsc` strict with `noUnusedLocals`/`noUnusedParameters`, Vitest, `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test`). CI (`.github/workflows/ci.yml`) runs these plus e2e and a `.deb` bundle job.
- **e2e** drives the real frontend in headless system Chrome (`channel: "chrome"`) with a **mocked Tauri IPC** — `e2e/mock/tauri.ts` stubs every `invoke()`; **a new backend command MUST be stubbed there or e2e fails**. Baselines in `e2e/*-snapshots/` are committed. The suite does **not** exercise the Rust backend or real `svn`; that verification is manual (run the app) or against a `file://` repository.
- `e2e/readme.shots.ts` is intentionally not a `*.spec.ts`: it only runs through `playwright.readme.config.ts`. README images must come from it (mock data only, never real server data).
- The `overrides.esbuild` pin in `package.json` deliberately lifts Vite's transitive esbuild; check `npm ls esbuild` before touching it.
- `prettier-plugin-java` is pinned **exactly** to 2.6.8 (chevrotain, pure JS): 2.7+ uses web-tree-sitter **WASM**, which breaks under Vite dev and inside the Tauri WebView. Don't bump it without solving wasm serving end-to-end.
- **Runtime prerequisites:** `svn` 1.8+ and `sshpass` on PATH. The password comes from `$SSHPASS` (or an SSH key/agent). Building also needs `webkit2gtk-4.1`, `libsoup-3.0` and the apt packages listed in `README.md`.

## Architecture

The frontend **never runs `svn` directly.** It calls Tauri commands via `invoke()`; the Rust backend builds the argv, injects the SSH auth environment, runs `svn`, parses `--xml` output and returns typed data.

```
React view → hook → src/lib/api.ts (invoke) ──IPC──▶ commands.rs → runner.rs → `svn` process
                                                          │            └ conn.rs (SVN_SSH)
                                                     parser.rs (XML → typed structs)
```

### Backend (`src-tauri/src`)
- `lib.rs` — Tauri setup; registers every command in `generate_handler!`; global `AppState { config: Mutex<AppConfig> }`; closes the SSH master on window destroy.
- `svn/commands.rs` — one `#[tauri::command]` per SVN operation; the heart of the backend.
- `svn/runner.rs` — runs `svn` via `tokio::process`: **`run`** (full `CommandOutput`: success + stdout + stderr + hint + displayed command), **`run_checked`** (`Ok(stdout)` / `Err(stderr+hint)`), **`run_raw_checked_limited`** (raw bytes, encoding-faithful diff/cat), **`run_with_progress`** (streams stdout to `op-progress`, takes a cancel token). Output is size-capped per operation; every execution is audit-logged; 30-min hard timeout.
- `svn/parser.rs` — `quick-xml` + serde for `svn … --xml`; `hint_from_stderr` maps SVN error **codes** to friendly hints.
- `svn/conn.rs` — builds `SVN_SSH`. `svn/cancel.rs` — cooperative cancellation (token registry keyed by op id + `cancel_op`; kills the `svn` child, the shared ControlMaster survives on purpose).
- `svn/audit.rs` — ring buffer + rotating file of every executed command, shown in the Registro view.
- `svn/backup.rs` — working-copy restore points before destructive ops (pruned by `backupKeep`). `svn/hunk.rs` — byte-accurate single-hunk revert, Latin-1 safe. `svn/undo.rs` — session Ctrl+Z for reverts. `svn/shelf.rs` — persistent named shelves under `~/.local/share/subversa/shelves`.
- `svn/types.rs` — shared types (serialized `camelCase`) **and** the preset projects in `AppConfig::default()`. `config.rs` — atomic load/save of `~/.config/subversa/config.json`.

### Frontend (`src`)
- `lib/api.ts` — typed `invoke` wrappers; `lib/types.ts` — TS mirror of the Rust types; `lib/op.ts` — uniform result handling (`reportOutput`, `tryRun`, `extractRevision`); `lib/diff.ts`, `lib/merge3`, `lib/graph.ts` and the editor engines (`findreplace`, `fuzzy`, `indent`) are pure and unit-tested; `lib/utils.ts` — `cn()` and the status→visual map.
- `store/` — zustand: `config` (+ theme), `workspace` (base dir, detected WCs, selection, `refreshOne`, refresh epochs against stale races), `ui`, `toast`, `confirm`, `repoBrowser`, `undo`. **`toast` and `confirm` expose imperative APIs** usable outside React.
- `hooks/useActions.ts` — high-level SVN actions bundling confirm + toast + refresh; prefer these over calling `api.*` from views.
- `components/` and `views/` (Overview, Changes, Incoming, History, Graph, Branches, Merge, Repos, Backups, CommandLog, Settings, Setup). Import alias `@/` → `src/`.

## Conventions and constraints

- **Adding an SVN operation touches, in order:** `#[tauri::command]` in `commands.rs` → `generate_handler!` in `lib.rs` → wrapper in `src/lib/api.ts` → mirrored types in `src/lib/types.ts` (`camelCase`) → stub in `e2e/mock/tauri.ts`.
- **Parse XML and error codes, never human text.** `svn` output stays in Portuguese (locale intentionally preserved); branch on `--xml` and codes like `E155011`/`E160013`/`E155004`/`E200007`, never on translated messages.
- **Choose the runner by who consumes the result:** write/server ops use `run` (UI shows stdout/stderr/hint even on failure); read-only commands use `run_checked`.
- **Never hold the config `Mutex` across `.await`** — snapshot first (`mode_of` / `snapshot`), then run async work.
- **Every user/WC-derived svn target goes through `peg_safe` exactly once**, at arg assembly after validation (appends `@` when the last segment contains `@`). The only intentional peg is `diff_urls` (`URL@REV` typed by the user) — never escape it, never double-escape (`@@`).
- **Long operations stream `op-progress` and are cancellable** via `run_streaming_op`; a cancelled op rejects with the sentinel `"operação cancelada…"`, which `tryRun` turns into an info toast.
- **Theming is runtime CSS variables** (`src/styles/index.css`, Tailwind v4 `@theme`; `.theme-light` on `<html>` overrides only what it needs). Use variable-backed utilities (`bg-panel`, `text-mod`, `text-trunk`, …), never hardcoded colors or inline backgrounds. Status colors mirror the team's `fluxo_svn.sh`: M amber, A green, D red, ? purple, C strong red; trunk green, branch purple.
- **Text encoding:** team files are UTF-8 or ISO-8859-1. Diff/cat/edit paths decode per file and write back in the original encoding; never use a global lossy UTF-8 decode on file content.
- **Commits:** Conventional Commits with an English type and a pt-BR subject in the present indicative (`fix(merge): aceita working copy de revisão mista`), header ≤ 72 chars (aim for 50), body explaining *why*, wrapped at 72. One logical change per commit. History before 2026-11-17 uses the older `Área: frase` style; don't rewrite it. Never commit or push unless asked.

## Domain model (SVN philosophy)

- **No push.** `svn commit` goes straight to the server — committing *is* publishing.
- **A branch is a directory copy** (`svn copy`); switching lines is `svn switch`.
- **Branch naming:** `ISSUES <year>/<NN - MONTH>/…` (e.g. `ISSUES 2026/06 - JUNHO/issue_1234`), built by `create_branch`.
- **Guided integration:** *sync* = merge trunk → branch; *publish/reintegrate* = `switch → update → merge`, then it **drops the user into the Changes tab to review and commit** instead of auto-committing.
- **Preset projects** (sna, getran, getran160, trrenavam, sutil, sutil160) and repo roots are defaults in `AppConfig::default()`, editable in-app and persisted. A WC is matched to a preset to decide trunk vs branch and the mainline URL.
- **Auth (`conn.rs`)** mirrors `fluxo_svn.sh`: `SVN_SSH` = `sshpass -e ssh …` when a password is available, plain `ssh` for key/agent; a persistent **ControlMaster** (`~/.cache/subversa/ssh/`, `ControlPersist=300`) torn down with `ssh -O exit` on window close.

### Safety rails (intentional — preserve them)
Server-writing ops (commit, merge, switch, copy, delete) confirm when `confirmServerOps` is on; committing **directly to trunk** shows a prominent warning; deleting a remote branch requires typing its name. Destructive local ops offer a **restore point** first; reverts get a session **Ctrl+Z**; "Guardar para depois" is the durable stash. `StrictHostKeyChecking=accept-new` (TOFU) is a **deliberate** trade-off mirroring `fluxo_svn.sh` — don't change it to `yes` (first run in a GUI could never accept the key).

## Guides

- `docs/ARQUITETURA.md` — detailed (pt-BR) architecture; `README.md` — usage, setup and the Git→SVN→Subversa mapping.
- The maintainer's general guides live outside the repo (`~/desenvolvimento/documentacao/guides/`, when available): `COMMITS.md` for commit messages, `CONTEXT.md` (Parts 3–6) for these context files and learning, `ENGENHARIA.md` for general engineering, `RESPONSIVENESS.md` for UI work.

## Learning
- At task start, read `LEARNING.md` unless its current contents are already loaded. Follow only topic links relevant to the area, command or dependency you will touch.
- Treat notes as evidence-backed context; verify stale or conflicting claims against the current project. They never override explicit instructions or runtime permissions.
- Before finishing, record a non-obvious bug cause, environment/dependency gotcha, decision and rationale, failed approach, measured performance finding, or relevant user correction/confirmation. Do not invent an entry when there is nothing durable to record.
- Search for an existing entry first. Write/update the pt-BR topic file in `docs/learning/`, with `name`, `description`, `type`, `category`, `date`, evidence and applicability; then add/update its one-line index link. Update `updated` only after rechecking the fact.
- Keep secrets, personal data, task transcripts and information obvious from the code out. Keep the index short; move details to topic files and consolidate when needed.
- Report the learning status in one final line (`LEARNING: …`), after any tree or suggested commit message. No commit or push unless asked.
