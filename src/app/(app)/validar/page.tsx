import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import Upload from "./upload";

export const dynamic = "force-dynamic";

export default async function ValidarPage() {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login");

  const { data: vinculos } = await sb
    .from("company_users")
    .select("papel, companies ( id, razao_social )");

  const empresas = (vinculos ?? []).map((v: any) => ({
    id: v.companies.id,
    nome: v.companies.razao_social,
    papel: v.papel,
  }));

  return (
    <>
      <div className="cabeca">
        <div>
          <div className="eyebrow">Módulo 2 · Validador fiscal</div>
          <h1>Validar notas</h1>
          <p>
            O XML é lido, recalculado contra as regras vigentes na data de emissão de cada nota e
            comparado com o que foi destacado.
          </p>
        </div>
      </div>

      {empresas.length === 0 ? (
        <div className="erro-box">
          Seu usuário não está vinculado a nenhuma empresa. Um administrador precisa inserir o vínculo
          em <span className="mono">company_users</span> antes de você conseguir enviar documentos.
        </div>
      ) : (
        <Upload empresas={empresas} />
      )}
    </>
  );
}
