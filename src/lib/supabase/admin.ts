import { createClient } from "@supabase/supabase-js";

/**
 * Cliente de serviço. IGNORA RLS — use apenas em rotinas de background
 * (worker do cron, ingestor de tabelas oficiais) e NUNCA numa rota que
 * responda diretamente a um usuário. A chave só existe no servidor.
 */
export const supabaseAdmin = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
