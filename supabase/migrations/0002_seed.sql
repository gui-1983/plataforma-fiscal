-- ============================================================================
-- 0002_seed.sql — carga inicial
-- ATENÇÃO: esta carga é o mínimo para o motor funcionar. As tabelas oficiais
-- (cClassTrib, CST, cCredPres, NCM, CFOP) NÃO são semeadas aqui de propósito:
-- devem ser ingeridas dos arquivos do Portal Nacional da NF-e pelo script
-- scripts/ingest-tabelas.ts. Digitar tabela oficial à mão é fonte de erro.
-- ============================================================================

insert into public.taxes (id, nome) values
  ('IBS','Imposto sobre Bens e Serviços'),
  ('CBS','Contribuição sobre Bens e Serviços'),
  ('IS','Imposto Seletivo'),
  ('ICMS','ICMS'), ('ISS','ISS'), ('IPI','IPI'), ('PIS','PIS/Pasep'), ('COFINS','COFINS')
on conflict do nothing;

insert into public.legal_sources (id, nome, tipo, orgao, tier, url, publicado_em) values
  ('11111111-1111-1111-1111-111111111111','LC 214/2025','lei_complementar','Congresso Nacional',1,
   'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm','2025-01-16'),
  ('22222222-2222-2222-2222-222222222222','LC 227/2026','lei_complementar','Congresso Nacional',1,
   'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp227.htm','2026-01-14'),
  ('33333333-3333-3333-3333-333333333333','Decreto 12.955/2026 — Regulamento da CBS','decreto','Presidência da República',1,
   'https://www.planalto.gov.br','2026-04-30'),
  ('44444444-4444-4444-4444-444444444444','Resolução CGIBS nº 6/2026 — Regulamento do IBS','resolucao','Comitê Gestor do IBS',1,
   'https://www.cgibs.gov.br','2026-04-30'),
  ('55555555-5555-5555-5555-555555555555','Informe Técnico RT 2025.002','informe_tecnico','Portal Nacional da NF-e',1,
   'https://www.nfe.fazenda.gov.br','2026-01-01')
on conflict do nothing;

-- Alíquotas de teste de 2026. Fixadas em lei, portanto cadastráveis com valor.
insert into public.ref_tax_rates (tributo, uf, cod_municipio, ano, aliquota, legal_source_id, artigo) values
  ('IBS_UF',  null, null, 2026, 0.000500, '11111111-1111-1111-1111-111111111111', 'art. 348, § 1º'),
  ('IBS_MUN', null, null, 2026, 0.000500, '11111111-1111-1111-1111-111111111111', 'art. 348, § 1º'),
  ('CBS',     null, null, 2026, 0.009000, '11111111-1111-1111-1111-111111111111', 'art. 348, § 1º');

-- 2027 em diante: a linha EXISTE, com aliquota NULL. É a única alteração
-- necessária quando o Senado fixar a alíquota de referência.
insert into public.ref_tax_rates (tributo, uf, cod_municipio, ano, aliquota, legal_source_id, artigo, status) values
  ('IBS_UF',  null, null, 2027, null, '11111111-1111-1111-1111-111111111111', 'art. 349 — pendente de resolução do Senado', 'pendente'),
  ('IBS_MUN', null, null, 2027, null, '11111111-1111-1111-1111-111111111111', 'art. 349 — pendente de resolução do Senado', 'pendente'),
  ('CBS',     null, null, 2027, null, '11111111-1111-1111-1111-111111111111', 'art. 347 e 349 — pendente', 'pendente');

-- Regras mínimas do motor -----------------------------------------------------
with r as (
  insert into public.tax_rules (id, tax_id, code, titulo) values
    ('a0000000-0000-0000-0000-000000000001','IBS','IBS.TRANSICAO.2026','IBS — ano de teste 2026'),
    ('a0000000-0000-0000-0000-000000000002','CBS','CBS.TRANSICAO.2026','CBS — ano de teste 2026'),
    ('a0000000-0000-0000-0000-000000000003','IBS','IBS.ALIQUOTA.2027','IBS — a partir de 2027'),
    ('a0000000-0000-0000-0000-000000000004','CBS','CBS.ALIQUOTA.2027','CBS — a partir de 2027')
  returning id
) select count(*) from r;

insert into public.tax_rule_versions
 (tax_rule_id, versao, status, cst, cclasstrib, incidencia, aliquota_source, aliquota_fixa,
  vigencia, legal_source_id, artigo, specificity_score, observacoes)
values
 ('a0000000-0000-0000-0000-000000000001','2026.05.02.001','vigente', array['000'], array['000001'],
  'tributada','fixa',0.001000,'[2026-01-01,2027-01-01)','11111111-1111-1111-1111-111111111111',
  'art. 348, § 1º',180,'Destaque sem recolhimento para quem cumpre as obrigações acessórias.'),
 ('a0000000-0000-0000-0000-000000000002','2026.05.02.002','vigente', array['000'], array['000001'],
  'tributada','fixa',0.009000,'[2026-01-01,2027-01-01)','11111111-1111-1111-1111-111111111111',
  'art. 348, § 1º',180,'Destaque sem recolhimento para quem cumpre as obrigações acessórias.'),
 ('a0000000-0000-0000-0000-000000000003','2026.08.06.001','vigente', array['000'], null,
  'tributada','indefinida',null,'[2027-01-01,)','11111111-1111-1111-1111-111111111111',
  'art. 349',80,'Alíquota de referência ainda não fixada. Estimativas divulgadas não são norma.'),
 ('a0000000-0000-0000-0000-000000000004','2026.08.06.002','vigente', array['000'], null,
  'tributada','indefinida',null,'[2027-01-01,)','11111111-1111-1111-1111-111111111111',
  'art. 347 e art. 349',80,'Alíquota de referência ainda não fixada.');

insert into public.rule_sets (id, rotulo, engine_version)
values ('b0000000-0000-0000-0000-000000000001','Carga inicial 2026.08','2026.08.15');

insert into public.rule_set_items (rule_set_id, tax_rule_version_id)
select 'b0000000-0000-0000-0000-000000000001', id from public.tax_rule_versions;
