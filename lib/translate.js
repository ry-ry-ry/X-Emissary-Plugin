// Free translation with no API key and no quota signup.
//
// Google's unofficial gtx endpoint is the primary provider: best quality and reliable
// language detection. It rate-limits by IP, though, so a 429 there is common enough that
// two fallbacks follow it. Each provider returns { text, sourceLang }; the first that
// succeeds wins. Called from the background service worker, where host permissions
// exempt it from CORS.

const TAG = "[XEmissary:translate]";

const LANG_NAMES = {
  af: "Afrikaans", ar: "Arabic", bg: "Bulgarian", bn: "Bengali", ca: "Catalan",
  cs: "Czech", da: "Danish", de: "German", el: "Greek", en: "English",
  es: "Spanish", et: "Estonian", fa: "Persian", fi: "Finnish", fr: "French",
  gu: "Gujarati", he: "Hebrew", hi: "Hindi", hr: "Croatian", hu: "Hungarian",
  id: "Indonesian", it: "Italian", ja: "Japanese", kn: "Kannada", ko: "Korean",
  lt: "Lithuanian", lv: "Latvian", ml: "Malayalam", mr: "Marathi", ms: "Malay",
  nl: "Dutch", no: "Norwegian", pl: "Polish", pt: "Portuguese", ro: "Romanian",
  ru: "Russian", sk: "Slovak", sl: "Slovenian", sr: "Serbian", sv: "Swedish",
  ta: "Tamil", te: "Telugu", th: "Thai", tl: "Filipino", tr: "Turkish",
  uk: "Ukrainian", ur: "Urdu", vi: "Vietnamese", zh: "Chinese",
  "zh-CN": "Chinese (Simplified)", "zh-TW": "Chinese (Traditional)",
};

export function languageName(code) {
  if (!code) return "unknown";
  if (LANG_NAMES[code]) return LANG_NAMES[code];
  const base = code.split("-")[0];
  return LANG_NAMES[base] || code;
}

// MyMemory rejects anything longer than this with a 403 *inside* a 200 response.
const MYMEMORY_MAX_CHARS = 500;

const PROVIDERS = [
  { name: "google", fn: viaGoogle },
  { name: "lingva", fn: viaLingva },
  { name: "mymemory", fn: viaMyMemory },
];

// Returns { text, sourceLang, provider }. sourceLang is "" when the provider could not
// detect it or its answer isn't trustworthy — callers should fall back to the language
// the platform itself reported. Throws only when every provider fails.
export async function translateText(text, targetLang = "en", debug = false) {
  const dlog = (...a) => { if (debug) console.warn(TAG, ...a); };
  const trimmed = (text || "").trim();
  if (!trimmed) throw new Error("nothing to translate");

  const failures = [];
  for (const provider of PROVIDERS) {
    try {
      const result = await provider.fn(trimmed, targetLang, dlog);
      if (result && result.text && result.text.trim()) {
        dlog(`translated via ${provider.name}, from ${result.sourceLang || "(undetected)"} -> ${targetLang}`);
        return { ...result, provider: provider.name };
      }
      failures.push(`${provider.name}: empty result`);
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      dlog(`${provider.name} failed:`, msg);
      failures.push(`${provider.name}: ${msg}`);
    }
  }
  throw new Error(failures.join("; "));
}

// A detected source equal to the target tells us nothing — we only translate when the
// post isn't already in the target language — and in practice signals a provider that
// guessed badly. Drop it so the caller uses the platform's own language field.
function trustSource(detected, targetLang) {
  const code = (detected || "").trim();
  if (!code) return "";
  if (code.toLowerCase() === targetLang.toLowerCase()) return "";
  if (code.toLowerCase() === "auto") return "";
  return code;
}

// Google's gtx endpoint. Unofficial: it may rate-limit (429) or change shape.
async function viaGoogle(text, targetLang, dlog) {
  const params = new URLSearchParams({
    client: "gtx",
    sl: "auto",
    tl: targetLang,
    dt: "t",
    q: text,
  });
  const res = await fetch(`https://translate.googleapis.com/translate_a/single?${params}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();

  // Shape: [ [ [translatedChunk, originalChunk, ...], ... ], ..., detectedSourceLang, ... ]
  if (!Array.isArray(data) || !Array.isArray(data[0])) throw new Error("unexpected response shape");
  const translated = data[0]
    .map((chunk) => (Array.isArray(chunk) ? chunk[0] : ""))
    .filter(Boolean)
    .join("");
  const detected = (typeof data[2] === "string" && data[2]) || (data[8] && data[8][0] && data[8][0][0]) || "";
  if (!translated) throw new Error("empty result");
  return { text: translated, sourceLang: trustSource(detected, targetLang) };
}

// Lingva proxies Google Translate, so quality matches the primary provider but the
// request leaves from a different IP — which is exactly what a 429 calls for.
//
// Its detected-source field is NOT reliable: verified returning "en" for both French and
// Russian input. trustSource() discards that, and anything else it reports is treated
// with the same suspicion by the caller's fallback to the platform's language field.
async function viaLingva(text, targetLang, dlog) {
  const url = `https://lingva.ml/api/v1/auto/${encodeURIComponent(targetLang)}/${encodeURIComponent(text)}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (!data || typeof data.translation !== "string") throw new Error("unexpected response shape");
  if (!data.translation.trim()) throw new Error("empty result");
  return { text: data.translation, sourceLang: "" };
}

// MyMemory, run by Translated.net. Reliable language detection, but two sharp edges:
// a hard 500-character limit, and errors returned as responseStatus inside an HTTP 200.
async function viaMyMemory(text, targetLang, dlog) {
  // Truncating would silently drop content, which is worse than not translating, so
  // decline instead and let the caller report that translation was unavailable.
  if (text.length > MYMEMORY_MAX_CHARS) {
    throw new Error(`text is ${text.length} chars, over the ${MYMEMORY_MAX_CHARS} limit`);
  }
  const params = new URLSearchParams({ q: text, langpair: `Autodetect|${targetLang}` });
  const res = await fetch(`https://api.mymemory.translated.net/get?${params}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();

  // responseStatus is the real status; HTTP 200 is returned even for quota and length
  // errors, and it arrives as either a number or a string depending on the error.
  const status = Number(data && data.responseStatus);
  if (status && status !== 200) {
    const detail = (data.responseDetails || (data.responseData && data.responseData.translatedText) || "").toString();
    throw new Error(`status ${status}${detail ? ` — ${detail.slice(0, 80)}` : ""}`);
  }
  if (data && data.quotaFinished) throw new Error("daily quota exhausted");

  const out = data && data.responseData ? data.responseData : null;
  const translated = out && typeof out.translatedText === "string" ? out.translatedText : "";
  if (!translated.trim()) throw new Error("empty result");
  return { text: translated, sourceLang: trustSource(out.detectedLanguage, targetLang) };
}
