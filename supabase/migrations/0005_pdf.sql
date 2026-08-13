-- ============================================================================
-- 0005_pdf.sql — recebimento de DANFE em PDF
-- O PDF é fonte COMPLEMENTAR. Documento sem XML fica pendente e não recebe
-- laudo tributário conclusivo.
-- ============================================================================

alter table public.documents
  add column if not exists origem       text not null default 'xml',  -- xml | pdf
  add column if not exists tem_xml      boolean not null default true,
  add column if not exists pdf_path     text,
  add column if not exists pdf_hash     text,
  add column if not exists pdf_escaneado boolean;

create index if not exists documents_chave_idx
  on public.documents (company_id, chave) where chave is not null;
