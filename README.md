# Integracao ClickUp

## Configuracao

1. Copie `.env.example` para `.env`.
2. Preencha `CLICKUP_TOKEN` com seu token pessoal do ClickUp.
3. Opcionalmente, ajuste `CLICKUP_REFRESH_INTERVAL_MINUTES` para definir o intervalo de atualizacao automatica. O padrao e `10`.
4. Opcionalmente, ajuste `CLICKUP_AUTO_REFRESH_ON_SERVER` para `false` se nao quiser que o servidor local fique sincronizando em segundo plano.

## Teste da conexao

Execute:

```powershell
npm run clickup:test
```

O script consulta a API do ClickUp e lista os workspaces disponiveis para o token informado.

## Atualizacao automatica

Execute:

```powershell
npm run clickup:sync
```

O projeto faz uma exportacao inicial do ClickUp e repete a atualizacao automaticamente no intervalo definido em `CLICKUP_REFRESH_INTERVAL_MINUTES`.

## Atualizacao manual pelo painel

Para usar um botao "Atualizar agora" dentro da aplicacao:

```powershell
npm run start
```

Depois abra `http://127.0.0.1:4173`.

Ao abrir a pagina, o painel tenta primeiro sincronizar com o ClickUp e depois carrega os dados atualizados.

Se voce quiser atualizar novamente sem recarregar a pagina, use o botao "Atualizar agora".

Enquanto `npm run serve` estiver rodando, o servidor tambem pode continuar sincronizando em segundo plano usando `CLICKUP_REFRESH_INTERVAL_MINUTES`.

Importante: esse fluxo usa os endpoints `/api/clickup-data` e `/api/clickup-refresh`, entao ele funciona com `npm run serve` ou `npm run start`. No `vite preview` a interface abre, mas a API local nao e atendida por esse servidor.

## Como visualizar localmente

1. Copie `.env.example` para `.env` e preencha o token.
2. Execute `npm install`, se ainda nao tiver instalado as dependencias.
3. Execute `npm run start`.
4. Abra `http://127.0.0.1:4173`.

## Sobre o Vercel

O projeto agora tambem foi preparado para o modelo serverless do Vercel.

Arquivos adicionados para isso:

1. `api/clickup-data.js`
2. `api/clickup-refresh.js`
3. `vercel.json`

No Vercel, o painel continua chamando `/api/clickup-data` e `/api/clickup-refresh`, mas agora essas rotas podem consultar o ClickUp diretamente sem depender do `server.mjs`.

## Como subir no Vercel

1. Suba o projeto para o Git.
2. Importe o repositorio no Vercel.
3. Configure a variavel de ambiente `CLICKUP_TOKEN`.
4. Opcionalmente, configure `CLICKUP_REFRESH_INTERVAL_MINUTES` apenas para manter consistencia com o ambiente local.
5. Faça o deploy.

## Observacao importante

No ambiente local, existe sincronizacao em segundo plano enquanto `server.mjs` estiver rodando.

No Vercel, por ser serverless, nao existe processo em execucao continua. Entao a atualizacao acontece quando a pagina abre ou quando o usuario clica no botao de atualizar.
