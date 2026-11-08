import { useEffect, useRef, useState } from "react";
import { AppState, ActivityIndicator, View } from "react-native";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { AppStoreProvider, todayKey, useAppStore } from "@/store/AppStore";
import { AuthProvider, useAuth } from "@/auth/AuthProvider";
import { supabase } from "@/lib/supabase";
import { ensureDeviceCryptoKey } from "@/lib/deviceCrypto";
import * as Notifications from "expo-notifications";
import { completeReminder, configureNotificationResponseActions, initializeNotificationChannels, NOTIFICATION_CATEGORIES, NotificationCategory, cancelSnoozesForReminder, recordNotificationHistory, reconcileScheduledNotifications, snoozeReminder } from "@/lib/notifications";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

function SessionGate() {
  const { configured, loading, session, recovery, user } = useAuth();
  const { canEdit, tasks, habits, routines, completions, toggleTask, toggleHabitToday, completeRoutine } = useAppStore();
  const segments = useSegments();
  const router = useRouter();
  const route = segments[0];
  const inAuth = route === "auth";
  const inMfa = route === "mfa";
  const inVerifyEmail = route === "verify-email";
  const emailVerified = Boolean(session?.user.email_confirmed_at);
  useEffect(() => {
    const reconcile = () => {
      if (!user?.id) {
        void reconcileScheduledNotifications(null).catch(() => undefined);
        return;
      }
      if (!canEdit) return;
      void reconcileScheduledNotifications(user.id).catch(() => undefined);
    };
    reconcile();
    const subscription = AppState.addEventListener("change", state => {
      if (state === "active") reconcile();
    });
    return () => subscription.remove();
  }, [user?.id, canEdit]);

  const handledResponses = useRef(new Set<string>());

  useEffect(() => {
    void initializeNotificationChannels();
    configureNotificationResponseActions();

    const handleResponse = async (response: Notifications.NotificationResponse) => {
      const requestId = response.notification.request.identifier;
      const responseKey = requestId + ":" + response.actionIdentifier;
      if (handledResponses.current.has(responseKey)) return;

      const data = response.notification.request.content.data as {
        userId?: unknown;
        reminderId?: unknown;
        route?: unknown;
        category?: unknown;
        sourceKey?: unknown;
        parentReminderId?: unknown;
        repeatKind?: unknown;
      };
      if (!user?.id || !canEdit) return;
      if (data.userId !== user.id || typeof data.reminderId !== "string") {
        handledResponses.current.add(responseKey);
        return;
      }
      handledResponses.current.add(responseKey);
      const category: NotificationCategory = NOTIFICATION_CATEGORIES.includes(data.category as NotificationCategory)
        ? data.category as NotificationCategory
        : "system";
      const historyEntry = {
        reminderId: data.reminderId,
        category,
        title: response.notification.request.content.title ?? "ONE-OS reminder",
        body: response.notification.request.content.body ?? "",
      };

      try {
        if (response.actionIdentifier === "SNOOZE_10") {
          await snoozeReminder(user.id, data.reminderId, 10);
          await recordNotificationHistory(user.id, { ...historyEntry, event: "snoozed" });
          return;
        }
        if (response.actionIdentifier === "DONE") {
          if (category === "task" && (typeof data.sourceKey === "string" || typeof data.parentReminderId === "string")) {
            const match = typeof data.sourceKey === "string" ? data.sourceKey.match(/^task:([^:]+):lead:/) : null;
            const task = tasks.find(item =>
              (match && item.id === match[1]) ||
              (typeof data.parentReminderId === "string" &&
                (item.reminderIds ?? (item.reminderId ? [item.reminderId] : [])).includes(data.parentReminderId)),
            );
            if (task && !task.completed) {
              const completed = await toggleTask(task.id);
              if (!completed) throw new Error("The task could not be completed; its reminders may still be active.");
            } else {
              await completeReminder(user.id, data.reminderId);
            }
          } else if (category === "routine" && (typeof data.sourceKey === "string" || typeof data.parentReminderId === "string")) {
            const match = typeof data.sourceKey === "string" ? data.sourceKey.match(/^routine:([^:]+):/) : null;
            const routine = routines.find(item =>
              (match && item.id === match[1]) ||
              (typeof data.parentReminderId === "string" && (item.reminderIds ?? []).includes(data.parentReminderId)),
            );
            if (routine) {
              const completed = await completeRoutine(routine.id);
              if (!completed) throw new Error("The routine could not be completed; its remaining alerts may still be active.");
            } else {
              await completeReminder(user.id, data.reminderId);
            }
          } else if (category === "habit" && (typeof data.sourceKey === "string" || typeof data.parentReminderId === "string")) {
            const match = typeof data.sourceKey === "string" ? data.sourceKey.match(/^habit:([^:]+):/) : null;
            const habit = habits.find(item =>
              (match && item.id === match[1]) ||
              (typeof data.parentReminderId === "string" &&
                (item.reminderIds ?? (item.reminderId ? [item.reminderId] : [])).includes(data.parentReminderId)),
            );
            if (habit) {
              const completionKey = habit.id + ":" + todayKey();
              if (!completions.includes(completionKey) && !toggleHabitToday(habit.id)) throw new Error("The habit check-in could not be saved.");
              const reminderIds = habit.reminderIds ?? (habit.reminderId ? [habit.reminderId] : []);
              for (const reminderId of reminderIds) await cancelSnoozesForReminder(user.id, reminderId);
              if (data.repeatKind === "once") await completeReminder(user.id, data.reminderId);
            } else {
              await completeReminder(user.id, data.reminderId);
            }
          } else {
            await completeReminder(user.id, data.reminderId);
          }
          await recordNotificationHistory(user.id, { ...historyEntry, event: "completed" });
          return;
        }
        if (
          response.actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER ||
          response.actionIdentifier === "OPEN"
        ) {
          await recordNotificationHistory(user.id, { ...historyEntry, event: "opened" });
          const allowedRoutes = ["/", "/tasks", "/habits", "/calendar", "/notifications", "/focus", "/routines", "/shared"];
          const target = typeof data.route === "string" && allowedRoutes.includes(data.route)
            ? data.route
            : "/notifications";
          router.push(target as never);
        }
      } catch {
        // A notification action must never crash session routing. The reminder
        // remains in encrypted storage and can be managed from Notifications.
      }
    };

    const receivedSubscription = Notifications.addNotificationReceivedListener(notification => {
      const data = notification.request.content.data as {
        userId?: unknown;
        reminderId?: unknown;
        category?: unknown;
      };
      if (!user?.id || data.userId !== user.id || typeof data.reminderId !== "string") return;
      const category: NotificationCategory = NOTIFICATION_CATEGORIES.includes(data.category as NotificationCategory)
        ? data.category as NotificationCategory
        : "system";
      void recordNotificationHistory(user.id, {
        reminderId: data.reminderId,
        category,
        title: notification.request.content.title ?? "ONE-OS reminder",
        body: notification.request.content.body ?? "",
        event: "received",
      }).catch(() => undefined);
    });
    const subscription = Notifications.addNotificationResponseReceivedListener(response => {
      void handleResponse(response);
    });
    void Notifications.getLastNotificationResponseAsync()
      .then(response => { if (response) void handleResponse(response); })
      .catch(() => undefined);

    return () => {
      receivedSubscription.remove();
      subscription.remove();
    };
  }, [user?.id, canEdit, router, tasks, habits, routines, completions, toggleTask, toggleHabitToday, completeRoutine]);

  const [assuranceReady, setAssuranceReady] = useState(false);
  const [aal2, setAal2] = useState(false);

  useEffect(() => {
    let alive = true;
    setAssuranceReady(false);
    setAal2(false);
    if (!session || !supabase || recovery || !emailVerified) {
      setAssuranceReady(true);
      return () => { alive = false; };
    }
    supabase.auth.mfa.getAuthenticatorAssuranceLevel().then(({ data, error }) => {
      if (!alive) return;
      setAal2(!error && data.currentLevel === "aal2");
      setAssuranceReady(true);
    }).catch(() => { if (alive) setAssuranceReady(true); });
    return () => { alive = false; };
  }, [session?.access_token, recovery, emailVerified]);

  useEffect(() => {
    if (loading || (!assuranceReady && session && emailVerified && !recovery)) return;
    if ((!configured || !session) && !inAuth) router.replace("/auth");
    else if (session && configured && !recovery && !emailVerified && !inVerifyEmail) router.replace("/verify-email");
    else if (session && configured && emailVerified && !recovery && !aal2 && !inMfa) router.replace("/mfa");
    else if (session && configured && emailVerified && !recovery && aal2 && (inAuth || inMfa || inVerifyEmail)) router.replace("/");
  }, [configured, loading, session, emailVerified, recovery, assuranceReady, aal2, inAuth, inMfa, inVerifyEmail, router]);

  // Heartbeat and device-key registration run only after the session reaches AAL2.
  useEffect(() => {
    const userId = session?.user.id;
    const client = supabase;
    if (!configured || !userId || !client || !aal2) return;
    let cancelled = false;
    const heartbeat = async () => {
      if (cancelled) return;
      const { data } = await client.from("space_members")
        .select("space_id").eq("user_id", userId).limit(1).maybeSingle();
      if (!cancelled && data?.space_id) {
        await client.rpc("touch_my_presence");
        if (!cancelled) await ensureDeviceCryptoKey(userId).catch(() => undefined);
      }
    };
    void heartbeat();
    const subscription = AppState.addEventListener("change", state => {
      if (state === "active") void heartbeat();
    });
    return () => { cancelled = true; subscription.remove(); };
  }, [configured, session?.user.id, aal2]);

  if (session && !recovery && !inVerifyEmail && (!emailVerified || (!inMfa && (!assuranceReady || !aal2)))) {
    return <View style={{ flex: 1, backgroundColor: "#101216", alignItems: "center", justifyContent: "center" }}><ActivityIndicator color="#b7adff" /></View>;
  }
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#101216" } }} />;
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <AppStoreProvider>
        <StatusBar style="light" />
        <SessionGate />
      </AppStoreProvider>
    </AuthProvider>
  );
}
