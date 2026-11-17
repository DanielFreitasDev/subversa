---
name: Dependências de runtime declaradas no .deb
description: o bundler do Tauri só detecta libs linkadas; subversion e openssh-client vão em depends, sshpass em recommends (tauri.conf.json)
type: project
category: decision
date: 2026-09-04
---
O `.deb` declara à mão `subversion` e `openssh-client` como `depends` e `sshpass` como `recommends`.

**Problema/Contexto:** o bundler do Tauri só detecta as bibliotecas que o binário linka. Numa máquina limpa o pacote instalava "com sucesso" e toda operação SVN falhava, porque `svn` e `ssh` são processos externos.
**Por que importa:** ao adicionar outra ferramenta externa obrigatória, ela também precisa entrar na lista, ou o pacote volta a instalar quebrado.
**Como aplicar:** `depends` para o que o app não funciona sem (o transporte é só `svn+ssh`, e o pacote do Subversion no Ubuntu não puxa o `openssh-client`); `recommends` para o opcional (`sshpass` — com chave SSH o modo auto do `conn.rs` usa `ssh` puro; o apt instala recommends por padrão).
**Evidência:** commit e912e8b; `bundle.linux.deb` em `src-tauri/tauri.conf.json`.
