import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { ENGINE_VERSION } from "@/lib/tax-engine/types";
import Sair from "./sair";

const MENU = [
  ["/validar", "Validar notas"],
  ["/documentos", "Documentos"],
  ["/regras", "Regras cadastradas"],
  ["/linha-do-tempo", "Linha do tempo"],
  ["/auditoria", "Auditoria"],
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login");

  const { data: vinculos } = await sb
    .from("company_users")
    .select("papel, companies ( id, razao_social, uf )")
    .limit(1);

  const empresa = (vinculos?.[0] as any)?.companies ?? null;

  return (
    <div className="app">
      <aside className="rail">
        <div className="marca">
          <b>Inteligência Tributária</b>
          <span>Validador fiscal</span>
        </div>
        <nav>
          {MENU.map(([href, rotulo], i) => (
            <Link key={href} href={href} className="item">
              <span className="num">{String(i + 1).padStart(2, "0")}</span> {rotulo}
            </Link>
          ))}
          <Sair />
        </nav>
        <div className="rodape">
          {empresa ? `${empresa.razao_social} · ${empresa.uf}` : "Sem empresa vinculada"}<br />
          Motor {ENGINE_VERSION}<br />
          {user.email}
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
