"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Excluir({ documentId }: { documentId: string }) {
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const router = useRouter();

  async function excluir() {
    setEnviando(true);
    setErro(null);
    const r = await fetch(`/api/documents/${documentId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ motivo }),
    });
    setEnviando(false);
    if (!r.ok) {
      const j = await r.json().catch(() => null);
      setErro(j?.error?.message ?? "Não foi possível excluir.");
      return;
    }
    setAberto(false);
    setMotivo("");
    router.refresh();
  }

  if (!aberto)
    return (
      <button className="btn fant" onClick={() => setAberto(true)}
        style={{ borderColor: "var(--carimbo)", color: "var(--carimbo)" }}>
        Excluir
      </button>
    );

  return (
    <div style={{ minWidth: 260 }}>
      <input
        className="campo-inline"
        placeholder="Motivo da exclusão"
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
        style={{ width: "100%", padding: "7px 9px", border: "1px solid var(--fio-forte)", borderRadius: 2, fontFamily: "inherit", fontSize: 13, marginBottom: 6 }}
      />
      {erro && <div style={{ color: "var(--carimbo)", fontSize: 12, marginBottom: 6 }}>{erro}</div>}
      <div style={{ display: "flex", gap: 6 }}>
        <button className="btn" onClick={excluir} disabled={enviando || motivo.trim().length < 5}
          style={{ background: "var(--carimbo)" }}>
          {enviando ? "Excluindo…" : "Confirmar"}
        </button>
        <button className="btn fant" onClick={() => { setAberto(false); setErro(null); }}>Cancelar</button>
      </div>
    </div>
  );
}
