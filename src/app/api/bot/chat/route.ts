import { NextResponse, type NextRequest } from "next/server";
import type { BotChatRequestBody } from "@/types/game";

export const maxDuration = 30;

const PROVIDER = (process.env.AI_PROVIDER || "groq").toLowerCase();
const MODEL = process.env.AI_MODEL || "llama-3.3-70b-versatile";
const API_KEY = process.env.AI_API_KEY;

const BAD_FALLBACKS: string[] = [
  "Dekhen bhai, ami to ei round e chupchap achhi. Apni ki bhabchen?",
  "Ei jhamela te amar kono hath nai, ami honestly bolchi.",
  "Ami to innocent, apni onno ke jiggesh korun.",
  "Na na, ami Chor na. Police bhai ektu bhalo kore dekhun.",
  "Tomra suggest korle ami shune nebo... trust me.",
  "Amake frame korar chesta hocche, ami kichui kori nai.",
];

const GOOD_FALLBACKS: string[] = [
  "Ami amar chit ta bolbo na, kintu ami innocent — bishwas korun.",
  "Police bhai, ami apnake help korbo. Kon dike suspicious lagche?",
  "Ei round e keu beshi chup thakle se suspicious.",
  "Ami shudhu shanti chai, kono jhamelay nai.",
  "Amar chit niye ami satisfied, ekhon shudhu dekhte chai ke ki bole.",
  "Dekhte gele onekei beshi beshi bolche, oder dike khan kheyal korun.",
];

const POLICE_FALLBACKS: string[] = [
  "Ami Police. Shobai nijer pokkhe bolun, tarpor ami siddhanto nebo.",
  "Keu keu beshi excited, keu chup. Ami shob dekhe rakhchi.",
  "Confess korle shamanno hobe, noile ami dhorbo.",
  "Ami final call nebo ekhon, tomra bolte thako.",
];

function fallbackChat(body: BotChatRequestBody): string {
  const pool =
    body.botRole === "Police"
      ? POLICE_FALLBACKS
      : ["Chor", "Dakaat", "Pocketmar", "Shinduk-Chor"].includes(
          body.botRole ?? ""
        )
        ? BAD_FALLBACKS
        : GOOD_FALLBACKS;
  return pool[Math.floor(Math.random() * pool.length)];
}

function fallbackAccuse(body: BotChatRequestBody): string[] {
  const candidates = (body.candidates ?? []).filter(
    (id) => id !== body.botId
  );
  if (candidates.length === 0) return [];
  const target = Math.min(
    Math.max(1, body.accuseCount ?? 1),
    candidates.length
  );
  const pool = [...candidates];
  const picks: string[] = [];
  while (picks.length < target && pool.length > 0) {
    const i = Math.floor(Math.random() * pool.length);
    picks.push(pool.splice(i, 1)[0]);
  }
  return picks;
}

function buildSystemPrompt(body: BotChatRequestBody): string {
  const roster = body.players
    .map((p) => {
      const tags = [p.name];
      if (p.id === body.botId) tags.push("(you)");
      if (p.isPolice) tags.push("[POLICE - public]");
      if (p.isBot) tags.push("[bot]");
      return tags.join(" ");
    })
    .join(", ");

  const transcript =
    body.recentMessages.length > 0
      ? body.recentMessages
          .map((m) => `${m.playerName}: ${m.message}`)
          .join("\n")
      : "(no messages yet)";

  const shared = `You are ${body.botName}, an AI player in the Bangladeshi social deduction game "Chor Police: The Syndicate".
Round ${body.round}. Current phase: ${body.phase}.
Roster: ${roster}
Known publicly revealed Police: ${
    body.policeId
      ? body.players.find((p) => p.id === body.policeId)?.name ?? "unknown"
      : "not revealed"
  }
Your SECRET role: ${body.botRole ?? "unknown"}.

How to play:
- Bad Chits (Chor, Dakaat, Pocketmar, Shinduk-Chor) bluff, deflect and frame others.
- Good roles (Babu, Mantri, Kotwal, Bicharpoti) defend themselves vaguely and sound helpful.
- Police probes and builds a case.
- NEVER reveal your secret role explicitly.
- Speak in natural Bangladeshi English / Banglish, colloquial and playful.

Recent chat transcript:
${transcript}`;

  if (body.action === "chat") {
    return `${shared}

Write ONE short in-character chat message (max 2 sentences). Stay in context with the transcript. Reply with the message text only, no quotes, no formatting.`;
  }

  return `${shared}

You are the Police and must accuse the Bad Chits. Candidates (player ids):
${(body.candidates ?? []).join(", ")}

Use the transcript to decide. Exactly ${Math.max(1, body.accuseCount ?? 1)} Bad Chit${(body.accuseCount ?? 1) === 1 ? "" : "s"} ${(body.accuseCount ?? 1) === 1 ? "is" : "are"} at the table. Reply with strict JSON only: {"accusedIds": ["<id>", ...]}. Name exactly ${Math.max(1, body.accuseCount ?? 1)} candidate${(body.accuseCount ?? 1) === 1 ? "" : "s"}.`;
}

