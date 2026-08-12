"use client";
import { useRef, useState } from "react";
import Link from "next/link";

type Empresa = { id: string; nome: string; papel: string };
type Resultado = {
  arquivo: string;
  analysisId?: string;
  resultado?: string;
  confianca?: string;
  erro?: { code: string; message: string };
};

const SELO: Record<string, string> = {
  APROVADO: "ok",
  APROVADO_COM_RESSALVAS: "aten",
  NECESSITA_REVISAO: "aten",
  DIVERGENCIA: "erro",
};

export default function Upload({ empresas }: { empresas: Empresa[] }) {
  const [empresa, setEmpresa] = useState(empresas[0].id);
  const [drag, setDrag] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [resultados, setResultados] = useState<Resultado[]>([]);
  const input = useRef<HTMLInputElement>(null);

  async function enviar(files: FileList | null) {
    if (!files || files.length === 0) return;
    setEnviando(true);
    const form = new FormData();
    form.append("companyId", empresa);
    Array.from(files).forEach((f) => form.append("files", f));

    try {
      const r = await fetch("/api/documents/upload", { method: "POST", body: form });
      const json = await r.json();
      setResultados(json.resultados ?? [{ arquivo: "—", erro: json.error ?? { code: "ERRO", message: "Falha no envio." } }]);
    } catch {
      setResultados([{ arquivo: "—", erro: { code: "NETWORK", message: "Não foi possível falar com o servidor." } }]);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <>
      {empresas.length > 1 && (
        <label className="campo" style={{ maxWidth: 340 }}>
          <span>Empresa</span>
          <select
            value={empresa}
            onChange={(e) => setEmpresa(e.target.value)}
            style={{ width: "100%", padding: "9px 11px", border: "1px solid var(--fio-forte)", borderRadius: 2, fontFamily: "inherit", fontSize: 14 }}
          >
            {empresas.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
          </select>
        </label>
      )}

      <div
        className={"zona" + (drag ? " drag" : "")}
        onClick={() => input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); enviar(e.dataTransfer.files); }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && input.current?.click()}
      >
        <b>{enviando ? "Processando…" : "Arraste os XML aqui"}</b>
        <span>ou clique para escolher. NF-e modelo 55, até 10 arquivos por envio, 5 MB cada.</span>
        <input ref={input} type="file" accept=".xml" multiple hidden onChange={(e) => enviar(e.target.files)} />
      </div>

      {resultados.length > 0 && (
        <div className="cartao" style={{ marginTop: 22 }}>
          <table className="dados">
            <thead>
              <tr><th>Arquivo</th><th>Confiança</th><th>Resultado</th><th></th></tr>
            </thead>
            <tbody>
              {resultados.map((r, i) => (
                <tr key={i}>
                  <td className="mono">{r.arquivo}</td>
                  <td>{r.confianca ? <span className="pill">{r.confianca.toUpperCase()}</span> : "—"}</td>
                  <td>
                    {r.erro
                      ? <span className="selo erro">{r.erro.code}</span>
                      : <span className={"selo " + (SELO[r.resultado!] ?? "neutro")}>{r.resultado?.replace(/_/g, " ")}</span>}
                  </td>
                  <td>
                    {r.analysisId
                      ? <Link className="btn fant" href={`/analises/${r.analysisId}`}>Abrir laudo</Link>
                      : <span style={{ fontSize: 12.5, color: "var(--ink-2)" }}>{r.erro?.message}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
