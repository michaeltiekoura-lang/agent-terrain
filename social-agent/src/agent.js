// Boucle de l'agent : Claude + outils de gestion des réseaux sociaux.
import Anthropic from "@anthropic-ai/sdk";
import { toolDefinitions, runTool } from "./tools.js";
import { logRequest, isoWeek } from "./store.js";

const MODEL = process.env.SOCIAL_AGENT_MODEL || "claude-opus-5-5";
const MAX_TURNS = 40;

const SYSTEM_PROMPT = `Tu es le responsable des réseaux sociaux de la marque décrite par l'outil get_brand_profile. Tu traites les requêtes de l'utilisateur (idées, rédaction, corrections, planification, publication, questions sur les comptes) et tu gères le calendrier éditorial.

Principes :
- Commence par consulter get_brand_profile et, si la requête touche au calendrier, get_week_overview pour la semaine concernée. Respecte strictement le ton, les piliers et la liste "do_not" de la marque.
- Adapte chaque post à son réseau : Facebook (communautaire, 1 à 3 paragraphes), Instagram (accroche forte, visuel obligatoire via media_brief, hashtags pertinents), LinkedIn (professionnel, apprentissage ou chiffre clé, 3 hashtags maximum), X (280 caractères tout compris), TikTok (script vidéo court dans media_brief + légende).
- Ne publie que sur les comptes activés (enabled) et respecte leur nombre de posts par semaine.
- N'invente jamais de chiffres, de prix, de citations ou de témoignages. Si une information factuelle manque, écris un emplacement clair comme [CHIFFRE À CONFIRMER] et signale-le.
- Tu peux utiliser la recherche web pour les dates clés, saisons et tendances du moment ; cite tes sources dans ta réponse.
- Tu crées des brouillons. L'approbation est une décision de l'utilisateur : ne prétends jamais qu'un post est approuvé ou publié s'il ne l'est pas. Tu ne peux publier qu'un post déjà approuvé, et seulement si l'utilisateur le demande.
- Si un outil signale des problèmes (longueur, visuel manquant), corrige le brouillon avec update_draft.

Planification hebdomadaire (quand on te demande le contenu d'une semaine) :
1. Vérifie l'existant de la semaine, puis choisis un thème et 2 à 3 objectifs.
2. Répartis les créneaux sur la semaine en variant les piliers et les jours, aux heures où l'audience est active (fuseau de la marque).
3. Enregistre le plan avec save_weekly_plan, puis crée un brouillon par créneau avec create_draft.
4. Termine par un récapitulatif sous forme de tableau (jour, réseau, sujet, identifiant) et la liste des points à confirmer.

Réponds en français, de façon concise et concrète.`;

const client = new Anthropic();

const tools = [
  ...toolDefinitions,
  { type: "web_search_20260209", name: "web_search", max_uses: 5 },
];

export class SocialAgent {
  constructor({ onText = () => {}, onTool = () => {} } = {}) {
    this.messages = [];
    this.onText = onText;
    this.onTool = onTool;
  }

  async ask(userText) {
    const today = new Date();
    const context = `[Date : ${today.toISOString().slice(0, 10)} — semaine en cours ${isoWeek(today)}]`;
    this.messages.push({ role: "user", content: `${context}\n${userText}` });
    logRequest({ type: "user", text: userText });

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const response = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        thinking: { type: "adaptive" },
        output_config: { effort: "high" },
        cache_control: { type: "ephemeral" },
        system: SYSTEM_PROMPT,
        tools,
        messages: this.messages,
      });

      this.messages.push({ role: "assistant", content: response.content });

      for (const block of response.content) {
        if (block.type === "text" && block.text) this.onText(block.text);
      }

      if (response.stop_reason === "refusal") {
        const msg = "La demande a été refusée par le modèle. Reformulez-la.";
        this.onText(msg);
        return msg;
      }
      // Recherche web interrompue côté serveur : on renvoie tel quel pour reprendre.
      if (response.stop_reason === "pause_turn") continue;

      const toolUses = response.content.filter((b) => b.type === "tool_use");
      if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
        const text = response.content
          .filter((b) => b.type === "text")
          .map((b) => b.text)
          .join("\n");
        logRequest({ type: "assistant", text, stop_reason: response.stop_reason });
        return text;
      }

      const results = [];
      for (const use of toolUses) {
        this.onTool(use.name, use.input);
        try {
          const output = await runTool(use.name, use.input);
          results.push({
            type: "tool_result",
            tool_use_id: use.id,
            content: JSON.stringify(output ?? null),
          });
        } catch (err) {
          results.push({
            type: "tool_result",
            tool_use_id: use.id,
            content: `Erreur : ${err.message}`,
            is_error: true,
          });
        }
      }
      this.messages.push({ role: "user", content: results });
    }
    const msg = "Nombre maximal d'étapes atteint ; la tâche est peut-être incomplète.";
    this.onText(msg);
    return msg;
  }
}
