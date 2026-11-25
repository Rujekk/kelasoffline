// KelasOffline core: hybrid tutoring via Firebase AI Logic.
//
// Routing (per the official Firebase AI Logic hybrid-inference docs,
// SDK v12.5.0+):
//  - Default: a model with InferenceMode.PREFER_ON_DEVICE. When Gemini Nano
//    is available in Chrome, inference runs on-device (works fully offline);
//    otherwise the SDK falls back to the cloud model automatically.
//  - "Deep answer" toggle: a model with InferenceMode.ONLY_IN_CLOUD using
//    Gemini 3.8 Flash for a richer answer.
// Output is requested as structured JSON (supported on-device and in cloud)
// so the UI never has to guess at free-form text.

import { getGenerativeModel, InferenceMode, Schema } from "firebase/ai";
import { ai } from "../firebase.js";

export const CLOUD_MODEL = "gemini-3.8-flash";

const resultSchema = Schema.object({
  properties: {
    summary: Schema.array({
      items: Schema.string(),
      minItems: 3,
      maxItems: 3,
      description: "Exactly 3 key points summarizing the material.",
    }),
    quiz: Schema.array({
      items: Schema.object({
        properties: {
          question: Schema.string(),
          answer: Schema.string(),
        },
        // No optionalProperties: in this SDK every property is required by
        // default, and ObjectSchema.toJSON() emits the standard "required"
        // field. (The older "requiredProperties" param is copied verbatim
        // into the request by the Schema base class and the Gemini API
        // rejects it with HTTP 400 — verified live 2026-11-25.)
      }),
      minItems: 3,
      maxItems: 3,
      description: "Exactly 3 practice questions with their answer key.",
    }),
  },
});

// IMPORTANT (learned from the installed SDK source, @firebase/ai v12.19):
// when `mode` is set, getGenerativeModel treats the params as HybridParams
// and IGNORES top-level `model`/`generationConfig` — the cloud side must be
// configured via `inCloudParams` (otherwise it silently defaults to
// gemini-2.5-flash-lite), and the on-device side via `onDeviceParams`, whose
// promptOptions.responseConstraint carries the JSON schema to the Chrome
// Prompt API. The plain (non-hybrid) cloud model below uses the classic
// top-level form, which is correct when no mode is set.
const resultJsonSchema = {
  type: "object",
  properties: {
    summary: {
      type: "array",
      items: { type: "string" },
      minItems: 3,
      maxItems: 3,
    },
    quiz: {
      type: "array",
      items: {
        type: "object",
        properties: {
          question: { type: "string" },
          answer: { type: "string" },
        },
        required: ["question", "answer"],
      },
      minItems: 3,
      maxItems: 3,
    },
  },
  required: ["summary", "quiz"],
};

// Cloud fallback chain: the newest Flash can hit temporary capacity spikes
// (HTTP 500 "high demand", seen live 2026-11-25). On a server-side error we
// retry once, then fall back to the Lite model Google provisions for new
// projects. Client errors (400 etc.) are NOT retried — they would fail again.
export const FALLBACK_MODEL = "gemini-3.5-flash-lite";

const jsonConfig = {
  responseMimeType: "application/json",
  responseSchema: resultSchema,
};

const hybridModel = getGenerativeModel(ai, {
  mode: InferenceMode.PREFER_ON_DEVICE,
  inCloudParams: { model: CLOUD_MODEL, generationConfig: jsonConfig },
  onDeviceParams: {
    promptOptions: { responseConstraint: resultJsonSchema },
  },
});

const cloudModelCache = new Map();
function cloudModelFor(name) {
  if (!cloudModelCache.has(name)) {
    cloudModelCache.set(name, getGenerativeModel(ai, { model: name, generationConfig: jsonConfig }));
  }
  return cloudModelCache.get(name);
}

function isServerError(err) {
  const msg = String(err?.message || err);
  return /\b(500|503)\b/.test(msg) || /high demand|overloaded|UNAVAILABLE/i.test(msg);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Runs the prompt against the cloud chain; resolves { text, modelUsed }.
async function generateCloud(material, onProgress) {
  const chain = [CLOUD_MODEL, FALLBACK_MODEL];
  let lastErr;
  for (const name of chain) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        onProgress(`Menghubungi ${name === CLOUD_MODEL ? "Gemini 3.8 Flash" : "Gemini 3.5 Flash-Lite"} di cloud…`);
        const result = await cloudModelFor(name).generateContent(PROMPT(material));
        return { text: result.response.text(), modelUsed: name };
      } catch (err) {
        lastErr = err;
        if (!isServerError(err)) throw err;
        if (attempt < 2) await sleep(3000);
      }
    }
  }
  throw lastErr;
}

