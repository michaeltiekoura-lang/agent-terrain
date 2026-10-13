#!/usr/bin/env node
// Interface en ligne de commande.
//   npm run chat                 conversation avec l'agent
//   npm run plan [-- 2026-W43]   génère le contenu d'une semaine (par défaut la suivante)
//   npm run publish-due          publie les posts approuvés dont l'heure est passée (pour cron)
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import * as store from "./store.js";
import { publishAndRecord } from "./tools.js";
import { isDryRun } from "./platforms/index.js";

const HELP = `Commandes (réservées à vous, l'agent ne peut pas les exécuter) :
  /posts [statut] [semaine]   liste les posts (statuts : draft, approved, published, failed, rejected)
  /voir <id>                  affiche un post en entier
  /approuver <id> [<id>…]     approuve un ou plusieurs brouillons
  /approuver-semaine <sem>    approuve tous les brouillons d'une semaine
  /rejeter <id> [motif]       rejette un brouillon (demandez ensuite à l'agent de le retravailler)
  /publier-dus                publie les posts approuvés dont l'heure est passée
  /aide                       cette aide
  /quitter                    quitter
Tout autre texte est envoyé à l'agent.`;

function formatPost(p, full = false) {
  const when = p.scheduled_at ? new Date(p.scheduled_at).toLocaleString("fr-FR") : "-";
  const head = `[${p.id}] ${p.status.padEnd(9)} ${p.platform.padEnd(9)} ${when}`;
  if (!full) return `${head}  ${p.text.replace(/\s+/g, " ").slice(0, 70)}…`;
  return [
    head,
    "",
    p.text,
    p.hashtags?.length ? `\n${p.hashtags.join(" ")}` : "",
    p.media_brief ? `\nVisuel : ${p.media_brief}` : "",
    p.media_url ? `Image : ${p.media_url}` : "",
    p.error ? `\nErreur : ${p.error}` : "",
    p.rejection_reason ? `\nMotif du rejet : ${p.rejection_reason}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function approve(ids) {
  for (const id of ids) {
    const post = store.getPost(id);
    if (!post) console.log(`  ${id} : introuvable`);
    else if (post.status !== "draft") console.log(`  ${id} : statut ${post.status}, ignoré`);
    else {
      store.updatePost(id, { status: "approved", approved_at: new Date().toISOString() });
      console.log(`  ${id} : approuvé`);
    }
  }
}

export async function publishDue(now = new Date()) {
  const due = store
    .listPosts({ status: "approved" })
    .filter((p) => p.scheduled_at && Date.parse(p.scheduled_at) <= now.getTime());
  if (due.length === 0) console.log("Aucun post à publier.");
  for (const post of due) {
    const r = await publishAndRecord(post);
    const outcome = r.simulated
      ? "simulé (mode test ou compte non connecté)"
      : r.ok
        ? `publié ${r.url || r.remote_id || ""}`
        : `échec : ${r.error}`;
    console.log(`  [${post.id}] ${post.platform} : ${outcome}`);
  }
  return due.length;
}

async function handleCommand(line) {
  const [cmd, ...args] = line.trim().split(/\s+/);
  switch (cmd) {
    case "/posts": {
      const status = args.find((a) => !/^\d{4}-W\d{2}$/.test(a));
      const week = args.find((a) => /^\d{4}-W\d{2}$/.test(a));
      const posts = store.listPosts({ status, week });
      console.log(posts.length ? posts.map((p) => formatPost(p)).join("\n") : "Aucun post.");
      break;
    }
    case "/voir": {
      const post = store.getPost(args[0]);
      console.log(post ? formatPost(post, true) : "Post introuvable.");
      break;
    }
    case "/approuver":
      approve(args);
      break;
    case "/approuver-semaine":
      approve(store.listPosts({ week: args[0], status: "draft" }).map((p) => p.id));
      break;
    case "/rejeter": {
      const [id, ...reason] = args;
      const post = store.getPost(id);
      if (!post) console.log("Post introuvable.");
      else {
        store.updatePost(id, { status: "rejected", rejection_reason: reason.join(" ") || undefined });
        console.log(`  ${id} : rejeté`);
      }
      break;
    }
    case "/publier-dus":
      await publishDue();
      break;
    case "/aide":
      console.log(HELP);
      break;
    default:
      console.log(`Commande inconnue. ${HELP}`);
  }
}

function makeAgent(SocialAgent) {
  return new SocialAgent({
    onText: (t) => console.log(`\n${t}\n`),
    onTool: (name) => console.log(`  · ${name}`),
  });
}

async function chat(SocialAgent) {
  const agent = makeAgent(SocialAgent);
  const rl = readline.createInterface({ input: stdin, output: stdout });
  console.log(`Agent réseaux sociaux${isDryRun() ? " (mode simulation : rien n'est publié)" : ""}.`);
  console.log("Tapez /aide pour les commandes.\n");
  while (true) {
    let line;
    try {
      line = (await rl.question("vous › ")).trim();
    } catch {
      break; // entrée fermée
    }
    if (!line) continue;
    if (line === "/quitter") break;
    try {
      if (line.startsWith("/")) await handleCommand(line);
      else await agent.ask(line);
    } catch (err) {
      console.error(`Erreur : ${err.message}`);
    }
  }
  rl.close();
}

async function main() {
  const [mode = "chat", arg] = process.argv.slice(2);
  if (mode === "publish-due") {
    await publishDue();
    return;
  }
  // Import tardif : publish-due fonctionne sans clé API.
  const { SocialAgent } = await import("./agent.js");
  if (mode === "plan") {
    const week = arg || store.nextIsoWeek();
    await makeAgent(SocialAgent).ask(
      `Prépare le contenu complet de la semaine ${week} pour tous les comptes activés : plan, puis un brouillon par créneau.`,
    );
    console.log(`Relisez avec /posts draft ${week}, puis approuvez avec /approuver-semaine ${week} (npm run chat).`);
    return;
  }
  await chat(SocialAgent);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
