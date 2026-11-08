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

  // Claim under a DB transaction that locks and rechecks live presence. This
  // replaces the old list-inactive-then-delete race.
  const { data: claims, error: claimError } = await admin.rpc("claim_expired_snap_deliveries", {
    p_cutoff: cutoff,
    p_batch_size: 100,
  });
  if (claimError) return Response.json({ error: "Could not claim expiry batch", detail: claimError.message }, { status: 500 });

  let deletedDeliveries = 0;
  let deletedObjects = 0;
  const failures: string[] = [];

  for (const item of claims ?? []) {
    let storageDeleted = false;
    if (item.object_path) {
      const { error } = await admin.storage.from("oneos-private-snaps").remove([item.object_path]);
      const missing = error && String(error.statusCode) === "404";
      if (error && !missing) {
        failures.push(`Storage cleanup failed for ${item.delivery_id}: ${error.message}`);
      } else {
        storageDeleted = true;
        if (!missing) deletedObjects++;
      }
    } else {
      storageDeleted = true;
    }

    const { error: finishError } = await admin.rpc("finish_snap_expiry", {
      p_delivery_id: item.delivery_id,
      p_storage_deleted: storageDeleted,
    });
    if (finishError) failures.push(`Expiry finalization failed for ${item.delivery_id}: ${finishError.message}`);
    else if (storageDeleted) deletedDeliveries++;
  }

  return Response.json({
    inactiveCutoff: cutoff,
    claimed: claims?.length ?? 0,
    deletedObjects,
    deletedDeliveries,
    failures,
    note: "Downloaded items are not expired. They remain until permanent-copy verification is implemented.",
  }, { status: failures.length ? 207 : 200 });
});
