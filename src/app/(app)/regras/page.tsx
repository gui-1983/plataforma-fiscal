import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const pct = (n: number | null) => (n == null ? "—" : (n * 100).toLocaleString("pt-BR", { minimumFractionDigits: 4 }) + "%");
const faixa = (v: string) => {
  const [ini, fim] = String(v).replace(/[[\]()]/g, "").split(",");
  const f = (d: string) => (d ? d.split("-").reverse().join("/") : "em aberto");
  return `${f(ini)} — ${fim ? f(fim) : "em aberto"}`;
};

export default async function Regras() {
  const sb = await supabaseServer();
  const { data } = await sb
    .from("tax_rule_versions")
    .select("id, versao, status, cst, cclasstrib, incidencia, aliquota_source, aliquota_fixa, vigencia, artigo, observacoes, tax_rules ( code, tax_id ), legal_sources ( nome )")
    .order("versao");

  const regras = data ?? [];

  return (
    <>
      <div className="cabeca">
        <div>
          <div className="eyebrow">Administração tributária</div>
          <h1>Regras cadastradas</h1>
          <p>
            Nenhuma alíquota vive no código. Quando a alíquota de referência for fixada em norma, o que
            muda é uma linha desta tabela — sem deploy e sem alterar nenhuma análise já emitida.
          </p>
        </div>
      </div>

      <div className="aviso" style={{ marginBottom: 16 }}>
        <b>Carga de demonstração.</b> As tabelas oficiais de cClassTrib e CST ainda não foram ingeridas.
        Regras com status <span className="mono">em_analise</span> derrubam a confiança de qualquer análise que as utilize.
      </div>

      <div className="cartao">
        <table className="dados">
          <thead>
            <tr><th>Código</th><th>Tributo</th><th>Casa com</th><th>Efeito</th><th>Vigência</th><th>Fundamento</th><th>Versão</th><th>Status</th></tr>
          </thead>
          <tbody>
            {regras.map((r: any) => (
              <tr key={r.id}>
                <td className="mono">{r.tax_rules?.code}</td>
                <td className="mono">{r.tax_rules?.tax_id}</td>
                <td className="mono" style={{ fontSize: 11 }}>
                  CST {r.cst?.join("/") ?? "*"}<br />cClassTrib {r.cclasstrib?.join("/") ?? "*"}
                </td>
                <td style={{ fontSize: 12 }}>
                  {r.incidencia}<br />
                  <span className="mono">{r.aliquota_source === "indefinida" ? "alíquota não fixada" : pct(r.aliquota_fixa)}</span>
                </td>
                <td className="mono" style={{ fontSize: 11 }}>{faixa(r.vigencia)}</td>
                <td style={{ fontSize: 12 }}>{r.legal_sources?.nome}<br /><span style={{ color: "var(--ink-2)" }}>{r.artigo}</span></td>
                <td className="mono" style={{ fontSize: 11 }}>{r.versao}</td>
                <td><span className={"selo " + (r.status === "vigente" ? "ok" : "aten")} style={{ fontSize: 10, padding: "3px 7px" }}>{r.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
