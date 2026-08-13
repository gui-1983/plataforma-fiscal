-- ============================================================================
-- 0003_exclusao.sql — exclusão de documento
-- Exclusão é LÓGICA. O documento some das telas, mas o registro e a trilha
-- permanecem: apagar análise fiscal de vez inviabiliza auditoria posterior.
-- ============================================================================

alter table public.documents
  add column if not exists deleted_at      timestamptz,
  add column if not exists deleted_by      uuid references public.profiles(id),
  add column if not exists motivo_exclusao text;

create index if not exists documents_ativos_idx
  on public.documents (company_id, created_at desc)
  where deleted_at is null;

-- Só administrador exclui, e só da própria empresa.
create policy p_documents_update on public.documents
  for update to authenticated
  using (
    public.tem_acesso(company_id)
    and public.papel_na_empresa(company_id) = 'administrador'
  )
  with check (
    public.tem_acesso(company_id)
    and public.papel_na_empresa(company_id) = 'administrador'
  );

-- A trilha precisa poder ser gravada pela aplicação.
create policy p_audit_insert on public.audit_logs
  for insert to authenticated
  with check (company_id is null or public.tem_acesso(company_id));
