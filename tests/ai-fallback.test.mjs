// Integration tests for the AI service: automatic fallback, invalid-key stop, manual pinning,
// capability checks, encrypted key storage and per-provider usage.
// Runs in a temporary folder with fake OpenAI-compatible providers: no real keys, no quota used,
// and your data/ folder is never touched.
import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let server, base, tmp, registry, service, usage;

// Fake provider: /ok answers with JSON, /429 is rate limited, /401 rejects the key, /500 is down.
function startMock() {
  return new Promise((resolve) => {
    server = http.createServer((req, res) => {
      const mode = req.url.split("/")[1];
      const send = (code, body) => {
        res.writeHead(code, { "content-type": "application/json", "x-ratelimit-remaining-requests": "42" });
        res.end(JSON.stringify(body));
      };
      if (mode === "ok") {
        return send(200, {
          id: "x", object: "chat.completion", created: 0, model: "mock",
          choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: '{"ok": true}' } }],
          usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
        });
      }
      if (mode === "401") return send(401, { error: { message: "Incorrect API key", type: "invalid_request_error", code: "invalid_api_key" } });
      if (mode === "500") return send(500, { error: { message: "Server error", type: "server_error" } });
      return send(429, { error: { message: "Rate limit reached", type: "rate_limit_error", code: "rate_limit_exceeded" } });
    });
    server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`));
  });
}

before(async () => {
  base = await startMock();
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pgp-test-"));
  process.chdir(tmp); // data/ is resolved from the working directory
  delete process.env.DATABASE_URL;
  delete process.env.GEMINI_API_KEY;
  process.env.APP_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
  registry = await import(path.join(root, "lib/ai/registry.js"));
  service = await import(path.join(root, "lib/ai/service.js"));
  usage = await import(path.join(root, "lib/usage.js"));
});

after(async () => {
  server?.close();
  process.chdir(root);
  await fs.rm(tmp, { recursive: true, force: true });
});

beforeEach(async () => {
  for (const p of await registry.getProviders()) await registry.removeProvider(p.id);
});

const add = (name, mode) =>
  registry.addProvider({ type: "compatible", name, apiKey: `test-key-${name}`, model: "mock", baseUrl: `${base}/${mode}/v1` });
const ask = (extra = {}) =>
  service.runAI({ kind: "test", parts: [{ text: "hi" }], schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] }, ...extra });

test("rate limit on the first provider switches to the next and says so", async () => {
  await add("Busy", "429");
  await add("Healthy", "ok");
  const out = await ask();
  assert.deepEqual(out.data, { ok: true });
  assert.equal(out.provider.name, "Healthy");
  assert.match(out.notice, /Busy hit its rate limit, so Healthy answered instead/);
});

test("server error also falls through to the next provider", async () => {
  await add("Down", "500");
  await add("Healthy", "ok");
  assert.equal((await ask()).provider.name, "Healthy");
});

test("an invalid key stops the request instead of switching silently", async () => {
  await add("BadKey", "401");
  await add("Healthy", "ok");
  await assert.rejects(ask(), (err) => {
    assert.equal(err.code, "auth");
    assert.match(err.message, /BadKey rejected its API key/);
    assert.ok(!err.attempts.some((a) => a.provider === "Healthy"), "must not try the next provider");
    return true;
  });
});

test("pinning a provider (manual switch) skips the others", async () => {
  await add("BadKey", "401");
  const ok = await add("Healthy", "ok");
  const out = await ask({ providerId: ok.id });
  assert.equal(out.provider.name, "Healthy");
});

test("when every provider is unavailable the error lists each one", async () => {
  await add("A", "429");
  await add("B", "500");
  await assert.rejects(ask(), (err) => {
    assert.equal(err.code, "exhausted");
    assert.match(err.message, /A .*rate limit/);
    assert.match(err.message, /B .*busy/);
    return true;
  });
});

test("providers that can't read PDFs are skipped for PDF requests", async () => {
  await add("TextOnly", "ok");
  await assert.rejects(ask({ needs: { pdf: true } }), (err) => err.code === "none" && /can't read PDFs/.test(err.message));
});

test("disabled providers are not used", async () => {
  const off = await add("Off", "ok");
  await registry.updateProvider(off.id, { enabled: false });
  await add("On", "ok");
  assert.equal((await ask()).provider.name, "On");
});

test("priority order can be changed (make default)", async () => {
  await add("First", "ok");
  const second = await add("Second", "ok");
  await registry.updateProvider(second.id, { move: "top" });
  assert.equal((await ask()).provider.name, "Second");
});

test("API keys are stored encrypted and never in the public view", async () => {
  const p = await add("Secret", "ok");
  const file = await fs.readFile(path.join(tmp, "data", "providers.json"), "utf8");
  assert.ok(!file.includes("test-key-Secret"), "plain key must not be on disk");
  assert.equal(await registry.resolveKey((await registry.getProviders()).find((x) => x.id === p.id)), "test-key-Secret");
  const view = registry.publicView(p);
  assert.ok(!("keyEnc" in view) && !JSON.stringify(view).includes("test-key"));
  assert.equal(view.keyHint, "…cret");
});

test("usage and errors are tracked per provider", async () => {
  const busy = await add("Busy", "429");
  const ok = await add("Healthy", "ok");
  await ask();
  await new Promise((r) => setTimeout(r, 50)); // usage writes are queued
  const u = await usage.getUsageSummary(await registry.getProviders());
  assert.equal(u.byProvider[busy.id].today.failed, 1);
  assert.equal(u.byProvider[busy.id].today.errors.rate, 1);
  assert.equal(u.byProvider[ok.id].today.successful, 1);
  assert.equal(u.byProvider[ok.id].today.total, 8);
});

test("daily limit alerts fire at the warning threshold", async () => {
  const p = await add("Limited", "ok");
  await registry.updateProvider(p.id, { dailyLimit: 2, warnAt: 50 });
  await ask();
  await new Promise((r) => setTimeout(r, 50));
  const u = await usage.getUsageSummary(await registry.getProviders());
  assert.ok(u.alerts.some((a) => a.providerId === p.id));
});
