import type {
  Achado, ItemInput, LinhaCalculo, OperationContext, Resolucao,
  ResultadoAnalise, Scored, TaxId, TaxRuleVersion,
} from "./types";
import { ENGINE_VERSION } from "./types";
import { validadores } from "./validators";

/* ============================================================================
   MOTOR TRIBUTÁRIO — função pura.
   Sem I/O, sem rede, sem Date.now(). A data vem no contexto; as regras vêm
   por parâmetro. Mesma entrada + mesma versão => mesma saída, sempre.
   É essa propriedade que torna o laudo auditável anos depois.
   ========================================================================== */

const PESOS: Record<string, number> = {
  cclasstrib: 100, cst: 80, ncmPattern: 60, cfop: 40,
  codMunicipio: 35, ufDestino: 25, ufOrigem: 20, regime: 20, tipoOperacao: 15,
};

const HIERARQUIA: Record<string, number> = {
  emenda_constitucional: 100, lei_complementar: 90, decreto: 70,
  resolucao: 70, portaria: 50, ato: 40, nota_tecnica: 30, informe_tecnico: 30,
};

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const dt = (s: string) => new Date(`${s}T00:00:00Z`).getTime();

export function dentroVigencia(r: TaxRuleVersion, data: string): boolean {
  const d = dt(data);
  const ini = dt(r.vigencia[0]);
  const fim = r.vigencia[1] ? dt(r.vigencia[1]) : null;
  return d >= ini && (fim === null || d <= fim);
}

export function especificidade(r: TaxRuleVersion): number {
  let s = 0;
  for (const k of Object.keys(PESOS)) {
    const v = (r as unknown as Record<string, unknown>)[k];
    if (Array.isArray(v) && v.length > 0) s += PESOS[k];
  }
  return s;
}

function casa(r: TaxRuleVersion, ctx: OperationContext): boolean {
  const dim = (lista: string[] | null, valor: string | null) => {
    if (!lista || lista.length === 0) return true;   // NULL = irrelevante
    if (valor == null) return false;                  // exigido mas ausente
    return lista.includes(valor);
  };
  const ncmOk =
    !r.ncmPattern || r.ncmPattern.length === 0
      ? true
      : ctx.ncm != null && r.ncmPattern.some((p) => ctx.ncm!.startsWith(p.replace(/%$/, "")));

  return (
    dim(r.cst, ctx.cst) &&
    dim(r.cclasstrib, ctx.cClassTrib) &&
    dim(r.cfop, ctx.cfop) &&
    dim(r.regime, ctx.regime) &&
    dim(r.ufOrigem, ctx.ufOrigem) &&
    dim(r.ufDestino, ctx.ufDestino) &&
    dim(r.codMunicipio, ctx.codMunicipioDestino) &&
    dim(r.tipoOperacao, ctx.tipoOperacao) &&
    ncmOk
  );
}

export function resolverRegra(tax: TaxId, ctx: OperationContext, regras: TaxRuleVersion[]): Resolucao {
  const candidatas: Scored[] = regras
    .filter((r) => r.taxId === tax)
    .filter((r) => r.status === "vigente" || r.status === "em_analise")
    .filter((r) => dentroVigencia(r, ctx.dataOperacao))
    .filter((r) => casa(r, ctx))
    .map((r) => ({ ...r, score: especificidade(r) }))
    .sort((a, b) => b.score - a.score || (HIERARQUIA[b.fonte] ?? 0) - (HIERARQUIA[a.fonte] ?? 0));

  if (candidatas.length === 0) {
    const faltando: string[] = [];
    if (!ctx.cst) faltando.push("CST-IBS/CBS");
    if (!ctx.cClassTrib) faltando.push("cClassTrib");
    return faltando.length
      ? { kind: "insufficient_data", faltando, candidatas: [] }
      : { kind: "not_found", faltando: [], candidatas: [] };
  }

  if (candidatas.length > 1 && candidatas[0].score === candidatas[1].score) {
    const a = candidatas[0], b = candidatas[1];
    const mesmoEfeito = a.incidencia === b.incidencia && a.aliquotaFixa === b.aliquotaFixa && a.pReducao === b.pReducao;
    if (!mesmoEfeito) return { kind: "conflict", candidatas };
  }
  return { kind: "resolved", regra: candidatas[0], candidatas };
}

export function baseDeCalculo(item: ItemInput): number {
  return round2(item.valorProduto - item.desconto + item.frete + item.seguro + item.outras);
}

