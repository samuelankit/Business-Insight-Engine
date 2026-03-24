import { Router } from "express";
import { db } from "@workspace/db";
import {
  voicePreferencesTable,
  voiceCallsTable,
  voiceSessionsTable,
  telnyxConfigsTable,
  agentsTable,
  conversationsTable,
} from "@workspace/db/schema";
import { eq, and, desc, lt } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";
import { generateToken } from "../lib/crypto.js";
import { checkWalletAndDebit, getOrCreateWallet, creditWallet } from "../lib/usage.js";
import { createHash, timingSafeEqual } from "crypto";
import { openai as replitOpenAI } from "@workspace/integrations-openai-ai-server";
import { preprocessAudio, validateAudioBuffer } from "../lib/audioPreprocess.js";

const router = Router();

const VOICE_SESSION_TTL_MS = 5 * 60 * 1000;
const HIGH_RISK_CONFIRM_TTL_MS = 60 * 1000;
const FREE_VOICE_CREDITS_PENCE = 400;

const highRiskConfirmTokens = new Map<string, { userId: string; expiresAt: number }>();

function issueHighRiskToken(userId: string): string {
  const token = generateToken(24);
  highRiskConfirmTokens.set(token, { userId, expiresAt: Date.now() + HIGH_RISK_CONFIRM_TTL_MS });
  return token;
}

function validateHighRiskToken(token: string, userId: string): boolean {
  const entry = highRiskConfirmTokens.get(token);
  if (!entry) return false;
  if (entry.userId !== userId || entry.expiresAt < Date.now()) {
    highRiskConfirmTokens.delete(token);
    return false;
  }
  highRiskConfirmTokens.delete(token);
  return true;
}

const ttsPlaybackTokens = new Map<string, { userId: string; expiresAt: number }>();

function issueTtsPlaybackToken(userId: string): string {
  const token = generateToken(16);
  ttsPlaybackTokens.set(token, { userId, expiresAt: Date.now() + 120_000 });
  return token;
}

function validateTtsPlaybackToken(token: string, userId: string): boolean {
  const entry = ttsPlaybackTokens.get(token);
  if (!entry) return false;
  if (entry.userId !== userId || entry.expiresAt < Date.now()) {
    ttsPlaybackTokens.delete(token);
    return false;
  }
  ttsPlaybackTokens.delete(token);
  return true;
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of highRiskConfirmTokens) {
    if (v.expiresAt < now) highRiskConfirmTokens.delete(k);
  }
  for (const [k, v] of ttsPlaybackTokens) {
    if (v.expiresAt < now) ttsPlaybackTokens.delete(k);
  }
}, 60_000);

const RIGO_SYSTEM_PROMPT = `You are Rigo, the GoRigo AI voice assistant for UK businesses. You are warm, professional, and helpful. Keep responses concise and conversational since they will be spoken aloud — aim for 1-3 sentences maximum. Use British English spelling and phrasing. Never use markdown formatting like ** or ## or bullet points — plain spoken prose only. Never say your own name at the start of a response.`;

const AGENT_KEYWORDS: Record<string, string[]> = {
  finance: ["payment", "invoice", "stripe", "money", "revenue", "expense", "profit", "loss", "tax", "vat", "bank", "account", "financial", "budget", "cost", "price", "pay"],
  marketing: ["social media", "campaign", "email", "marketing", "brand", "customer", "audience", "instagram", "facebook", "twitter", "content", "post", "promotion", "advert"],
  operations: ["schedule", "task", "process", "workflow", "staff", "team", "employee", "operation", "system", "automate", "manage", "organise"],
  sales: ["sale", "lead", "prospect", "crm", "deal", "pipeline", "contact", "client", "quotation", "proposal", "convert"],
};

const HIGH_RISK_PATTERNS = [
  /\bsend\s+(invoice|email|message)\b/i,
  /\bdelete\b/i,
  /\bapprove\b/i,
  /\bcancel\s+(subscription|order|deal)\b/i,
  /\btransfer\s+(money|funds|payment)\b/i,
  /\bpay\s+(invoice|bill|supplier)\b/i,
  /\bfire\b|\bdismiss\b|\bterminate\s+employee\b/i,
];

