import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { supabaseServer } from "@/lib/supabase/server";
import { parseNFe, ErroParse } from "@/lib/nfe/parser";
import { extrairDanfe } from "@/lib/nfe/pdf";
import { carregarRegras, congelarRuleSet, carregarAdmissibilidade } from "@/lib/tax-engine/repository";
import { analisar } from "@/lib/tax-engine/engine";
import { ENGINE_VERSION } from "@/lib/tax-engine/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const storagePathXml = (companyId: string, hash: string) => `${companyId}/${hash}.xml`; // Vercel: limite do plano. Lote grande vai para a fila.

const MAX_BYTES_XML = 5 * 1024 * 1024;
const MAX_BYTES_PDF = 10 * 1024 * 1024;
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
      const ehPdf = /\.pdf$/i.test(nome);
      const ehXml = /\.xml$/i.test(nome);
      if (!ehPdf && !ehXml) throw new ErroParse("FILE_REJECTED", "Envie o XML da NF-e ou o DANFE em PDF.");
      if (file.size > (ehPdf ? MAX_BYTES_PDF : MAX_BYTES_XML))
        throw new ErroParse("FILE_REJECTED", `Arquivo acima de ${ehPdf ? 10 : 5} MB.`);

      // ---------------------------------------------------------------- PDF
      if (ehPdf) {
        const buffer = await file.arrayBuffer();
        const pdfHash = createHash("sha256").update(Buffer.from(buffer)).digest("hex");
        const danfe = await extrairDanfe(buffer);
        const pdfPath = `${companyId}/pdf/${pdfHash}.pdf`;

        await sb.storage.from("documentos-fiscais")
          .upload(pdfPath, buffer, { contentType: "application/pdf", upsert: true });

        if (danfe.escaneado && !danfe.chave) {
          resultados.push({
            arquivo: nome,
            erro: {
              code: "PDF_ESCANEADO",
              message: "PDF sem camada de texto (documento escaneado). Não foi possível ler a chave de acesso. Envie o XML da nota.",
            },
          });
          continue;
        }

        if (!danfe.chave) {
          resultados.push({
            arquivo: nome,
            erro: {
              code: "CHAVE_NAO_ENCONTRADA",
              message: danfe.chaveInvalida
                ? "Encontrei uma sequência de 44 dígitos, mas o dígito verificador não confere. Envie o XML da nota."
                : "Não localizei a chave de acesso neste PDF. Envie o XML da nota.",
            },
          });
          continue;
        }

        // Chave válida: se o XML já está na base, o PDF vira anexo do documento.
        const { data: comXml } = await sb.from("documents")
          .select("id, tem_xml, deleted_at")
          .eq("company_id", companyId).eq("chave", danfe.chave).maybeSingle();

        if (comXml) {
          if (comXml.deleted_at)
            await sb.from("documents").update({ deleted_at: null, deleted_by: null, motivo_exclusao: null }).eq("id", comXml.id);

          await sb.from("documents")
            .update({ pdf_path: pdfPath, pdf_hash: pdfHash, pdf_escaneado: danfe.escaneado })
            .eq("id", comXml.id);

          const { data: ultima } = await sb.from("analyses")
            .select("id").eq("document_id", comXml.id)
            .order("created_at", { ascending: false }).limit(1).maybeSingle();

          resultados.push({
            arquivo: nome,
            documentId: comXml.id,
            analysisId: ultima?.id,
            resultado: "PDF_ANEXADO",
            confianca: "—",
            aviso: "PDF anexado ao documento que já tinha XML. A análise continua baseada no XML.",
          });
          continue;
        }

        // Sem XML: registra como pendente. Nenhum cálculo é feito.
        const { data: docPdf, error: ePdf } = await sb.from("documents").insert({
          company_id: companyId,
          modelo: danfe.chave.slice(20, 22),
          numero: danfe.numero, serie: danfe.serie, chave: danfe.chave,
          data_operacao: `20${danfe.chave.slice(2, 4)}-${danfe.chave.slice(4, 6)}-01`,
          natureza: null,
          emit: { cnpj: danfe.cnpjEmitente, nome: null, uf: null, municipio: null, crt: null },
          dest: {},
          totais: { vNF: danfe.valorTotal, vProd: null },
          storage_path: pdfPath, hash_arquivo: pdfHash,
          status: "aguardando_xml", origem: "pdf", tem_xml: false,
          pdf_path: pdfPath, pdf_hash: pdfHash, pdf_escaneado: danfe.escaneado,
          created_by: auth.user.id,
        }).select("id").single();
        if (ePdf) throw ePdf;

        resultados.push({
          arquivo: nome,
          documentId: docPdf.id,
          resultado: "AGUARDANDO_XML",
          confianca: "—",
          aviso: `Chave ${danfe.chave} lida e conferida. O DANFE não traz os dados fiscais necessários para o cálculo: envie o XML desta nota para gerar o laudo.`,
        });
        continue;
      }
      // ---------------------------------------------------------------- XML

      const xml = await file.text();
      const nota = parseNFe(xml);
      const hash = createHash("sha256").update(xml).digest("hex");

      // Idempotência: mesmo arquivo, mesma empresa, não duplica.
      const { data: existente } = await sb.from("documents")
        .select("id, deleted_at").eq("company_id", companyId).eq("hash_arquivo", hash).maybeSingle();

      // Se o PDF chegou antes, o XML assume o documento já criado pela chave.
      if (!existente && nota.chave) {
        const { data: soPdf } = await sb.from("documents")
          .select("id").eq("company_id", companyId).eq("chave", nota.chave).eq("tem_xml", false).maybeSingle();
        if (soPdf) {
          await sb.from("documents").update({
            hash_arquivo: hash, storage_path: storagePathXml(companyId, hash),
            tem_xml: true, origem: "xml", status: "processado",
            data_operacao: nota.dataOperacao, natureza: nota.natureza,
            emit: nota.emitente, dest: nota.destinatario, totais: nota.totais,
            numero: nota.numero, serie: nota.serie, modelo: nota.modelo,
            deleted_at: null,
          }).eq("id", soPdf.id);
          await sb.from("document_items").delete().eq("document_id", soPdf.id);
        }
      }

      // Documento excluído e reenviado volta a ficar visível, em vez de ser
      // rejeitado pela restrição de hash único.
      if (existente?.deleted_at) {
        await sb.from("documents")
          .update({ deleted_at: null, deleted_by: null, motivo_exclusao: null })
          .eq("id", existente.id);
      }

      let documentId = existente?.id as string | undefined;
      if (!documentId && nota.chave) {
        const { data: assumido } = await sb.from("documents")
          .select("id").eq("company_id", companyId).eq("chave", nota.chave).maybeSingle();
        documentId = assumido?.id;
        if (documentId) {
          const { error: eItens } = await sb.from("document_items").insert(
            nota.itens.map((it) => ({
              document_id: documentId, company_id: companyId, n_item: it.nItem,
              descricao: it.descricao, ncm: it.ncm, cfop: it.cfop, cst: it.cst, cclasstrib: it.cClassTrib,
              valor_produto: it.valorProduto, desconto: it.desconto, frete: it.frete,
              seguro: it.seguro, outras: it.outras, destacado: it.destacado,
            })),
          );
          if (eItens) throw eItens;
        }
      }
      const storagePath = storagePathXml(companyId, hash);

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
      const tabela = await carregarAdmissibilidade(sb);
      const ruleSetId = await congelarRuleSet(sb, regras, ENGINE_VERSION);
      const analise = analisar(nota, regras, { tabela });

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
