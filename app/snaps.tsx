import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator, Alert, AppState, Image, Modal, Pressable,
  ScrollView, StyleSheet, Text, View,
} from "react-native";
import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { File } from "expo-file-system";
import { useAuth } from "@/auth/AuthProvider";
import { supabase } from "@/lib/supabase";
import { DeviceCryptoKey, ensureDeviceCryptoKey, getPartnerPublicKey, getPinnedPartnerPublicKey, partnerKeyFingerprint, pinPartnerPublicKey } from "@/lib/deviceCrypto";
import { decryptSnap, encryptSnap } from "@/lib/snapCrypto";
import {
  LocalSnap, bytesToBase64, getLocalSnaps, readLocalSnap, saveLocalSnap,
} from "@/lib/snapVault";

type PendingSnap = {
  id: string;
  space_id: string;
  sender_id: string;
  recipient_id: string;
  recipient_device_id: string;
  object_path: string;
  status: "uploading" | "pending" | "downloaded" | "permanent_copy_verified" | "received" | "expiring";
  ephemeral_public_key: string;
  wrap_salt: string;
  wrap_nonce: string;
  wrapped_file_key: string;
  content_nonce: string;
  mime_type: string;
  file_size_bytes: number;
  captured_at: string;
};

const MAX_CIPHERTEXT_BYTES = 20 * 1024 * 1024;
const MAX_PLAINTEXT_BYTES = MAX_CIPHERTEXT_BYTES - 16;

/** Stop an in-flight Snap action if sign-out, account switching, or MFA downgrade occurs. */
async function assertActiveSnapUser(expectedUserId: string): Promise<void> {
  if (!supabase) throw new Error("Connect Supabase before sharing private photos.");
  const { data: identity, error: identityError } = await supabase.auth.getUser();
  if (identityError) throw identityError;
  if (identity.user?.id !== expectedUserId) {
    throw new Error("Your account changed. Reopen Private Memories before continuing.");
  }
  const { data: assurance, error: assuranceError } =
    await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assuranceError) throw assuranceError;
  if (assurance.currentLevel !== "aal2") {
    throw new Error("Complete multi-factor authentication before sharing private photos.");
  }
}

function localDateKey(date: Date): string {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}


