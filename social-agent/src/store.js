// Stockage local en JSON : publications, plans hebdomadaires et journal des requêtes.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const DATA_DIR = process.env.SOCIAL_AGENT_DATA_DIR || path.resolve("data");
const DB_FILE = path.join(DATA_DIR, "db.json");

const STATUSES = ["draft", "approved", "scheduled", "published", "failed", "rejected"];

function load() {
  if (!fs.existsSync(DB_FILE)) return { posts: [], plans: [], requests: [] };
  return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
}

function save(db) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

export function listPosts({ status, week, platform } = {}) {
  return load().posts.filter(
    (p) =>
      (!status || p.status === status) &&
      (!week || p.week === week) &&
      (!platform || p.platform === platform),
  );
}

export function getPost(id) {
  return load().posts.find((p) => p.id === id) || null;
}

export function createPost(fields) {
  const db = load();
  const post = {
    id: crypto.randomUUID().slice(0, 8),
    status: "draft",
    created_at: new Date().toISOString(),
    ...fields,
  };
  db.posts.push(post);
  save(db);
  return post;
}

export function updatePost(id, changes) {
  const db = load();
  const post = db.posts.find((p) => p.id === id);
  if (!post) return null;
  if (changes.status && !STATUSES.includes(changes.status)) {
    throw new Error(`Statut inconnu : ${changes.status}`);
  }
  Object.assign(post, changes, { updated_at: new Date().toISOString() });
  save(db);
  return post;
}

export function savePlan(plan) {
  const db = load();
  db.plans = db.plans.filter((p) => p.week !== plan.week);
  db.plans.push({ ...plan, saved_at: new Date().toISOString() });
  save(db);
  return plan;
}

export function getPlan(week) {
  return load().plans.find((p) => p.week === week) || null;
}

export function logRequest(entry) {
  const db = load();
  db.requests.push({ at: new Date().toISOString(), ...entry });
  db.requests = db.requests.slice(-500);
  save(db);
}

// Semaine ISO au format "2026-W42".
export function isoWeek(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function nextIsoWeek(date = new Date()) {
  return isoWeek(new Date(date.getTime() + 7 * 86400000));
}
