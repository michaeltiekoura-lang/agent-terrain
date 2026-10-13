import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let runTool, store, publishDue;

before(async () => {
  process.env.SOCIAL_AGENT_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "social-agent-"));
  delete process.env.SOCIAL_DRY_RUN;
  ({ runTool } = await import("../src/tools.js"));
  store = await import("../src/store.js");
  ({ publishDue } = await import("../src/cli.js"));
});

test("isoWeek calcule la semaine ISO", () => {
  assert.equal(store.isoWeek(new Date(2026, 9, 13)), "2026-W42");
  assert.equal(store.isoWeek(new Date(2027, 0, 1)), "2026-W53");
});

test("create_draft signale les dépassements de longueur", async () => {
  const { post, problems } = await runTool("create_draft", {
    platform: "x",
    week: "2026-W43",
    scheduled_at: "2026-10-19T09:00:00Z",
    text: "a".repeat(300),
  });
  assert.equal(post.status, "draft");
  assert.equal(problems.length, 1);
});

test("Instagram exige un visuel", async () => {
  const { problems } = await runTool("create_draft", {
    platform: "instagram",
    week: "2026-W43",
    scheduled_at: "2026-10-19T09:00:00Z",
    text: "Bonjour",
  });
  assert.match(problems[0], /visuel/);
});

test("l'agent ne peut pas publier un brouillon non approuvé", async () => {
  const { post } = await runTool("create_draft", {
    platform: "facebook",
    week: "2026-W43",
    scheduled_at: "2026-10-19T09:00:00Z",
    text: "Conseil de la semaine",
  });
  await assert.rejects(runTool("publish_post", { id: post.id }), /approuver/);
});

test("update_draft remet un post approuvé en brouillon", async () => {
  const { post } = await runTool("create_draft", {
    platform: "linkedin",
    week: "2026-W43",
    scheduled_at: "2026-10-20T08:00:00Z",
    text: "Texte",
  });
  store.updatePost(post.id, { status: "approved" });
  const { post: updated } = await runTool("update_draft", { id: post.id, text: "Nouveau texte" });
  assert.equal(updated.status, "draft");
});

test("publishDue simule la publication sans identifiants", async () => {
  const { post } = await runTool("create_draft", {
    platform: "facebook",
    week: "2026-W42",
    scheduled_at: "2026-10-01T09:00:00Z",
    text: "Post dû",
  });
  store.updatePost(post.id, { status: "approved" });
  const count = await publishDue(new Date("2026-10-13T00:00:00Z"));
  assert.ok(count >= 1);
  const after = store.getPost(post.id);
  assert.equal(after.status, "approved");
  assert.ok(after.last_simulation_at);
});

test("save_weekly_plan valide la semaine", async () => {
  await assert.rejects(runTool("save_weekly_plan", { week: "42", theme: "x", slots: [] }), /Semaine/);
  const r = await runTool("save_weekly_plan", {
    week: "2026-W43",
    theme: "Récolte du cacao",
    slots: [{ day: "lundi", platform: "facebook", idea: "Conseils de séchage" }],
  });
  assert.equal(r.slots, 1);
  const overview = await runTool("get_week_overview", { week: "2026-W43" });
  assert.equal(overview.plan.theme, "Récolte du cacao");
});
