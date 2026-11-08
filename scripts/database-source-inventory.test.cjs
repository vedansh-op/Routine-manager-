const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const migrationDir = path.join(__dirname, "..", "supabase", "migrations");
const files = fs.readdirSync(migrationDir)
  .filter(name => name.endsWith(".sql"))
  .sort();
const migrations = files.map(name => ({
  name,
  sql: fs.readFileSync(path.join(migrationDir, name), "utf8"),
}));

const expectedPolicies = [
  ["public.profiles", "Users can read their own profile"],
  ["public.profiles", "Users can insert their own profile"],
  ["public.profiles", "Users can update their own profile"],
  ["public.spaces", "Members can view their spaces"],
  ["public.space_members", "Members can view space membership"],
  ["public.weekly_reports", "Users can read their own weekly reports"],
  ["public.weekly_reports", "Partners can read explicitly shared weekly reports"],
  ["public.weekly_reports", "Users can create their own weekly reports"],
  ["public.weekly_reports", "Users can update their own weekly reports"],
  ["public.weekly_reports", "Users can delete their own weekly reports"],
  ["public.shared_activities", "Members can read activities in shared spaces"],
  ["public.shared_activities", "Members can add shared activities"],
  ["public.shared_activities", "Creators can edit their shared activities"],
  ["public.shared_activities", "Creators can delete their shared activities"],
  ["public.device_crypto_keys", "Users can read own and active two-person shared device public keys"],
  ["public.snap_deliveries", "Participants can read snap delivery metadata"],
  ["public.shared_archives", "Archive participants can read their shared archive"],
  ["public.shared_archive_participants", "Archive participants can read archive membership"],
  ["public.shared_archive_activities", "Archive participants can read shared history"],
  ["storage.objects", "ONE-OS sender can upload encrypted snap"],
  ["storage.objects", "ONE-OS recipient can download pending or downloaded encrypted snap"],
].map(([table, name]) => table + "|" + name);

const expectedSecurityDefiners = [
  "public.handle_new_user",
  "public.is_space_member",
  "public.create_shared_space",
  "public.join_shared_space",
  "public.rotate_shared_invite",
  "public.seed_member_presence",
  "public.touch_my_presence",
  "public.register_device_crypto_key",
  "public.create_snap_delivery",
  "public.finalize_snap_upload",
  "public.is_shared_archive_participant",
  "public.create_shared_archive_for_space",
  "public.mirror_shared_activity_to_archive",
  "public.mirror_shared_member_to_archive",
  "public.end_shared_connection",
  "public.reject_writes_to_ended_shared_space",
  "public.renew_snap_upload_lease",
  "public.claim_expired_snap_deliveries",
  "public.finish_snap_expiry",
  "public.enforce_shared_activity_daily_limit",
  "public.require_aal2_for_sensitive_write",
  "public.revoke_device_crypto_key",
  "public.require_active_recipient_device_for_snap",
].sort();

function finalPolicies() {
  const state = new Map();
  const changePattern =
    /(drop\s+policy\s+if\s+exists\s+"([^"]+)"\s+on\s+([a-z0-9_.]+)|create\s+policy\s+"([^"]+)"\s+on\s+([a-z0-9_.]+))/gi;
  for (const file of migrations) {
    for (const match of file.sql.matchAll(changePattern)) {
      const dropping = Boolean(match[2]);
      const name = dropping ? match[2] : match[4];
      const table = (dropping ? match[3] : match[5]).toLowerCase();
      const key = table + "|" + name;
      if (dropping) state.delete(key);
      else state.set(key, { table, name, migration: file.name });
    }
  }
  return [...state.keys()].sort();
}

