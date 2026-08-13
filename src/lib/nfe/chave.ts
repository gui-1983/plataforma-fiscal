/* ============================================================================
   Chave de acesso do DF-e. Sem dependência de Node nem de browser: usada
   no servidor, no cliente e nos testes.

   Por que a chave é o alvo certo do OCR: ela carrega dígito verificador
   (módulo 11). Se o OCR trocar um dígito, o DV não fecha e a leitura é
   rejeitada. Nenhum outro campo do DANFE tem essa propriedade — um valor
   lido errado passaria despercebido.
   ========================================================================== */

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

/** Campos codificados na própria chave — não dependem de ler o layout. */
export function dadosDaChave(chave: string) {
  return {
    cUF: chave.slice(0, 2),
    ano: `20${chave.slice(2, 4)}`,
    mes: chave.slice(4, 6),
    cnpjEmitente: chave.slice(6, 20),
    modelo: chave.slice(20, 22),
    serie: String(Number(chave.slice(22, 25))),
    numero: String(Number(chave.slice(25, 34))),
  };
}

/**
 * Procura uma chave válida em texto solto. Aceita separadores e, para texto
 * vindo de OCR, testa janelas deslizantes dentro de sequências longas.
 */
export function extrairChave(texto: string): { chave: string | null; invalida: string | null } {
  const candidatos = new Set<string>();

  for (const m of texto.matchAll(/(?:\d[\s.\-]?){44}/g)) {
    const d = m[0].replace(/\D/g, "");
    if (d.length === 44) candidatos.add(d);
  }
  for (const m of texto.matchAll(/\d{44,}/g)) {
    const d = m[0];
    for (let i = 0; i + 44 <= d.length; i++) candidatos.add(d.slice(i, i + 44));
  }
  // OCR costuma quebrar a chave em blocos; tenta a concatenação de todos os dígitos.
  const tudo = texto.replace(/\D/g, "");
  for (let i = 0; i + 44 <= tudo.length; i++) candidatos.add(tudo.slice(i, i + 44));

  let invalida: string | null = null;
  for (const c of candidatos) {
    if (chaveValida(c)) return { chave: c, invalida: null };
    invalida = invalida ?? c;
  }
  return { chave: null, invalida };
}
