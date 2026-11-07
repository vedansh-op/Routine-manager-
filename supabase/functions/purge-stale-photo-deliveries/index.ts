// Supabase Edge Function: purge pending photo ciphertext after 72h without recipient sync.
// Deploy with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY set as function secrets.
// Invoke from Supabase Cron every 15 minutes using a private function secret header.
import { createClient } from "npm:@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const cronSecret = Deno.env.get("ONEOS_PURGE_CRON_SECRET");

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (!cronSecret || req.headers.get("x-oneos-cron-secret") !== cronSecret) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!supabaseUrl || !serviceKey) {
    return new Response("Server configuration missing", { status: 500 });
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: stale, error } = await supabase
    .from("photo_deliveries")
    .select("id, object_path, recipient_id, space_id, status")
    .in("status", ["pending", "delivered"])
    .limit(500);

  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

  const cutoffMs = Date.now() - 72 * 60 * 60 * 1000;
  let expired = 0;
  const failures: string[] = [];
  for (const delivery of stale ?? []) {
    if (delivery.status === "pending") {
      const { data: presence, error: presenceError } = await supabase
        .from("space_member_presence")
        .select("last_seen_at")
        .eq("space_id", delivery.space_id)
        .eq("user_id", delivery.recipient_id)
        .maybeSingle();

      if (presenceError) { failures.push(delivery.id); continue; }
      const lastSeen = presence?.last_seen_at ? Date.parse(presence.last_seen_at) : 0;
      if (lastSeen > cutoffMs) continue;
    }

    const { error: removeError } = await supabase.storage
      .from("oneos-private-snaps")
      .remove([delivery.object_path]);
    if (removeError) { failures.push(delivery.id); continue; }

    const { error: deleteError } = await supabase
      .from("photo_deliveries")
      .delete()
      .eq("id", delivery.id)
      .eq("status", delivery.status);
    if (deleteError) { failures.push(delivery.id); continue; }
    expired++;
  }

  return Response.json({ scanned: stale?.length ?? 0, expired, failures });
});
