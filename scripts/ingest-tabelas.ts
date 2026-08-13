/**
 * Ingestor das tabelas oficiais do Informe Técnico RT 2025.002.
 *
 * Baixe o arquivo em: Portal Nacional da NF-e > Documentos > Diversos
 * e rode:
 *
 *   npx tsx scripts/ingest-tabelas.ts ./tabelas.xlsx --versao "IT 2025.002 v1.50" --dry-run
 *   npx tsx scripts/ingest-tabelas.ts ./tabelas.xlsx --versao "IT 2025.002 v1.50"
 *
 * O --dry-run mostra as colunas detectadas e as 5 primeiras linhas SEM gravar.
 * Rode sempre o dry-run primeiro: os cabeçalhos mudam entre versões do IT.
 *
 * A ingestão é versionada por `fonte_versao`. Uma versão nova NÃO apaga a
 * anterior — as duas convivem, e a vigência decide qual vale em cada data.
 */
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import { readFileSync } from "fs";

const args = process.argv.slice(2);
const arquivo = args.find((a) => !a.startsWith("--"));
const versao = valorDe("--versao") ?? "IT 2025.002 (versão não informada)";
const vigenciaIni = valorDe("--vigencia-inicio") ?? "2026-01-01";
const dryRun = args.includes("--dry-run");

function valorDe(flag: string) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

if (!arquivo) {
  console.error("Uso: npx tsx scripts/ingest-tabelas.ts <arquivo.xlsx|csv> --versao \"IT 2025.002 v1.50\" [--dry-run]");
  process.exit(1);
}

/** Aceita variações de cabeçalho entre versões do IT. */
const ALIAS: Record<string, string[]> = {
  cclasstrib: ["cclasstrib", "codigo de classificacao tributaria", "classificacao tributaria", "codclasstrib"],
  cst: ["cst-ibs/cbs", "cst ibs/cbs", "cst", "cstibscbs"],
  descricao: ["descricao", "descricao do cclasstrib", "descricao cclasstrib", "texto"],
  dispositivo: ["dispositivo legal", "dispositivo", "fundamentacao legal", "base legal", "lc 214/2025"],
  p_red_ibs: ["percentual de reducao ibs", "% reducao ibs", "predibs", "reducao ibs"],
  p_red_cbs: ["percentual de reducao cbs", "% reducao cbs", "predcbs", "reducao cbs"],
  tipo_aliquota: ["tipo de aliquota", "tipo aliquota", "aliquota"],
};

const normalizar = (s: string) =>
  String(s ?? "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/\s+/g, " ").trim();

function mapearColunas(cabecalhos: string[]) {
  const mapa: Record<string, string> = {};
  for (const [campo, apelidos] of Object.entries(ALIAS)) {
    const achado = cabecalhos.find((c) => {
      const n = normalizar(c);
      return apelidos.some((a) => n === a || n.includes(a));
    });
    if (achado) mapa[campo] = achado;
  }
  return mapa;
}

const percentual = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const texto = String(v).replace("%", "").replace(",", ".").trim();
  const n = Number(texto);
  if (!Number.isFinite(n)) return null;
  // Planilha pode trazer 60 (por cento) ou 0.6 (fração). Normaliza para fração.
  return n > 1 ? n / 100 : n;
};

async function main() {
  const buffer = readFileSync(arquivo!);
  const wb = XLSX.read(buffer, { type: "buffer" });

  // Procura a aba do cClassTrib; cai na primeira se não achar.
  const nomeAba =
    wb.SheetNames.find((n) => normalizar(n).includes("cclasstrib")) ?? wb.SheetNames[0];
  const linhas = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[nomeAba], { defval: null });

  if (linhas.length === 0) {
    console.error(`A aba "${nomeAba}" está vazia.`);
    process.exit(1);
  }

  const cabecalhos = Object.keys(linhas[0]);
  const mapa = mapearColunas(cabecalhos);

  console.log(`\nAba: ${nomeAba}`);
  console.log(`Linhas: ${linhas.length}`);
  console.log(`\nColunas do arquivo:\n  ${cabecalhos.join("\n  ")}`);
  console.log(`\nMapeamento detectado:`);
  for (const campo of Object.keys(ALIAS))
    console.log(`  ${campo.padEnd(14)} -> ${mapa[campo] ?? "NÃO ENCONTRADA"}`);

  if (!mapa.cclasstrib || !mapa.cst) {
    console.error(
      "\nNão foi possível localizar as colunas de cClassTrib e CST.\n" +
      "Acrescente o cabeçalho real ao objeto ALIAS no topo deste arquivo e rode de novo.",
    );
    process.exit(1);
  }

  const registros = linhas
    .map((l) => ({
      cclasstrib: String(l[mapa.cclasstrib] ?? "").trim(),
      cst: String(l[mapa.cst] ?? "").trim().padStart(3, "0"),
      descricao: String(l[mapa.descricao] ?? "").trim() || "(sem descrição)",
      dispositivo: mapa.dispositivo ? String(l[mapa.dispositivo] ?? "").trim() || null : null,
      tipo_aliquota: mapa.tipo_aliquota ? String(l[mapa.tipo_aliquota] ?? "").trim() || null : null,
      p_red_ibs: mapa.p_red_ibs ? percentual(l[mapa.p_red_ibs]) : null,
      p_red_cbs: mapa.p_red_cbs ? percentual(l[mapa.p_red_cbs]) : null,
      vigencia: `[${vigenciaIni},)`,
      fonte_versao: versao,
    }))
    .filter((r) => /^\d{6}$/.test(r.cclasstrib) && /^\d{3}$/.test(r.cst));

  console.log(`\nRegistros válidos: ${registros.length} de ${linhas.length}`);
  console.log(`Amostra:`);
  console.table(registros.slice(0, 5));

  if (dryRun) {
    console.log("\n--dry-run: nada foi gravado.");
    return;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Defina NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente (.env.local).");
    process.exit(1);
  }

  const sb = createClient(url, key, { auth: { persistSession: false } });

  // Grava em lotes; upsert pela chave (cclasstrib, cst, fonte_versao).
  const LOTE = 500;
  for (let i = 0; i < registros.length; i += LOTE) {
    const fatia = registros.slice(i, i + LOTE);
    const { error } = await sb.from("ref_cclasstrib").upsert(fatia, {
      onConflict: "cclasstrib,cst,fonte_versao",
    });
    if (error) {
      console.error(`Erro no lote ${i}:`, error.message);
      process.exit(1);
    }
    console.log(`  gravados ${Math.min(i + LOTE, registros.length)} / ${registros.length}`);
  }

  // Tabela CST derivada dos pares distintos encontrados.
  const csts = new Map<string, string>();
  for (const r of registros) if (!csts.has(r.cst)) csts.set(r.cst, r.descricao);

  const { error: e2 } = await sb.from("ref_cst_ibscbs").upsert(
    [...csts].map(([cst, descricao]) => ({
      cst, descricao, vigencia: `[${vigenciaIni},)`, fonte_versao: versao,
    })),
    { onConflict: "cst,fonte_versao" },
  );
  if (e2) console.error("Erro ao gravar ref_cst_ibscbs:", e2.message);

  console.log(`\nPronto. ${registros.length} classificações e ${csts.size} CST ingeridos como "${versao}".`);
  console.log("Confira em /regras e reprocesse uma nota para ver o V007 validando de verdade.");
}

main().catch((e) => { console.error(e); process.exit(1); });
