-- ============================================================================
-- 0001_init.sql — Plataforma de Inteligência Tributária
-- Supabase / PostgreSQL 15+
-- Princípios aplicados: regra é dado (não código), histórico imutável,
-- isolamento multiempresa no banco (RLS), vigência sem sobreposição.
-- ============================================================================

create extension if not exists "pgcrypto";
create extension if not exists "btree_gist";

-- ---------------------------------------------------------------- IDENTIDADE
-- auth.users é gerenciado pelo Supabase Auth. Perfil espelha dados de negócio.

create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  nome        text not null,
  email       text not null,
  created_at  timestamptz not null default now()
);

create table public.companies (
  id          uuid primary key default gen_random_uuid(),
  cnpj        text not null unique,
  razao_social text not null,
  uf          char(2) not null,
  cod_municipio text not null,
  crt         text not null check (crt in ('1','2','3','4')),
  retencao_dias int not null default 1825,
  tolerancia_item numeric(15,2) not null default 0.01,
  created_at  timestamptz not null default now()
);

create type public.papel as enum ('administrador','analista','consulta');

create table public.company_users (
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  papel      public.papel not null default 'consulta',
  created_at timestamptz not null default now(),
  primary key (company_id, user_id)
);

-- Helper usado por todas as políticas de RLS.
create or replace function public.tem_acesso(c uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.company_users cu
    where cu.company_id = c and cu.user_id = auth.uid()
  );
$$;

create or replace function public.papel_na_empresa(c uuid)
returns public.papel language sql stable security definer set search_path = public as $$
  select cu.papel from public.company_users cu
  where cu.company_id = c and cu.user_id = auth.uid();
$$;

-- ------------------------------------------------------------ FONTES LEGAIS

create table public.legal_sources (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null,               -- 'LC 214/2025'
  tipo        text not null,               -- lei_complementar|decreto|resolucao|nota_tecnica|informe_tecnico|ato
  orgao       text not null,
  tier        int  not null check (tier between 1 and 3),  -- 1 primária vinculante
  url         text not null,
  publicado_em date not null,
  created_at  timestamptz not null default now()
);

create table public.legal_source_versions (
  id               uuid primary key default gen_random_uuid(),
  legal_source_id  uuid not null references public.legal_sources(id),
  consultado_em    date not null,
  hash_conteudo    text not null,
  texto            text,
  created_at       timestamptz not null default now()
);

-- ------------------------------------------------- TABELAS OFICIAIS (REF)
-- Ingeridas do Portal Nacional da NF-e. Versionadas, nunca digitadas à mão.

create table public.ref_cst_ibscbs (
  cst        text not null,
  descricao  text not null,
  vigencia   daterange not null,
  fonte_versao text not null,             -- 'IT RT 2025.002 v1.40'
  primary key (cst, fonte_versao)
);

create table public.ref_cclasstrib (
  cclasstrib   text not null,
  cst          text not null,
  descricao    text not null,
  tipo_aliquota text,
  p_red_ibs    numeric(9,6),
  p_red_cbs    numeric(9,6),
  dispositivo  text,
  vigencia     daterange not null,
  fonte_versao text not null,
  primary key (cclasstrib, cst, fonte_versao)
);

create table public.ref_cfop (
  cfop text primary key,
  descricao text not null,
  tipo text not null                       -- entrada|saida
);

create table public.ref_ncm (
  ncm text primary key,
  descricao text not null,
  vigencia daterange not null
);

-- Alíquotas por ente e por ano. É AQUI que se altera quando o Senado fixar
-- a alíquota de referência. Nenhum deploy é necessário.
create table public.ref_tax_rates (
  id           uuid primary key default gen_random_uuid(),
  tributo      text not null,              -- IBS_UF|IBS_MUN|CBS
  uf           char(2),
  cod_municipio text,
  ano          int not null,
  aliquota     numeric(9,6),               -- NULL = ainda não fixada em norma
  legal_source_id uuid references public.legal_sources(id),
  artigo       text,
  status       text not null default 'vigente',
  created_at   timestamptz not null default now(),
  unique (tributo, uf, cod_municipio, ano)
);

