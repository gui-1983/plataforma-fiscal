import { notFound } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const brl = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = (n: number | null | undefined) =>
  n == null ? "—" : (n * 100).toLocaleString("pt-BR", { minimumFractionDigits: 4, maximumFractionDigits: 4 }) + "%";
const dataBR = (s?: string | null) => (s ? s.split("-").reverse().join("/") : "—");

const SELO: Record<string, string> = {
  APROVADO: "ok", CORRETO: "ok",
  APROVADO_COM_RESSALVAS: "aten", NECESSITA_REVISAO: "aten",
  DIVERGENCIA: "erro", AUSENTE: "erro",
  INFORMACAO_INSUFICIENTE: "neutro", REGRA_NAO_DETERMINADA: "neutro",
};

export default async function Laudo({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await supabaseServer();

  const { data: analise } = await sb
    .from("analyses")
    .select("id, engine_version, rule_set_id, reference_date, resultado, confianca, impacto, trace, created_at, documents ( numero, serie, chave, modelo, natureza, emit, dest, totais )")
    .eq("id", id)
    .maybeSingle();

  if (!analise) notFound();

  const doc = analise.documents as any;
  const trace = analise.trace as any;

  return (
    <>
      <div className="cabeca">
        <div>
          <div className="eyebrow">NF-e modelo {doc.modelo} · {doc.natureza}</div>
          <h1>Nota {doc.numero} · série {doc.serie}</h1>
          <p className="mono" style={{ fontSize: 11.5 }}>{doc.chave}</p>
        </div>
        <span className={"selo " + (SELO[analise.resultado] ?? "neutro")}>
          {analise.resultado.replace(/_/g, " ")}
        </span>
      </div>

      <div className="grade" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", marginBottom: 18 }}>
        <Ficha rot="Emitente" val={doc.emit?.nome} sub={`${doc.emit?.cnpj ?? ""} · ${doc.emit?.municipio ?? ""}/${doc.emit?.uf ?? ""} · CRT ${doc.emit?.crt ?? ""}`} />
        <Ficha rot="Destinatário" val={doc.dest?.nome} sub={`${doc.dest?.cnpjCpf ?? ""} · ${doc.dest?.municipio ?? ""}/${doc.dest?.uf ?? ""}`} />
        <Ficha rot="Data da operação" val={dataBR(analise.reference_date)} sub={`Regras vigentes nessa data`} />
        <Ficha rot="Confiança" val={String(analise.confianca).toUpperCase()} sub={`Motor ${analise.engine_version}`} />
      </div>

      {analise.confianca === "baixa" && (
        <div className="aviso" style={{ marginBottom: 18 }}>
          <b>Confiança baixa.</b> Há campo ausente, conflito de regras ou regra ainda em curadoria.
          Este laudo não é conclusivo e precisa de revisão tributária.
        </div>
      )}

      {(trace?.itens ?? []).map((linha: any, idx: number) => (
        <div className="cartao" key={idx} style={{ marginBottom: 14 }}>
          <div style={{ padding: "13px 16px", borderBottom: "1px solid var(--fio)" }}>
            <div className="eyebrow">Item {linha.nItem}</div>
            <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
              <span className="pill">NCM {linha.ctx.ncm ?? "—"}</span>
              <span className="pill">CFOP {linha.ctx.cfop ?? "—"}</span>
              <span className="pill">CST {linha.ctx.cst ?? "—"}</span>
              <span className="pill">cClassTrib {linha.ctx.cClassTrib ?? "—"}</span>
              <span className="pill">{linha.ctx.ufOrigem} → {linha.ctx.ufDestino}</span>
            </div>
          </div>

          <table className="dados">
            <thead>
              <tr>
                <th>Tributo</th><th className="n">Base</th><th className="n">Alíq. inf.</th><th className="n">Alíq. esp.</th>
                <th className="n">Informado</th><th className="n">Esperado</th><th className="n">Diferença</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {linha.tributos.map((t: any, i: number) => (
                <tr key={i}>
                  <td className="mono">{t.tax}</td>
                  <td className="n">{brl(t.base)}</td>
                  <td className="n">{pct(t.aliquotaInformada)}</td>
                  <td className="n">{pct(t.aliquotaEsperada)}</td>
                  <td className="n">{brl(t.valorInformado)}</td>
                  <td className="n">{brl(t.valorEsperado)}</td>
                  <td className="n" style={{ color: t.diferenca ? "var(--carimbo)" : undefined }}>{brl(t.diferenca)}</td>
                  <td><span className={"selo " + (SELO[t.status] ?? "neutro")} style={{ fontSize: 10.5, padding: "3px 8px" }}>{t.status.replace(/_/g, " ")}</span></td>
                </tr>
              ))}
            </tbody>
          </table>

          {linha.tributos.map((t: any, i: number) => (
            <div className="trilha" key={i} style={{ borderTopWidth: 1, borderLeft: 0, borderRight: 0, borderBottom: 0 }}>
              <div className="eyebrow" style={{ marginBottom: 10 }}>Trilha da regra · {t.tax}</div>

              <div className="linha">
                <div className="rot">Candidatas</div>
                <div style={{ flex: 1 }}>
                  {(t.resolucao?.candidatas ?? []).length === 0 && (
                    <div className="cand perdeu">nenhuma regra vigente casou com este contexto</div>
                  )}
                  {(t.resolucao?.candidatas ?? []).map((c: any, k: number) => (
                    <div key={k} className={"cand " + (t.ruleVersionId === c.id ? "venceu" : "perdeu")}>
                      <span className="sc">{c.score}</span>
                      <span>{c.code}</span>
                      <span style={{ opacity: 0.7 }}>{c.artigo}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="linha">
                <div className="rot">Conclusão</div>
                <div>
                  <span className={"selo " + (SELO[t.status] ?? "neutro")} style={{ fontSize: 10.5, padding: "3px 8px" }}>
                    {t.status.replace(/_/g, " ")}
                  </span>
                  <div style={{ marginTop: 6, color: "var(--ink-2)", fontSize: 12.5 }}>{t.motivo}</div>
                </div>
              </div>
            </div>
          ))}

          {linha.achados?.length > 0 && (
            <div style={{ padding: "12px 16px", borderTop: "1px solid var(--fio)", background: "#FCFCFA" }}>
              <div className="eyebrow" style={{ marginBottom: 6 }}>Achados de conformidade</div>
              {linha.achados.map((a: any, i: number) => (
                <div className="achado" key={i}>
                  <span className={"cod " + a.gravidade}>{a.codigo}</span>
                  <div>{a.texto}<em>{a.fundamento}</em></div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      <div className="aviso" style={{ marginTop: 20 }}>
        Análise gerada pelo motor {analise.engine_version} com o conjunto de regras {analise.rule_set_id},
        vigentes em {dataBR(analise.reference_date)}. A ausência de divergência apontada não atesta a
        conformidade fiscal da operação: indica apenas que nenhuma regra cadastrada foi violada.
        O resultado não substitui a análise de contador, advogado tributarista ou autoridade fiscal.
      </div>
    </>
  );
}

function Ficha({ rot, val, sub }: { rot: string; val?: string | null; sub?: string }) {
  return (
    <div className="cartao kpi">
      <div className="rot">{rot}</div>
      <div className="val sm">{val ?? "—"}</div>
      <div style={{ fontSize: 11.5, color: "var(--ink-2)", marginTop: 4 }}>{sub}</div>
    </div>
  );
}
