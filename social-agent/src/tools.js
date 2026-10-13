// Outils que l'agent peut appeler. L'approbation des posts reste une action
// humaine (commande /approuver dans la CLI) : l'agent ne peut publier qu'un post
// déjà approuvé.
import fs from "node:fs";
import path from "node:path";
import * as store from "./store.js";
import { platforms, isConfigured, isDryRun, validatePost, publish } from "./platforms/index.js";

const BRAND_FILE = process.env.SOCIAL_AGENT_BRAND || path.resolve("config/brand.json");
const PLATFORM_NAMES = Object.keys(platforms);

export function loadBrand() {
  return JSON.parse(fs.readFileSync(BRAND_FILE, "utf8"));
}

const EDITABLE = ["text", "hashtags", "media_brief", "media_url", "scheduled_at", "pillar", "notes"];

export const toolDefinitions = [
  {
    name: "get_brand_profile",
    description:
      "Renvoie le profil de la marque : ton, audiences, piliers de contenu, interdits, hashtags et comptes sociaux actifs avec leur fréquence de publication hebdomadaire.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_accounts_status",
    description:
      "Indique pour chaque réseau social s'il est activé, connecté (identifiants présents) ou en publication manuelle, et si le mode simulation est actif.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_week_overview",
    description:
      "Renvoie le plan éditorial et tous les posts d'une semaine ISO (ex. 2026-W42). Utiliser avant de planifier pour éviter les doublons.",
    input_schema: {
      type: "object",
      properties: { week: { type: "string", description: "Semaine ISO, format AAAA-Www" } },
      required: ["week"],
      additionalProperties: false,
    },
  },
  {
    name: "save_weekly_plan",
    description:
      "Enregistre (ou remplace) le plan éditorial d'une semaine : thème, objectifs et liste des créneaux par réseau. Les posts eux-mêmes se créent ensuite avec create_draft.",
    input_schema: {
      type: "object",
      properties: {
        week: { type: "string", description: "Semaine ISO, format AAAA-Www" },
        theme: { type: "string" },
        objectives: { type: "array", items: { type: "string" } },
        slots: {
          type: "array",
          items: {
            type: "object",
            properties: {
              day: { type: "string", description: "Jour (lundi…dimanche)" },
              platform: { type: "string", enum: PLATFORM_NAMES },
              pillar: { type: "string" },
              idea: { type: "string" },
            },
            required: ["day", "platform", "idea"],
            additionalProperties: false,
          },
        },
      },
      required: ["week", "theme", "slots"],
      additionalProperties: false,
    },
  },
  {
    name: "create_draft",
    description:
      "Crée un brouillon de post pour un réseau, adapté à son format. Le texte est vérifié contre les limites de la plateforme ; en cas de problème le brouillon est quand même créé et les problèmes sont signalés pour correction avec update_draft.",
    input_schema: {
      type: "object",
      properties: {
        platform: { type: "string", enum: PLATFORM_NAMES },
        week: { type: "string", description: "Semaine ISO, format AAAA-Www" },
        scheduled_at: {
          type: "string",
          description: "Date et heure de publication ISO 8601 avec fuseau, ex. 2026-10-20T09:00:00Z",
        },
        text: { type: "string", description: "Texte du post, sans les hashtags" },
        hashtags: { type: "array", items: { type: "string" } },
        pillar: { type: "string" },
        media_brief: {
          type: "string",
          description: "Description du visuel ou script vidéo à produire",
        },
        media_url: { type: "string", description: "URL publique d'une image déjà prête" },
      },
      required: ["platform", "week", "scheduled_at", "text"],
      additionalProperties: false,
    },
  },
  {
    name: "update_draft",
    description:
      "Modifie un post en brouillon ou rejeté (texte, hashtags, visuel, date…). Un post modifié repasse en brouillon et doit être réapprouvé.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string" },
        text: { type: "string" },
        hashtags: { type: "array", items: { type: "string" } },
        media_brief: { type: "string" },
        media_url: { type: "string" },
        scheduled_at: { type: "string" },
        pillar: { type: "string" },
        notes: { type: "string" },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "list_posts",
    description: "Liste les posts, filtrables par statut, semaine et réseau.",
    input_schema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["draft", "approved", "published", "failed", "rejected"],
        },
        week: { type: "string" },
        platform: { type: "string", enum: PLATFORM_NAMES },
      },
      additionalProperties: false,
    },
  },
  {
    name: "publish_post",
    description:
      "Publie immédiatement un post déjà approuvé par l'utilisateur. Refusé si le post n'est pas au statut approved.",
    input_schema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    },
  },
];

