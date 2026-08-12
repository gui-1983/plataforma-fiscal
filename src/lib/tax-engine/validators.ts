import type { Achado, ItemInput, OperationContext } from "./types";
import type { NotaInput } from "./engine";

/** Data em que a NF-e do regime regular passa a ser rejeitada sem o grupo IBS/CBS. */
const EXIGENCIA_GRUPO_IBSCBS = "2026-08-03";

/**
 * Admissibilidade CST x cClassTrib.
 * PROVISÓRIO: substituir pela consulta a public.ref_cclasstrib, alimentada
 * pelo ingestor do Informe Técnico RT 2025.002. Não preencher à mão.
 */
export interface TabelaAdmissibilidade {
  porCst: Record<string, string[]>;
  completa: boolean;
  fonte: string;
}

export const TABELA_VAZIA: TabelaAdmissibilidade = {
  porCst: {},
  completa: false,
  fonte: "Informe Técnico RT 2025.002 — tabela ainda não ingerida",
};

export function validadores(
  nota: NotaInput,
  item: ItemInput,
  ctx: OperationContext,
  tabela: TabelaAdmissibilidade = TABELA_VAZIA,
): Achado[] {
  const a: Achado[] = [];
  const semGrupo = item.cst == null && item.cClassTrib == null && item.baseInformada == null;

  if (semGrupo) {
    const exigivel = nota.dataOperacao >= EXIGENCIA_GRUPO_IBSCBS && nota.emitente.crt === "3";
    a.push({
      codigo: "V001",
      gravidade: exigivel ? "alta" : "media",
      campo: "IBSCBS",
      texto: "Grupo IBS/CBS ausente no item.",
      fundamento: exigivel
        ? "A partir de 03/08/2026 a NF-e do regime regular é rejeitada sem o grupo IBS/CBS."
        : "Grupo esperado na fase de transição.",
    });
  } else {
    if (!item.cClassTrib)
      a.push({ codigo: "V002", gravidade: "alta", campo: "cClassTrib",
        texto: "cClassTrib não informado.",
        fundamento: "Sem o cClassTrib não é possível determinar o tratamento tributário do item (IT RT 2025.002)." });

    if (item.cst && item.cClassTrib) {
      const permitidos = tabela.porCst[item.cst];
      if (permitidos && !permitidos.includes(item.cClassTrib))
        a.push({ codigo: "V007", gravidade: "alta", campo: "cClassTrib",
          texto: `cClassTrib ${item.cClassTrib} não é admissível para o CST ${item.cst}.`,
          fundamento: tabela.fonte });
      else if (!permitidos)
        a.push({ codigo: "V007b", gravidade: "info", campo: "cClassTrib",
          texto: `Admissibilidade do CST ${item.cst} não conferida.`,
          fundamento: tabela.fonte });
    }
  }

  if (!item.ncm || !/^\d{8}$/.test(item.ncm))
    a.push({ codigo: "V003", gravidade: "alta", campo: "NCM",
      texto: `NCM inválido ou ausente: ${item.ncm ?? "—"}.`,
      fundamento: "O NCM deve conter 8 dígitos." });

  if (item.cfop) {
    const esperados =
      ctx.tipoOperacao === "interna" ? ["1", "5"]
      : ctx.tipoOperacao === "interestadual" ? ["2", "6"]
      : ["3", "7"];
    if (!esperados.includes(item.cfop[0]))
      a.push({ codigo: "V004", gravidade: "alta", campo: "CFOP",
        texto: `CFOP ${item.cfop} incompatível com operação ${ctx.tipoOperacao} (${ctx.ufOrigem} → ${ctx.ufDestino}).`,
        fundamento: "Convênio SINIEF s/nº de 1970 — tabela de CFOP." });
  }

  if (item.baseInformada != null) {
    const recomposta = item.valorProduto - item.desconto + item.frete + item.seguro + item.outras;
    if (Math.abs(recomposta - item.baseInformada) > 0.01)
      a.push({ codigo: "V005", gravidade: "media", campo: "vBC",
        texto: `Base informada (${item.baseInformada.toFixed(2)}) diverge da recomposta pelos valores do item (${recomposta.toFixed(2)}).`,
        fundamento: "Consistência interna do documento." });
  }

  return a;
}
