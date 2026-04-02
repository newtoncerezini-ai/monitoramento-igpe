# Integracao ClickUp

## Configuracao

1. Copie `.env.example` para `.env`.
2. Preencha `CLICKUP_TOKEN` com seu token pessoal do ClickUp.

## Teste da conexao

Execute:

```powershell
npm run clickup:test
```

O script consulta a API do ClickUp e lista os workspaces disponiveis para o token informado.
