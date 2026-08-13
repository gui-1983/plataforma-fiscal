import { supabaseServer } from "@/lib/supabase/server";
import Restaurar from "./restaurar";

export const dynamic = "force-dynamic";

const dataHora = (s?: string | null) =>
  s ? new Date(s).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";

export default async function Auditoria() {
  const sb = await supabaseServer();

  const { data: excluidos } = await sb
    .from("documents")
    .select("id, numero, serie, chave, data_operacao, emit, deleted_at, motivo_exclusao, profiles:deleted_by ( nome, email )")
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false })
    .limit(100);

  const { data: logs } = await sb
    .from("audit_logs")
    .select("id, created_at, acao, entidade, entidade_id, motivo, antes, profiles:user_id ( nome, email )")
    .order("created_at", { ascending: false })
    .limit(200);

  const um = (v: unknown) => ((Array.isArray(v) ? v[0] : v) ?? {}) as Record<string, string>;

  return (
    <>
      <div className="cabeca">
        <div>
          <div className="eyebrow">Administração</div>
          <h1>Auditoria</h1>
          <p>
            Documentos excluídos e trilha de alterações. Nada some do banco: a exclusão é lógica,
            registrada com autor e motivo, e pode ser desfeita.
          </p>
        </div>
      </div>

      <div className="eyebrow" style={{ marginBottom: 10 }}>
        Documentos excluídos · {excluidos?.length ?? 0}
      </div>

      {!excluidos?.length ? (
        <div className="cartao" style={{ padding: 22, fontSize: 13, color: "var(--ink-2)" }}>
          Nenhum documento excluído.
        </div>
      ) : (
        <div className="cartao">
          <table className="dados">
            <thead>
              <tr><th>Nota</th><th>Emitente</th><th>Emissão</th><th>Excluído em</th><th>Por</th><th>Motivo</th><th></th></tr>
            </thead>
            <tbody>
              {excluidos.map((d: any) => (
                <tr key={d.id}>
                  <td className="mono">{d.numero}/{d.serie}</td>
                  <td>{d.emit?.nome}<br /><span className="mono" style={{ fontSize: 10.5, color: "var(--ink-2)" }}>{d.chave}</span></td>
                  <td className="mono">{d.data_operacao?.split("-").reverse().join("/")}</td>
                  <td className="mono">{dataHora(d.deleted_at)}</td>
                  <td style={{ fontSize: 12.5 }}>{um(d.profiles).nome ?? um(d.profiles).email ?? "—"}</td>
                  <td style={{ fontSize: 12.5 }}>{d.motivo_exclusao}</td>
                  <td><Restaurar documentId={d.id} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="eyebrow" style={{ margin: "28px 0 10px" }}>
        Trilha de alterações · últimos {logs?.length ?? 0} registros
      </div>

      {!logs?.length ? (
        <div className="cartao" style={{ padding: 22, fontSize: 13, color: "var(--ink-2)" }}>
          Nenhum registro. A trilha só é visível para administradores da empresa.
        </div>
      ) : (
        <div className="cartao">
          <table className="dados">
            <thead>
              <tr><th>Quando</th><th>Quem</th><th>Ação</th><th>Entidade</th><th>Motivo</th></tr>
            </thead>
            <tbody>
              {logs.map((l: any) => (
                <tr key={l.id}>
                  <td className="mono">{dataHora(l.created_at)}</td>
                  <td style={{ fontSize: 12.5 }}>{um(l.profiles).nome ?? um(l.profiles).email ?? "—"}</td>
                  <td className="mono" style={{ fontSize: 11.5 }}>{l.acao}</td>
                  <td className="mono" style={{ fontSize: 11 }}>
                    {l.entidade}
                    {l.antes?.numero && <><br /><span style={{ color: "var(--ink-2)" }}>nota {l.antes.numero}/{l.antes.serie}</span></>}
                  </td>
                  <td style={{ fontSize: 12.5 }}>{l.motivo ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 14, maxWidth: "72ch" }}>
        A tabela de trilha é somente inclusão: o banco recusa alteração e remoção de registros.
        Restaurar um documento também gera um registro próprio.
      </p>
    </>
  );
}
