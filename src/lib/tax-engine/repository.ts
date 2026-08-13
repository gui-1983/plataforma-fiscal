import type { SupabaseClient } from "@supabase/supabase-js";
import type { TaxRuleVersion } from "./types";
import type { TabelaAdmissibilidade } from "./validators";

/**
 * Carrega as regras cadastradas. A vigência é filtrada DENTRO do motor,
 * por dentroVigencia(), que é coberto por teste. Filtrar daterange pela URL
 * do PostgREST devolvia zero linhas silenciosamente, e o motor concluía
 * "regra não determinada" quando na verdade era falha de leitura.
 */
export async function carregarRegras(sb: SupabaseClient, _dataOperacao: string): Promise<TaxRuleVersion[]> {
  const { data, error } = await sb
    .from("tax_rule_versions")
    .select(`id, versao, status, ncm_pattern, cst, cclasstrib, cfop, regime, uf_origem, uf_destino,
             cod_municipio, tipo_operacao, incidencia, base_formula, aliquota_source, aliquota_fixa,
             p_reducao, arredondamento, vigencia, artigo, observacoes, specificity_score,
             tax_rules ( tax_id, code ),
             legal_sources ( nome, tipo )`)
    .in("status", ["vigente", "em_analise"]);

  if (error) throw error;

  // O join pode vir como objeto ou como array de um elemento.
  const um = (v: unknown) => ((Array.isArray(v) ? v[0] : v) ?? {}) as Record<string, string>;

  const regras = (data ?? []).map((r: Record<string, unknown>): TaxRuleVersion => {
    const tr = um(r.tax_rules);
    const ls = um(r.legal_sources);
    const [ini, fim] = String(r.vigencia).replace(/[[\]()]/g, "").split(",");
    return {
      id: r.id as string,
      taxId: tr.tax_id as TaxRuleVersion["taxId"],
      code: tr.code,
      versao: r.versao as string,
      status: r.status as TaxRuleVersion["status"],
      ncmPattern: r.ncm_pattern as string[] | null,
      cst: r.cst as string[] | null,
      cclasstrib: r.cclasstrib as string[] | null,
      cfop: r.cfop as string[] | null,
      regime: r.regime as string[] | null,
      ufOrigem: r.uf_origem as string[] | null,
      ufDestino: r.uf_destino as string[] | null,
      codMunicipio: r.cod_municipio as string[] | null,
      tipoOperacao: r.tipo_operacao as string[] | null,
      incidencia: r.incidencia as TaxRuleVersion["incidencia"],
      baseFormula: r.base_formula as string,
      aliquotaSource: r.aliquota_source as TaxRuleVersion["aliquotaSource"],
      aliquotaFixa: r.aliquota_fixa === null ? null : Number(r.aliquota_fixa),
      pReducao: Number(r.p_reducao ?? 0),
      arredondamento: r.arredondamento as string,
      vigencia: [ini, fim || null],
      fonte: ls.tipo,
      artigo: r.artigo as string | null,
      observacoes: r.observacoes as string | null,
      specificityScore: Number(r.specificity_score ?? 0),
    };
  });

  // Falha alto: regra sem tributo é defeito de carga, não "regra não encontrada".
  const semTributo = regras.filter((r) => !r.taxId);
  if (semTributo.length)
    throw new Error(`Carga de regras inválida: ${semTributo.length} versão(ões) sem tax_id.`);

  return regras;
}

/** Congela as versões usadas para que a análise seja reproduzível no futuro. */
export async function congelarRuleSet(
  sb: SupabaseClient,
  regras: TaxRuleVersion[],
  engineVersion: string,
): Promise<string> {
  const { data: rs, error } = await sb
    .from("rule_sets")
    .insert({ rotulo: `auto ${new Date().toISOString().slice(0, 10)}`, engine_version: engineVersion })
    .select("id")
    .single();
  if (error) throw error;

  if (regras.length) {
    const { error: e2 } = await sb
      .from("rule_set_items")
      .insert(regras.map((r) => ({ rule_set_id: rs.id, tax_rule_version_id: r.id })));
    if (e2) throw e2;
  }

  return rs.id as string;
}

/**
 * Monta a tabela CST x cClassTrib a partir da carga oficial ingerida.
 * Se nada foi ingerido, devolve tabela vazia e marcada como incompleta —
 * o validador V007 então avisa "não conferida" em vez de reprovar à toa.
 */
export async function carregarAdmissibilidade(sb: SupabaseClient): Promise<TabelaAdmissibilidade> {
  const { data, error } = await sb
    .from("ref_cclasstrib")
    .select("cst, cclasstrib, fonte_versao");

  if (error || !data || data.length === 0)
    return { porCst: {}, completa: false, fonte: "Informe Técnico RT 2025.002 — tabela ainda não ingerida" };

  const porCst: Record<string, string[]> = {};
  for (const r of data as { cst: string; cclasstrib: string }[]) {
    (porCst[r.cst] ??= []).push(r.cclasstrib);
  }

  const versao = (data[0] as { fonte_versao: string }).fonte_versao;
  return { porCst, completa: true, fonte: versao };
}
