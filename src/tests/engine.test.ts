import { describe, it, expect } from "vitest";
import { analisar, calcularTributo, resolverRegra, baseDeCalculo } from "@/lib/tax-engine/engine";
import type { ItemInput, OperationContext, TaxRuleVersion } from "@/lib/tax-engine/types";

/* Regras de teste. Espelham o seed 0002 — se o seed mudar, estes testes falham
   de propósito: é o alarme de que uma regra mudou sem revisão. */

const regra = (o: Partial<TaxRuleVersion>): TaxRuleVersion => ({
  id: "r", taxId: "CBS", code: "TESTE", versao: "1", status: "vigente",
  ncmPattern: null, cst: null, cclasstrib: null, cfop: null, regime: null,
  ufOrigem: null, ufDestino: null, codMunicipio: null, tipoOperacao: null,
  incidencia: "tributada", baseFormula: "BASE_PADRAO_ITEM", aliquotaSource: "fixa",
  aliquotaFixa: 0.009, pReducao: 0, arredondamento: "half_up_2",
  vigencia: ["2026-01-01", "2026-12-31"], fonte: "lei_complementar",
  artigo: "art. 348, § 1º", observacoes: null, specificityScore: 180,
  ...o,
});

const CBS_2026 = regra({ id: "cbs26", taxId: "CBS", cst: ["000"], cclasstrib: ["000001"], aliquotaFixa: 0.009 });
const IBS_2026 = regra({ id: "ibs26", taxId: "IBS", cst: ["000"], cclasstrib: ["000001"], aliquotaFixa: 0.001 });
const CBS_2027 = regra({ id: "cbs27", taxId: "CBS", cst: ["000"], aliquotaSource: "indefinida", aliquotaFixa: null, vigencia: ["2027-01-01", null] });

const item = (o: Partial<ItemInput> = {}): ItemInput => ({
  nItem: 1, descricao: "Cabo", ncm: "73121090", cfop: "6102",
  valorProduto: 1000, desconto: 0, frete: 0, seguro: 0, outras: 0,
  cst: "000", cClassTrib: "000001", baseInformada: 1000,
  destacado: { CBS: { aliquota: 0.009, valor: 9 }, IBS: { aliquota: 0.001, valor: 1 } },
  ...o,
});

const ctx = (o: Partial<OperationContext> = {}): OperationContext => ({
  dataOperacao: "2026-08-05", cst: "000", cClassTrib: "000001", ncm: "73121090",
  cfop: "6102", regime: "3", ufOrigem: "MG", ufDestino: "SP",
  codMunicipioDestino: "3550308", tipoOperacao: "interestadual", ...o,
});

const nota = (itens: ItemInput[], data = "2026-08-05", ufDest = "SP") => ({
  dataOperacao: data,
  emitente: { uf: "MG", codMunicipio: "3106200", crt: "3" },
  destinatario: { uf: ufDest, codMunicipio: "3550308" },
  idDest: ufDest === "MG" ? "1" : "2",
  itens,
});

describe("base de cálculo", () => {
  it("soma frete, seguro e outras despesas e subtrai desconto", () => {
    expect(baseDeCalculo(item({ valorProduto: 1000, desconto: 100, frete: 50, seguro: 10, outras: 5 }))).toBe(965);
  });
});

describe("vigência", () => {
  it("nunca seleciona regra fora da vigência", () => {
    const r = resolverRegra("CBS", ctx({ dataOperacao: "2025-12-31" }), [CBS_2026]);
    expect(r.kind).not.toBe("resolved");
  });

  it("usa a regra da data do fato gerador, não a de hoje", () => {
    const r = resolverRegra("CBS", ctx({ dataOperacao: "2026-06-01" }), [CBS_2026, CBS_2027]);
    expect(r.kind).toBe("resolved");
    if (r.kind === "resolved") expect(r.regra.id).toBe("cbs26");
  });
});

