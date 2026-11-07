// @ts-nocheck
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: cors });

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authHeader = request.headers.get("Authorization");
  if (!url || !anonKey || !serviceKey || !authHeader?.startsWith("Bearer ")) {
    return Response.json({ error: "Missing authenticated request configuration" }, { status: 401, headers: cors });
  }

  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData.user) return Response.json({ error: "Authentication required" }, { status: 401, headers: cors });

  let body: { deliveryId?: string };
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400, headers: cors }); }
  if (!body.deliveryId || !/^[0-9a-f-]{36}$/i.test(body.deliveryId)) {
    return Response.json({ error: "A valid deliveryId is required" }, { status: 400, headers: cors });
  }

  const { data: delivery, error: readError } = await userClient
    .from("snap_deliveries")
    .select("id,status,object_path")
    .eq("id", body.deliveryId)
    .eq("recipient_id", authData.user.id)
    .maybeSingle();

  if (readError || !delivery) return Response.json({ error: "Snap not found" }, { status: 404, headers: cors });
  if (delivery.status === "received") return Response.json({ received: true, alreadyAcknowledged: true }, { headers: cors });
  if (delivery.status !== "pending" || !delivery.object_path) {
    return Response.json({ error: "Snap is not ready to acknowledge" }, { status: 409, headers: cors });
  }

  const { error: removeError } = await admin.storage
    .from("oneos-private-snaps")
    .remove([delivery.object_path]);

  // Storage removal is performed before clearing the key envelope. If removal fails,
  // the recipient can retry and the server does not falsely claim the cloud copy is gone.
  const isMissingObject = removeError && String(removeError.statusCode) === "404";
  if (removeError && !isMissingObject) {
    return Response.json({ error: "Could not remove the cloud copy", detail: removeError.message }, { status: 502, headers: cors });
  }

  const { error: deleteError } = await admin.from("snap_deliveries")
    .delete()
    .eq("id", delivery.id)
    .eq("recipient_id", authData.user.id)
    .eq("status", "pending");

  if (deleteError) return Response.json({ error: "Cloud file removed but delivery metadata could not be cleared", detail: deleteError.message }, { status: 502, headers: cors });
  return Response.json({ received: true, metadataCleared: true }, { headers: cors });
});