function isHighRiskRequest(transcript: string): boolean {
  return HIGH_RISK_PATTERNS.some((p) => p.test(transcript));
}

const LOCALE_VOICE_MAP: Record<string, string> = {
  "en-GB": "shimmer",
  "en-US": "nova",
  "en-NG": "shimmer",
  "en-IN": "shimmer",
  "cy": "shimmer",
  "fr": "shimmer",
  "ar": "shimmer",
  "es": "alloy",
  "de": "alloy",
  "zh": "shimmer",
};

function getVoiceForLocale(outputLocale: string, preferredVoiceName?: string | null): string {
  if (preferredVoiceName) return preferredVoiceName;
  const langCode = outputLocale.split("-")[0] ?? "en";
  return LOCALE_VOICE_MAP[outputLocale] ?? LOCALE_VOICE_MAP[langCode] ?? "shimmer";
}

function getTtsInstructions(outputLocale: string): string | undefined {
  const localeInstructions: Record<string, string> = {
    "en-GB": "Speak with a natural British English accent.",
    "en-US": "Speak with a natural American English accent.",
    "en-NG": "Speak with a clear Nigerian English accent.",
    "en-IN": "Speak with a clear Indian English accent.",
    "cy": "Speak in Welsh with a natural Welsh accent and intonation.",
    "fr": "Speak in French with a natural Parisian accent.",
    "ar": "Speak in Modern Standard Arabic with clear pronunciation.",
    "es": "Speak in Spanish with a clear Castilian accent.",
    "de": "Speak in German with clear standard German pronunciation.",
    "zh": "Speak in Mandarin Chinese with clear standard pronunciation.",
  };
  const langCode = outputLocale.split("-")[0] ?? "en";
  return localeInstructions[outputLocale] ?? localeInstructions[langCode];
}

function hashPin(pin: string): string {
  return createHash("sha256").update(`gorigo-voice-pin:${pin}`).digest("hex");
}

