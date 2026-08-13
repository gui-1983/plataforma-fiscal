-- ============================================================================
-- 0004_rule_sets_rls.sql
-- Regras tributárias são conhecimento público e global: qualquer usuário
-- autenticado precisa lê-las e registrar o conjunto usado na própria análise.
-- O isolamento entre empresas está nas tabelas com company_id.
-- ============================================================================

alter table public.rule_sets      enable row level security;
alter table public.rule_set_items enable row level security;

create policy p_rule_sets_select on public.rule_sets
  for select to authenticated using (true);
create policy p_rule_sets_insert on public.rule_sets
  for insert to authenticated with check (true);

create policy p_rule_set_items_select on public.rule_set_items
  for select to authenticated using (true);
create policy p_rule_set_items_insert on public.rule_set_items
  for insert to authenticated with check (true);
