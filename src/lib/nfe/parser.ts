import { XMLParser, XMLValidator } from "fast-xml-parser";
import type { ItemInput } from "../tax-engine/types";
import type { NotaInput } from "../tax-engine/engine";

/* ============================================================================
   PARSER NF-e 4.00 (modelo 55) incluindo o grupo IBS/CBS da NT 2025.002.
   Segurança: fast-xml-parser não resolve DTD nem entidades externas, o que
   elimina XXE e billion laughs. Limites de tamanho são aplicados antes daqui.
   ========================================================================== */

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,        // tudo vem como string; a conversão é explícita
  trimValues: true,
  removeNSPrefix: true,        // ignora o namespace do portal fiscal
});

const n = (v: unknown): number | null => {
  if (v === undefined || v === null || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};
const s = (v: unknown): string | null => (v === undefined || v === null ? null : String(v).trim() || null);
const arr = <T,>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

export interface NotaParseada extends NotaInput {
  modelo: string | null;
  numero: string | null;
  serie: string | null;
  chave: string | null;
  natureza: string | null;
  emitente: NotaInput["emitente"] & { cnpj: string | null; nome: string | null; municipio: string | null };
  destinatario: NotaInput["destinatario"] & { cnpjCpf: string | null; nome: string | null; municipio: string | null };
  totais: { vProd: number | null; vNF: number | null };
}

export class ErroParse extends Error {
  constructor(public codigo: string, message: string) { super(message); }
}

export function parseNFe(xml: string): NotaParseada {
  const valido = XMLValidator.validate(xml);
  if (valido !== true) throw new ErroParse("XML_INVALID", "XML mal formado.");
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new ErroParse("XML_INVALID", "Declarações DTD não são aceitas.");

  const doc = parser.parse(xml);
  const infNFe = doc?.nfeProc?.NFe?.infNFe ?? doc?.NFe?.infNFe ?? doc?.infNFe;
  if (!infNFe) throw new ErroParse("XSD_MISMATCH", "Estrutura de NF-e não encontrada (infNFe ausente).");

  const ide = infNFe.ide ?? {};
  const emit = infNFe.emit ?? {};
  const dest = infNFe.dest ?? {};
  const enderEmit = emit.enderEmit ?? {};
  const enderDest = dest.enderDest ?? {};
  const total = infNFe.total?.ICMSTot ?? {};

  const dh = s(ide.dhEmi) ?? s(ide.dEmi) ?? "";
  const dataOperacao = dh.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataOperacao))
    throw new ErroParse("INSUFFICIENT_DATA", "Data de emissão ausente ou inválida.");

  const itens: ItemInput[] = arr(infNFe.det).map((det: any, i: number) => {
    const prod = det.prod ?? {};
    const imposto = det.imposto ?? {};
    const ibscbs = imposto.IBSCBS ?? null;
    const g = ibscbs?.gIBSCBS ?? {};
    const pIBS = (n(g.gIBSUF?.pIBSUF) ?? 0) + (n(g.gIBSMun?.pIBSMun) ?? 0);
    const vIBS = (n(g.gIBSUF?.vIBSUF) ?? 0) + (n(g.gIBSMun?.vIBSMun) ?? 0);
    const temIBS = g.gIBSUF !== undefined || g.gIBSMun !== undefined;
    const temCBS = g.gCBS !== undefined;

    return {
      nItem: Number(det["@_nItem"] ?? i + 1),
      descricao: s(prod.xProd),
      ncm: s(prod.NCM),
      cfop: s(prod.CFOP),
      valorProduto: n(prod.vProd) ?? 0,
      desconto: n(prod.vDesc) ?? 0,
      frete: n(prod.vFrete) ?? 0,
      seguro: n(prod.vSeg) ?? 0,
      outras: n(prod.vOutro) ?? 0,
      cst: ibscbs ? s(ibscbs.CST) : null,
      cClassTrib: ibscbs ? s(ibscbs.cClassTrib) : null,
      baseInformada: ibscbs ? n(g.vBC) : null,
      destacado: {
        IBS: { aliquota: temIBS ? pIBS / 100 : null, valor: temIBS ? vIBS : null },
        CBS: { aliquota: n(g.gCBS?.pCBS) !== null ? n(g.gCBS.pCBS)! / 100 : null, valor: temCBS ? n(g.gCBS?.vCBS) : null },
      },
    } satisfies ItemInput;
  });

  if (itens.length === 0) throw new ErroParse("XSD_MISMATCH", "Documento sem itens.");

  return {
    modelo: s(ide.mod),
    numero: s(ide.nNF),
    serie: s(ide.serie),
    chave: (s(infNFe["@_Id"]) ?? "").replace(/^NFe/, "") || null,
    natureza: s(ide.natOp),
    idDest: s(ide.idDest),
    dataOperacao,
    emitente: {
      cnpj: s(emit.CNPJ), nome: s(emit.xNome),
      uf: s(enderEmit.UF) ?? "", municipio: s(enderEmit.xMun),
      codMunicipio: s(enderEmit.cMun) ?? "", crt: s(emit.CRT) ?? "3",
    },
    destinatario: {
      cnpjCpf: s(dest.CNPJ) ?? s(dest.CPF), nome: s(dest.xNome),
      uf: s(enderDest.UF) ?? "", municipio: s(enderDest.xMun),
      codMunicipio: s(enderDest.cMun) ?? "",
    },
    totais: { vProd: n(total.vProd), vNF: n(total.vNF) },
    itens,
  };
}