function safeCompareHash(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function sendSSE(res: import("express").Response, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

async function selectBestAgent(businessId: string, userId: string, transcript: string): Promise<typeof agentsTable.$inferSelect | null> {
  try {
    const agents = await db
      .select()
      .from(agentsTable)
      .where(and(eq(agentsTable.businessId, businessId), eq(agentsTable.isActive, true), eq(agentsTable.userId, userId)));

    if (!agents.length) return null;

    const lower = transcript.toLowerCase();
    let bestAgent: typeof agentsTable.$inferSelect | null = null;
    let bestScore = 0;

    for (const agent of agents) {
      let score = 0;
      const agentName = agent.name.toLowerCase();
      const agentType = agent.type.toLowerCase();

      for (const [category, keywords] of Object.entries(AGENT_KEYWORDS)) {
        if (agentName.includes(category) || agentType.includes(category)) {
          for (const kw of keywords) {
            if (lower.includes(kw)) score++;
          }
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestAgent = agent;
      }
    }

    return bestScore > 0 ? bestAgent : null;
  } catch {
    return null;
  }
}

async function verifyAndRefreshVoiceSession(userId: string, sessionToken: string | undefined): Promise<boolean> {
  if (!sessionToken) return false;
  try {
    const [session] = await db
      .select()
      .from(voiceSessionsTable)
      .where(and(eq(voiceSessionsTable.userId, userId), eq(voiceSessionsTable.sessionToken, sessionToken)))
      .limit(1);

    if (!session) return false;
    if (session.expiresAt < new Date()) {
      await db.delete(voiceSessionsTable).where(eq(voiceSessionsTable.id, session.id));
      return false;
    }

    const newExpiry = new Date(Date.now() + VOICE_SESSION_TTL_MS);
    await db.update(voiceSessionsTable)
      .set({ expiresAt: newExpiry })
      .where(eq(voiceSessionsTable.id, session.id));

    return true;
  } catch {
    return false;
  }
}

async function getOrCreateVoicePrefs(userId: string) {
  const [pref] = await db
    .select()
    .from(voicePreferencesTable)
    .where(eq(voicePreferencesTable.userId, userId));

  if (pref) return pref;

  const newPref = {
    id: generateToken(16),
    userId,
    provider: "openai",
    voiceName: "shimmer",
    speechRate: "1",
    inputLocale: "en-GB",
    outputLocale: "en-GB",
    voiceActivated: false,
  };
  await db.insert(voicePreferencesTable).values(newPref);
  return newPref as typeof voicePreferencesTable.$inferSelect;
}

async function whisperTranscribe(audioBase64: string, langCode: string, apiKey: string): Promise<string> {
  const rawBuffer = Buffer.from(audioBase64, "base64");
  if (!validateAudioBuffer(rawBuffer)) return "";

  const processedBuffer = await preprocessAudio(rawBuffer);

  const audioBlob = new Blob([processedBuffer], { type: "audio/wav" });
  const formData = new FormData();
  formData.append("file", audioBlob, "audio.wav");
  formData.append("model", "whisper-1");
  formData.append("language", langCode);

  const resp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });

  if (!resp.ok) return "";
  const data = await resp.json() as { text?: string };
  return (data.text ?? "").trim();
}

async function buildChatMessages(
  userId: string,
  businessId: string,
  transcript: string,
  systemPrompt: string,
) {
  const history = await db
    .select()
    .from(conversationsTable)
    .where(and(eq(conversationsTable.userId, userId), eq(conversationsTable.businessId, businessId)))
    .orderBy(desc(conversationsTable.createdAt))
    .limit(6);

  const historyMessages = history.reverse().map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  return [
    { role: "system" as const, content: systemPrompt },
    ...historyMessages,
    { role: "user" as const, content: transcript || "Hello" },
  ];
}

async function generateAgentResponse(
  userId: string,
  businessId: string,
  transcript: string,
  agent: typeof agentsTable.$inferSelect | null,
  outputLocale: string,
): Promise<string> {
  const localeNote = outputLocale !== "en-GB"
    ? ` Respond in the language/dialect for locale: ${outputLocale}.`
    : "";

  const systemPrompt = agent
    ? `${agent.systemPrompt ?? RIGO_SYSTEM_PROMPT} You are connected to ${agent.name}. Keep responses spoken-word friendly — 1-3 sentences, no markdown.${localeNote}`
    : RIGO_SYSTEM_PROMPT + localeNote;

  const messages = await buildChatMessages(userId, businessId, transcript, systemPrompt);

  try {
    const completion = await replitOpenAI.chat.completions.create({
      model: "gpt-4o-mini",
      max_completion_tokens: 200,
      messages,
    });

    const response = completion.choices[0]?.message?.content ?? "I'm sorry, I couldn't process that. Please try again.";

    await db.insert(conversationsTable).values([
      { id: generateToken(16), userId, businessId, role: "user", content: transcript },
      { id: generateToken(16), userId, businessId, role: "assistant", content: response },
    ]);

    return response;
  } catch {
    return "I'm having a little trouble right now. Please try again in a moment.";
  }
}

router.post("/pin/set", requireAuth, async (req, res, next) => {
  try {
    const { pin } = req.body as { pin?: string };
    if (!pin || !/^\d{4}$/.test(pin)) {
      res.status(400).json({ error: "PIN must be exactly 4 digits" });
      return;
    }

    const pinHash = hashPin(pin);
    const pref = await getOrCreateVoicePrefs(req.userId!);
    const isFirstActivation = !pref.voiceActivated;

    await db
      .update(voicePreferencesTable)
      .set({ voicePinHash: pinHash, voiceActivated: true, updatedAt: new Date() })
      .where(eq(voicePreferencesTable.userId, req.userId!));

    if (isFirstActivation) {
      await creditWallet(req.userId!, FREE_VOICE_CREDITS_PENCE, "Welcome voice credits — 50 free interactions");
    }

    res.json({ success: true, firstActivation: isFirstActivation, creditedPence: isFirstActivation ? FREE_VOICE_CREDITS_PENCE : 0 });
  } catch (err) {
    next(err);
  }
});

router.post("/pin/verify", requireAuth, async (req, res, next) => {
  try {
    const { pin } = req.body as { pin?: string };
    if (!pin || !/^\d{4}$/.test(pin)) {
      res.status(400).json({ error: "PIN must be exactly 4 digits" });
      return;
    }

    const pref = await getOrCreateVoicePrefs(req.userId!);
    if (!pref.voicePinHash) {
      res.status(400).json({ error: "No PIN set. Please set your voice PIN first." });
      return;
    }

    const inputHash = hashPin(pin);
    if (!safeCompareHash(inputHash, pref.voicePinHash)) {
      res.status(401).json({ error: "Incorrect PIN" });
      return;
    }

    await db.delete(voiceSessionsTable)
      .where(and(eq(voiceSessionsTable.userId, req.userId!), lt(voiceSessionsTable.expiresAt, new Date())));

    const sessionToken = generateToken(32);
    const expiresAt = new Date(Date.now() + VOICE_SESSION_TTL_MS);

    await db.insert(voiceSessionsTable).values({
      id: generateToken(16),
      userId: req.userId!,
      sessionToken,
      expiresAt,
    });

    const confirmToken = issueHighRiskToken(req.userId!);
    res.json({ sessionToken, expiresAt: expiresAt.toISOString(), highRiskConfirmToken: confirmToken });
  } catch (err) {
    next(err);
  }
});

router.get("/voice-preferences", requireAuth, async (req, res, next) => {
  try {
    const pref = await getOrCreateVoicePrefs(req.userId!);
    const wallet = await getOrCreateWallet(req.userId!);

    res.json({
      provider: pref.provider ?? "openai",
      voiceName: pref.voiceName ?? "shimmer",
      speechRate: pref.speechRate ? Number(pref.speechRate) : 1,
      inputLocale: pref.inputLocale ?? "en-GB",
      outputLocale: pref.outputLocale ?? "en-GB",
      voiceActivated: pref.voiceActivated ?? false,
      hasPinSet: !!pref.voicePinHash,
      walletBalancePence: wallet.balancePence,
    });
  } catch (err) {
    next(err);
  }
});

router.put("/voice-preferences", requireAuth, async (req, res, next) => {
  try {
    const { provider, voiceName, speechRate, inputLocale, outputLocale } = req.body as {
      provider?: string;
      voiceName?: string;
      speechRate?: number;
      inputLocale?: string;
      outputLocale?: string;
    };

    await getOrCreateVoicePrefs(req.userId!);

    await db
      .update(voicePreferencesTable)
      .set({
        ...(provider && { provider }),
        ...(voiceName && { voiceName }),
        ...(speechRate && { speechRate: String(speechRate) }),
        ...(inputLocale && { inputLocale }),
        ...(outputLocale && { outputLocale }),
        updatedAt: new Date(),
      })
      .where(eq(voicePreferencesTable.userId, req.userId!));

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.post("/transcribe", requireAuth, async (req, res, next) => {
  try {
    const voiceSessionToken = req.headers["x-voice-session"] as string | undefined;
    if (!(await verifyAndRefreshVoiceSession(req.userId!, voiceSessionToken))) {
      res.status(401).json({ error: "Voice session required. Please verify your PIN." });
      return;
    }

    const { audio, inputLocale } = req.body as { audio?: string; inputLocale?: string };
    if (!audio) {
      res.status(400).json({ error: "audio (base64) is required" });
      return;
    }

    const rawBuffer = Buffer.from(audio, "base64");
    if (!validateAudioBuffer(rawBuffer)) {
      res.status(400).json({ error: "Audio is too short, empty, or in an unsupported format. Please try again." });
      return;
    }

    const debitResult = await checkWalletAndDebit(req.userId!, "voice_transcribe", "Voice transcription");
    if (!debitResult.allowed) {
      res.status(402).json({
        error: "insufficient_balance",
        balancePence: debitResult.balancePence,
        message: "Your balance is too low. Please top up your wallet to continue.",
      });
      return;
    }

    let transcript = "";
    const apiKey = process.env["OPENAI_API_KEY"];

    if (apiKey) {
      const langCode = (inputLocale ?? "en-GB").split("-")[0] ?? "en";
      transcript = await whisperTranscribe(audio, langCode, apiKey);
    }

    res.json({ transcript, walletBalancePence: debitResult.balancePence });
  } catch (err) {
    next(err);
  }
});

router.get("/intro-tts", requireAuth, async (req, res, next) => { // No voice session required — plays during first activation before session exists
  try {
    const apiKey = process.env["OPENAI_API_KEY"];
    if (!apiKey) {
      res.status(501).json({ error: "TTS not configured" });
      return;
    }

    const pref = await getOrCreateVoicePrefs(req.userId!);
    const outputLocale = pref.outputLocale ?? "en-GB";
    const ttsVoice = getVoiceForLocale(outputLocale, pref.voiceName);
    const ttsInstructions = getTtsInstructions(outputLocale);
    const introText = "Hi, I'm Rigo — your GoRigo voice assistant. I'm connected to your business and your agents. Hold the mic button and ask me anything.";

    const ttsBody: Record<string, unknown> = {
      model: "tts-1",
      input: introText,
      voice: ttsVoice,
      response_format: "mp3",
    };
    if (ttsInstructions) ttsBody["instructions"] = ttsInstructions;

    const ttsResp = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(ttsBody),
    });

    if (!ttsResp.ok) {
      res.status(502).json({ error: "TTS API error" });
      return;
    }

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Transfer-Encoding", "chunked");
    res.setHeader("Cache-Control", "no-cache");

    const reader = ttsResp.body!.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  } catch (err) {
    next(err);
  }
});

router.get("/tts-native", requireAuth, async (req, res, next) => {
  try {
    const { text, sessionToken, ttsToken } = req.query as { text?: string; sessionToken?: string; ttsToken?: string };

    if (!text) {
      res.status(400).json({ error: "text is required" });
      return;
    }

    if (!(await verifyAndRefreshVoiceSession(req.userId!, sessionToken))) {
      res.status(401).json({ error: "Voice session required. Please verify your PIN." });
      return;
    }

    const hasValidPlaybackToken = ttsToken ? validateTtsPlaybackToken(ttsToken, req.userId!) : false;
    if (!hasValidPlaybackToken) {
      const debitResult = await checkWalletAndDebit(req.userId!, "voice_tts", "Voice TTS playback");
      if (!debitResult.allowed) {
        res.status(402).json({ error: "insufficient_balance" });
        return;
      }
    }

    const apiKey = process.env["OPENAI_API_KEY"];
    if (!apiKey) {
      res.status(501).json({ error: "TTS not configured" });
      return;
    }

    const pref = await getOrCreateVoicePrefs(req.userId!);
    const outputLocale = pref.outputLocale ?? "en-GB";
    const ttsVoice = getVoiceForLocale(outputLocale, pref.voiceName);
    const ttsInstructions = getTtsInstructions(outputLocale);
    const ttsBody: Record<string, unknown> = {
      model: "tts-1",
      input: text,
      voice: ttsVoice,
      response_format: "mp3",
    };
    if (ttsInstructions) ttsBody["instructions"] = ttsInstructions;

    const ttsResp = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(ttsBody),
    });

    if (!ttsResp.ok) {
      res.status(502).json({ error: "TTS API error" });
      return;
    }

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Transfer-Encoding", "chunked");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Access-Control-Allow-Origin", "*");

    const reader = ttsResp.body!.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  } catch (err) {
    next(err);
  }
});

