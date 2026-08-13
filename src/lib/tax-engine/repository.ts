export async function carregarRegras(sb: SupabaseClient, dataOperacao: string): Promise<TaxRuleVersion[]> {
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
  const um = (v: any) => (Array.isArray(v) ? v[0] : v) ?? {};

  const regras = (data ?? []).map((r: any): TaxRuleVersion => {
    const tr = um(r.tax_rules);
    const ls = um(r.legal_sources);
    const [ini, fim] = String(r.vigencia).replace(/[[\]()]/g, "").split(",");
    return {
      id: r.id,
      taxId: tr.tax_id,
      code: tr.code,
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
      fonte: ls.tipo,
      artigo: r.artigo,
      observacoes: r.observacoes,
      specificityScore: r.specificity_score,
    };
  });

  // Falha alto: regra sem tributo é defeito de carga, não "regra não encontrada".
  const semTributo = regras.filter((r) => !r.taxId);
  if (semTributo.length)
    throw new Error(`Carga de regras inválida: ${semTributo.length} versão(ões) sem tax_id.`);

  return regras;
}
