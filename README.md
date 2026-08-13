# Plataforma de Inteligência Tributária — Fase 1

Stack: **Next.js 15 (Vercel) + Supabase (Postgres, Auth, Storage) + TypeScript**.

O motor tributário é uma função pura em `src/lib/tax-engine`. Ele não conhece banco, rede nem relógio: recebe contexto e regras, devolve cálculo e trilha. É essa propriedade que torna o laudo reproduzível anos depois.

**Nenhuma alíquota está no código.** Todas vivem em `tax_rule_versions` e `ref_tax_rates`, versionadas e datadas. Quando o Senado fixar a alíquota de referência, altera-se uma linha no banco — sem deploy.

---

## 1. Subir o projeto

### 1.1 GitHub

```bash
git init && git add . && git commit -m "estrutura inicial"
gh repo create plataforma-fiscal --private --source=. --push
```

### 1.2 Supabase

Crie o projeto em supabase.com (região São Paulo). Depois:

```bash
npm i -g supabase
supabase link --project-ref SEU_REF
supabase db push          # aplica as migrations 0001 a 0004
```

No painel do Supabase:

1. **Storage** → novo bucket `documentos-fiscais`, **privado**. Nunca público: o XML tem CPF, CNPJ e dados comerciais.
2. **Authentication** → Providers → Email. Desative "Enable email signups" se o cadastro for feito por convite.
3. **Storage → Policies** → adicione a política abaixo, senão o RLS bloqueia o upload:

```sql
create policy "membros acessam a pasta da própria empresa"
on storage.objects for all to authenticated
using (
  bucket_id = 'documentos-fiscais'
  and public.tem_acesso(((storage.foldername(name))[1])::uuid)
);
```

### 1.3 Vercel

Importe o repositório. Em Settings → Environment Variables, copie de `.env.example`:

| Variável | Onde achar |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | idem |
| `SUPABASE_SERVICE_ROLE_KEY` | idem — **nunca** com prefixo `NEXT_PUBLIC_` |
| `CRON_SECRET` | string aleatória sua |

Não existe `vercel.json` neste repositório, e é proposital: cron mais frequente que uma vez por dia falha no plano Hobby. O worker de lote entra quando houver processamento em lote, via plano Pro ou `pg_cron` no Supabase.

### 1.4 Primeira empresa e primeiro usuário

Crie o usuário pelo painel de Auth, depois no SQL Editor:

```sql
insert into public.profiles (id, nome, email)
values ('UUID_DO_USUARIO', 'Seu Nome', 'voce@empresa.com');

insert into public.companies (cnpj, razao_social, uf, cod_municipio, crt)
values ('12345678000190', 'SUA EMPRESA LTDA', 'MG', '3106200', '3')
returning id;

insert into public.company_users (company_id, user_id, papel)
values ('UUID_DA_EMPRESA', 'UUID_DO_USUARIO', 'administrador');
```

### 1.5 Testes

```bash
npm install
npm test
```

Os testes em `src/tests/engine.test.ts` são golden files: cobrem vigência, especificidade, conflito, dado ausente, alíquota não fixada e determinismo. **Rode-os antes de todo merge.** Se um deles quebrar depois de você mexer numa regra, o alarme está funcionando.

---

## 2. O que já está pronto

- Schema completo com RLS, imutabilidade de regra aprovada, aprovação por segundo par de olhos e restrição de vigência sobreposta (`EXCLUDE USING gist`).
- Motor tributário puro, tipado, com resolução por especificidade, hierarquia normativa e estado explícito para "não sei".
- Parser de NF-e 4.00 com grupo IBS/CBS, resistente a XXE.
- Autenticação com Supabase Auth, middleware de sessão e proteção de rotas.
- Telas: login, validar notas, documentos, laudo com trilha da regra, regras cadastradas, linha do tempo e auditoria.
- Exclusão lógica de documento com motivo obrigatório, restrita a administrador, restaurável e registrada em `audit_logs`.
- Suíte de testes do motor (`npm test`).

## 3. O que falta, em ordem

1. **Ingestor das tabelas oficiais** (`scripts/ingest-tabelas.ts`) — Informe Técnico RT 2025.002: cClassTrib, CST-IBS/CBS, cCredPres. Enquanto isso não existir, o validador `V007` não valida nada de verdade e o motor conhece uma única combinação. **É o próximo passo mais importante.**
2. Painel com gráficos e índice de conformidade.
3. Worker de lote: `/api/jobs/worker` lendo `processing_tasks` com reserva por `reservado_ate`.
4. Exportação PDF e Excel.
5. Administração de regras com fluxo de aprovação pela interface.
6. Crawler legislativo.

## 4. Limites desta stack que você precisa conhecer agora

**Serverless tem teto de tempo.** No Vercel, a função encerra em 60 s (Pro) ou 10 s (Hobby). Lote de mil notas não roda numa requisição. Por isso o upload síncrono é limitado a 10 arquivos e o resto vai para `processing_tasks`, drenada pelo cron a cada 2 minutos. Se o volume crescer, o worker migra para uma Edge Function do Supabase ou uma máquina dedicada.

**Sem Redis.** A fila é uma tabela com reserva otimista (`reservado_ate`). Funciona bem até alguns milhares de tarefas por dia. Acima disso, troque por uma fila de verdade.

**Antivírus não está incluído.** Vercel não roda ClamAV. Se aceitar PDF de origem externa, contrate um serviço de varredura ou aceite o risco de forma consciente e documentada. Para XML, o parser já bloqueia DTD e entidades externas, que é o vetor real.

**Service role key derruba o RLS.** Ela só pode aparecer em rotas de background. Qualquer uso dela numa rota de usuário anula todo o isolamento entre empresas construído no `0001_init.sql`.

**Backup.** O plano Free do Supabase não tem point-in-time recovery. Para dado fiscal de cliente, isso não é aceitável — suba para um plano com PITR antes do primeiro cliente real.

---

## 5. Aviso obrigatório do produto

> Esta plataforma realiza análise automatizada com base nos dados disponíveis, na legislação e nas regras cadastradas e fontes consultadas, na versão e na data indicadas no relatório. A ausência de divergência apontada não atesta a conformidade fiscal da operação: indica apenas que nenhuma regra cadastrada foi violada. O resultado não substitui a análise de contador, advogado tributarista ou autoridade fiscal.