-- ------------------------------------------------------------- MOTOR DE REGRAS

create table public.taxes (
  id     text primary key,                 -- IBS|CBS|IS|ICMS|ISS|IPI|PIS|COFINS
  nome   text not null,
  ativo  boolean not null default true
);

create table public.tax_rules (
  id         uuid primary key default gen_random_uuid(),
  tax_id     text not null references public.taxes(id),
  code       text not null,
  scope      text not null default 'global' check (scope in ('global','company')),
  company_id uuid references public.companies(id),
  titulo     text not null,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  unique (tax_id, code, company_id)
);

create type public.rule_status as enum
  ('draft','pending_approval','vigente','futura','revogada','substituida','suspensa','em_analise');

create table public.tax_rule_versions (
  id             uuid primary key default gen_random_uuid(),
  tax_rule_id    uuid not null references public.tax_rules(id),
  versao         text not null,
  status         public.rule_status not null default 'draft',
  -- dimensões de match: NULL = irrelevante para esta regra (casa com qualquer valor)
  ncm_pattern    text[],
  cst            text[],
  cclasstrib     text[],
  cfop           text[],
  regime         text[],
  uf_origem      char(2)[],
  uf_destino     char(2)[],
  cod_municipio  text[],
  tipo_operacao  text[],
  extra_conditions jsonb,
  -- efeito
  incidencia     text not null check (incidencia in
    ('tributada','isenta','imune','nao_incidencia','suspensa','diferida','monofasica','indeterminada')),
  base_formula   text not null default 'BASE_PADRAO_ITEM',
  aliquota_source text not null check (aliquota_source in ('referencia','propria_ente','fixa','tabela','indefinida')),
  aliquota_fixa  numeric(9,6),
  p_reducao      numeric(9,6) default 0,
  credito_regra  jsonb,
  arredondamento text not null default 'half_up_2',
  -- temporalidade e rastreabilidade
  vigencia       daterange not null,
  legal_source_id uuid not null references public.legal_sources(id),
  artigo         text,
  paragrafo      text,
  inciso         text,
  observacoes    text,
  specificity_score int not null default 0,
  superseded_by  uuid references public.tax_rule_versions(id),
  created_at     timestamptz not null default now(),
  created_by     uuid references public.profiles(id),
  submitted_at   timestamptz,
  approved_at    timestamptz,
  approved_by    uuid references public.profiles(id),
  motivo         text,
  -- duas versões vigentes da mesma regra jamais podem se sobrepor no tempo
  constraint sem_sobreposicao exclude using gist (
    tax_rule_id with =, vigencia with &&
  ) where (status in ('vigente','futura'))
);

-- Aprovador nunca pode ser o autor.
create or replace function public.trg_aprovacao_dois_pares()
returns trigger language plpgsql as $$
begin
  if new.status = 'vigente' and old.status <> 'vigente' then
    if new.approved_by is null then
      raise exception 'Aprovação exige approved_by.';
    end if;
    if new.approved_by = new.created_by then
      raise exception 'O aprovador não pode ser o autor da versão da regra.';
    end if;
    if new.motivo is null or length(new.motivo) < 10 then
      raise exception 'Aprovação exige motivo registrado.';
    end if;
  end if;
  return new;
end $$;

create trigger tax_rule_versions_aprovacao
  before update on public.tax_rule_versions
  for each row execute function public.trg_aprovacao_dois_pares();

