import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { supabaseServer } from "@/lib/supabase/server";
import { parseNFe, ErroParse } from "@/lib/nfe/parser";
import { carregarRegras, congelarRuleSet } from "@/lib/tax-engine/repository";
import { analisar } from "@/lib/tax-engine/engine";
import { ENGINE_VERSION } from "@/lib/tax-engine/types";

export const runtime = "nodejs";
export const maxDuration = 60; // Vercel: limite do plano. Lote grande vai para a fila.

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_ARQUIVOS_SINCRONO = 10;

export async function POST(req: Request) {
  const sb = await supabaseServer();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: { code: "UNAUTHENTICATED" } }, { status: 401 });

  const form = await req.formData();
  const companyId = String(form.get("companyId") ?? "");
  const arquivos = form.getAll("files").filter((f): f is File => f instanceof File);

  if (!companyId) return NextResponse.json({ error: { code: "COMPANY_REQUIRED" } }, { status: 400 });
  if (arquivos.length === 0) return NextResponse.json({ error: { code: "NO_FILES" } }, { status: 400 });

  // Acima do limite síncrono, enfileira. O worker do cron processa em lote.
  if (arquivos.length > MAX_ARQUIVOS_SINCRONO)
    return NextResponse.json({ error: { code: "USE_BATCH", message: "Envie por /api/jobs para processamento em lote." } }, { status: 413 });

  const resultados: unknown[] = [];

  for (const file of arquivos) {
    const nome = file.name;
    try {
      if (!/\.xml$/i.test(nome)) throw new ErroParse("FILE_REJECTED", "Extensão não permitida.");
      if (file.size > MAX_BYTES) throw new ErroParse("FILE_REJECTED", "Arquivo acima de 5 MB.");

      const xml = await file.text();
      const nota = parseNFe(xml);
      const hash = createHash("sha256").update(xml).digest("hex");

      // Idempotência: mesmo arquivo, mesma empresa, não duplica.
      const { data: existente } = await sb.from("documents")
        .select("id").eq("company_id", companyId).eq("hash_arquivo", hash).maybeSingle();

      let documentId = existente?.id as string | undefined;
      const storagePath = `${companyId}/${hash}.xml`;

      if (!documentId) {
        const up = await sb.storage.from("documentos-fiscais")
          .upload(storagePath, xml, { contentType: "application/xml", upsert: false });
        if (up.error && !up.error.message.includes("exists")) throw up.error;

        const { data: doc, error } = await sb.from("documents").insert({
          company_id: companyId,
          modelo: nota.modelo, numero: nota.numero, serie: nota.serie, chave: nota.chave,
          data_operacao: nota.dataOperacao, natureza: nota.natureza,
          emit: nota.emitente, dest: nota.destinatario, totais: nota.totais,
          storage_path: storagePath, hash_arquivo: hash, status: "processado",
          created_by: auth.user.id,
        }).select("id").single();
        if (error) throw error;
        documentId = doc.id;

        const { error: e2 } = await sb.from("document_items").insert(
          nota.itens.map((it) => ({
            document_id: documentId, company_id: companyId, n_item: it.nItem,
            descricao: it.descricao, ncm: it.ncm, cfop: it.cfop, cst: it.cst, cclasstrib: it.cClassTrib,
            valor_produto: it.valorProduto, desconto: it.desconto, frete: it.frete,
            seguro: it.seguro, outras: it.outras, destacado: it.destacado,
          })),
        );
        if (e2) throw e2;
      }

      // Regras vigentes NA DATA DA OPERAÇÃO, não na data de hoje.
      const regras = await carregarRegras(sb, nota.dataOperacao);
      const ruleSetId = await congelarRuleSet(sb, regras, ENGINE_VERSION);
      const analise = analisar(nota, regras);

      const { data: saved, error: e3 } = await sb.from("analyses").insert({
        company_id: companyId, document_id: documentId,
        engine_version: ENGINE_VERSION, rule_set_id: ruleSetId,
        reference_date: nota.dataOperacao,
        resultado: analise.resultado, confianca: analise.confianca, impacto: analise.impacto,
        trace: analise, created_by: auth.user.id,
      }).select("id").single();
      if (e3) throw e3;

      const divergencias = analise.itens.flatMap((i) => [
        ...i.achados.map((a) => ({
          analysis_id: saved.id, company_id: companyId, codigo: a.codigo,
          gravidade: a.gravidade, campo: a.campo ?? null, texto: a.texto, fundamento: a.fundamento,
        })),
        ...i.tributos.filter((t) => t.status === "DIVERGENCIA" || t.status === "AUSENTE").map((t) => ({
          analysis_id: saved.id, company_id: companyId, codigo: "DIF_VALOR",
          gravidade: "alta", campo: t.tax, texto: `${t.tax}: ${t.motivo}`,
          fundamento: t.ruleVersionId ?? "", valor_informado: t.valorInformado, valor_esperado: t.valorEsperado,
        })),
      ]);
      if (divergencias.length) await sb.from("tax_divergences").insert(divergencias);

      resultados.push({ arquivo: nome, documentId, analysisId: saved.id, resultado: analise.resultado, confianca: analise.confianca });
    } catch (e) {
      const err = e as ErroParse;
      resultados.push({ arquivo: nome, erro: { code: err.codigo ?? "INTERNAL", message: err.message } });
    }
  }

  return NextResponse.json({ resultados });
}
