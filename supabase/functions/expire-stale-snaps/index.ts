// @ts-nocheck
import { createClient } from "npm:@supabase/supabase-js@2";

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const expected = Deno.env.get("ONEOS_CRON_SECRET") ?? "";
  const supplied = request.headers.get("x-oneos-cron-secret") ?? "";
  if (expected.length < 32 || !constantTimeEqual(expected, supplied)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return Response.json({ error: "Server configuration missing" }, { status: 500 });

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const cutoff = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
  const abandonedUploadCutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data: inactive, error: presenceError } = await admin
    .from("member_presence")
    .select("space_id,user_id")
    .lt("last_seen_at", cutoff);

  if (presenceError) return Response.json({ error: presenceError.message }, { status: 500 });

  let deletedDeliveries = 0;
  let deletedObjects = 0;
  const failures: string[] = [];
  const processed = new Set<string>();

  async function purge(delivery: { id: string; object_path: string | null }, reason: string) {
    if (processed.has(delivery.id)) return;
    processed.add(delivery.id);

    if (delivery.object_path) {
      const { error: removeError } = await admin.storage
        .from("oneos-private-snaps")
        .remove([delivery.object_path]);
      const isMissingObject = removeError && String(removeError.statusCode) === "404";
      if (removeError && !isMissingObject) {
        failures.push(`Storage cleanup failed for ${delivery.id} (${reason}): ${removeError.message}`);
        return;
      }
      if (!removeError) deletedObjects++;
    }

    const { error: deleteError } = await admin
      .from("snap_deliveries")
      .delete()
      .eq("id", delivery.id);
    if (deleteError) failures.push(`Metadata cleanup failed for ${delivery.id} (${reason}): ${deleteError.message}`);
    else deletedDeliveries++;
  }

  // A recipient who has been offline for 72 hours loses only their pending deliveries.
  for (const member of inactive ?? []) {
    const { data: deliveries, error: deliveryError } = await admin
      .from("snap_deliveries")
      .select("id,object_path")
      .eq("space_id", member.space_id)
      .eq("recipient_id", member.user_id)
      .eq("status", "pending");

    if (deliveryError) {
      failures.push(deliveryError.message);
      continue;
    }
    for (const delivery of deliveries ?? []) await purge(delivery, "recipient inactive for 72 hours");
  }

  // An unfinished upload is an orphan candidate after one hour, regardless of recipient presence.
  const { data: abandonedUploads, error: uploadError } = await admin
    .from("snap_deliveries")
    .select("id,object_path")
    .eq("status", "uploading")
    .lt("created_at", abandonedUploadCutoff);

  if (uploadError) failures.push(uploadError.message);
  else {
    for (const delivery of abandonedUploads ?? []) await purge(delivery, "upload unfinished for one hour");
  }

  return Response.json({
    inactiveCutoff: cutoff,
    abandonedUploadCutoff,
    inactiveMembersChecked: inactive?.length ?? 0,
    deletedObjects,
    deletedDeliveries,
    failures,
  }, { status: failures.length ? 207 : 200 });
});
