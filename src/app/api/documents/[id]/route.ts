import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Exclusão lógica do documento. As análises continuam no banco, referenciadas
 * pelo rule_set que as originou — o que sai é a visibilidade nas telas.
 * Motivo é obrigatório: exclusão sem justificativa não é auditável.
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await supabaseServer();

  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: { code: "UNAUTHENTICATED" } }, { status: 401 });

  let motivo = "";
  try {
    const body = await req.json();
    motivo = String(body?.motivo ?? "").trim();
  } catch { /* corpo ausente */ }

  if (motivo.length < 5)
    return NextResponse.json(
      { error: { code: "MOTIVO_REQUIRED", message: "Informe o motivo da exclusão." } },
      { status: 400 },
    );

  const { data: doc } = await sb
    .from("documents")
    .select("id, company_id, numero, serie, chave, deleted_at")
    .eq("id", id)
    .maybeSingle();

  if (!doc) return NextResponse.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
  if (doc.deleted_at) return NextResponse.json({ ok: true, jaExcluido: true });

  const { error } = await sb
    .from("documents")
    .update({ deleted_at: new Date().toISOString(), deleted_by: user.id, motivo_exclusao: motivo })
    .eq("id", id);

  // RLS recusa quando o usuário não é administrador da empresa.
  if (error)
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Apenas administradores da empresa podem excluir documentos." } },
      { status: 403 },
    );

  await sb.from("audit_logs").insert({
    company_id: doc.company_id,
    user_id: user.id,
    acao: "documento.excluir",
    entidade: "documents",
    entidade_id: id,
    antes: { numero: doc.numero, serie: doc.serie, chave: doc.chave },
    depois: { deleted_at: new Date().toISOString() },
    motivo,
  });

  return NextResponse.json({ ok: true });
}
