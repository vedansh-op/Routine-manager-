import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/auth/AuthProvider";
import { useAppStore } from "@/store/AppStore";
import { getNotificationPermission, getNotificationState, scheduleReminder } from "@/lib/notifications";
import {
  DEFAULT_PARTNER_TIME_ZONE,
  formatInTimeZone,
  getDateKeyInTimeZone,
  getDeviceTimeZone,
  getTimeZoneOffsetLabel,
} from "@/lib/time";

type Activity = {
  id: string;
  title: string;
  note: string | null;
  starts_at: string;
  timezone: string;
  created_by: string;
};

const monthLabel = (year: number, month: number) =>
  new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, month, 1)));

function monthCells(year: number, month: number): Array<number | null> {
  const firstDay = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const count = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return [...Array(firstDay).fill(null), ...Array.from({ length: count }, (_, i) => i + 1)];
}
function dateKey(year: number, month: number, day: number) {
  return [year, String(month + 1).padStart(2, "0"), String(day).padStart(2, "0")].join("-");
}

export default function ActivityCalendarScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { canEdit } = useAppStore();
  const zone = getDeviceTimeZone();
  const now = new Date();
  const [month, setMonth] = useState(() => new Date(now.getFullYear(), now.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(() => getDateKeyInTimeZone(now, zone));
  const [selectedInstant, setSelectedInstant] = useState(() => new Date());
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [connectionEnded, setConnectionEnded] = useState(false);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    if (!supabase || !user) { setLoading(false); return; }
    setLoading(true);
    try {
      const { data: membership, error: memberError } = await supabase
        .from("space_members").select("space_id").eq("user_id", user.id).limit(1).maybeSingle();
      if (memberError) throw memberError;
      if (!membership?.space_id) { setSpaceId(null); setActivities([]); setConnectionEnded(false); return; }
      setSpaceId(membership.space_id);
      const { data: archive, error: archiveError } = await supabase
        .from("shared_archives").select("ended_at")
        .eq("source_space_id", membership.space_id).maybeSingle();
      if (archiveError) throw archiveError;
      setConnectionEnded(Boolean(archive?.ended_at));
      const { data, error } = await supabase.from("shared_activities")
        .select("id,title,note,starts_at,timezone,created_by")
        .eq("space_id", membership.space_id).order("starts_at", { ascending: true });
      if (error) throw error;
      setActivities((data ?? []) as Activity[]);
    } catch (error) {
      Alert.alert("Couldn't load shared calendar", error instanceof Error ? error.message : "Please try again.");
    } finally { setLoading(false); }
  }, [user]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    const syncLocalCalendarAlerts = async () => {
      if (!user?.id || !canEdit || activities.length === 0) return;
      try {
        const [permission, notificationState] = await Promise.all([
          getNotificationPermission(),
          getNotificationState(user.id),
        ]);
        if (!permission.granted || cancelled) return;
        const now = Date.now();
        const leadMinutes = notificationState.settings.calendarLeadMinutes;
        const horizon = now + 30 * 24 * 60 * 60 * 1000;
        const upcoming = activities
          .filter(item => {
            const startsAt = new Date(item.starts_at).getTime();
            return Number.isFinite(startsAt) && startsAt > now + 30_000 && startsAt <= horizon;
          })
          .slice(0, 40);
        for (const item of upcoming) {
          if (cancelled) return;
          const startsAt = new Date(item.starts_at).getTime();
          const alertAt = Math.max(now + 30_000, startsAt - leadMinutes * 60_000);
          try {
            await scheduleReminder(user.id, {
              category: "calendar",
              title: item.title,
              body: "Your shared calendar event starts soon.",
              route: "/calendar",
              sourceKey: "calendar:" + item.id,
              repeat: { kind: "once", date: new Date(alertAt).toISOString() },
            });
          } catch {
            // Calendar browsing must continue even when reminders are disabled,
            // permission is denied, or an individual event is not schedulable.
          }
        }
      } catch {
        // The calendar remains usable when notification services are unavailable.
      }
    };
    void syncLocalCalendarAlerts();
    return () => { cancelled = true; };
  }, [activities, user?.id, canEdit]);

  const cells = useMemo(() => monthCells(month.getFullYear(), month.getMonth()), [month]);
  const activityDates = useMemo(() => new Set(activities.map(item => getDateKeyInTimeZone(new Date(item.starts_at), zone))), [activities, zone]);
  const selected = activities.filter(item => getDateKeyInTimeZone(new Date(item.starts_at), zone) === selectedDate);

  function chooseCalendarDate(key: string) {
    setSelectedDate(key);
    const [year, monthNumber, day] = key.split("-").map(Number);
    setSelectedInstant(current => new Date(
      year, monthNumber - 1, day, current.getHours(), current.getMinutes(), 0, 0,
    ));
  }

  function openEventDatePicker() {
    DateTimePickerAndroid.open({
      value: selectedInstant,
      mode: "date",
      onChange: (event, pickedDate) => {
        if (event.type !== "set" || !pickedDate) return;
        const next = new Date(
          pickedDate.getFullYear(), pickedDate.getMonth(), pickedDate.getDate(),
          selectedInstant.getHours(), selectedInstant.getMinutes(), 0, 0,
        );
        setSelectedInstant(next);
        setSelectedDate(getDateKeyInTimeZone(next, zone));
        setMonth(new Date(next.getFullYear(), next.getMonth(), 1));
      },
    });
  }

  function openEventTimePicker() {
    DateTimePickerAndroid.open({
      value: selectedInstant,
      mode: "time",
      is24Hour: true,
      onChange: (event, pickedTime) => {
        if (event.type !== "set" || !pickedTime) return;
        const next = new Date(selectedInstant);
        next.setHours(pickedTime.getHours(), pickedTime.getMinutes(), 0, 0);
        setSelectedInstant(next);
      },
    });
  }

  async function addMoment() {
    const value = title.trim();
    if (!value) return Alert.alert("Add a title", "Give this shared activity a short name.");
    if (!supabase || !user || !spaceId) return;
    setSaving(true);
    try {
      const { error } = await supabase.from("shared_activities").insert({
        space_id: spaceId,
        created_by: user.id,
        title: value,
        note: note.trim() || null,
        starts_at: selectedInstant.toISOString(),
        timezone: zone,
      });
      if (error) throw error;
      setTitle(""); setNote("");
      await refresh();
      Alert.alert("Added to shared calendar", "Your partner can see this activity in their calendar.");
    } catch (error) {
      Alert.alert("Couldn't add activity", error instanceof Error ? error.message : "Please try again.");
    } finally { setSaving(false); }
  }

  function changeMonth(amount: number) {
    setMonth(old => new Date(old.getFullYear(), old.getMonth() + amount, 1));
  }

  return <ScrollView style={s.page} contentContainerStyle={s.body}>
    <Pressable onPress={() => router.back()}><Text style={s.back}>←  Back</Text></Pressable>
    <Text style={s.eyebrow}>TWO PEOPLE · SHARED MEMORIES</Text>
    <Text style={s.heading}>Our calendar.</Text>
    <Text style={s.sub}>Shared activities appear on each person's calendar using their own local timezone.</Text>
    {!spaceId && !loading ? <View style={s.card}>
      <Text style={s.cardTitle}>Connect your shared space first</Text>
      <Text style={s.muted}>Create a space or join your partner's one-time invitation code before adding shared moments.</Text>
      <Pressable onPress={() => router.push("/shared")} style={s.primary}><Text style={s.primaryText}>Open shared space</Text></Pressable>
    </View> : <>
      <View style={s.calendar}>
        <View style={s.monthHeader}>
          <Pressable onPress={() => changeMonth(-1)}><Text style={s.arrow}>‹</Text></Pressable>
          <Text style={s.month}>{monthLabel(month.getFullYear(), month.getMonth())}</Text>
          <Pressable onPress={() => changeMonth(1)}><Text style={s.arrow}>›</Text></Pressable>
        </View>
        <View style={s.grid}>
          {["S","M","T","W","T","F","S"].map((day, i) => <Text key={day+i} style={s.weekday}>{day}</Text>)}
          {cells.map((day, i) => {
            if (!day) return <View key={"blank"+i} style={s.dayCell} />;
            const key = dateKey(month.getFullYear(), month.getMonth(), day);
            const active = key === selectedDate;
            const hasItems = activityDates.has(key);
            return <Pressable key={key} onPress={() => chooseCalendarDate(key)} style={[s.dayCell, active && s.selectedDay]}>
              <Text style={[s.dayText, active && s.selectedDayText]}>{day}</Text>
              {hasItems ? <View style={[s.dot, active && s.selectedDot]} /> : null}
            </Pressable>;
          })}
        </View>
        <Text style={s.timezone}>Dates shown in {zone}</Text>
      </View>
      <View style={s.card}>
        <Text style={s.cardTitle}>{formatInTimeZone(new Date(selectedDate + "T12:00:00"), zone, { weekday:"long", day:"numeric", month:"long" })}</Text>
        {loading ? <ActivityIndicator color="#b7adff" /> : selected.length ? selected.map(item => <View key={item.id} style={s.event}>
          <View style={s.eventDot} />
          <View style={{ flex: 1 }}>
            <Text style={s.eventTitle}>{item.title}</Text>
            <Text style={s.eventTime}>{formatInTimeZone(item.starts_at, zone, { hour:"2-digit", minute:"2-digit" })} · added by {item.created_by === user?.id ? "you" : "partner"}</Text>
            {item.note ? <Text style={s.muted}>{item.note}</Text> : null}
          </View>
        </View>) : <Text style={s.muted}>No shared activities on this date yet.</Text>}
      </View>
      {!connectionEnded ? <View style={s.card}>
        <Text style={s.cardTitle}>Add a shared moment</Text>
        <Text style={s.muted}>Choose a date and time in your phone's timezone. ONE-OS stores one UTC instant and converts it for your partner automatically.</Text>
        <View style={s.schedulePanel}>
          <View style={s.scheduleRow}>
            <Pressable style={s.scheduleButton} onPress={openEventDatePicker}>
              <Text style={s.scheduleLabel}>YOUR DATE</Text>
              <Text style={s.scheduleValue}>{formatInTimeZone(selectedInstant, zone, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}</Text>
              <Text style={s.scheduleHint}>Change date</Text>
            </Pressable>
            <Pressable style={s.scheduleButton} onPress={openEventTimePicker}>
              <Text style={s.scheduleLabel}>YOUR TIME</Text>
              <Text style={s.scheduleValue}>{formatInTimeZone(selectedInstant, zone, { hour: "2-digit", minute: "2-digit", hour12: true })}</Text>
              <Text style={s.scheduleHint}>Change time</Text>
            </Pressable>
          </View>
          <Text style={s.scheduleZone}>Saved as UTC · {zone} ({getTimeZoneOffsetLabel(selectedInstant, zone)})</Text>
          <Text style={s.partnerPreview}>Portugal sees {formatInTimeZone(selectedInstant, DEFAULT_PARTNER_TIME_ZONE, { weekday: "short", day: "numeric", month: "short" })} at {formatInTimeZone(selectedInstant, DEFAULT_PARTNER_TIME_ZONE, { hour: "2-digit", minute: "2-digit", hour12: true })} · {getTimeZoneOffsetLabel(selectedInstant, DEFAULT_PARTNER_TIME_ZONE)}</Text>
        </View>
        <TextInput value={title} onChangeText={setTitle} placeholder="What happened?" placeholderTextColor="#777d8c" maxLength={120} style={s.input} />
        <TextInput value={note} onChangeText={setNote} placeholder="A little detail (optional)" placeholderTextColor="#777d8c" multiline style={[s.input, s.noteInput]} />
        <Pressable disabled={saving || loading} onPress={() => void addMoment()} style={[s.primary, (saving || loading) && s.disabled]}>
          {saving ? <ActivityIndicator color="#101216" /> : <Text style={s.primaryText}>Add to our calendar</Text>}
        </Pressable>
      </View> : <View style={s.card}><Text style={s.cardTitle}>Read-only shared history</Text><Text style={s.muted}>This connection has ended. Existing calendar moments remain available to both people, but no new shared moments can be added.</Text></View>}
    </>}
    <Text style={s.footer}>Only activities intentionally added here are stored in the shared cloud space. Private tasks and habits stay on each phone.</Text>
  </ScrollView>;
}

