import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

type CookieParaGravar = { name: string; value: string; options?: CookieOptions };

/** Cliente ligado à sessão do usuário. Respeita RLS. Use este por padrão. */
export async function supabaseServer() {
  const store = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (list: CookieParaGravar[]) => {
          try {
            list.forEach(({ name, value, options }) => store.set(name, value, options));
          } catch {
            // Server Component não pode gravar cookie. O middleware já renova a sessão.
          }
        },
      },
    },
  );
}
