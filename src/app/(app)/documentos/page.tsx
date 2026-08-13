import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import Excluir from "./excluir";

export const dynamic = "force-dynamic";

const brl = (n: number | null) => (n == null ? "—" : n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const dataBR = (s?: string | null) => (s ? s.split("-").reverse().join("/") : "—");
const SELO: Record<string, string> = {
  APROVADO: "ok", APROVADO_COM_RESSALVAS: "aten", NECESSITA_REVISAO: "aten", DIVERGENCIA: "erro",
};

export default async function Documentos() {
  const sb = await supabaseServer();

  // Só documentos ativos. Excluídos permanecem no banco para auditoria.
  const { data: docs } = await sb
    .from("documents")
    .select("id, numero, serie, emit, totais, data_operacao")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(100);

  const ids = (docs ?? []).map((d) => d.id);

  const { data: analises } = ids.length
    ? await sb
        .from("analyses")
        .select("id, document_id, resultado, confianca, impacto, reference_date, created_at")
        .in("document_id", ids)
        .order("created_at", { ascending: false })
    : { data: [] as any[] };

  // Cada documento exibe a análise mais recente.
  const ultima = new Map<string, any>();
  for (const a of analises ?? []) if (!ultima.has(a.document_id)) ultima.set(a.document_id, a);

  const linhas = (docs ?? []).map((d: any) => ({ doc: d, analise: ultima.get(d.id) }));
  const total = linhas.length;
  const conta = (r: string) => linhas.filter((l) => l.analise?.resultado === r).length;
  const impacto = linhas.reduce((s, l) => s + Number(l.analise?.impacto ?? 0), 0);

  return (
    <>
      <div className="cabeca">
        <div>
          <div className="eyebrow">Visão consolidada</div>
          <h1>Documentos analisados</h1>
          <p>Últimos 100 documentos ativos. Excluir remove o documento das telas, mas mantém o registro e a trilha para auditoria.</p>
        </div>
      </div>

      <div className="grade" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", marginBottom: 18 }}>
        <div className="cartao kpi"><div className="rot">Documentos</div><div className="val">{total}</div></div>
        <div className="cartao kpi"><div className="rot">Aprovados</div><div className="val">{conta("APROVADO")}</div></div>
        <div className="cartao kpi"><div className="rot">Com divergência</div><div className="val" style={{ color: "var(--carimbo)" }}>{conta("DIVERGENCIA")}</div></div>
        <div className="cartao kpi"><div className="rot">Necessitam revisão</div><div className="val" style={{ color: "var(--ocre)" }}>{conta("NECESSITA_REVISAO")}</div></div>
        <div className="cartao kpi"><div className="rot">Divergência apurada</div><div className="val sm" style={{ color: "var(--carimbo)" }}>{brl(impacto)}</div></div>
      </div>

      {total === 0 ? (
        <div className="cartao" style={{ padding: 24, fontSize: 13, color: "var(--ink-2)" }}>
          Nenhum documento ativo. Comece em <Link href="/validar">Validar notas</Link>.
        </div>
      ) : (
        <div className="cartao">
          <table className="dados">
            <thead>
              <tr>
                <th>Nota</th><th>Emitente</th><th>Emissão</th><th className="n">Valor</th>
                <th>Confiança</th><th>Resultado</th><th></th><th></th>
              </tr>
            </thead>
            <tbody>
              {linhas.map(({ doc, analise }) => (
                <tr key={doc.id}>
                  <td className="mono">{doc.numero}/{doc.serie}</td>
                  <td>{doc.emit?.nome}</td>
                  <td className="mono">{dataBR(doc.data_operacao)}</td>
                  <td className="n">{brl(doc.totais?.vNF ?? null)}</td>
                  <td>{analise ? <span className="pill">{String(analise.confianca).toUpperCase()}</span> : "—"}</td>
                  <td>
                    {analise
                      ? <span className={"selo " + (SELO[analise.resultado] ?? "neutro")}>{analise.resultado.replace(/_/g, " ")}</span>
                      : <span className="pill">sem análise</span>}
                  </td>
                  <td>{analise && <Link className="btn fant" href={`/analises/${analise.id}`}>Abrir</Link>}</td>
                  <td><Excluir documentId={doc.id} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
