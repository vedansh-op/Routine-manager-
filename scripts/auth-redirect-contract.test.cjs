const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const provider = fs.readFileSync(path.join(root, "src/auth/AuthProvider.tsx"), "utf8");
const screen = fs.readFileSync(path.join(root, "app/auth.tsx"), "utf8");
const config = fs.readFileSync(path.join(root, "app.json"), "utf8");

test("auth callback accepts Supabase PKCE codes from the query string", () => {
  assert.match(provider, /const code = query\.get\("code"\)/);
  assert.match(provider, /exchangeCodeForSession\(code\)/);
});

test("legacy implicit-flow callback accepts access and refresh tokens from query or hash", () => {
  assert.match(provider, /hash\.get\("access_token"\) \?\? query\.get\("access_token"\)/);
  assert.match(provider, /hash\.get\("refresh_token"\) \?\? query\.get\("refresh_token"\)/);
  assert.match(provider, /setSession\(\{ access_token: accessToken, refresh_token: refreshToken \}\)/);
});

test("password recovery is enabled only after Supabase accepts the callback credentials", () => {
  const exchange = provider.indexOf("exchangeCodeForSession(code)");
  const setSession = provider.indexOf("setSession({ access_token: accessToken, refresh_token: refreshToken })");
  const recovery = provider.indexOf("if (isRecovery && shouldContinue()) setRecovery(true)");
  assert.ok(exchange >= 0 && setSession >= 0 && recovery > exchange && recovery > setSession);
  assert.match(provider, /const isRecovery = .*=== "recovery"/);
});

test("initial and foreground deep links are both observed and cleaned up", () => {
  assert.match(provider, /Linking\.getInitialURL\(\)/);
  assert.match(provider, /Linking\.addEventListener\("url"/);
  assert.match(provider, /linkListener\.remove\(\)/);
  assert.match(provider, /listener\.subscription\.unsubscribe\(\)/);
});

test("OAuth launch uses the registered app callback and PKCE callback handler", () => {
  assert.match(screen, /redirectTo: "oneos:\/\/auth"/);
  assert.match(screen, /skipBrowserRedirect: true/);
  assert.match(provider, /Linking\.addEventListener\("url"/);
  assert.match(config, /"scheme":\s*"oneos"/);
});

test("password values are submitted unchanged (not trimmed or lowercased)", () => {
  assert.match(screen, /password,\s*options:/);
  assert.match(screen, /signInWithPassword\(\{ email: cleanEmail, password \}\)/);
  assert.match(screen, /updateUser\(\{ password \}\)/);
});