router.post("/tts", requireAuth, async (req, res, next) => {
  try {
    const voiceSessionToken = req.headers["x-voice-session"] as string | undefined;
    if (!(await verifyAndRefreshVoiceSession(req.userId!, voiceSessionToken))) {
      res.status(401).json({ error: "Voice session required. Please verify your PIN." });
      return;
    }

    const { text, voiceName } = req.body as { text?: string; voiceName?: string };
    if (!text) {
      res.status(400).json({ error: "text is required" });
      return;
    }

    const debitResult = await checkWalletAndDebit(req.userId!, "voice_tts", "Rigo TTS synthesis");
    if (!debitResult.allowed) {
      res.status(402).json({
        error: "insufficient_balance",
        balancePence: debitResult.balancePence,
        message: "Your balance is too low. Please top up your wallet.",
      });
      return;
    }

    const apiKey = process.env["OPENAI_API_KEY"];
    if (!apiKey) {
      res.status(501).json({ error: "TTS not configured" });
      return;
    }

    const pref = await getOrCreateVoicePrefs(req.userId!);
    const outputLocale = pref.outputLocale ?? "en-GB";
    const ttsVoice = voiceName ? voiceName : getVoiceForLocale(outputLocale, pref.voiceName);
    const ttsInstructions = getTtsInstructions(outputLocale);
    const ttsBodyData: Record<string, unknown> = { model: "tts-1", input: text, voice: ttsVoice, response_format: "mp3" };
    if (ttsInstructions) ttsBodyData["instructions"] = ttsInstructions;

    const ttsResp = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(ttsBodyData),
    });

    if (!ttsResp.ok) {
      const errText = await ttsResp.text();
      res.status(502).json({ error: `TTS API error: ${errText}` });
      return;
    }

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Transfer-Encoding", "chunked");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("X-Wallet-Balance", String(debitResult.balancePence));

    const reader = ttsResp.body!.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  } catch (err) {
    next(err);
  }
});

