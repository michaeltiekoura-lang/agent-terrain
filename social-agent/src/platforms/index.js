// Connecteurs vers les réseaux sociaux. Chaque connecteur lit ses identifiants
// dans les variables d'environnement. Sans identifiants, ou si SOCIAL_DRY_RUN
// n'est pas "false", la publication est simulée et rien n'est envoyé.

const GRAPH = "https://graph.facebook.com/v21.0";

async function postJson(url, body, headers = {}) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} : ${text.slice(0, 500)}`);
  }
  return { data, headers: res.headers };
}

function fullText(post) {
  const tags = (post.hashtags || []).join(" ");
  return tags ? `${post.text}\n\n${tags}` : post.text;
}

export const platforms = {
  facebook: {
    label: "Facebook (Page)",
    env: ["FACEBOOK_PAGE_ID", "FACEBOOK_PAGE_TOKEN"],
    limits: { maxChars: 63206 },
    async publish(post) {
      const { FACEBOOK_PAGE_ID: pageId, FACEBOOK_PAGE_TOKEN: token } = process.env;
      if (post.media_url) {
        const { data } = await postJson(`${GRAPH}/${pageId}/photos`, {
          url: post.media_url,
          caption: fullText(post),
          access_token: token,
        });
        return { remote_id: data.post_id || data.id };
      }
      const { data } = await postJson(`${GRAPH}/${pageId}/feed`, {
        message: fullText(post),
        access_token: token,
      });
      return { remote_id: data.id, url: `https://facebook.com/${data.id}` };
    },
  },

  instagram: {
    label: "Instagram (compte professionnel)",
    env: ["INSTAGRAM_USER_ID", "INSTAGRAM_TOKEN"],
    limits: { maxChars: 2200, maxHashtags: 30, requiresMedia: true },
    async publish(post) {
      const { INSTAGRAM_USER_ID: igId, INSTAGRAM_TOKEN: token } = process.env;
      if (!post.media_url) throw new Error("Instagram exige une image (media_url).");
      const { data: container } = await postJson(`${GRAPH}/${igId}/media`, {
        image_url: post.media_url,
        caption: fullText(post),
        access_token: token,
      });
      const { data } = await postJson(`${GRAPH}/${igId}/media_publish`, {
        creation_id: container.id,
        access_token: token,
      });
      return { remote_id: data.id };
    },
  },

  linkedin: {
    label: "LinkedIn (page entreprise)",
    env: ["LINKEDIN_AUTHOR_URN", "LINKEDIN_TOKEN"],
    limits: { maxChars: 3000 },
    async publish(post) {
      const { LINKEDIN_AUTHOR_URN: author, LINKEDIN_TOKEN: token } = process.env;
      const { headers } = await postJson(
        "https://api.linkedin.com/rest/posts",
        {
          author,
          commentary: fullText(post),
          visibility: "PUBLIC",
          distribution: {
            feedDistribution: "MAIN_FEED",
            targetEntities: [],
            thirdPartyDistributionChannels: [],
          },
          lifecycleState: "PUBLISHED",
          isReshareDisabledByAuthor: false,
        },
        {
          Authorization: `Bearer ${token}`,
          "LinkedIn-Version": process.env.LINKEDIN_VERSION || "202409",
          "X-Restli-Protocol-Version": "2.0.0",
        },
      );
      return { remote_id: headers.get("x-restli-id") };
    },
  },

  x: {
    label: "X (Twitter)",
    env: ["X_USER_ACCESS_TOKEN"],
    limits: { maxChars: 280 },
    async publish(post) {
      const { data } = await postJson(
        "https://api.x.com/2/tweets",
        { text: fullText(post) },
        { Authorization: `Bearer ${process.env.X_USER_ACCESS_TOKEN}` },
      );
      return { remote_id: data.data?.id, url: `https://x.com/i/status/${data.data?.id}` };
    },
  },

  tiktok: {
    label: "TikTok",
    env: [],
    limits: { maxChars: 2200, requiresMedia: true },
    manual: true,
    async publish() {
      throw new Error(
        "TikTok exige l'envoi d'une vidéo via l'app : publication manuelle (script et légende fournis).",
      );
    },
  },
};

export function isConfigured(name) {
  const p = platforms[name];
  return Boolean(p && !p.manual && p.env.every((key) => process.env[key]));
}

export function isDryRun() {
  return process.env.SOCIAL_DRY_RUN !== "false";
}

// Vérifie un brouillon contre les contraintes de la plateforme.
export function validatePost(post) {
  const p = platforms[post.platform];
  if (!p) return [`Plateforme inconnue : ${post.platform}`];
  const problems = [];
  const length = fullText(post).length;
  if (length > p.limits.maxChars) {
    problems.push(`${length} caractères (maximum ${p.limits.maxChars} sur ${p.label}).`);
  }
  if (p.limits.maxHashtags && (post.hashtags || []).length > p.limits.maxHashtags) {
    problems.push(`Trop de hashtags (maximum ${p.limits.maxHashtags}).`);
  }
  if (p.limits.requiresMedia && !post.media_url && !post.media_brief) {
    problems.push(`${p.label} exige un visuel : fournir media_url ou media_brief.`);
  }
  return problems;
}

// Publie (ou simule) un post. Ne modifie pas le stockage.
export async function publish(post) {
  const p = platforms[post.platform];
  if (!p) return { ok: false, error: `Plateforme inconnue : ${post.platform}` };
  if (p.manual) return { ok: false, manual: true, error: "Publication manuelle requise." };
  if (isDryRun() || !isConfigured(post.platform)) {
    return { ok: true, simulated: true };
  }
  try {
    return { ok: true, ...(await p.publish(post)) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
