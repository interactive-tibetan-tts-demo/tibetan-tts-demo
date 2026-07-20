const WORKER_HTTP_URL = "https://anonymous-tts-demo.tibetan-speech-demo-2026.workers.dev/tts";
const $ = (id) => document.getElementById(id);
const ui = {
  text: $("textInput"), button: $("synthesize"), status: $("connectionStatus"), label: $("connectionLabel"),
  title: $("resultTitle"), message: $("resultMessage"), audio: $("audio"), download: $("download"), notice: $("notice")
};
let running = false, objectUrl = null;

function setResult(title, message, isError = false) {
  ui.title.textContent = title;
  ui.message.textContent = message;
  ui.notice.className = `notice${isError ? " error" : ""}`;
}
function parseErrorDetail(detail, fallback) {
  if (!detail) return fallback;
  try {
    const parsed = JSON.parse(detail);
    return parsed.message || fallback;
  } catch {
    return detail.slice(0, 180);
  }
}
function base64ToBlob(value) {
  const clean = String(value || "").replace(/^data:[^;]+;base64,/, "").replace(/\s/g, "").replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(clean), bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const mime = clean.startsWith("UklGR") ? "audio/wav" : "audio/mpeg";
  return new Blob([bytes], { type: mime });
}
function finish(error) {
  running = false;
  ui.button.disabled = false;
  if (error) setResult("Synthesis failed", error, true);
}
function playResult(base64) {
  const blob = base64ToBlob(base64);
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = URL.createObjectURL(blob);
  ui.audio.src = objectUrl;
  ui.audio.hidden = false;
  ui.download.href = objectUrl;
  ui.download.download = `tibetan-tts-${Date.now()}.wav`;
  ui.download.style.display = "inline-block";
  setResult("Audio ready", "Use the player or download the generated audio.");
  finish();
}
async function synthesize() {
  const text = ui.text.value.trim();
  if (!text) return setResult("Text required", "Enter Tibetan text before starting synthesis.", true);
  if (running) return;
  running = true;
  ui.button.disabled = true;
  ui.audio.hidden = true;
  ui.download.style.display = "none";
  setResult("Synthesizing", "Sending the text to the speech service...");
  try {
    const response = await fetch(WORKER_HTTP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text })
    });
    if (response.status === 429) return finish("This IP address has used all 10 successful synthesis attempts.");
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return finish(parseErrorDetail(detail, `The speech service returned HTTP ${response.status}.`));
    }
    const result = await response.json();
    if (!result.data) return finish("The response did not contain audio data.");
    if (Number.isFinite(Number(result.remaining))) ui.notice.textContent = `${result.remaining} successful synthesis attempts remain for this IP address.`;
    playResult(result.data);
  } catch (error) {
    finish("Could not reach the speech service. Check the Worker URL and deployment.");
  }
}
ui.text.addEventListener("input", () => { $("count").textContent = `${countUnits(ui.text.value)} Tibetan syllables`; });
ui.button.addEventListener("click", synthesize);

function isChineseChar(char) { return /[\u4E00-\u9FFF]/u.test(char); }
function isTibetanChar(char) { const code = char.codePointAt(0); return code >= 0x0F00 && code <= 0x0FFF; }
function isTibetanDelimiter(char) { return /\s/u.test(char) || /[\u0F0B\u0F0D-\u0F11]/u.test(char); }
function countUnits(text) {
  let count = 0, inTibetanToken = false;
  for (const char of text || "") {
    if (isChineseChar(char)) { count += 1; inTibetanToken = false; continue; }
    if (isTibetanDelimiter(char)) { inTibetanToken = false; continue; }
    if (isTibetanChar(char)) { if (!inTibetanToken) { count += 1; inTibetanToken = true; } continue; }
    if (!/\s/u.test(char)) count += 1; else inTibetanToken = false;
  }
  return count;
}
$("connectionStatus").className = "status connected";
$("connectionLabel").textContent = "Service ready";
ui.button.disabled = false;
setResult("Ready", "Enter Tibetan text to begin synthesis.");