function requireString(input, key) {
  if (typeof input[key] !== "string" || !input[key].trim()) {
    throw new Error(`Paramètre « ${key} » manquant ou vide.`);
  }
}

function checkWeek(week) {
  if (!/^\d{4}-W\d{2}$/.test(week)) throw new Error(`Semaine invalide : ${week} (format AAAA-Www).`);
}

function checkDate(value) {
  if (Number.isNaN(Date.parse(value))) throw new Error(`Date invalide : ${value}`);
}

// Publie un post approuvé et enregistre le résultat.
export async function publishAndRecord(post) {
  const result = await publish(post);
  if (result.ok && !result.simulated) {
    store.updatePost(post.id, {
      status: "published",
      published_at: new Date().toISOString(),
      remote_id: result.remote_id,
      remote_url: result.url,
    });
  } else if (result.ok) {
    store.updatePost(post.id, { last_simulation_at: new Date().toISOString() });
  } else if (!result.manual) {
    store.updatePost(post.id, { status: "failed", error: result.error });
  }
  return result;
}

const handlers = {
  get_brand_profile: () => loadBrand(),

  get_accounts_status: () => {
    const brand = loadBrand();
    return {
      dry_run: isDryRun(),
      accounts: PLATFORM_NAMES.map((name) => ({
        platform: name,
        label: platforms[name].label,
        enabled: Boolean(brand.accounts?.[name]?.enabled),
        posts_per_week: brand.accounts?.[name]?.posts_per_week ?? 0,
        connected: isConfigured(name),
        manual: Boolean(platforms[name].manual),
      })),
    };
  },

  get_week_overview: ({ week }) => {
    checkWeek(week);
    return { week, plan: store.getPlan(week), posts: store.listPosts({ week }) };
  },

  save_weekly_plan: (input) => {
    checkWeek(input.week);
    requireString(input, "theme");
    if (!Array.isArray(input.slots) || input.slots.length === 0) {
      throw new Error("Le plan doit contenir au moins un créneau.");
    }
    store.savePlan(input);
    return { saved: true, week: input.week, slots: input.slots.length };
  },

  create_draft: (input) => {
    requireString(input, "text");
    checkWeek(input.week);
    checkDate(input.scheduled_at);
    if (!platforms[input.platform]) throw new Error(`Plateforme inconnue : ${input.platform}`);
    const fields = { platform: input.platform, week: input.week };
    for (const key of EDITABLE) if (input[key] !== undefined) fields[key] = input[key];
    const post = store.createPost(fields);
    return { post, problems: validatePost(post) };
  },

  update_draft: (input) => {
    requireString(input, "id");
    const post = store.getPost(input.id);
    if (!post) throw new Error(`Post introuvable : ${input.id}`);
    if (!["draft", "rejected", "approved", "failed"].includes(post.status)) {
      throw new Error(`Impossible de modifier un post au statut ${post.status}.`);
    }
    if (input.scheduled_at) checkDate(input.scheduled_at);
    const changes = { status: "draft" };
    for (const key of EDITABLE) if (input[key] !== undefined) changes[key] = input[key];
    const updated = store.updatePost(input.id, changes);
    return { post: updated, problems: validatePost(updated) };
  },

  list_posts: (input) => store.listPosts(input),

  publish_post: async ({ id }) => {
    const post = store.getPost(id);
    if (!post) throw new Error(`Post introuvable : ${id}`);
    if (post.status !== "approved") {
      throw new Error(
        `Le post ${id} est au statut ${post.status}. Seul l'utilisateur peut l'approuver (/approuver ${id}).`,
      );
    }
    return publishAndRecord(post);
  },
};

export async function runTool(name, input) {
  const handler = handlers[name];
  if (!handler) throw new Error(`Outil inconnu : ${name}`);
  return handler(input ?? {});
}