async function callOpenAiCompatible(
  body: BotChatRequestBody,
  url: string,
  jsonMode: boolean
): Promise<string | null> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: buildSystemPrompt(body) },
        {
          role: "user",
          content:
            body.action === "chat"
              ? "Say your next line."
              : "Return the JSON decision now.",
        },
      ],
      temperature: body.action === "accuse" ? 0.4 : 0.9,
      max_tokens: 200,
      ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content?.trim() ?? null;
}

async function callGemini(
  body: BotChatRequestBody,
  jsonMode: boolean
): Promise<string | null> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            {
              text:
                buildSystemPrompt(body) +
                (jsonMode ? "\n\nReturn strict JSON only." : ""),
            },
          ],
        },
      ],
      generationConfig: {
        temperature: body.action === "accuse" ? 0.4 : 0.9,
        maxOutputTokens: 200,
        ...(jsonMode ? { responseMimeType: "application/json" } : {}),
      },
    }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? null;
}

async function runLlm(body: BotChatRequestBody): Promise<string | null> {
  if (!API_KEY) return null;
  const jsonMode = body.action !== "chat";
  try {
    if (PROVIDER === "gemini") return await callGemini(body, jsonMode);
    if (PROVIDER === "openai")
      return await callOpenAiCompatible(
        body,
        "https://api.openai.com/v1/chat/completions",
        jsonMode
      );
    return await callOpenAiCompatible(
      body,
      "https://api.groq.com/openai/v1/chat/completions",
      jsonMode
    );
  } catch {
    return null;
  }
}

function parseJson(raw: string | null): unknown {
  if (!raw) return null;
  const cleaned = raw
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

export async function POST(req: NextRequest) {
  let body: BotChatRequestBody;
  try {
    body = (await req.json()) as BotChatRequestBody;
  } catch {
    return NextResponse.json({ message: "..." }, { status: 400 });
  }

  const raw = await runLlm(body);
  const source: "llm" | "fallback" = raw ? "llm" : "fallback";

  if (body.action === "chat") {
    const message =
      raw && raw.length > 0 ? raw.replace(/^["']|["']$/g, "") : fallbackChat(body);
    return NextResponse.json({ message, source });
  }

  const parsed = parseJson(raw) as { accusedIds?: unknown } | null;
  const candidates = body.candidates ?? [];
  const target = Math.min(
    Math.max(1, body.accuseCount ?? 1),
    candidates.length
  );
  let accusedIds: string[] = [];
  if (parsed && Array.isArray(parsed.accusedIds)) {
    accusedIds = parsed.accusedIds
      .filter(
        (id): id is string =>
          typeof id === "string" && candidates.includes(id)
      )
      .filter((id, i, arr) => arr.indexOf(id) === i)
      .slice(0, target);
  }
  if (accusedIds.length < target) {
    const remaining = candidates.filter((id) => !accusedIds.includes(id));
    const fill = fallbackAccuse({ ...body, candidates: remaining, accuseCount: target - accusedIds.length });
    accusedIds = [...accusedIds, ...fill];
  }
  return NextResponse.json({ accusedIds, source });
}
