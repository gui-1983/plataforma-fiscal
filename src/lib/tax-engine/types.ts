export const ENGINE_VERSION = "2026.08.15";

export type TaxId = "IBS" | "CBS" | "IS" | "ICMS" | "ISS" | "IPI" | "PIS" | "COFINS";

export type Incidencia =
  | "tributada" | "isenta" | "imune" | "nao_incidencia"
  | "suspensa" | "diferida" | "monofasica" | "indeterminada";

export type RuleStatus =
  | "draft" | "pending_approval" | "vigente" | "futura"
  | "revogada" | "substituida" | "suspensa" | "em_analise";

/** Espelha public.tax_rule_versions. NULL numa dimensão = irrelevante para a regra. */
export interface TaxRuleVersion {
  id: string;
  taxId: TaxId;
  code: string;
  versao: string;
  status: RuleStatus;
  ncmPattern: string[] | null;
  cst: string[] | null;
  cclasstrib: string[] | null;
  cfop: string[] | null;
  regime: string[] | null;
  ufOrigem: string[] | null;
  ufDestino: string[] | null;
  codMunicipio: string[] | null;
  tipoOperacao: string[] | null;
  incidencia: Incidencia;
  baseFormula: string;
  aliquotaSource: "referencia" | "propria_ente" | "fixa" | "tabela" | "indefinida";
  aliquotaFixa: number | null;
  pReducao: number;
  arredondamento: string;
  vigencia: [string, string | null];
  fonte: string;
  artigo: string | null;
  observacoes: string | null;
  specificityScore: number;
}

export interface OperationContext {
  dataOperacao: string;      // YYYY-MM-DD — data do fato gerador
  cst: string | null;
  cClassTrib: string | null;
  ncm: string | null;
  cfop: string | null;
  regime: string | null;     // CRT
  ufOrigem: string | null;
  ufDestino: string | null;
  codMunicipioDestino: string | null;
  tipoOperacao: "interna" | "interestadual" | "exterior";
}

export interface ItemInput {
  nItem: number;
  descricao: string | null;
  ncm: string | null;
  cfop: string | null;
  valorProduto: number;
  desconto: number;
  frete: number;
  seguro: number;
  outras: number;
  cst: string | null;
  cClassTrib: string | null;
  baseInformada: number | null;
  destacado: Partial<Record<TaxId, { aliquota: number | null; valor: number | null }>>;
}

export type Resolucao =
  | { kind: "resolved"; regra: Scored; candidatas: Scored[] }
  | { kind: "conflict"; candidatas: Scored[] }
  | { kind: "not_found"; faltando: string[]; candidatas: [] }
  | { kind: "insufficient_data"; faltando: string[]; candidatas: [] };

export type Scored = TaxRuleVersion & { score: number };

export type StatusCalculo =
  | "CORRETO" | "DIVERGENCIA" | "NAO_APLICAVEL" | "AUSENTE"
  | "INFORMACAO_INSUFICIENTE" | "REGRA_NAO_DETERMINADA"
  | "NECESSITA_REVISAO" | "REGRA_DESATUALIZADA";

export interface LinhaCalculo {
  tax: TaxId;
  base: number;
  aliquotaInformada: number | null;
  aliquotaEsperada: number | null;
  valorInformado: number | null;
  valorEsperado: number | null;
  diferenca: number | null;
  status: StatusCalculo;
  motivo: string;
  confianca: "alta" | "media" | "baixa";
  ruleVersionId: string | null;
  resolucao: Resolucao;
}

export interface Achado {
  codigo: string;
  gravidade: "alta" | "media" | "info";
  campo?: string;
  texto: string;
  fundamento: string;
}

export interface ResultadoAnalise {
  engineVersion: string;
  referenceDate: string;
  resultado: "APROVADO" | "APROVADO_COM_RESSALVAS" | "DIVERGENCIA" | "NECESSITA_REVISAO";
  confianca: "alta" | "media" | "baixa";
  impacto: number;
  itens: Array<{
    nItem: number;
    descricao: string | null;
    valorProduto: number;
    desconto: number;
    frete: number;
    seguro: number;
    outras: number;
    ctx: OperationContext;
    tributos: LinhaCalculo[];
    achados: Achado[];
  }>;
}