-- Versão aprovada é imutável: só status e superseded_by podem mudar.
create or replace function public.trg_versao_imutavel()
returns trigger language plpgsql as $$
begin
  if old.status in ('vigente','futura','revogada','substituida') then
    if (new.aliquota_fixa is distinct from old.aliquota_fixa)
       or (new.vigencia is distinct from old.vigencia)
       or (new.incidencia is distinct from old.incidencia)
       or (new.cst is distinct from old.cst)
       or (new.cclasstrib is distinct from old.cclasstrib) then
      raise exception 'Versão de regra aprovada é imutável. Crie uma nova versão.';
    end if;
  end if;
  return new;
end $$;

create trigger tax_rule_versions_imutavel
  before update on public.tax_rule_versions
  for each row execute function public.trg_versao_imutavel();

-- Conjunto congelado de regras usado por uma análise.
create table public.rule_sets (
  id             uuid primary key default gen_random_uuid(),
  rotulo         text not null,
  engine_version text not null,
  congelado_em   timestamptz not null default now()
);

create table public.rule_set_items (
  rule_set_id         uuid not null references public.rule_sets(id),
  tax_rule_version_id uuid not null references public.tax_rule_versions(id),
  primary key (rule_set_id, tax_rule_version_id)
);

-- --------------------------------------------------------------- DOCUMENTOS

create table public.documents (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id),
  modelo        text not null,
  numero        text,
  serie         text,
  chave         text,
  data_operacao date not null,
  natureza      text,
  emit          jsonb not null,
  dest          jsonb not null,
  totais        jsonb not null,
  storage_path  text not null,
  hash_arquivo  text not null,
  status        text not null default 'recebido',
  created_at    timestamptz not null default now(),
  created_by    uuid references public.profiles(id),
  unique (company_id, hash_arquivo)
);

create table public.document_items (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null references public.documents(id) on delete cascade,
  company_id   uuid not null references public.companies(id),
  n_item       int not null,
  descricao    text,
  ncm          text,
  cfop         text,
  cst          text,
  cclasstrib   text,
  quantidade   numeric(19,6),
  valor_produto numeric(15,2) not null default 0,
  desconto     numeric(15,2) not null default 0,
  frete        numeric(15,2) not null default 0,
  seguro       numeric(15,2) not null default 0,
  outras       numeric(15,2) not null default 0,
  destacado    jsonb not null default '{}'::jsonb
);

-- ----------------------------------------------------------------- ANÁLISES

create table public.analyses (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id),
  document_id    uuid not null references public.documents(id),
  engine_version text not null,
  rule_set_id    uuid not null references public.rule_sets(id) on delete restrict,
  reference_date date not null,
  resultado      text not null,
  confianca      text not null check (confianca in ('alta','media','baixa')),
  impacto        numeric(15,2) not null default 0,
  trace          jsonb not null,
  supersedes_id  uuid references public.analyses(id),
  created_at     timestamptz not null default now(),
  created_by     uuid references public.profiles(id)
);

create table public.tax_calculations (
  id             uuid primary key default gen_random_uuid(),
  analysis_id    uuid not null references public.analyses(id) on delete cascade,
  company_id     uuid not null references public.companies(id),
  document_item_id uuid not null references public.document_items(id),
  tax_id         text not null references public.taxes(id),
  base           numeric(19,6),
  aliquota_informada numeric(9,6),
  aliquota_esperada  numeric(9,6),
  valor_informado numeric(15,2),
  valor_esperado  numeric(15,2),
  diferenca       numeric(15,2),
  status          text not null,
  tax_rule_version_id uuid references public.tax_rule_versions(id)
);

create table public.tax_divergences (
  id             uuid primary key default gen_random_uuid(),
  analysis_id    uuid not null references public.analyses(id) on delete cascade,
  company_id     uuid not null references public.companies(id),
  codigo         text not null,            -- V001..V007, DIF_VALOR
  gravidade      text not null,
  campo          text,
  texto          text not null,
  fundamento     text,
  valor_informado numeric(15,2),
  valor_esperado  numeric(15,2)
);

-- --------------------------------------------------------------- OPERACIONAL

