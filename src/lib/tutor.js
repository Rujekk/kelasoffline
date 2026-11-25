// KelasOffline core: hybrid tutoring via Firebase AI Logic.
//
// Routing (per the official Firebase AI Logic hybrid-inference docs,
// SDK v12.5.0+):
//  - Default: a model with InferenceMode.PREFER_ON_DEVICE. When Gemini Nano
//    is available in Chrome, inference runs on-device (works fully offline);
//    otherwise the SDK falls back to the cloud model automatically.
//  - "Deep answer" toggle: a model with InferenceMode.ONLY_IN_CLOUD using
//    Gemini 2.5 Flash for a richer answer.
// Output is requested as structured JSON (supported on-device and in cloud)
// so the UI never has to guess at free-form text.

import { getGenerativeModel, InferenceMode, Schema } from "firebase/ai";
import { ai } from "../firebase.js";

export const CLOUD_MODEL = "gemini-2.5-flash";

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
        requiredProperties: ["question", "answer"],
      }),
      minItems: 3,
      maxItems: 3,
      description: "Exactly 3 practice questions with their answer key.",
    }),
  },
  requiredProperties: ["summary", "quiz"],
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

const hybridModel = getGenerativeModel(ai, {
  mode: InferenceMode.PREFER_ON_DEVICE,
  inCloudParams: {
    model: CLOUD_MODEL,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: resultSchema,
    },
  },
  onDeviceParams: {
    promptOptions: { responseConstraint: resultJsonSchema },
  },
});

const cloudModel = getGenerativeModel(ai, {
  model: CLOUD_MODEL,
  generationConfig: {
    responseMimeType: "application/json",
    responseSchema: resultSchema,
  },
});

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
// Resolves: { summary, quiz, modeServed: "on_device" | "cloud", responseMs }
export async function summarizeAndQuiz(material, { deep = false, onProgress = () => {} } = {}) {
  const started = performance.now();
  if (deep) {
    onProgress("Menghubungi Gemini 2.5 Flash di cloud…");
    const result = await cloudModel.generateContent(PROMPT(material));
    const data = parseResult(result.response.text());
    return { ...data, modeServed: "cloud", responseMs: Math.round(performance.now() - started) };
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
  const result = await model.generateContent(PROMPT(material));
  const data = parseResult(result.response.text());
  // With PREFER_ON_DEVICE the SDK serves on-device exactly when Nano is
  // available; otherwise it transparently falls back to the cloud. We label
  // the result by the availability observed for this request.
  const modeServed = nano === "available" ? "on_device" : "cloud";
  return { ...data, modeServed, responseMs: Math.round(performance.now() - started) };
}
