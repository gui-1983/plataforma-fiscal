import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const brl = (n: number | null) => (n == null ? "—" : n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const dataBR = (s?: string | null) => (s ? s.split("-").reverse().join("/") : "—");
const SELO: Record<string, string> = {
  APROVADO: "ok", APROVADO_COM_RESSALVAS: "aten", NECESSITA_REVISAO: "aten", DIVERGENCIA: "erro",
};

export default async function Documentos() {
  const sb = await supabaseServer();
  const { data } = await sb
    .from("analyses")
    .select("id, resultado, confianca, impacto, reference_date, documents ( numero, serie, emit, totais )")
    .order("created_at", { ascending: false })
    .limit(100);

  const analises = data ?? [];
  const total = analises.length;
  const conformes = analises.filter((a) => a.resultado === "APROVADO").length;
  const divergentes = analises.filter((a) => a.resultado === "DIVERGENCIA").length;
  const revisao = analises.filter((a) => a.resultado === "NECESSITA_REVISAO").length;
  const impacto = analises.reduce((s, a) => s + Number(a.impacto ?? 0), 0);

  return (
    <>
      <div className="cabeca">
        <div>
          <div className="eyebrow">Visão consolidada</div>
          <h1>Documentos analisados</h1>
          <p>Últimas 100 análises da empresa. Cada linha guarda a versão do motor e o conjunto de regras usado.</p>
        </div>
      </div>

      <div className="grade" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", marginBottom: 18 }}>
        <div className="cartao kpi"><div className="rot">Analisadas</div><div className="val">{total}</div></div>
        <div className="cartao kpi"><div className="rot">Aprovadas</div><div className="val">{conformes}</div></div>
        <div className="cartao kpi"><div className="rot">Com divergência</div><div className="val" style={{ color: "var(--carimbo)" }}>{divergentes}</div></div>
        <div className="cartao kpi"><div className="rot">Necessitam revisão</div><div className="val" style={{ color: "var(--ocre)" }}>{revisao}</div></div>
        <div className="cartao kpi"><div className="rot">Divergência apurada</div><div className="val sm" style={{ color: "var(--carimbo)" }}>{brl(impacto)}</div></div>
      </div>

      {total === 0 ? (
        <div className="cartao" style={{ padding: 24, fontSize: 13, color: "var(--ink-2)" }}>
          Nenhuma nota analisada ainda. Comece em <Link href="/validar">Validar notas</Link>.
        </div>
      ) : (
        <div className="cartao">
          <table className="dados">
            <thead>
              <tr><th>Nota</th><th>Emitente</th><th>Emissão</th><th className="n">Valor</th><th>Confiança</th><th>Resultado</th><th></th></tr>
            </thead>
            <tbody>
              {analises.map((a: any) => (
                <tr key={a.id}>
                  <td className="mono">{a.documents?.numero}/{a.documents?.serie}</td>
                  <td>{a.documents?.emit?.nome}</td>
                  <td className="mono">{dataBR(a.reference_date)}</td>
                  <td className="n">{brl(a.documents?.totais?.vNF ?? null)}</td>
                  <td><span className="pill">{String(a.confianca).toUpperCase()}</span></td>
                  <td><span className={"selo " + (SELO[a.resultado] ?? "neutro")}>{a.resultado.replace(/_/g, " ")}</span></td>
                  <td><Link className="btn fant" href={`/analises/${a.id}`}>Abrir</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