// Gemini Nano availability via the Chrome Prompt API global.
// Returns: "available" | "downloadable" | "downloading" | "unavailable" | "unsupported"
export async function probeNano() {
  try {
    const LM = globalThis.LanguageModel || globalThis.ai?.languageModel;
    if (!LM || typeof LM.availability !== "function") return "unsupported";
    return await LM.availability();
  } catch {
    return "unavailable";
  }
}

const PROMPT = (material) => `Kamu adalah tutor belajar untuk pelajar Indonesia.
Dari materi berikut, buat:
1. "summary": ringkasan tepat 3 poin penting.
2. "quiz": tepat 3 soal latihan beserta kunci jawabannya ("question" dan "answer").
Gunakan bahasa yang sama dengan materi (Indonesia atau Inggris). Jawaban harus hanya berdasarkan materi, jangan menambahkan fakta dari luar materi. Kembalikan HANYA JSON sesuai skema.

MATERI:
${material}`;

function parseResult(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Format jawaban AI tidak valid. Silakan coba lagi.");
  }
  const summary = Array.isArray(data?.summary) ? data.summary.filter((s) => typeof s === "string" && s.trim()) : [];
  const quiz = Array.isArray(data?.quiz)
    ? data.quiz.filter((q) => q && typeof q.question === "string" && typeof q.answer === "string")
    : [];
  if (summary.length === 0 || quiz.length === 0) {
    throw new Error("Jawaban AI tidak lengkap. Silakan coba lagi.");
  }
  return { summary: summary.slice(0, 3), quiz: quiz.slice(0, 3) };
}

// Runs the one core feature. Options:
//   deep: boolean — force the cloud model for a deeper answer.
//   onProgress: (msg) => void — status/download progress updates.
// Resolves: { summary, quiz, modeServed: "on_device" | "cloud", responseMs, modelUsed }
export async function summarizeAndQuiz(material, { deep = false, onProgress = () => {} } = {}) {
  const started = performance.now();
  const done = (data, modeServed, modelUsed) => ({
    ...data,
    modeServed,
    modelUsed,
    responseMs: Math.round(performance.now() - started),
  });

  if (deep) {
    const { text, modelUsed } = await generateCloud(material, onProgress);
    return done(parseResult(text), "cloud", modelUsed);
  }

  const nano = await probeNano();
  const model = hybridModel;
  if (typeof model.initializeDeviceModel === "function") {
    // Required by the hybrid SDK: initialize the on-device model on a user
    // interaction (this runs inside the button click handler chain), before
    // the first prompt. Reports Gemini Nano download progress when relevant.
    onProgress(nano === "available" ? "Menyiapkan Gemini Nano di perangkat…" : "Menyiapkan model…");
    await model.initializeDeviceModel((v) => {
      onProgress(`Mengunduh Gemini Nano… ${Math.round(v * 100)}%`);
    });
  }
  onProgress(nano === "available" ? "Memproses di perangkat (offline-ready)…" : "Memproses…");
  try {
    const result = await model.generateContent(PROMPT(material));
    const data = parseResult(result.response.text());
    // With PREFER_ON_DEVICE the SDK serves on-device exactly when Nano is
    // available; otherwise it transparently falls back to the cloud. We label
    // the result by the availability observed for this request.
    const modeServed = nano === "available" ? "on_device" : "cloud";
    return done(data, modeServed, modeServed === "on_device" ? "gemini-nano" : CLOUD_MODEL);
  } catch (err) {
    // The hybrid model's cloud leg uses the primary model only. If it hit a
    // temporary server-side capacity error (and Nano did not serve), walk
    // the cloud fallback chain before giving up.
    if (nano === "available" || !isServerError(err)) throw err;
    const { text, modelUsed } = await generateCloud(material, onProgress);
    return done(parseResult(text), "cloud", modelUsed);
  }
}
