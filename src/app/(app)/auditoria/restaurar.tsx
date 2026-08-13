"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Restaurar({ documentId }: { documentId: string }) {
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const router = useRouter();

  async function restaurar() {
    setEnviando(true);
    setErro(null);
    const r = await fetch(`/api/documents/${documentId}`, { method: "PATCH" });
    setEnviando(false);
    if (!r.ok) {
      const j = await r.json().catch(() => null);
      setErro(j?.error?.message ?? "Não foi possível restaurar.");
      return;
    }
    router.refresh();
  }

  return (
    <div>
      <button className="btn fant" onClick={restaurar} disabled={enviando}>
        {enviando ? "Restaurando…" : "Restaurar"}
      </button>
      {erro && <div style={{ color: "var(--carimbo)", fontSize: 12, marginTop: 4 }}>{erro}</div>}
    </div>
  );
}
