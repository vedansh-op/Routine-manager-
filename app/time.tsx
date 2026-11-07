import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import {
  DEFAULT_PARTNER_TIME_ZONE,
  formatInTimeZone,
  getDeviceTimeZone,
  getTimeZoneOffsetLabel,
} from "@/lib/time";

function ClockCard({ label, zone, now, note }: { label: string; zone: string; now: Date; note: string }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardLabel}>{label}</Text>
      <Text style={styles.clock}>{formatInTimeZone(now, zone, { hour: "2-digit", minute: "2-digit", hour12: true })}</Text>
      <Text style={styles.day}>{formatInTimeZone(now, zone, { weekday: "long", day: "numeric", month: "long" })}</Text>
      <Text style={styles.zone}>{zone} · {getTimeZoneOffsetLabel(now, zone)}</Text>
      <Text style={styles.note}>{note}</Text>
    </View>
  );
}

export default function OurTimeScreen() {
  const router = useRouter();
  const [now, setNow] = useState(() => new Date());
  const [myZone, setMyZone] = useState(() => getDeviceTimeZone());

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
      setMyZone(getDeviceTimeZone());
    }, 30_000);
    return () => clearInterval(timer);
  }, []);

  const partnerZone = DEFAULT_PARTNER_TIME_ZONE;
  const sameDay = formatInTimeZone(now, myZone, { year: "numeric", month: "2-digit", day: "2-digit" }) ===
    formatInTimeZone(now, partnerZone, { year: "numeric", month: "2-digit", day: "2-digit" });

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.body}>
      <Pressable onPress={() => router.back()}><Text style={styles.back}>←  Back</Text></Pressable>
      <Text style={styles.eyebrow}>ONE-OS · SHARED TIME</Text>
      <Text style={styles.title}>Our time.</Text>
      <Text style={styles.subtitle}>One moment, shown in both local time zones. Portugal's daylight-saving changes are handled automatically.</Text>
      <ClockCard label="YOUR LOCAL TIME" zone={myZone} now={now} note="Detected from this phone" />
      <ClockCard label="PARTNER · PORTUGAL" zone={partnerZone} now={now} note="Europe/Lisbon · mainland Portugal" />
      <View style={styles.info}>
        <Text style={styles.infoTitle}>{sameDay ? "You're on the same calendar day" : "You're on different calendar days"}</Text>
        <Text style={styles.infoText}>ONE-OS stores moments as UTC timestamps and converts them for each person. Activity dates and reminders must be interpreted in the timezone chosen for that activity, not by guessing an offset.</Text>
      </View>
      <Text style={styles.footer}>Both clocks refresh automatically while this screen is open.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#101216" },
  body: { padding: 24, paddingTop: 58, paddingBottom: 48 },
  back: { color: "#c7bfff", fontSize: 14, marginBottom: 34 },
  eyebrow: { color: "#9b8cff", fontSize: 10, letterSpacing: 2, fontWeight: "700" },
  title: { color: "#f4f2ff", fontSize: 40, fontWeight: "700", marginTop: 14 },
  subtitle: { color: "#9699a5", fontSize: 14, lineHeight: 22, marginTop: 10, marginBottom: 26 },
  card: { backgroundColor: "#1a1d24", borderColor: "#2a2e38", borderWidth: 1, borderRadius: 18, padding: 20, marginBottom: 14 },
  cardLabel: { color: "#9699a5", fontSize: 10, letterSpacing: 1.4, fontWeight: "700" },
  clock: { color: "#f4f2ff", fontSize: 42, fontWeight: "700", marginTop: 12, fontVariant: ["tabular-nums"] },
  day: { color: "#ded9ff", fontSize: 15, marginTop: 3 },
  zone: { color: "#a99eff", fontSize: 12, marginTop: 10 },
  note: { color: "#777d8c", fontSize: 11, marginTop: 7 },
  info: { backgroundColor: "#211f2d", borderRadius: 16, padding: 17, marginTop: 8 },
  infoTitle: { color: "#e5e0ff", fontSize: 15, fontWeight: "700" },
  infoText: { color: "#a7a4b4", fontSize: 12, lineHeight: 19, marginTop: 8 },
  footer: { color: "#666c79", fontSize: 11, textAlign: "center", marginTop: 22 },
});
