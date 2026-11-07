import { supabase } from "@/lib/supabase";
import { getOrCreatePhotoIdentity } from "@/lib/photoCrypto";

/** Publish this device's public key for one shared space. The private key stays in SecureStore. */
export async function registerMyPhotoKey(userId: string, spaceId: string): Promise<void> {
  if (!supabase) throw new Error("Connect Supabase before setting up photo sharing.");
  const identity = await getOrCreatePhotoIdentity(userId, spaceId);
  const { error } = await supabase.rpc("register_space_encryption_key", {
    p_space_id: spaceId,
    p_public_key_hex: identity.publicKeyHex,
  });
  if (error) throw error;
}

/** Returns the other member's public key. A missing key means their device has not completed setup. */
export async function getPartnerPhotoKey(spaceId: string, userId: string): Promise<string> {
  if (!supabase) throw new Error("Connect Supabase before setting up photo sharing.");
  const { data, error } = await supabase
    .from("space_member_encryption_keys")
    .select("public_key_hex")
    .eq("space_id", spaceId)
    .neq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data?.public_key_hex) throw new Error("Your partner needs to open ONE-OS and finish photo-security setup first.");
  return data.public_key_hex;
}

/** Call only after decrypting and saving the image successfully into app-private local storage. */
export async function acknowledgeAndEraseCloudPhoto(deliveryId: string, objectPath: string): Promise<void> {
  if (!supabase) throw new Error("Connect Supabase before receiving photos.");
  const { error: ackError } = await supabase.rpc("acknowledge_photo_delivery", { p_delivery_id: deliveryId });
  if (ackError) throw ackError;
  const { error: removeError } = await supabase.storage.from("oneos-private-snaps").remove([objectPath]);
  if (removeError) throw removeError;
  const { error: finalizeError } = await supabase.rpc("finalize_photo_delivery", { p_delivery_id: deliveryId });
  if (finalizeError) throw finalizeError;
}
