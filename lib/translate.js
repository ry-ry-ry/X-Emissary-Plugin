// Free translation via Google's unofficial gtx endpoint. No API key, no quota signup.
// Called from the background service worker (host permission covers CORS).
// Unofficial — may rate-limit or change; callers should handle a thrown error.

const ENDPOINT = "https://translate.googleapis.com/translate_a/single";
const TAG = "[DefenseEmissary:translate]";

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

// Returns { text, sourceLang } where sourceLang is the auto-detected source code.
// Throws on network/parse failure or empty input.
export async function translateText(text, targetLang = "en", debug = false) {
  const dlog = (...a) => { if (debug) console.warn(TAG, ...a); };
  const trimmed = (text || "").trim();
  if (!trimmed) throw new Error("nothing to translate");

  const params = new URLSearchParams({
    client: "gtx",
    sl: "auto",
    tl: targetLang,
    dt: "t",
    q: trimmed,
  });
  const url = `${ENDPOINT}?${params.toString()}`;

  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    dlog("HTTP", res.status);
    throw new Error(`translate HTTP ${res.status}`);
  }
  const data = await res.json();

  // Shape: [ [ [translatedChunk, originalChunk, ...], ... ], ..., detectedSourceLang, ... ]
  if (!Array.isArray(data) || !Array.isArray(data[0])) {
    throw new Error("translate: unexpected response shape");
  }
  const translated = data[0]
    .map((chunk) => (Array.isArray(chunk) ? chunk[0] : ""))
    .filter(Boolean)
    .join("");
  const sourceLang = (typeof data[2] === "string" && data[2]) || (data[8] && data[8][0] && data[8][0][0]) || "";

  if (!translated) throw new Error("translate: empty result");
  dlog("translated from", sourceLang, "->", targetLang);
  return { text: translated, sourceLang };
}