create table public.processing_jobs (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id),
  tipo        text not null,
  total       int not null default 0,
  concluidos  int not null default 0,
  erros       int not null default 0,
  status      text not null default 'pendente',
  created_at  timestamptz not null default now(),
  created_by  uuid references public.profiles(id)
);

create table public.processing_tasks (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid not null references public.processing_jobs(id) on delete cascade,
  company_id  uuid not null references public.companies(id),
  document_id uuid references public.documents(id),
  storage_path text,
  status      text not null default 'pendente',
  tentativas  int not null default 0,
  erro        text,
  reservado_ate timestamptz,
  created_at  timestamptz not null default now()
);

create index on public.processing_tasks (status, reservado_ate);

create table public.audit_logs (
  id          bigserial primary key,
  company_id  uuid,
  user_id     uuid,
  ip          inet,
  acao        text not null,
  entidade    text not null,
  entidade_id text,
  antes       jsonb,
  depois      jsonb,
  motivo      text,
  created_at  timestamptz not null default now()
);

-- audit_logs é append-only, inclusive para o dono do banco na camada de app
create rule audit_logs_sem_update as on update to public.audit_logs do instead nothing;
create rule audit_logs_sem_delete as on delete to public.audit_logs do instead nothing;

create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid references public.companies(id),
  user_id     uuid references public.profiles(id),
  tipo        text not null,
  titulo      text not null,
  corpo       text,
  lida        boolean not null default false,
  created_at  timestamptz not null default now()
);

-- ================================ RLS =======================================
-- Isolamento entre empresas garantido pelo banco, não pelo código da aplicação.

alter table public.profiles            enable row level security;
alter table public.companies           enable row level security;
alter table public.company_users       enable row level security;
alter table public.documents           enable row level security;
alter table public.document_items      enable row level security;
alter table public.analyses            enable row level security;
alter table public.tax_calculations    enable row level security;
alter table public.tax_divergences     enable row level security;
alter table public.processing_jobs     enable row level security;
alter table public.processing_tasks    enable row level security;
alter table public.notifications       enable row level security;
alter table public.audit_logs          enable row level security;
alter table public.tax_rules           enable row level security;
alter table public.tax_rule_versions   enable row level security;

create policy p_profiles_self on public.profiles
  for select using (id = auth.uid());

create policy p_companies_membro on public.companies
  for select using (public.tem_acesso(id));

create policy p_company_users_membro on public.company_users
  for select using (public.tem_acesso(company_id));

-- Padrão para tabelas com company_id: ler se é membro; escrever se analista+.
do $$
declare t text;
begin
  foreach t in array array['documents','document_items','analyses','tax_calculations',
                           'tax_divergences','processing_jobs','processing_tasks','notifications']
  loop
    execute format($f$
      create policy p_%1$s_select on public.%1$s
        for select using (public.tem_acesso(company_id));
      create policy p_%1$s_insert on public.%1$s
        for insert with check (
          public.tem_acesso(company_id)
          and public.papel_na_empresa(company_id) in ('administrador','analista')
        );
    $f$, t);
  end loop;
end $$;

create policy p_audit_select on public.audit_logs
  for select using (
    company_id is not null
    and public.tem_acesso(company_id)
    and public.papel_na_empresa(company_id) = 'administrador'
  );

-- Regras globais: leitura para qualquer autenticado; escrita só administrador.
create policy p_tax_rules_select on public.tax_rules
  for select using (scope = 'global' or public.tem_acesso(company_id));

create policy p_tax_rule_versions_select on public.tax_rule_versions
  for select using (true);

-- Tabelas de referência são públicas para leitura autenticada.
grant select on public.ref_cst_ibscbs, public.ref_cclasstrib, public.ref_cfop,
               public.ref_ncm, public.ref_tax_rates, public.taxes,
               public.legal_sources, public.legal_source_versions to authenticated;