function captureTimestamp(exifValue: unknown): string {
  if (typeof exifValue === "string") {
    const match = exifValue.match(/^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
    if (match) {
      const [, year, month, day, hour, minute, second] = match;
      const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
      if (!Number.isNaN(date.getTime())) return date.toISOString();
    }
    const parsed = new Date(exifValue);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return new Date().toISOString();
}

function snapMonthCells(year: number, month: number): Array<number | null> {
  const firstDay = new Date(year, month, 1).getDay();
  const count = new Date(year, month + 1, 0).getDate();
  return [...Array(firstDay).fill(null), ...Array.from({ length: count }, (_, index) => index + 1)];
}

export default function SnapMemoriesScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [partnerId, setPartnerId] = useState<string | null>(null);
  const [partnerReady, setPartnerReady] = useState(false);
  const [partnerTrusted, setPartnerTrusted] = useState(false);
  const [partnerKeyChanged, setPartnerKeyChanged] = useState(false);
  const [partnerFingerprint, setPartnerFingerprint] = useState("");
  const [partnerDeviceId, setPartnerDeviceId] = useState<string | null>(null);
  const [partnerPublicKeyHex, setPartnerPublicKeyHex] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingSnap[]>([]);
  const [localSnaps, setLocalSnaps] = useState<LocalSnap[]>([]);
  const [deviceKey, setDeviceKey] = useState<DeviceCryptoKey | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [receivingId, setReceivingId] = useState<string | null>(null);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [calendarMonth, setCalendarMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [selectedMemoryDate, setSelectedMemoryDate] = useState(() => localDateKey(new Date()));

  const refreshGeneration = useRef(0);
  const refresh = useCallback(async () => {
    const generation = ++refreshGeneration.current;
    const expectedUserId = user?.id ?? null;
    const isCurrent = () =>
      refreshGeneration.current === generation && (user?.id ?? null) === expectedUserId;
    if (!user) {
      setLocalSnaps([]); setPending([]); setDeviceKey(null); setSpaceId(null);
      setPartnerId(null); setPartnerReady(false); setPartnerTrusted(false);
      setPartnerKeyChanged(false); setPartnerFingerprint(""); setPartnerDeviceId(null);
      setPartnerPublicKeyHex(null); setLoading(false);
      return;
    }
    setLoading(true);
    // Never leave the previous account's private metadata visible while this
    // account's data is loading.
    setLocalSnaps([]); setPending([]); setDeviceKey(null); setSpaceId(null);
    setPartnerId(null); setPartnerReady(false); setPartnerTrusted(false);
    setPartnerKeyChanged(false); setPartnerFingerprint(""); setPartnerDeviceId(null);
    setPartnerPublicKeyHex(null);
    try {
      const snaps = await getLocalSnaps(user.id);
      if (!isCurrent()) return;
      setLocalSnaps(snaps);

      if (!supabase) return;
      const key = await ensureDeviceCryptoKey(user.id);
      if (!isCurrent()) return;
      setDeviceKey(key);
      const { data: membership, error: memberError } = await supabase
        .from("space_members")
        .select("space_id")
        .eq("user_id", user.id)
        .limit(1)
        .maybeSingle();
      if (!isCurrent()) return;
      if (memberError) throw memberError;
      if (!membership?.space_id) return;
      setSpaceId(membership.space_id);

      const partner = await getPartnerPublicKey(membership.space_id, user.id);
      if (!isCurrent()) return;
      setPartnerId(partner?.userId ?? null);
      setPartnerDeviceId(partner?.deviceId ?? null);
      setPartnerPublicKeyHex(partner?.publicKeyHex ?? null);
      const hasPartnerKey = Boolean(partner?.deviceId && partner?.publicKeyHex);
      setPartnerReady(hasPartnerKey);
      if (partner?.publicKeyHex) {
        const pinned = await getPinnedPartnerPublicKey(user.id, membership.space_id);
        if (!isCurrent()) return;
        setPartnerTrusted(pinned === partner.publicKeyHex);
        setPartnerKeyChanged(Boolean(pinned && pinned !== partner.publicKeyHex));
        setPartnerFingerprint(partnerKeyFingerprint(key.secretKey, partner.publicKeyHex));
      } else {
        setPartnerTrusted(false); setPartnerKeyChanged(false); setPartnerFingerprint("");
      }

      const { data, error } = await supabase
        .from("snap_deliveries")
        .select("id,space_id,sender_id,recipient_id,object_path,status,ephemeral_public_key,wrap_salt,wrap_nonce,wrapped_file_key,content_nonce,mime_type,file_size_bytes,captured_at")
        .eq("recipient_id", user.id)
        .eq("recipient_device_id", key.deviceId)
        .in("status", ["pending", "downloaded"])
        .order("created_at", { ascending: true });
      if (!isCurrent()) return;
      if (error) throw error;
      setPending((data ?? []) as PendingSnap[]);
    } catch (error) {
      if (isCurrent()) Alert.alert("Couldn't refresh memories", error instanceof Error ? error.message : "Please try again.");
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void refresh();
    return () => { refreshGeneration.current += 1; };
  }, [refresh]);
  useEffect(() => {
    const sub = AppState.addEventListener("change", state => {
      if (state === "active") void refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  const pendingCount = pending.length;
  const sentCount = useMemo(() => localSnaps.filter(item => item.direction === "sent").length, [localSnaps]);
  const calendarCells = useMemo(() => snapMonthCells(calendarMonth.getFullYear(), calendarMonth.getMonth()), [calendarMonth]);
  const memoryDates = useMemo(() => new Set(localSnaps.map(item => localDateKey(new Date(item.capturedAt)))), [localSnaps]);
  const selectedMemories = localSnaps.filter(item => localDateKey(new Date(item.capturedAt)) === selectedMemoryDate);

  function verifyPartnerKey() {
    if (!user || !spaceId || !partnerPublicKeyHex || partnerKeyChanged) return;
    Alert.alert(
      "Compare partner fingerprint",
      partnerFingerprint + "\n\nCompare this exact code with your partner through a separate trusted channel (for example, a voice call). Only confirm if both phones show the same code.",
      [
        { text: "Not yet", style: "cancel" },
        { text: "We compared — trust this key", onPress: () => {
          void pinPartnerPublicKey(user.id, spaceId, partnerPublicKeyHex)
            .then(() => setPartnerTrusted(true))
            .catch(error => Alert.alert("Key not pinned", error instanceof Error ? error.message : "Please try again."));
        } },
      ],
    );
  }

  async function choosePhoto(source: "camera" | "library") {
    if (!user || !supabase || !spaceId) {
      Alert.alert("Connect your shared space", "Create or join the two-person shared space first.");
      return;
    }
    if (!partnerReady || !partnerId || !partnerDeviceId || !partnerPublicKeyHex) {
      Alert.alert("Ask your partner to open ONE-OS", "Their device needs to register its private photo-receiving key once. They can open this screen while signed in.");
      return;
    }
    setBusy(true);
    try {
      await assertActiveSnapUser(user.id);
      let result: ImagePicker.ImagePickerResult;
      if (source === "camera") {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) throw new Error("Camera permission is needed to capture a snap.");
        result = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.82, allowsEditing: false, exif: true });
      } else {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) throw new Error("Photo access permission is needed to choose a snap.");
        result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.82, allowsEditing: false, exif: true });
      }
      if (result.canceled || !result.assets?.[0]) return;
      await assertActiveSnapUser(user.id);
      const asset = result.assets[0];
      const bytes = await new File(asset.uri).bytes();
      if (bytes.length < 1 || bytes.length > MAX_PLAINTEXT_BYTES) {
        throw new Error("Choose an image smaller than 20 MB. ONE-OS encrypts it before upload.");
      }
      const mimeType = asset.mimeType && ["image/jpeg", "image/png", "image/webp", "image/heic"].includes(asset.mimeType)
        ? asset.mimeType : "image/jpeg";
      const capturedAt = captureTimestamp(asset.exif?.DateTimeOriginal);

      const envelope = encryptSnap(bytes, partnerPublicKeyHex);
      await assertActiveSnapUser(user.id);
      const { data, error } = await supabase.rpc("create_snap_delivery", {
        p_space_id: spaceId,
        p_recipient_id: partnerId,
        p_recipient_device_id: partnerDeviceId,
        p_ephemeral_public_key: envelope.ephemeralPublicKey,
        p_wrap_salt: envelope.wrapSalt,
        p_wrap_nonce: envelope.wrapNonce,
        p_wrapped_file_key: envelope.wrappedFileKey,
        p_content_nonce: envelope.contentNonce,
        p_mime_type: mimeType,
        p_file_size_bytes: envelope.ciphertext.length,
        p_captured_at: capturedAt,
      });
      if (error) throw error;
      const created = Array.isArray(data) ? data[0] : data;
      if (!created?.delivery_id || !created?.object_path) throw new Error("The server did not create the encrypted delivery.");

      await assertActiveSnapUser(user.id);
      const { error: uploadError } = await supabase.storage
        .from("oneos-private-snaps")
        .upload(created.object_path, envelope.ciphertext.buffer as ArrayBuffer, {
          contentType: "application/octet-stream",
          upsert: false,
        });
      if (uploadError) throw uploadError;

      // Keep a private encrypted copy on the sender's device before finalizing delivery.
      const senderCopy = await saveLocalSnap(user.id, created.delivery_id, mimeType, capturedAt, "sent", bytes, created.delivery_id);
      await assertActiveSnapUser(user.id);
      setLocalSnaps(old => [senderCopy, ...old.filter(snap => snap.id !== senderCopy.id)]);

      await assertActiveSnapUser(user.id);
      const { error: finalizeError } = await supabase.rpc("finalize_snap_upload", {
        p_delivery_id: created.delivery_id,
      });
      if (finalizeError) throw finalizeError;

      Alert.alert("Encrypted snap sent", "Your photo is saved privately on this phone. Your partner can receive it when they open ONE-OS.");
    } catch (error) {
      Alert.alert("Couldn't send this snap", error instanceof Error ? error.message : "Please try again.");
    } finally { setBusy(false); }
  }

  async function receiveSnap(item: PendingSnap) {
    if (!user || !supabase || !deviceKey) return;
    setReceivingId(item.id);
    try {
      await assertActiveSnapUser(user.id);
      // Re-read the durable vault on every attempt. React state may be stale after an
      // earlier download succeeded but the cloud acknowledgement failed.
      const savedSnaps = await getLocalSnaps(user.id);
      await assertActiveSnapUser(user.id);
      let existing = savedSnaps.find(local => local.deliveryId === item.id || local.id === item.id);
      if (existing) {
        await readLocalSnap(user.id, existing);
        await assertActiveSnapUser(user.id);
        setLocalSnaps(old => [existing!, ...old.filter(snap => snap.id !== existing!.id)]);
      } else {
        if (!item.object_path || !item.ephemeral_public_key || !item.wrap_salt || !item.wrap_nonce || !item.wrapped_file_key || !item.content_nonce) {
          throw new Error("This delivery is missing its encryption envelope.");
        }
        await assertActiveSnapUser(user.id);
        const { data: blob, error: downloadError } = await supabase.storage
          .from("oneos-private-snaps")
          .download(item.object_path);
        if (downloadError || !blob) throw downloadError ?? new Error("The encrypted photo is unavailable.");
        await assertActiveSnapUser(user.id);
        const ciphertext = new Uint8Array(await blob.arrayBuffer());
        await assertActiveSnapUser(user.id);
        const plaintext = decryptSnap(ciphertext, {
          ephemeralPublicKey: item.ephemeral_public_key,
          wrapSalt: item.wrap_salt,
          wrapNonce: item.wrap_nonce,
          wrappedFileKey: item.wrapped_file_key,
          contentNonce: item.content_nonce,
        }, deviceKey.secretKey);

        // The cloud copy is acknowledged only after successful local encryption and index write.
        existing = await saveLocalSnap(
          user.id, item.id, item.mime_type, item.captured_at, "received", plaintext, item.id,
        );
        plaintext.fill(0);
        await assertActiveSnapUser(user.id);
        // Show the durable local copy immediately; acknowledgement is a separate cloud step.
        setLocalSnaps(old => [existing!, ...old.filter(snap => snap.id !== existing!.id)]);
      }

      await assertActiveSnapUser(user.id);
      const { error: ackError } = await supabase.functions.invoke("ack-snap", {
        body: { deliveryId: item.id },
      });
      if (ackError) {
        // Keep the inbox item visible until the server confirms its download state.
        // A missing row is not treated as proof that a permanent copy was verified.
        throw ackError;
      }
      await assertActiveSnapUser(user.id);
      setPending(old => old.filter(snap => snap.id !== item.id));
      setLocalSnaps(old => [existing!, ...old.filter(snap => snap.id !== existing!.id)]);
      Alert.alert("Memory received", "The photo is saved encrypted on this phone. The temporary encrypted server copy is being retained until ONE-OS can verify a separate permanent copy.");
    } catch (error) {
      Alert.alert("Couldn't receive this snap", error instanceof Error ? error.message : "Please retry when connected.");
    } finally { setReceivingId(null); }
  }

  async function openLocal(record: LocalSnap) {
    if (!user) return;
    try {
      const bytes = await readLocalSnap(user.id, record);
      setPreviewUri("data:" + record.mimeType + ";base64," + bytesToBase64(bytes));
      bytes.fill(0);
    } catch (error) {
      Alert.alert("Couldn't open memory", error instanceof Error ? error.message : "The local file is unavailable.");
    }
  }

  return <ScrollView style={s.page} contentContainerStyle={s.body}>
    <Pressable onPress={() => router.back()}><Text style={s.back}>←  Back</Text></Pressable>
    <Text style={s.eyebrow}>PRIVATE · END-TO-END ENCRYPTED</Text>
    <Text style={s.heading}>Little moments.</Text>
    <Text style={s.sub}>A snap is encrypted on your phone, delivered privately, then kept in each person's own encrypted memory vault.</Text>

    <View style={s.stats}>
      <View style={s.stat}><Text style={s.statValue}>{pendingCount}</Text><Text style={s.statLabel}>WAITING FOR YOU</Text></View>
      <View style={s.stat}><Text style={s.statValue}>{localSnaps.length}</Text><Text style={s.statLabel}>ON THIS PHONE</Text></View>
      <View style={s.stat}><Text style={s.statValue}>{sentCount}</Text><Text style={s.statLabel}>SAVED BY YOU</Text></View>
    </View>

    {!spaceId ? <View style={s.card}>
      <Text style={s.cardTitle}>Connect your shared space first</Text>
      <Text style={s.muted}>Private snaps are sent only to the other person in your two-member ONE-OS shared space.</Text>
      <Pressable style={s.primary} onPress={() => router.push("/shared")}><Text style={s.primaryText}>Open shared space</Text></Pressable>
    </View> : <>
      <View style={s.card}>
        <Text style={s.cardTitle}>Capture or share a photo</Text>
        <Text style={s.muted}>{partnerReady ? (partnerTrusted ? "Your partner's key is verified on this phone." : partnerKeyChanged ? "SECURITY WARNING: your partner's registered key changed. Sending is blocked." : "Your partner's receiving key is available, but it must be verified once.") : "Your partner needs to open ONE-OS once to register their device key."}</Text>
        {partnerReady && !partnerTrusted ? <View style={s.fingerprintPanel}>
          <Text style={s.fingerprintLabel}>PARTNER KEY FINGERPRINT</Text>
          <Text selectable style={s.fingerprint}>{partnerFingerprint}</Text>
          {!partnerKeyChanged ? <Pressable style={s.secondary} onPress={verifyPartnerKey}><Text style={s.secondaryText}>Compare & verify key</Text></Pressable> : <Text style={s.securityWarning}>Do not approve this change. A verified key-recovery flow is not available yet.</Text>}
        </View> : null}
        <View style={s.actionRow}>
          <Pressable disabled={busy || !partnerReady || !partnerTrusted} style={[s.primary, s.action, (busy || !partnerReady || !partnerTrusted) && s.disabled]} onPress={() => void choosePhoto("camera")}>
            {busy ? <ActivityIndicator color="#101216" /> : <Text style={s.primaryText}>Take a snap</Text>}
          </Pressable>
          <Pressable disabled={busy || !partnerReady || !partnerTrusted} style={[s.secondary, s.action, (busy || !partnerReady || !partnerTrusted) && s.disabled]} onPress={() => void choosePhoto("library")}>
            <Text style={s.secondaryText}>Choose photo</Text>
          </Pressable>
        </View>
        <Text style={s.footnote}>Images are limited to 20 MB. Only encrypted bytes and a wrapped one-time key are uploaded.</Text>
      </View>

      <View style={s.card}>
        <View style={s.sectionRow}>
          <Text style={s.cardTitle}>Waiting in your inbox</Text>
          <Pressable onPress={() => void refresh()}><Text style={s.refresh}>Refresh ↻</Text></Pressable>
        </View>
        {loading ? <ActivityIndicator color="#b7adff" /> : pending.length ? pending.map(item => (
          <View key={item.id} style={s.inboxItem}>
            <View style={{flex:1}}>
              <Text style={s.inboxTitle}>A new private memory</Text>
              <Text style={s.muted}>{new Date(item.captured_at).toLocaleString()}</Text>
            </View>
            <Pressable disabled={receivingId === item.id} style={s.receive} onPress={() => void receiveSnap(item)}>
              {receivingId === item.id ? <ActivityIndicator color="#101216" /> : <Text style={s.receiveText}>Receive</Text>}
            </Pressable>
          </View>
        )) : <Text style={s.muted}>Nothing waiting right now. When your partner sends a snap, it will appear here.</Text>}
      </View>
    </>}

    <View style={s.card}>
      <Text style={s.cardTitle}>Our private photo calendar</Text>
      <Text style={s.muted}>Each dot marks a day with a photo saved on this phone. Choose a date to revisit a moment.</Text>
      <View style={s.monthHeader}>
        <Pressable onPress={() => setCalendarMonth(old => new Date(old.getFullYear(), old.getMonth() - 1, 1))}><Text style={s.monthArrow}>‹</Text></Pressable>
        <Text style={s.monthTitle}>{calendarMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</Text>
        <Pressable onPress={() => setCalendarMonth(old => new Date(old.getFullYear(), old.getMonth() + 1, 1))}><Text style={s.monthArrow}>›</Text></Pressable>
      </View>
      <View style={s.calendarGrid}>
        {["S","M","T","W","T","F","S"].map((day, index) => <Text key={day + index} style={s.weekday}>{day}</Text>)}
        {calendarCells.map((day, index) => {
          if (!day) return <View key={"empty-" + index} style={s.calendarDay} />;
          const key = localDateKey(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), day));
          const active = key === selectedMemoryDate;
          const hasMemory = memoryDates.has(key);
          return <Pressable key={key} onPress={() => setSelectedMemoryDate(key)} style={[s.calendarDay, active && s.calendarDaySelected]}>
            <Text style={[s.calendarDayText, active && s.calendarDayTextSelected]}>{day}</Text>
            {hasMemory ? <View style={[s.memoryDot, active && s.memoryDotSelected]} /> : null}
          </Pressable>;
        })}
      </View>
      <Text style={s.selectedDate}>{new Date(selectedMemoryDate + "T12:00:00").toLocaleDateString(undefined, { weekday:"long", day:"numeric", month:"long" })}</Text>
      {selectedMemories.length ? <View style={s.memoryList}>
        {selectedMemories.map(item => (
          <Pressable key={item.id} style={s.memory} onPress={() => void openLocal(item)}>
            <View style={s.memoryIcon}><Text style={s.memoryIconText}>✦</Text></View>
            <View style={{flex:1}}>
              <Text style={s.inboxTitle}>{item.direction === "sent" ? "You shared a moment" : "A moment from your partner"}</Text>
              <Text style={s.muted}>{new Date(item.capturedAt).toLocaleTimeString(undefined, { hour:"2-digit", minute:"2-digit" })}</Text>
            </View>
            <Text style={s.openArrow}>Open →</Text>
          </Pressable>
        ))}
      </View> : <Text style={s.muted}>No photos saved for this date.</Text>}
    </View>

    <View style={s.noteCard}>
      <Text style={s.noteTitle}>A small privacy promise</Text>
      <Text style={s.muted}>Pending encrypted cloud photos expire after 72 hours without a server heartbeat. Once a recipient downloads a photo, ONE-OS keeps the temporary encrypted server copy until a separate permanent copy can be verified. Local encrypted copies remain on each device independently. Opening the app offline does not reset the server timer.</Text>
    </View>
    <Text style={s.footer}>ONE-OS · private moments, kept close</Text>

    <Modal visible={Boolean(previewUri)} transparent animationType="fade" onRequestClose={() => setPreviewUri(null)}>
      <View style={s.modal}>
        <Pressable style={s.modalClose} onPress={() => setPreviewUri(null)}><Text style={s.modalCloseText}>Close ✕</Text></Pressable>
        {previewUri ? <Image source={{uri:previewUri}} resizeMode="contain" style={s.preview} /> : null}
      </View>
    </Modal>
  </ScrollView>;
}

