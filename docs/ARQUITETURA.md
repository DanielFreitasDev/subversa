# Arquitetura do Subversa

Documento técnico do funcionamento interno. Para uso/instalação, veja o
[README](../README.md).

## Visão geral

```
┌──────────────────────────────────────────────────────────────┐
│  Frontend (WebView)  —  React 19 + TS + Tailwind v4           │
│                                                              │
│   views/ ── components/ ── store/ (zustand) ── lib/api.ts    │
│                                   │  invoke()                │
└───────────────────────────────────┼──────────────────────────┘
                                    │  (Tauri IPC)
┌───────────────────────────────────┼──────────────────────────┐
│  Backend nativo (Rust)  —  Tauri v2                          │
│                                                              │
│   commands.rs → runner.rs → (processo) `svn …`               │
│        │            │                                        │
│   parser.rs     conn.rs (SVN_SSH: sshpass + ControlMaster)   │
│   (XML → tipos)                                              │
└───────────────────────────────────┼──────────────────────────┘
                                    │  svn+ssh
                              Servidor SVN (produção)
```

O frontend nunca executa `svn` diretamente: ele chama comandos Tauri via
`invoke()`. O backend Rust monta os argumentos, injeta o ambiente de autenticação,
roda o `svn`, faz o parsing da saída `--xml` e devolve **tipos fortes** ao frontend.

---

## Backend (`src-tauri/src`)

| Arquivo | Responsabilidade |
|---------|------------------|
| `lib.rs` | Inicializa o app Tauri, registra os comandos e o estado global (`AppState` com a config em `Mutex`). |
| `config.rs` | Carrega/salva `~/.config/subversa/config.json` (escrita atômica). |
| `svn/types.rs` | Tipos públicos (serializados em `camelCase`) e os *defaults* dos projetos do usuário. |
| `svn/parser.rs` | Desserializa `svn … --xml` (status, info, log, list, blame) com `quick-xml` + serde. Mapeia códigos de erro (`E155011`…) em dicas. |
| `svn/conn.rs` | Monta o valor de `SVN_SSH` (sshpass/chave + ControlMaster persistente). |
| `svn/runner.rs` | Executa `svn` de forma assíncrona (`tokio::process`), captura stdout/stderr com limite e devolve `CommandOutput`. |
| `svn/commands.rs` | Os `#[tauri::command]` — uma função por operação do fluxo, com validação central de URL, caminho local, mensagens e opções. |

### Por que parsing por XML?

A CLI do usuário responde em **português**, e mensagens humanas mudam entre versões.
A saída `--xml` é **estável e independente de idioma**. Já os *erros* são detectados
pelos **códigos** (`E160013`, `E155004`, …), que também não dependem do locale — por
isso o app preserva o idioma do `svn` e ainda assim entende as falhas.

### Comandos expostos

*Leitura:* `detect_working_copies`, `get_info`, `get_status` (local ou `-u`),
`get_diff`, `get_log`, `list_dir`, `cat_file`, `blame`.

*Escrita:* `checkout`, `update`, `commit`, `svn_add`, `revert`, `remove`,
`create_branch` (copy), `switch_wc`, `merge` (sync/reintegrate, com `--dry-run`),
`resolve`, `cleanup`, `delete_remote`.

*Config & utilidades:* `load_config`, `save_config`, `svn_version`,
`test_connection`, `reveal_in_file_manager`, `open_external_diff`, `suggested_base_dir`.

### Validações e limites

O frontend pode prevenir erros, mas o backend é a fronteira final. Operações
remotas de leitura sensível e escrita só aceitam URLs com esquema `svn+ssh`,
`svn`, `http`, `https` ou `file`, e apenas sob `repoRoots` ou URLs de `projects`
configurados. Checkouts e exports exigem destino absoluto dentro de `baseDir`;
imports exigem uma pasta local absoluta existente; commits/copy/delete/mkdir/move
e import bloqueiam mensagem vazia; `resolve --accept` é restrito aos valores do
SVN usados pela UI.

O runner não usa shell e mantém os argumentos separados com `Command::new`.
Também não usa captura ilimitada de `cmd.output()`: stdout/stderr são lidos de
forma assíncrona com teto por operação. Os limites são 20 MiB para
diff/log/status/list/info, 5 MiB para `cat_file` e 10 MiB para `blame`; ao
exceder, o comando retorna `Err(String)` com sugestão para reduzir o alvo ou usar
ferramenta externa.

### Autenticação

`conn.rs` espelha o `fluxo_svn.sh`:

