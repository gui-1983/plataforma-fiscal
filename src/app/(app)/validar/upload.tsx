"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { lerChavePorOcr } from "@/lib/nfe/ocr";

type Empresa = { id: string; nome: string; papel: string };

type Resultado = {
  arquivo: string;
  documentId?: string;
  analysisId?: string;
  resultado?: string;
  confianca?: string;
  aviso?: string;
  erro?: { code: string; message: string };
  /** Arquivo guardado para reprocessar por OCR sem novo upload manual. */
  file?: File;
  ocr?: { rodando: boolean; mensagem: string; pct: number };
};

const SELO: Record<string, string> = {
  APROVADO: "ok",
  APROVADO_COM_RESSALVAS: "aten",
  NECESSITA_REVISAO: "aten",
  DIVERGENCIA: "erro",
  AGUARDANDO_XML: "neutro",
  PDF_ANEXADO: "neutro",
};

const PRECISA_OCR = ["PDF_ESCANEADO", "CHAVE_NAO_ENCONTRADA", "FILE_REJECTED"];

export default function Upload({ empresas }: { empresas: Empresa[] }) {
  const [empresa, setEmpresa] = useState(empresas[0].id);
  const [drag, setDrag] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [resultados, setResultados] = useState<Resultado[]>([]);
  const input = useRef<HTMLInputElement>(null);

  const atualizar = (i: number, patch: Partial<Resultado>) =>
    setResultados((r) => r.map((x, k) => (k === i ? { ...x, ...patch } : x)));

  async function enviar(files: FileList | null) {
    if (!files || files.length === 0) return;
    const lista = Array.from(files);
    setEnviando(true);

    // Imagens não passam pelo servidor: vão direto para o OCR local.
    const imagens = lista.filter((f) => /\.(jpe?g|png)$/i.test(f.name));
    const paraServidor = lista.filter((f) => !/\.(jpe?g|png)$/i.test(f.name));

    const saida: Resultado[] = imagens.map((f) => ({
      arquivo: f.name,
      file: f,
      erro: { code: "PDF_ESCANEADO", message: "Imagem: use o OCR para ler a chave de acesso." },
    }));

    if (paraServidor.length) {
      const form = new FormData();
      form.append("companyId", empresa);
      paraServidor.forEach((f) => form.append("files", f));
      try {
        const r = await fetch("/api/documents/upload", { method: "POST", body: form });
        const json = await r.json();
        const doServidor: Resultado[] = json.resultados ?? [
          { arquivo: "—", erro: json.error ?? { code: "ERRO", message: "Falha no envio." } },
        ];
        saida.push(...doServidor.map((s) => ({ ...s, file: lista.find((f) => f.name === s.arquivo) })));
      } catch {
        saida.push({ arquivo: "—", erro: { code: "NETWORK", message: "Não foi possível falar com o servidor." } });
      }
    }

    setResultados(saida);
    setEnviando(false);
  }

  async function rodarOcr(i: number) {
    const alvo = resultados[i];
    if (!alvo?.file) return;

    atualizar(i, { ocr: { rodando: true, mensagem: "Iniciando…", pct: 0 } });

    try {
      const { chave, invalida } = await lerChavePorOcr(alvo.file, (mensagem, pct) =>
        atualizar(i, { ocr: { rodando: true, mensagem, pct: pct ?? 0 } }),
      );

      if (!chave) {
        atualizar(i, {
          ocr: undefined,
          erro: {
            code: "OCR_SEM_CHAVE",
            message: invalida
              ? "O OCR leu 44 dígitos, mas o verificador não fecha — provavelmente resolução baixa. Envie o XML."
              : "Não consegui localizar a chave de acesso na imagem. Envie o XML da nota.",
          },
        });
        return;
      }

      const form = new FormData();
      form.append("companyId", empresa);
      form.append("chave", chave);
      form.append("file", alvo.file);

      const r = await fetch("/api/documents/chave", { method: "POST", body: form });
      const json = await r.json();

      if (!r.ok) {
        atualizar(i, { ocr: undefined, erro: json.error ?? { code: "ERRO", message: "Falha ao registrar." } });
        return;
      }

      atualizar(i, {
        ocr: undefined,
        erro: undefined,
        documentId: json.documentId,
        resultado: json.resultado,
        confianca: "—",
        aviso: `Chave ${chave} lida por OCR e conferida pelo dígito verificador. Envie o XML desta nota para gerar o laudo.`,
      });
    } catch {
      atualizar(i, {
        ocr: undefined,
        erro: { code: "OCR_FALHOU", message: "O reconhecimento não pôde ser concluído neste navegador." },
      });
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
        <b>{enviando ? "Processando…" : "Arraste os arquivos aqui"}</b>
        <span>
          XML da NF-e gera o laudo completo. DANFE em PDF ou foto identifica a nota
          pela chave de acesso. Até 10 arquivos por envio.
        </span>
        <input
          ref={input}
          type="file"
          accept=".xml,.pdf,.jpg,.jpeg,.png"
          multiple
          hidden
          onChange={(e) => enviar(e.target.files)}
        />
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
                  <td>{r.confianca && r.confianca !== "—" ? <span className="pill">{r.confianca.toUpperCase()}</span> : "—"}</td>
                  <td>
                    {r.erro
                      ? <span className="selo erro">{r.erro.code}</span>
                      : <span className={"selo " + (SELO[r.resultado ?? ""] ?? "neutro")}>{r.resultado?.replace(/_/g, " ")}</span>}
                  </td>
                  <td style={{ minWidth: 300 }}>
                    {r.ocr?.rodando ? (
                      <div>
                        <div style={{ fontSize: 12.5, marginBottom: 4 }}>{r.ocr.mensagem}</div>
                        <div className="barra"><i style={{ width: `${r.ocr.pct}%` }} /></div>
                      </div>
                    ) : r.analysisId ? (
                      <Link className="btn fant" href={`/analises/${r.analysisId}`}>Abrir laudo</Link>
                    ) : (
                      <div>
                        <div style={{ fontSize: 12.5, color: r.erro ? "var(--carimbo)" : "var(--ink-2)" }}>
                          {r.erro?.message ?? r.aviso}
                        </div>
                        {r.erro && PRECISA_OCR.includes(r.erro.code) && r.file && (
                          <button className="btn" style={{ marginTop: 8 }} onClick={() => rodarOcr(i)}>
                            Ler com OCR
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 14, maxWidth: "72ch" }}>
        O OCR roda no seu navegador: o arquivo não vai para nenhum serviço de reconhecimento.
        Ele procura apenas a chave de acesso, cujo dígito verificador permite descartar leitura errada.
        Valores e classificações continuam vindo exclusivamente do XML.
      </p>
    </>
  );
}