const s = StyleSheet.create({
  page:{flex:1,backgroundColor:"#101216"},body:{padding:22,paddingTop:56,paddingBottom:50},back:{color:"#c7bfff",fontSize:14,marginBottom:30},
  eyebrow:{color:"#9b8cff",fontSize:10,letterSpacing:2,fontWeight:"700"},heading:{color:"#f4f2ff",fontSize:38,fontWeight:"700",marginTop:13},
  sub:{color:"#9699a5",fontSize:13,lineHeight:21,marginTop:9,marginBottom:20},
  stats:{flexDirection:"row",gap:8,marginBottom:14},stat:{flex:1,backgroundColor:"#1a1d24",borderRadius:14,padding:12,borderWidth:1,borderColor:"#2a2e38"},
  statValue:{color:"#f4f2ff",fontSize:23,fontWeight:"800"},statLabel:{color:"#858b98",fontSize:8,letterSpacing:0.7,marginTop:5},
  card:{backgroundColor:"#1a1d24",borderColor:"#2a2e38",borderWidth:1,borderRadius:18,padding:17,marginTop:13},
  cardTitle:{color:"#f4f2ff",fontSize:17,fontWeight:"700",marginBottom:8},muted:{color:"#9699a5",fontSize:12,lineHeight:19},
  actionRow:{flexDirection:"row",gap:10,marginTop:8},action:{flex:1},primary:{backgroundColor:"#b7adff",padding:14,borderRadius:12,alignItems:"center",marginTop:13},primaryText:{color:"#101216",fontWeight:"800",fontSize:13},
  secondary:{backgroundColor:"#29243a",padding:14,borderRadius:12,alignItems:"center",marginTop:13},secondaryText:{color:"#d8d1ff",fontWeight:"800",fontSize:13},
  disabled:{opacity:0.45},fingerprintPanel:{backgroundColor:"#101216",borderRadius:12,padding:13,marginTop:13},fingerprintLabel:{color:"#9699a5",fontSize:9,letterSpacing:1,fontWeight:"800"},fingerprint:{color:"#c7bfff",fontSize:15,fontWeight:"800",letterSpacing:1.2,marginTop:9,lineHeight:24},securityWarning:{color:"#ffb8b8",fontSize:11,lineHeight:17,marginTop:10},footnote:{color:"#727987",fontSize:10,lineHeight:16,marginTop:12},
  sectionRow:{flexDirection:"row",alignItems:"center",justifyContent:"space-between"},refresh:{color:"#c7bfff",fontSize:12,fontWeight:"700"},
  inboxItem:{borderTopWidth:1,borderTopColor:"#2a2e38",paddingTop:13,marginTop:10,flexDirection:"row",alignItems:"center",gap:12},
  inboxTitle:{color:"#f4f2ff",fontSize:13,fontWeight:"700"},receive:{backgroundColor:"#b7adff",paddingHorizontal:16,paddingVertical:10,borderRadius:10,minWidth:80,alignItems:"center"},receiveText:{color:"#101216",fontWeight:"800",fontSize:12},
  monthHeader:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",marginTop:10,marginBottom:12},monthTitle:{color:"#f4f2ff",fontSize:15,fontWeight:"700"},monthArrow:{color:"#c7bfff",fontSize:27,paddingHorizontal:12},
  calendarGrid:{flexDirection:"row",flexWrap:"wrap"},weekday:{width:"14.2857%",textAlign:"center",color:"#777d8c",fontSize:10,paddingVertical:7},
  calendarDay:{width:"14.2857%",height:39,alignItems:"center",justifyContent:"center",borderRadius:10},calendarDaySelected:{backgroundColor:"#b7adff"},
  calendarDayText:{color:"#d8d9e0",fontSize:12},calendarDayTextSelected:{color:"#101216",fontWeight:"800"},
  memoryDot:{width:4,height:4,borderRadius:3,backgroundColor:"#b7adff",position:"absolute",bottom:4},memoryDotSelected:{backgroundColor:"#101216"},
  selectedDate:{color:"#c7bfff",fontSize:12,fontWeight:"700",marginTop:12,marginBottom:5},
  memoryList:{marginTop:6},memory:{flexDirection:"row",alignItems:"center",gap:11,borderTopWidth:1,borderTopColor:"#2a2e38",paddingVertical:12},
  memoryIcon:{width:36,height:36,borderRadius:11,backgroundColor:"#29243a",alignItems:"center",justifyContent:"center"},memoryIconText:{color:"#c7bfff",fontSize:18},
  openArrow:{color:"#c7bfff",fontSize:11,fontWeight:"700"},noteCard:{backgroundColor:"#181a23",borderRadius:16,padding:16,marginTop:13,borderWidth:1,borderColor:"#3b3658"},
  noteTitle:{color:"#c7bfff",fontSize:13,fontWeight:"800",marginBottom:7},footer:{color:"#666c79",fontSize:10,textAlign:"center",marginTop:24},
  modal:{flex:1,backgroundColor:"#08090df2",justifyContent:"center",alignItems:"center",padding:18},modalClose:{position:"absolute",top:55,right:22,zIndex:2,padding:12},modalCloseText:{color:"#f4f2ff",fontWeight:"700"},preview:{width:"100%",height:"78%"},
});
