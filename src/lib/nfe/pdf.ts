import { extractText, getDocumentProxy } from "unpdf";
import { extrairChave, dadosDaChave } from "./chave";

/* ============================================================================
   Extração de DANFE em PDF.

   O PDF NÃO é fonte fiscal. Dele extraímos identificação — sobretudo a chave
   de acesso, que é autoverificável — e nunca dados de tributação item a item.
   Regra do produto: PDF sem XML jamais gera laudo tributário conclusivo.
   ========================================================================== */

export interface PdfExtraido {
  texto: string;
  escaneado: boolean;       // sem camada de texto: precisaria de OCR
  paginas: number;
  chave: string | null;     // 44 dígitos, com DV conferido
  chaveInvalida: string | null; // encontrada mas com DV errado
  numero: string | null;
  serie: string | null;
  cnpjEmitente: string | null;
  valorTotal: number | null;
}

function acharValor(texto: string): number | null {
  // "VALOR TOTAL DA NOTA" seguido de um número no formato brasileiro.
  const m = texto.match(/VALOR\s+TOTAL\s+DA\s+NOTA[\s\S]{0,80}?([\d.]+,\d{2})/i);
  if (!m) return null;
  const n = Number(m[1].replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export async function extrairDanfe(buffer: ArrayBuffer): Promise<PdfExtraido> {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text, totalPages } = await extractText(pdf, { mergePages: true });
  const texto = String(text ?? "");

  // Menos de ~200 caracteres em um DANFE indica PDF de imagem.
  const escaneado = texto.replace(/\s/g, "").length < 200;

  const { chave, invalida } = extrairChave(texto);
  const numero = texto.match(/N[ºo°]?\.?\s*0*(\d{1,9})\s*S[ÉE]RIE/i)?.[1] ?? null;
  const serie = texto.match(/S[ÉE]RIE\s*:?\s*0*(\d{1,3})/i)?.[1] ?? null;
  const cnpj = texto.match(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/)?.[0] ?? null;

  return {
    texto,
    escaneado,
    paginas: totalPages ?? 1,
    chave,
    chaveInvalida: chave ? null : invalida,
    // Quando há chave, ela é a fonte mais confiável de número e série.
    numero: chave ? dadosDaChave(chave).numero : numero,
    serie: chave ? dadosDaChave(chave).serie : serie,
    cnpjEmitente: chave ? dadosDaChave(chave).cnpjEmitente : cnpj ? cnpj.replace(/\D/g, "") : null,
    valorTotal: acharValor(texto),
  };
}
