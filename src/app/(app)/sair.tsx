"use client";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

export default function Sair() {
  const router = useRouter();
  return (
    <button
      className="item"
      onClick={async () => {
        await supabaseBrowser().auth.signOut();
        router.push("/login");
        router.refresh();
      }}
    >
      <span className="num">—</span> Sair
    </button>
  );
}