router.post("/talk", requireAuth, async (req, res, next) => {
  try {
    const voiceSessionToken = req.headers["x-voice-session"] as string | undefined;
    if (!(await verifyAndRefreshVoiceSession(req.userId!, voiceSessionToken))) {
      res.status(401).json({ error: "Voice session required. Please verify your PIN." });
      return;
    }

    const { audio, text, agentId: requestedAgentId, businessId, confirm, highRiskConfirmToken, platform } = req.body as {
      audio?: string;
      text?: string;
      agentId?: string;
      businessId?: string;
      confirm?: boolean;
      highRiskConfirmToken?: string;
      platform?: string;
    };
    const isNativeClient = platform === "native";

    if (!businessId || (!audio && !text)) {
      res.status(400).json({ error: "businessId and either audio or text is required" });
      return;
    }

    const pref = await getOrCreateVoicePrefs(req.userId!);
    const inputLocale = pref.inputLocale ?? "en-GB";
    const outputLocale = pref.outputLocale ?? "en-GB";
    const voiceName = pref.voiceName ?? "shimmer";
    const apiKey = process.env["OPENAI_API_KEY"];

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    let transcript = text ?? "";

    if (!text && audio && apiKey) {
      const audioBuffer = Buffer.from(audio, "base64");
      if (audioBuffer.length >= 100) {
        const langCode = inputLocale.split("-")[0] ?? "en";
        transcript = await whisperTranscribe(audio, langCode, apiKey);
      }
    }

    sendSSE(res, "transcript", { transcript });

    if (isHighRiskRequest(transcript)) {
      if (!confirm || !highRiskConfirmToken || !validateHighRiskToken(highRiskConfirmToken, req.userId!)) {
        sendSSE(res, "pin_required", {
          reason: "This action requires PIN confirmation to protect your business.",
          transcript,
        });
        sendSSE(res, "done", { callId: null, requiresPinConfirmation: true });
        res.end();
        return;
      }
    }

    const debitResult = await checkWalletAndDebit(req.userId!, "voice_talk", "Voice interaction with Rigo");
    if (!debitResult.allowed) {
      sendSSE(res, "error", {
        error: "insufficient_balance",
        balancePence: debitResult.balancePence,
        message: "Your balance is too low. Please top up your wallet to continue.",
      });
      sendSSE(res, "done", { callId: null });
      res.end();
      return;
    }

    let selectedAgent: typeof agentsTable.$inferSelect | null = null;
    if (requestedAgentId) {
      const [found] = await db
        .select()
        .from(agentsTable)
        .where(and(eq(agentsTable.id, requestedAgentId), eq(agentsTable.userId, req.userId!)))
        .limit(1);
      selectedAgent = found ?? null;
    } else {
      selectedAgent = await selectBestAgent(businessId, req.userId!, transcript);
    }

    const aiResponse = await generateAgentResponse(
      req.userId!,
      businessId,
      transcript,
      selectedAgent,
      outputLocale,
    );

    const wallet = await getOrCreateWallet(req.userId!);
    const isLowBalance = wallet.balancePence < 100;

    const ttsPlaybackToken = isNativeClient ? issueTtsPlaybackToken(req.userId!) : undefined;
    sendSSE(res, "response", {
      response: aiResponse,
      agentId: selectedAgent?.id ?? null,
      agentName: selectedAgent?.name ?? null,
      walletBalancePence: wallet.balancePence,
      lowBalance: isLowBalance,
      ...(ttsPlaybackToken ? { ttsPlaybackToken } : {}),
    });

    const callId = generateToken(16);
    await db.insert(voiceCallsTable).values({
      id: callId,
      userId: req.userId!,
      businessId,
      agentId: selectedAgent?.id ?? null,
      agentName: selectedAgent?.name ?? null,
      direction: "outbound",
      transcriptSummary: transcript.length > 120 ? transcript.slice(0, 120) + "..." : transcript,
      transcript,
      creditsUsed: String(debitResult.costPence),
    });

    if (apiKey && !isNativeClient) {
      try {
        const ttsVoice = getVoiceForLocale(outputLocale, pref.voiceName);
        const ttsInstructions = getTtsInstructions(outputLocale);
        const ttsBody: Record<string, unknown> = {
          model: "tts-1",
          input: aiResponse,
          voice: ttsVoice,
          response_format: "mp3",
        };
        if (ttsInstructions) ttsBody["instructions"] = ttsInstructions;

        const ttsResp = await fetch("https://api.openai.com/v1/audio/speech", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify(ttsBody),
        });

        if (ttsResp.ok && ttsResp.body) {
          const reader = ttsResp.body.getReader();
          let buffer = Buffer.alloc(0);
          const CHUNK_BYTES = 24576;

          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              if (buffer.length > 0) {
                sendSSE(res, "audio_chunk", { chunk: buffer.toString("base64") });
              }
              break;
            }
            buffer = Buffer.concat([buffer, Buffer.from(value)]);
            while (buffer.length >= CHUNK_BYTES) {
              const chunk = buffer.slice(0, CHUNK_BYTES);
              buffer = buffer.slice(CHUNK_BYTES);
              sendSSE(res, "audio_chunk", { chunk: chunk.toString("base64") });
            }
          }
        }
      } catch {
      }
    }

    sendSSE(res, "done", {
      callId,
      creditsUsed: debitResult.costPence,
      walletBalancePence: wallet.balancePence,
      lowBalance: isLowBalance,
    });

    res.end();
  } catch (err) {
    next(err);
  }
});

