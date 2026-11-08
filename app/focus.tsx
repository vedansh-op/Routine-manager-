import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Link } from "expo-router";
import { useAuth } from "@/auth/AuthProvider";
import { useAppStore } from "@/store/AppStore";
import {
  cancelReminder,
  getNotificationPermission,
  getNotificationState,
  Reminder,
  requestNotificationPermission,
  scheduleReminder,
} from "@/lib/notifications";

const presets = [25, 50, 90];

function remainingLabel(reminder: Reminder | null, now: number) {
  if (!reminder || reminder.repeat.kind !== "once") return "No active focus session";
  const remaining = Math.max(0, new Date(reminder.repeat.date).getTime() - now);
  const minutes = Math.floor(remaining / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1000);
  if (remaining <= 0) return "Session time reached";
  return minutes + "m " + String(seconds).padStart(2, "0") + "s remaining";
}

export default function FocusScreen() {
  const { user } = useAuth();
  const { canEdit } = useAppStore();
  const [active, setActive] = useState<Reminder | null>(null);
  const [permission, setPermission] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());

  const refresh = useCallback(async () => {
    if (!user?.id || !canEdit) return;
    try {
      const [permissionState, state] = await Promise.all([
        getNotificationPermission(),
        getNotificationState(user.id),
      ]);
      setPermission(permissionState.granted);
      setActive(state.reminders.find(item => item.sourceKey === "focus:active-session" && item.enabled && !item.completed) ?? null);
    } catch (error) {
      Alert.alert("Focus unavailable", error instanceof Error ? error.message : "Could not load the focus session.");
    }
  }, [user?.id, canEdit]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  async function startSession(minutes: number) {
    if (!user?.id || !canEdit) return;
    setBusy(true);
    try {
      const allowed = await requestNotificationPermission();
      setPermission(allowed.granted);
      if (!allowed.granted) {
        Alert.alert("Notifications are off", "Allow ONE-OS notifications so it can alert you when the focus session ends.");
        return;
      }
      const endsAt = Date.now() + minutes * 60_000;
      const reminder = await scheduleReminder(user.id, {
        category: "focus",
        title: "Focus session complete",
        body: "Your " + minutes + "-minute focus session is finished. Take a short break and reset.",
        route: "/focus",
        sourceKey: "focus:active-session",
        repeat: { kind: "once", date: new Date(endsAt).toISOString() },
      });
      try {
        await scheduleReminder(user.id, {
          category: "focus",
          title: "Break is over",
          body: "Your 5-minute reset is complete. Ready to focus again?",
          route: "/focus",
          sourceKey: "focus:active-session:break",
          repeat: { kind: "once", date: new Date(endsAt + 5 * 60_000).toISOString() },
        });
      } catch {
        Alert.alert("Break reminder unavailable", "Your focus-end alert is still scheduled, but the 5-minute return reminder could not be added.");
      }
      setActive(reminder);
    } catch (error) {
      Alert.alert("Couldn't start focus session", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function stopSession() {
    if (!user?.id || !active) return;
    setBusy(true);
    try {
      const state = await getNotificationState(user.id);
      const linked = state.reminders.filter(item =>
        item.sourceKey === "focus:active-session" ||
        item.sourceKey === "focus:active-session:break",
      );
      for (const reminder of linked) await cancelReminder(user.id, reminder.id);
      setActive(null);
    } catch (error) {
      Alert.alert("Couldn't stop focus session", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!canEdit) return <View style={s.page}><Link href="/" style={s.back}>←  Home</Link><Text style={s.heading}>Focus</Text><Text style={s.muted}>Preparing secure account storage…</Text></View>;

  return <ScrollView style={s.page} contentContainerStyle={s.body}>
    <Link href="/" style={s.back}>←  Home</Link>
    <Text style={s.eyebrow}>ONE THING AT A TIME</Text>
    <Text style={s.heading}>Focus.</Text>
    <Text style={s.muted}>Start a quiet work block. ONE-OS will remind you when the session ends, even when the app is closed, subject to Android delivery restrictions.</Text>

    <View style={s.timer}>
      <Text style={s.timerLabel}>{active ? "SESSION RUNNING" : "READY WHEN YOU ARE"}</Text>
      <Text style={s.timerValue}>{active ? remainingLabel(active, now) : "Choose your block"}</Text>
      {active?.repeat.kind === "once" ? <Text style={s.ends}>Ends · {new Date(active.repeat.date).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</Text> : null}
    </View>

    {active ? <Pressable disabled={busy} onPress={() => void stopSession()} style={s.stop}>
      {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.stopText}>End focus session</Text>}
    </Pressable> : <View style={s.presets}>
      {presets.map(minutes => <Pressable key={minutes} disabled={busy} onPress={() => void startSession(minutes)} style={[s.preset, busy && s.disabled]}>
        <Text style={s.presetNumber}>{minutes}</Text>
        <Text style={s.presetLabel}>MINUTES</Text>
      </Pressable>)}
    </View>}

    <Text style={s.permission}>{permission === true ? "Notifications enabled on this device" : permission === false ? "Enable notifications to receive the session-end alert" : "Checking notification permission…"}</Text>
    <Link href="/notifications" style={s.settings}>Notification settings →</Link>
    <Text style={s.footer}>Only one active focus timer is kept per account. Each session schedules an end alert and a 5-minute break-return alert; ending the session cancels both.</Text>
  </ScrollView>;
}

const s = StyleSheet.create({
  page:{flex:1,backgroundColor:"#101216"},body:{padding:24,paddingTop:54,paddingBottom:48},
  back:{color:"#a99cff",marginBottom:28},eyebrow:{color:"#9b8cff",fontSize:10,letterSpacing:2,fontWeight:"700"},
  heading:{color:"#f4f2ff",fontSize:40,fontWeight:"700",marginTop:12},muted:{color:"#9699a5",fontSize:12,lineHeight:19,marginTop:9},
  timer:{backgroundColor:"#1a1d24",borderColor:"#3d375a",borderWidth:1,borderRadius:22,padding:24,alignItems:"center",marginTop:34},
  timerLabel:{color:"#aaa0e6",fontSize:9,fontWeight:"900",letterSpacing:1.8},timerValue:{color:"#f4f2ff",fontSize:23,fontWeight:"800",textAlign:"center",marginTop:18},
  ends:{color:"#9699a5",fontSize:11,marginTop:10},presets:{flexDirection:"row",gap:10,marginTop:18},
  preset:{flex:1,backgroundColor:"#302b47",borderColor:"#6f659b",borderWidth:1,borderRadius:15,alignItems:"center",paddingVertical:19},
  presetNumber:{color:"#f4f2ff",fontSize:24,fontWeight:"900"},presetLabel:{color:"#c7bfff",fontSize:8,fontWeight:"800",letterSpacing:1,marginTop:5},
  stop:{backgroundColor:"#8d4054",borderRadius:13,padding:16,alignItems:"center",marginTop:18},stopText:{color:"#fff",fontWeight:"800"},
  disabled:{opacity:0.5},permission:{color:"#858b98",fontSize:10,textAlign:"center",marginTop:22},settings:{color:"#c7bfff",fontSize:12,fontWeight:"700",textAlign:"center",marginTop:19},
  footer:{color:"#686e7b",fontSize:10,lineHeight:16,textAlign:"center",marginTop:24},
});
