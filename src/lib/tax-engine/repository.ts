import type { SupabaseClient } from "@supabase/supabase-js";
import type { TaxRuleVersion } from "./types";

/** Carrega o conjunto de regras vigentes na data e o congela num rule_set. */
export async function carregarRegras(sb: SupabaseClient, dataOperacao: string): Promise<TaxRuleVersion[]> {
  const { data, error } = await sb
    .from("tax_rule_versions")
    .select(`id, versao, status, ncm_pattern, cst, cclasstrib, cfop, regime, uf_origem, uf_destino,
             cod_municipio, tipo_operacao, incidencia, base_formula, aliquota_source, aliquota_fixa,
             p_reducao, arredondamento, vigencia, artigo, observacoes, specificity_score,
             tax_rules!inner ( tax_id, code ),
             legal_sources!inner ( nome, tipo )`)
    .in("status", ["vigente", "em_analise"])
    .contains("vigencia", `[${dataOperacao},${dataOperacao}]`);

  if (error) throw error;

  return (data ?? []).map((r: any): TaxRuleVersion => {
    const [ini, fim] = String(r.vigencia).replace(/[[\]()]/g, "").split(",");
    return {
      id: r.id,
      taxId: r.tax_rules.tax_id,
      code: r.tax_rules.code,
      versao: r.versao,
      status: r.status,
      ncmPattern: r.ncm_pattern,
      cst: r.cst,
      cclasstrib: r.cclasstrib,
      cfop: r.cfop,
      regime: r.regime,
      ufOrigem: r.uf_origem,
      ufDestino: r.uf_destino,
      codMunicipio: r.cod_municipio,
      tipoOperacao: r.tipo_operacao,
      incidencia: r.incidencia,
      baseFormula: r.base_formula,
      aliquotaSource: r.aliquota_source,
      aliquotaFixa: r.aliquota_fixa === null ? null : Number(r.aliquota_fixa),
      pReducao: Number(r.p_reducao ?? 0),
      arredondamento: r.arredondamento,
      vigencia: [ini, fim || null],
      fonte: r.legal_sources.tipo,
      artigo: r.artigo,
      observacoes: r.observacoes,
      specificityScore: r.specificity_score,
    };
  });
}

/** Congela as versões usadas para que a análise seja reproduzível no futuro. */
export async function congelarRuleSet(sb: SupabaseClient, regras: TaxRuleVersion[], engineVersion: string) {
  const { data: rs, error } = await sb
    .from("rule_sets")
    .insert({ rotulo: `auto ${new Date().toISOString().slice(0, 10)}`, engine_version: engineVersion })
    .select("id").single();
  if (error) throw error;
  if (regras.length) {
    const { error: e2 } = await sb.from("rule_set_items")
      .insert(regras.map((r) => ({ rule_set_id: rs.id, tax_rule_version_id: r.id })));
    if (e2) throw e2;
  }
  return rs.id as string;
}