router.get("/calls", requireAuth, async (req, res, next) => {
  try {
    const { businessId } = req.query as { businessId?: string };
    if (!businessId) {
      res.status(400).json({ error: "businessId is required" });
      return;
    }

    const calls = await db
      .select()
      .from(voiceCallsTable)
      .where(and(eq(voiceCallsTable.userId, req.userId!), eq(voiceCallsTable.businessId, businessId)))
      .orderBy(desc(voiceCallsTable.createdAt))
      .limit(20);

    res.json({ calls });
  } catch (err) {
    next(err);
  }
});

router.get("/numbers", requireAuth, async (req, res, next) => {
  try {
    const { businessId } = req.query as { businessId?: string };
    if (!businessId) {
      res.status(400).json({ error: "businessId is required" });
      return;
    }

    const numbers = await db
      .select()
      .from(telnyxConfigsTable)
      .where(and(
        eq(telnyxConfigsTable.businessId, businessId),
        eq(telnyxConfigsTable.userId, req.userId!),
        eq(telnyxConfigsTable.isActive, true),
      ));

    res.json({
      numbers: numbers.map((n) => ({
        id: n.id,
        phoneNumber: n.phoneNumber,
        agentId: n.agentId,
        monthlyFeePence: n.monthlyFeePence,
        createdAt: n.createdAt,
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.post("/numbers/purchase", requireAuth, async (req, res, next) => {
  try {
    const { businessId, countryCode, agentId } = req.body as { businessId?: string; countryCode?: string; agentId?: string };
    if (!businessId) {
      res.status(400).json({ error: "businessId is required" });
      return;
    }

    const PURCHASE_COST_PENCE = 500;
    const MONTHLY_FEE_PENCE = 299;

    const wallet = await getOrCreateWallet(req.userId!);
    if (wallet.balancePence < PURCHASE_COST_PENCE) {
      res.status(402).json({
        error: "insufficient_balance",
        balancePence: wallet.balancePence,
        costPence: PURCHASE_COST_PENCE,
        message: "You need at least £5.00 in your wallet to purchase a phone number.",
      });
      return;
    }

    const telnyxApiKey = process.env["TELNYX_API_KEY"];
    let phoneNumber: string;

    if (telnyxApiKey) {
      try {
        const cc = countryCode ?? "GB";
        const searchResp = await fetch(
          `https://api.telnyx.com/v2/available_phone_numbers?filter[country_code]=${cc}&filter[features][]=voice&filter[limit]=1`,
          { headers: { Authorization: `Bearer ${telnyxApiKey}`, "Content-Type": "application/json" } },
        );

        if (!searchResp.ok) throw new Error(`Telnyx search failed: ${searchResp.status}`);

        const searchData = await searchResp.json() as { data?: Array<{ phone_number: string }> };
        const available = searchData.data;

        if (!available || available.length === 0) {
          res.status(503).json({ error: "No available phone numbers in selected region. Please try again." });
          return;
        }

        const selectedNumber = available[0]!.phone_number;
        const orderResp = await fetch("https://api.telnyx.com/v2/number_orders", {
          method: "POST",
          headers: { Authorization: `Bearer ${telnyxApiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            phone_numbers: [{ phone_number: selectedNumber }],
            ...(process.env["TELNYX_CONNECTION_ID"] && { connection_id: process.env["TELNYX_CONNECTION_ID"] }),
          }),
        });

        if (!orderResp.ok) {
          const errBody = await orderResp.text();
          throw new Error(`Telnyx order failed: ${errBody}`);
        }

        const orderData = await orderResp.json() as { data?: { phone_numbers?: Array<{ phone_number: string }> } };
        phoneNumber = orderData.data?.phone_numbers?.[0]?.phone_number ?? selectedNumber;
      } catch (telErr) {
        req.log?.warn({ err: telErr }, "Telnyx purchase failed");
        res.status(502).json({ error: "Phone number purchase failed. Please try again later." });
        return;
      }
    } else {
      const cc = countryCode ?? "GB";
      const randomDigits = Math.floor(Math.random() * 9000000000 + 1000000000);
      phoneNumber = cc === "GB" ? `+44${randomDigits}`.slice(0, 13) : `+1${randomDigits}`.slice(0, 12);
    }

    const debitResult = await checkWalletAndDebit(
      req.userId!,
      "voice_number_purchase",
      `Phone number purchase: ${phoneNumber}`,
      { businessId, phoneNumber },
    );

    if (!debitResult.allowed) {
      res.status(402).json({
        error: "insufficient_balance",
        balancePence: debitResult.balancePence,
        message: "Failed to debit wallet. Please try again.",
      });
      return;
    }

    const configId = generateToken(16);
    await db.insert(telnyxConfigsTable).values({
      id: configId,
      businessId,
      userId: req.userId!,
      agentId: agentId ?? null,
      phoneNumber,
      isActive: true,
      monthlyFeePence: String(MONTHLY_FEE_PENCE),
    });

    res.json({
      success: true,
      id: configId,
      phoneNumber,
      agentId: agentId ?? null,
      monthlyFeePence: MONTHLY_FEE_PENCE,
      walletBalancePence: debitResult.balancePence,
      message: `Phone number ${phoneNumber} purchased successfully.`,
    });
  } catch (err) {
    next(err);
  }
});

router.patch("/numbers/:id", requireAuth, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { agentId } = req.body as { agentId?: string | null };

    await db
      .update(telnyxConfigsTable)
      .set({ agentId: agentId ?? null, updatedAt: new Date() })
      .where(and(eq(telnyxConfigsTable.id, id), eq(telnyxConfigsTable.userId, req.userId!)));

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.delete("/numbers/:id", requireAuth, async (req, res, next) => {
  try {
    const { id } = req.params;
    const telnyxApiKey = process.env["TELNYX_API_KEY"];

    const [config] = await db
      .select()
      .from(telnyxConfigsTable)
      .where(and(eq(telnyxConfigsTable.id, id), eq(telnyxConfigsTable.userId, req.userId!)));

    if (config && telnyxApiKey) {
      try {
        await fetch(`https://api.telnyx.com/v2/phone_numbers/${encodeURIComponent(config.phoneNumber)}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${telnyxApiKey}` },
        });
      } catch {
      }
    }

    await db
      .update(telnyxConfigsTable)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(telnyxConfigsTable.id, id), eq(telnyxConfigsTable.userId, req.userId!)));

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