```
SVN_SSH = "sshpass -e ssh -o ControlMaster=auto -o ControlPath=~/.cache/subversa/ssh/cm-%r@%h:%p \
           -o ControlPersist=300 -o StrictHostKeyChecking=accept-new …"
```

- Modo **auto**: usa `sshpass -e` se há `$SSHPASS` (inofensivo quando a chave já
  autentica); senão `ssh` puro.
- O **ControlMaster** mantém uma conexão SSH viva por 5 min, evitando repedir senha
  a cada comando.
- Ao fechar a janela, o master é encerrado (`ssh -O exit`).

---

## Frontend (`src`)

```
src/
├─ lib/
│  ├─ api.ts      → wrappers tipados de cada comando (invoke)
│  ├─ types.ts    → espelho dos tipos do Rust
│  ├─ diff.ts     → parser do diff unificado → hunks
│  ├─ op.ts       → tratamento uniforme de resultado (toasts + dicas)
│  └─ utils.ts    → cn(), datas, e o mapa visual dos status (M/A/D/?/C…)
├─ store/         → zustand: config(+tema), workspace, ui, toast, confirm
├─ hooks/         → useSelectedWc, useStatus, useActions
├─ components/
│  ├─ ui/         → Button, Modal, Tooltip, Field, Badge, Segmented, …
│  ├─ layout/     → AppShell, Sidebar, TopBar, StatusBar, CommandPalette
│  ├─ feedback/   → Toaster, ConfirmDialog
│  ├─ diff/       → DiffViewer (realce palavra a palavra com jsdiff)
│  └─ dialogs/    → Checkout, CreateBranch, Conflict
└─ views/         → Overview, Changes, History, Branches, Merge, Settings
```

### Fluxo de dados (exemplo: aba Alterações)

1. `ChangesView` monta e usa `useStatus(wc.path)`.
2. O hook chama `api.getStatus(path)` → `invoke("get_status")`.
3. O backend roda `svn status --xml`, `parser::parse_status` devolve `StatusEntry[]`.
4. A view marca por padrão os itens *committáveis*, carrega o diff do destacado
   (`get_diff`) e renderiza tudo.
5. No commit: adiciona arquivos novos (`svn_add`), agenda removidos (`remove`) e
   chama `commit`; o resultado vira toast com a revisão e a WC é recarregada.

### Estado

- **config**: a configuração + aplicação de tema (alterna a classe `.theme-light` no
  `<html>`; as *utilities* do Tailwind v4 leem variáveis CSS, então o tema troca em
  runtime, sem rebuild).
- **workspace**: pasta-base, working copies detectadas e seleção atual.
- **ui**: visão atual, paleta, diálogos globais.
- **toast / confirm**: APIs imperativas (`toast.success(...)`, `await confirm(...)`)
  usáveis de qualquer lugar, inclusive fora de componentes.

### Design system

Tokens em `styles/index.css` via `@theme` do Tailwind v4. As cores de status seguem
o `fluxo_svn.sh`: **M** âmbar, **A** verde, **D** vermelho, **?** roxo, **C** vermelho
forte; **trunk** verde, **branch** roxo. Tema claro sobrescreve só as variáveis
necessárias.

---

## Decisões & trade-offs

- **Tauri × Electron** — Tauri foi escolhido pelo binário minúsculo (~5 MB vs.
  ~150 MB), menor consumo e backend Rust ideal para processos/SSH. Todas as libs de
  sistema (`webkit2gtk-4.1`, `libsoup-3.0`) já estavam presentes.
- **CLI `svn` × bindings** — usar a CLI (em vez de uma lib SVN) garante paridade
  exata com o comportamento que o usuário já conhece e com a autenticação do script.
- **Commit por caminhos selecionados** — o `commit` recebe os alvos marcados, então a
  seleção da UI vira exatamente os argumentos do `svn commit`.
- **Reintegração guiada** — em vez de automatizar o commit final às cegas, o app faz
  `switch → update → merge` e **leva o usuário para a aba Alterações** revisar e
  commitar (o commit é a publicação), preservando o controle humano.

---

## Build

- `npm run tauri dev` — Vite (HMR) + binário debug.
- `npm run check` — `npm run build`, `cargo fmt --check`, `cargo clippy -D warnings`
  e `cargo test`.
- `npm run e2e` — testes visuais Playwright com backend Tauri mockado.
- `npm run tauri build` — `tsc && vite build` (frontend embutido) + Rust release
  (LTO, `opt-level="s"`, `strip`) → binário ~5 MB + pacotes em
  `target/release/bundle/`.
