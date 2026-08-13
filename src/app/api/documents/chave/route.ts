import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { supabaseServer } from "@/lib/supabase/server";
import { chaveValida, dadosDaChave } from "@/lib/nfe/chave";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Registra um documento a partir de uma chave lida por OCR no navegador.
 * O dígito verificador é conferido AQUI também: nunca confiar em validação
 * feita apenas no cliente.
 */
export async function POST(req: Request) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: { code: "UNAUTHENTICATED" } }, { status: 401 });

  const form = await req.formData();
  const companyId = String(form.get("companyId") ?? "");
  const chave = String(form.get("chave") ?? "").replace(/\D/g, "");
  const file = form.get("file");

  if (!companyId) return NextResponse.json({ error: { code: "COMPANY_REQUIRED" } }, { status: 400 });
  if (!chaveValida(chave))
    return NextResponse.json(
      { error: { code: "CHAVE_INVALIDA", message: "Chave com dígito verificador inválido." } },
      { status: 400 },
    );

  const d = dadosDaChave(chave);

  const { data: existente } = await sb.from("documents")
    .select("id, tem_xml, deleted_at").eq("company_id", companyId).eq("chave", chave).maybeSingle();

  let path: string | null = null;
  let hash = `chave:${chave}`;

  if (file instanceof File) {
    const buffer = await file.arrayBuffer();
    hash = createHash("sha256").update(Buffer.from(buffer)).digest("hex");
    path = `${companyId}/pdf/${hash}.pdf`;
    await sb.storage.from("documentos-fiscais")
      .upload(path, buffer, { contentType: file.type || "application/pdf", upsert: true });
  }

  if (existente) {
    await sb.from("documents")
      .update({ pdf_path: path, pdf_hash: path ? hash : null, pdf_escaneado: true, deleted_at: null })
      .eq("id", existente.id);
    return NextResponse.json({
      documentId: existente.id,
      resultado: existente.tem_xml ? "PDF_ANEXADO" : "AGUARDANDO_XML",
      chave,
    });
  }

  const { data: doc, error } = await sb.from("documents").insert({
    company_id: companyId,
    modelo: d.modelo, numero: d.numero, serie: d.serie, chave,
    data_operacao: `${d.ano}-${d.mes}-01`,
    emit: { cnpj: d.cnpjEmitente, nome: null, uf: null, municipio: null, crt: null },
    dest: {},
    totais: { vNF: null, vProd: null },
    storage_path: path ?? `${companyId}/sem-arquivo/${chave}`,
    hash_arquivo: hash,
    status: "aguardando_xml", origem: "pdf", tem_xml: false,
    pdf_path: path, pdf_hash: path ? hash : null, pdf_escaneado: true,
    created_by: user.id,
  }).select("id").single();

  if (error) return NextResponse.json({ error: { code: "INTERNAL", message: error.message } }, { status: 500 });

  return NextResponse.json({ documentId: doc.id, resultado: "AGUARDANDO_XML", chave });
}
