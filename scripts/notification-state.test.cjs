const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const sourcePath = path.join(__dirname, "..", "src", "lib", "notifications.ts");
const source = fs.readFileSync(sourcePath, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
});
const mocks = {
  "expo-notifications": {},
  "react-native": { Platform: { OS: "android" } },
  "@/lib/secureLocalStore": { getEncryptedItem: async () => null, setEncryptedItem: async () => undefined },
};
const moduleObject = { exports: {} };
vm.runInNewContext(compiled.outputText, {
  module: moduleObject,
  exports: moduleObject.exports,
  require: name => {
    if (!(name in mocks)) throw new Error("Unexpected test dependency: " + name);
    return mocks[name];
  },
});
const { normalizeNotificationState } = moduleObject.exports;

const validReminder = (overrides = {}) => ({
  id: "reminder-1",
  category: "task",
  title: "Finish assignment",
  body: "Review the final section",
  route: "/tasks",
  sourceKey: "task:task-1:lead:15",
  repeat: { kind: "once", date: "2026-11-10T09:00:00.000Z" },
  notificationId: null,
  enabled: true,
  completed: false,
  createdAt: "2026-11-09T09:00:00.000Z",
  ...overrides,
});

test("invalid repeat payloads are discarded instead of reaching native scheduling", () => {
  const result = normalizeNotificationState({
    reminders: [
      validReminder({ repeat: { kind: "hourly", interval: 1 } }),
      validReminder({ id: "bad-date", sourceKey: "bad-date", repeat: { kind: "once", date: "not-a-date" } }),
      validReminder({ id: "bad-clock", sourceKey: "bad-clock", repeat: { kind: "daily", hour: 24, minute: 10 } }),
      validReminder({ id: "bad-weekday", sourceKey: "bad-weekday", repeat: { kind: "weekly", weekday: 0, hour: 9, minute: 0 } }),
    ],
  });
  assert.equal(result.reminders.length, 0);
});

test("valid one-time, daily and weekly reminder rules are preserved", () => {
  const result = normalizeNotificationState({
    reminders: [
      validReminder(),
      validReminder({ id: "daily", sourceKey: "daily", repeat: { kind: "daily", hour: 8, minute: 30 } }),
      validReminder({ id: "weekly", sourceKey: "weekly", repeat: { kind: "weekly", weekday: 2, hour: 18, minute: 0 } }),
    ],
  });
  assert.equal(JSON.stringify(result.reminders.map(item => item.repeat.kind)), JSON.stringify(["once", "daily", "weekly"]));
});

test("duplicate reminder IDs and stable source keys are removed", () => {
  const result = normalizeNotificationState({
    reminders: [
      validReminder(),
      validReminder({ id: "reminder-1", sourceKey: "duplicate-id" }),
      validReminder({ id: "reminder-2", sourceKey: "task:task-1:lead:15" }),
    ],
  });
  assert.equal(result.reminders.length, 1);
  assert.equal(result.reminders[0].id, "reminder-1");
});

test("legacy reminders with a missing native identifier are retained for reconciliation", () => {
  const result = normalizeNotificationState({
    reminders: [validReminder({ notificationId: undefined })],
  });
  assert.equal(result.reminders.length, 1);
  assert.equal(result.reminders[0].notificationId, null);
});

test("reminder and history collections are bounded and malformed rows are discarded", () => {
  const reminders = Array.from({ length: 205 }, (_, index) =>
    validReminder({ id: "rem-" + index, sourceKey: undefined }),
  );
  const history = Array.from({ length: 105 }, (_, index) => ({
    id: "history-" + index,
    reminderId: "rem-" + index,
    category: "task",
    title: "Task reminder",
    body: "",
    event: "received",
    occurredAt: "2026-11-09T09:00:00.000Z",
  }));
  history.push({ id: "invalid", reminderId: "x", category: "unknown", title: "Bad", body: "", event: "received", occurredAt: "today" });
  const result = normalizeNotificationState({ reminders, history });
  assert.equal(result.reminders.length, 200);
  assert.equal(result.history.length, 100);
  assert.equal(result.history.some(item => item.id === "invalid"), false);
});

test("notification preferences fall back safely when persisted values are malformed", () => {
  const result = normalizeNotificationState({
    settings: {
      enabled: false,
      sound: "yes",
      vibration: false,
      calendarLeadMinutes: 999,
      categoryEnabled: { task: false, habit: "off" },
      quietHours: { enabled: true, startHour: 25, startMinute: -1, endHour: 7, endMinute: 15 },
    },
  });
  assert.equal(result.settings.enabled, false);
  assert.equal(result.settings.sound, true);
  assert.equal(result.settings.vibration, false);
  assert.equal(result.settings.calendarLeadMinutes, 15);
  assert.equal(result.settings.categoryEnabled.task, false);
  assert.equal(result.settings.categoryEnabled.habit, true);
  assert.equal(JSON.stringify(result.settings.quietHours), JSON.stringify({
    enabled: true, startHour: 22, startMinute: 0, endHour: 7, endMinute: 15,
  }));
});