export function calcularTributo(
  tax: TaxId, item: ItemInput, ctx: OperationContext,
  regras: TaxRuleVersion[], tolerancia = 0.01,
): LinhaCalculo {
  const res = resolverRegra(tax, ctx, regras);
  const dest = item.destacado[tax] ?? { aliquota: null, valor: null };
  const base = item.baseInformada ?? baseDeCalculo(item);

  const comum = {
    tax, base,
    aliquotaInformada: dest.aliquota,
    valorInformado: dest.valor,
    aliquotaEsperada: null as number | null,
    valorEsperado: null as number | null,
    diferenca: null as number | null,
    ruleVersionId: null as string | null,
    resolucao: res,
  };

  if (res.kind === "insufficient_data")
    return { ...comum, status: "INFORMACAO_INSUFICIENTE", confianca: "baixa",
      motivo: `Campo necessário ausente: ${res.faltando.join(", ")}.` };

  if (res.kind === "not_found")
    return { ...comum, status: "REGRA_NAO_DETERMINADA", confianca: "baixa",
      motivo: "Nenhuma regra cadastrada casa com esta operação na data do fato gerador." };

  if (res.kind === "conflict")
    return { ...comum, status: "NECESSITA_REVISAO", confianca: "baixa",
      motivo: `${res.candidatas.length} regras com a mesma especificidade e efeitos diferentes.` };

  const r = res.regra;
  const confiancaBase = r.status === "em_analise" ? "baixa" as const : "alta" as const;

  if (r.aliquotaSource === "indefinida" || (r.incidencia === "tributada" && r.aliquotaFixa == null))
    return { ...comum, ruleVersionId: r.id, status: "NECESSITA_REVISAO", confianca: "baixa",
      motivo: "Incidência conhecida, mas a alíquota ainda não foi fixada em norma. Nenhuma estimativa é apresentada." };

  if (r.incidencia !== "tributada") {
    const informado = dest.valor ?? 0;
    const bate = Math.abs(informado) <= tolerancia;
    return { ...comum, ruleVersionId: r.id, aliquotaEsperada: 0, valorEsperado: 0,
      diferenca: round2(informado), confianca: confiancaBase,
      status: bate ? "CORRETO" : "DIVERGENCIA",
      motivo: bate ? `Operação ${r.incidencia}: nada a destacar.`
                   : `Operação ${r.incidencia}, mas há valor destacado.` };
  }

  const aliquotaEfetiva = r.aliquotaFixa! * (1 - (r.pReducao ?? 0));
  const valorEsperado = round2(base * aliquotaEfetiva);
  const diferenca = dest.valor == null ? null : round2(dest.valor - valorEsperado);

  const status =
    dest.valor == null ? "AUSENTE"
    : Math.abs(diferenca!) <= tolerancia ? "CORRETO"
    : "DIVERGENCIA";

  return {
    ...comum, ruleVersionId: r.id, aliquotaEsperada: aliquotaEfetiva, valorEsperado, diferenca,
    status, confianca: confiancaBase,
    motivo:
      status === "CORRETO" ? "Valor destacado confere com a regra vigente na data da operação."
      : status === "AUSENTE" ? "Tributo não destacado no documento."
      : "Valor destacado diverge do recalculado.",
  };
}

export interface NotaInput {
  dataOperacao: string;
  emitente: { uf: string; codMunicipio: string; crt: string };
  destinatario: { uf: string; codMunicipio: string };
  idDest: string | null;
  itens: ItemInput[];
}

export function analisar(
  nota: NotaInput, regras: TaxRuleVersion[],
  opts: { tributos?: TaxId[]; tolerancia?: number } = {},
): ResultadoAnalise {
  const tributos = opts.tributos ?? (["IBS", "CBS"] as TaxId[]);
  const tolerancia = opts.tolerancia ?? 0.01;

  const tipoOperacao: OperationContext["tipoOperacao"] =
    nota.idDest === "3" ? "exterior"
    : nota.emitente.uf === nota.destinatario.uf ? "interna"
    : "interestadual";

  const itens = nota.itens.map((item) => {
    const ctx: OperationContext = {
      dataOperacao: nota.dataOperacao,
      cst: item.cst, cClassTrib: item.cClassTrib, ncm: item.ncm, cfop: item.cfop,
      regime: nota.emitente.crt,
      ufOrigem: nota.emitente.uf, ufDestino: nota.destinatario.uf,
      codMunicipioDestino: nota.destinatario.codMunicipio,
      tipoOperacao,
    };
    return {
      nItem: item.nItem,
      ctx,
      tributos: tributos.map((t) => calcularTributo(t, item, ctx, regras, tolerancia)),
      achados: validadores(nota, item, ctx),
    };
  });

  const linhas: LinhaCalculo[] = itens.flatMap((i) => i.tributos);
  const achados: Achado[] = itens.flatMap((i) => i.achados);

  const temRevisao = linhas.some((l) =>
    ["NECESSITA_REVISAO", "REGRA_NAO_DETERMINADA", "INFORMACAO_INSUFICIENTE"].includes(l.status));
  const temDivergencia = linhas.some((l) => ["DIVERGENCIA", "AUSENTE"].includes(l.status));
  const achadosAltos = achados.filter((a) => a.gravidade === "alta");

  const confianca: ResultadoAnalise["confianca"] =
    linhas.some((l) => l.confianca === "baixa") ? "baixa"
    : achadosAltos.length ? "media"
    : "alta";

  // Confiança baixa nunca é apresentada como conclusão: força revisão.
  const resultado: ResultadoAnalise["resultado"] =
    temRevisao || confianca === "baixa" ? "NECESSITA_REVISAO"
    : temDivergencia ? "DIVERGENCIA"
    : achadosAltos.length ? "APROVADO_COM_RESSALVAS"
    : "APROVADO";

  const impacto = round2(linhas.reduce((s, l) => s + Math.abs(l.diferenca ?? 0), 0));

  return { engineVersion: ENGINE_VERSION, referenceDate: nota.dataOperacao, resultado, confianca, impacto, itens };
}