function finalSecurityDefiners() {
  const functions = new Map();
  const startPattern =
    /create\s+(?:or\s+replace\s+)?function\s+([a-z0-9_.]+)\s*\(/gi;
  const dollarOpenPattern = /\bas\s+\$(?:[a-z_][a-z0-9_]*)?\$/i;
  for (const file of migrations) {
    for (const match of file.sql.matchAll(startPattern)) {
      const start = match.index;
      const headerTail = file.sql.slice(start);
      const delimiter = dollarOpenPattern.exec(headerTail);
      if (!delimiter) continue;
      const header = headerTail.slice(0, delimiter.index + delimiter[0].length);
      if (/\bsecurity\s+definer\b/i.test(header)) {
        functions.set(match[1].toLowerCase(), { header, migration: file.name });
      }
    }
  }
  return functions;
}

test("all expected SQL migration files are present and ordered", () => {
  assert.equal(files.length, 18);
  assert.deepEqual(files, [...files].sort());
});

test("dollar-quoted SQL bodies are balanced and no single-dollar AS opener exists", () => {
  for (const file of migrations) {
    assert.equal(
      /\bas\s+\$(?:\s|$)/im.test(file.sql),
      false,
      file.name + " contains an invalid single-dollar AS delimiter",
    );
    const counts = new Map();
    for (const delimiter of file.sql.match(/\$\$|\$[a-z_][a-z0-9_]*\$/gi) ?? []) {
      const key = delimiter.toLowerCase();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const [delimiter, count] of counts) {
      assert.equal(count % 2, 0, file.name + " has an unbalanced " + delimiter + " quote");
    }
  }
});

test("the final source migration set contains exactly the reviewed 21 policies", () => {
  const actual = finalPolicies();
  assert.equal(actual.length, 21);
  assert.deepEqual(actual, [...expectedPolicies].sort());
});

test("all 23 SECURITY DEFINER functions use an empty search_path", () => {
  const functions = finalSecurityDefiners();
  assert.deepEqual([...functions.keys()].sort(), expectedSecurityDefiners);
  for (const [name, details] of functions) {
    assert.match(
      details.header,
      /set\s+search_path\s*=\s*''/i,
      name + " in " + details.migration + " must pin an empty search_path",
    );
  }
});

test("trigger-only SECURITY DEFINER functions are not granted to client roles", () => {
  const triggerOnly = [
    "handle_new_user",
    "seed_member_presence",
    "create_shared_archive_for_space",
    "mirror_shared_activity_to_archive",
    "mirror_shared_member_to_archive",
    "reject_writes_to_ended_shared_space",
    "enforce_shared_activity_daily_limit",
    "require_aal2_for_sensitive_write",
    "require_active_recipient_device_for_snap",
  ];
  const allSql = migrations.map(file => file.sql).join("\n");
  for (const name of triggerOnly) {
    const clientGrant = new RegExp(
      "grant\\s+execute\\s+on\\s+function\\s+public\\." + name +
      "\\s*\\([^;]*?\\)\\s+to\\s+(?:anon|authenticated)\\b",
      "i",
    );
    assert.equal(clientGrant.test(allSql), false, name + " must remain trigger-only");
  }
});

test("Snap expiry claim/finalize functions are restricted to service_role", () => {
  const allSql = migrations.map(file => file.sql).join("\n");
  for (const [name, signature] of [
    ["claim_expired_snap_deliveries", "(timestamptz,integer)"],
    ["finish_snap_expiry", "(uuid,boolean)"],
  ]) {
    const grant = new RegExp(
      "grant\\s+execute\\s+on\\s+function\\s+public\\." + name +
      "\\s*" + signature.replace(/[()]/g, "\\$&") + "\\s+to\\s+service_role\\b",
      "i",
    );
    const clientGrant = new RegExp(
      "grant\\s+execute\\s+on\\s+function\\s+public\\." + name +
      "\\s*\\([^;]*?\\)\\s+to\\s+(?:anon|authenticated)\\b",
      "i",
    );
    assert.equal(grant.test(allSql), true, name + " must be granted to service_role");
    assert.equal(clientGrant.test(allSql), false, name + " must not be granted to client roles");
  }
});

test("AAL2 trigger is attached to every intended sensitive-write table", () => {
  const migration = migrations.find(file => file.name.endsWith("0012_require_aal2_for_sensitive_writes.sql"));
  assert.ok(migration);
  for (const table of [
    "spaces", "space_members", "space_invitations",
    "device_crypto_keys", "snap_deliveries", "shared_activities", "weekly_reports",
  ]) {
    assert.match(
      migration.sql,
      new RegExp("create\\s+trigger\\s+require_aal2_[a-z0-9_]+\\s+before[\\s\\S]{0,160}?on\\s+public\\." + table + "\\b", "i"),
      table + " must have the AAL2 trigger",
    );
  }
});