describe("cálculo", () => {
  it("caminho feliz: CBS 0,9% sobre 1000 = 9,00", () => {
    const l = calcularTributo("CBS", item(), ctx(), [CBS_2026]);
    expect(l.status).toBe("CORRETO");
    expect(l.valorEsperado).toBe(9);
  });

  it("aponta divergência quando o destacado não bate", () => {
    const l = calcularTributo("CBS", item({ destacado: { CBS: { aliquota: 0.007, valor: 7 } } }), ctx(), [CBS_2026]);
    expect(l.status).toBe("DIVERGENCIA");
    expect(l.diferenca).toBe(-2);
  });

  it("aceita diferença de 1 centavo como arredondamento", () => {
    const l = calcularTributo("CBS", item({ destacado: { CBS: { aliquota: 0.009, valor: 9.01 } } }), ctx(), [CBS_2026]);
    expect(l.status).toBe("CORRETO");
  });
});

describe("ausência de dado", () => {
  it("sem cClassTrib devolve INFORMACAO_INSUFICIENTE, não um chute", () => {
    const l = calcularTributo("CBS", item({ cClassTrib: null }), ctx({ cClassTrib: null }), [CBS_2026]);
    expect(l.status).toBe("INFORMACAO_INSUFICIENTE");
    expect(l.valorEsperado).toBeNull();
  });
});

describe("alíquota não fixada em norma", () => {
  it("2027 devolve NECESSITA_REVISAO sem estimar valor", () => {
    const l = calcularTributo("CBS", item(), ctx({ dataOperacao: "2027-03-10" }), [CBS_2026, CBS_2027]);
    expect(l.status).toBe("NECESSITA_REVISAO");
    expect(l.valorEsperado).toBeNull();
    expect(l.motivo).toMatch(/não foi fixada/);
  });
});

describe("conflito", () => {
  it("duas regras de mesma especificidade e efeitos diferentes não se resolvem sozinhas", () => {
    const a = regra({ id: "a", taxId: "CBS", cst: ["000"], cclasstrib: ["000001"], aliquotaFixa: 0.009 });
    const b = regra({ id: "b", taxId: "CBS", cst: ["000"], cclasstrib: ["000001"], aliquotaFixa: 0.005 });
    const r = resolverRegra("CBS", ctx(), [a, b]);
    expect(r.kind).toBe("conflict");
  });

  it("a regra mais específica vence a genérica", () => {
    const generica = regra({ id: "g", taxId: "CBS", cst: ["000"], aliquotaFixa: 0.009 });
    const especifica = regra({ id: "e", taxId: "CBS", cst: ["000"], cclasstrib: ["000001"], aliquotaFixa: 0.005 });
    const r = resolverRegra("CBS", ctx(), [generica, especifica]);
    expect(r.kind).toBe("resolved");
    if (r.kind === "resolved") expect(r.regra.id).toBe("e");
  });
});

describe("validadores", () => {
  it("CFOP 6102 numa operação interna gera V004", () => {
    const a = analisar(nota([item()], "2026-08-05", "MG"), [CBS_2026, IBS_2026]);
    expect(a.itens[0].achados.map((x) => x.codigo)).toContain("V004");
  });

  it("NCM com menos de 8 dígitos gera V003", () => {
    const a = analisar(nota([item({ ncm: "7312" })]), [CBS_2026, IBS_2026]);
    expect(a.itens[0].achados.map((x) => x.codigo)).toContain("V003");
  });
});

describe("agregação", () => {
  it("confiança baixa nunca sai como APROVADO", () => {
    const a = analisar(nota([item({ cst: null, cClassTrib: null, baseInformada: null })]), [CBS_2026, IBS_2026]);
    expect(a.confianca).toBe("baixa");
    expect(a.resultado).toBe("NECESSITA_REVISAO");
  });

  it("determinismo: mesma entrada, mesma saída", () => {
    const n = nota([item()]);
    expect(JSON.stringify(analisar(n, [CBS_2026, IBS_2026])))
      .toEqual(JSON.stringify(analisar(n, [CBS_2026, IBS_2026])));
  });
});

describe("chave de acesso", () => {
  it("aceita chave com DV correto e rejeita dígito trocado", async () => {
    const { chaveValida, extrairChave, dadosDaChave } = await import("@/lib/nfe/chave");
    const chave = "31260738164393000164550010011001471682094377";
    expect(chaveValida(chave)).toBe(true);

    const trocado = chave.slice(0, 10) + (Number(chave[10]) === 9 ? "8" : "9") + chave.slice(11);
    expect(chaveValida(trocado)).toBe(false);

    expect(extrairChave(`Chave de acesso ${chave} DANFE`).chave).toBe(chave);
    expect(dadosDaChave(chave).modelo).toBe("55");
  });
});
