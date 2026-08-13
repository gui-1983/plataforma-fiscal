import { extractText, getDocumentProxy } from "unpdf";

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

/** Módulo 11 — o mesmo DV que a SEFAZ usa na chave de acesso. */
export function chaveValida(chave: string): boolean {
  if (!/^\d{44}$/.test(chave)) return false;
  const base = chave.slice(0, 43);
  let peso = 2;
  let soma = 0;
  for (let i = base.length - 1; i >= 0; i--) {
    soma += Number(base[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  const dv = resto === 0 || resto === 1 ? 0 : 11 - resto;
  return dv === Number(chave[43]);
}

const soDigitos = (s: string) => s.replace(/\D/g, "");

function acharChave(texto: string): { chave: string | null; invalida: string | null } {
  // A chave costuma vir com espaços a cada 4 dígitos no DANFE.
  const candidatos = new Set<string>();

  for (const m of texto.matchAll(/(?:\d[\s.]?){44}/g)) {
    const d = soDigitos(m[0]);
    if (d.length === 44) candidatos.add(d);
  }
  // Fallback: sequência longa de dígitos, fatiada em janelas de 44.
  for (const m of texto.matchAll(/\d{44,}/g)) {
    const d = m[0];
    for (let i = 0; i + 44 <= d.length; i++) candidatos.add(d.slice(i, i + 44));
  }

  let invalida: string | null = null;
  for (const c of candidatos) {
    if (chaveValida(c)) return { chave: c, invalida: null };
    invalida = invalida ?? c;
  }
  return { chave: null, invalida };
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

  const { chave, invalida } = acharChave(texto);
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
    numero: chave ? String(Number(chave.slice(25, 34))) : numero,
    serie: chave ? String(Number(chave.slice(22, 25))) : serie,
    cnpjEmitente: chave ? chave.slice(6, 20) : cnpj ? soDigitos(cnpj) : null,
    valorTotal: acharValor(texto),
  };
}