const s = StyleSheet.create({
  page:{flex:1,backgroundColor:"#101216"},body:{padding:22,paddingTop:56,paddingBottom:50},back:{color:"#c7bfff",fontSize:14,marginBottom:30},
  eyebrow:{color:"#9b8cff",fontSize:10,letterSpacing:2,fontWeight:"700"},heading:{color:"#f4f2ff",fontSize:38,fontWeight:"700",marginTop:13},
  sub:{color:"#9699a5",fontSize:13,lineHeight:21,marginTop:9,marginBottom:22},calendar:{backgroundColor:"#1a1d24",borderColor:"#2a2e38",borderWidth:1,borderRadius:18,padding:15},
  monthHeader:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",marginBottom:15},month:{color:"#f4f2ff",fontSize:17,fontWeight:"700"},arrow:{color:"#c7bfff",fontSize:30,paddingHorizontal:10},
  grid:{flexDirection:"row",flexWrap:"wrap"},weekday:{width:"14.2857%",textAlign:"center",color:"#777d8c",fontSize:11,paddingVertical:8},
  dayCell:{width:"14.2857%",height:43,alignItems:"center",justifyContent:"center",borderRadius:11},dayText:{color:"#d8d9e0",fontSize:13},
  selectedDay:{backgroundColor:"#b7adff"},selectedDayText:{color:"#101216",fontWeight:"800"},dot:{width:4,height:4,borderRadius:3,backgroundColor:"#b7adff",position:"absolute",bottom:4},selectedDot:{backgroundColor:"#101216"},
  timezone:{color:"#777d8c",fontSize:10,textAlign:"center",marginTop:12},card:{backgroundColor:"#1a1d24",borderColor:"#2a2e38",borderWidth:1,borderRadius:18,padding:17,marginTop:15},
  cardTitle:{color:"#f4f2ff",fontSize:17,fontWeight:"700",marginBottom:10},muted:{color:"#9699a5",fontSize:12,lineHeight:19},event:{flexDirection:"row",gap:11,paddingVertical:10,borderTopWidth:1,borderTopColor:"#2a2e38"},
  eventDot:{width:8,height:8,borderRadius:5,backgroundColor:"#b7adff",marginTop:5},eventTitle:{color:"#f4f2ff",fontSize:14,fontWeight:"700"},eventTime:{color:"#a99eff",fontSize:11,marginTop:4},
  input:{backgroundColor:"#101216",borderWidth:1,borderColor:"#3b3e4a",borderRadius:12,padding:14,color:"#f4f2ff",marginTop:13,fontSize:14},
  noteInput:{minHeight:68,textAlignVertical:"top"},
  schedulePanel:{backgroundColor:"#101216",borderRadius:13,padding:12,marginTop:13},
  scheduleRow:{flexDirection:"row",gap:9},
  scheduleButton:{flex:1,backgroundColor:"#222532",borderWidth:1,borderColor:"#39364d",borderRadius:11,padding:12},
  scheduleLabel:{color:"#9699a5",fontSize:9,letterSpacing:1,fontWeight:"800"},
  scheduleValue:{color:"#f4f2ff",fontSize:14,fontWeight:"700",marginTop:7},
  scheduleHint:{color:"#a99eff",fontSize:10,marginTop:5},
  scheduleZone:{color:"#777d8c",fontSize:10,marginTop:11},
  partnerPreview:{color:"#c7bfff",fontSize:11,lineHeight:17,marginTop:6},
  primary:{backgroundColor:"#b7adff",padding:15,borderRadius:12,alignItems:"center",marginTop:14},primaryText:{color:"#101216",fontWeight:"800"},
  disabled:{opacity:0.5},footer:{color:"#666c79",fontSize:10,lineHeight:17,textAlign:"center",marginTop:20},
});
