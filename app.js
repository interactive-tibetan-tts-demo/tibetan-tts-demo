const WORKER_HTTP_URL = "https://anonymous-tts-demo.tibetan-speech-demo-2026.workers.dev/tts";
const CHUNK_SYLLABLES = 60;
const CROSSFADE_SECONDS = 0.055;

const SAMPLES = [
  { text: "བཀྲ་ཤིས་བདེ་ལེགས།", translation: "Good fortune and happiness" },
  { text: "དེ་རིང་གནམ་གཤིས་ངོ་མ་བཟང་གི", translation: "The weather is really nice today" },
  { text: "2027ལོའི་ཚོགས་འདུ་ཐུགས་གྲ་ལེགས་འགྲིག་ཡོང་བའི་སྨོན་འདུན་ཞུ།", translation: "Wishing the 2027 conference great success" }
];

const $ = (id) => document.getElementById(id);
const ui = {
  text: $("textInput"), button: $("synthesize"), random: $("randomSample"), samples: $("sampleList"),
  translation: $("sampleTranslation"), count: $("count"), status: $("connectionStatus"), label: $("connectionLabel"),
  title: $("resultTitle"), message: $("resultMessage"), audio: $("audio"), download: $("download"), notice: $("notice")
};
let running = false;
let objectUrl = null;
let lastSampleIndex = -1;

function setResult(title, message, isError = false) {
  ui.title.textContent = title;
  ui.message.textContent = message;
  ui.notice.className = `notice${isError ? " error" : ""}`;
}
function parseErrorDetail(detail, fallback) {
  if (!detail) return fallback;
  try { return JSON.parse(detail).message || fallback; } catch { return detail.slice(0, 180); }
}
function isChineseChar(char) { return /[\u4E00-\u9FFF]/u.test(char); }
function isTibetanChar(char) { const code = char.codePointAt(0); return code >= 0x0F00 && code <= 0x0FFF; }
function isTibetanDelimiter(char) { return /\s/u.test(char) || /[\u0F0B\u0F0D-\u0F11]/u.test(char); }
function countUnits(text) {
  let count = 0, inToken = false;
  for (const char of text || "") {
    if (isChineseChar(char)) { count += 1; inToken = false; continue; }
    if (isTibetanDelimiter(char)) { inToken = false; continue; }
    if (isTibetanChar(char)) { if (!inToken) count += 1; inToken = true; continue; }
    if (!/\s/u.test(char)) count += 1;
    inToken = false;
  }
  return count;
}

// Prefer a Tibetan shad (།) within +/-20% of the target length.
function splitTextSmart(text, target = CHUNK_SYLLABLES) {
  const characters = Array.from(String(text || "").trim());
  if (!characters.length) return [];
  const min = Math.max(1, Math.floor(target * 0.8));
  const max = Math.ceil(target * 1.2);
  const chunks = [];
  let start = 0;
  while (start < characters.length) {
    const remaining = characters.slice(start).join("").trim();
    if (countUnits(remaining) <= max) { chunks.push(remaining); break; }
    let units = 0, inToken = false, preferred = [], fallback = [], index = start;
    for (; index < characters.length && units <= max; index += 1) {
      const char = characters[index];
      if (isChineseChar(char)) { units += 1; inToken = false; }
      else if (isTibetanDelimiter(char)) inToken = false;
      else if (isTibetanChar(char)) { if (!inToken) units += 1; inToken = true; }
      else if (!/\s/u.test(char)) { units += 1; inToken = false; }
      else inToken = false;
      if (units >= min && units <= max) {
        const candidate = { cut: index + 1, units };
        if (char === "།") preferred.push(candidate);
        else if (/\s/u.test(char) || /[༎༏༐༑༔，,。.!！？?；;：:、]/u.test(char)) fallback.push(candidate);
      }
    }
    const candidates = preferred.length ? preferred : fallback;
    let cut;
    if (candidates.length) cut = candidates.reduce((best, item) => Math.abs(item.units - target) < Math.abs(best.units - target) ? item : best).cut;
    else cut = Math.max(start + 1, index);
    const chunk = characters.slice(start, cut).join("").trim();
    if (chunk) chunks.push(chunk);
    start = cut;
  }
  return chunks;
}

function renderSamples() {
  ui.samples.innerHTML = SAMPLES.map((sample, index) => `
    <button class="sample-card" type="button" data-sample="${index}">
      <span class="sample-tibetan">${sample.text}</span><span class="sample-english">${sample.translation}</span>
    </button>`).join("");
  ui.samples.querySelectorAll("[data-sample]").forEach((button) => button.addEventListener("click", () => useSample(Number(button.dataset.sample))));
}
function useSample(index) {
  const sample = SAMPLES[index];
  lastSampleIndex = index;
  ui.text.value = sample.text;
  ui.translation.hidden = false;
  ui.translation.textContent = `English translation: ${sample.translation}`;
  updateCount();
  ui.text.focus();
}
function chooseRandomSample() {
  let index = Math.floor(Math.random() * SAMPLES.length);
  if (SAMPLES.length > 1 && index === lastSampleIndex) index = (index + 1) % SAMPLES.length;
  useSample(index);
}
function updateCount() { ui.count.textContent = `${countUnits(ui.text.value)} Tibetan syllables`; }

function base64ToArrayBuffer(value) {
  const clean = String(value || "").replace(/^data:[^;]+;base64,/, "").replace(/\s/g, "").replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
function audioBufferToWav(buffer) {
  const channels = Math.min(2, buffer.numberOfChannels);
  const frames = buffer.length;
  const output = new ArrayBuffer(44 + frames * channels * 2);
  const view = new DataView(output);
  const write = (offset, value) => view.setUint8(offset, value.charCodeAt(0));
  "RIFF".split("").forEach((char, index) => write(index, char));
  view.setUint32(4, 36 + frames * channels * 2, true);
  "WAVEfmt ".split("").forEach((char, index) => write(8 + index, char));
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true); view.setUint32(28, buffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true);
  "data".split("").forEach((char, index) => write(36 + index, char));
  view.setUint32(40, frames * channels * 2, true);
  let offset = 44;
  for (let frame = 0; frame < frames; frame += 1) for (let channel = 0; channel < channels; channel += 1) {
    const source = buffer.getChannelData(Math.min(channel, buffer.numberOfChannels - 1))[frame];
    view.setInt16(offset, Math.max(-1, Math.min(1, source)) * 0x7fff, true); offset += 2;
  }
  return new Blob([output], { type: "audio/wav" });
}
async function joinAudio(segments) {
  if (segments.length === 1) return new Blob([base64ToArrayBuffer(segments[0])], { type: "audio/wav" });
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass || !window.OfflineAudioContext) throw new Error("This browser cannot join multi-part audio. Please use a recent Chrome, Edge, Firefox, or Safari browser.");
  const context = new AudioContextClass();
  try {
    const decoded = [];
    for (const segment of segments) decoded.push(await context.decodeAudioData(base64ToArrayBuffer(segment)));
    const sampleRate = decoded[0].sampleRate;
    const channels = Math.min(2, Math.max(...decoded.map((item) => item.numberOfChannels)));
    const overlapFrames = Math.floor(sampleRate * CROSSFADE_SECONDS);
    const totalFrames = decoded.reduce((total, item) => total + item.length, 0) - overlapFrames * (decoded.length - 1);
    const offline = new OfflineAudioContext(channels, totalFrames, sampleRate);
    let frame = 0;
    decoded.forEach((buffer, index) => {
      const source = offline.createBufferSource(); source.buffer = buffer;
      const gain = offline.createGain(); source.connect(gain).connect(offline.destination);
      const start = frame / sampleRate;
      if (index > 0) gain.gain.setValueAtTime(0, start), gain.gain.linearRampToValueAtTime(1, start + CROSSFADE_SECONDS);
      if (index < decoded.length - 1) { const end = start + buffer.duration; gain.gain.setValueAtTime(1, end - CROSSFADE_SECONDS), gain.gain.linearRampToValueAtTime(0, end); }
      source.start(start); frame += buffer.length - overlapFrames;
    });
    return audioBufferToWav(await offline.startRendering());
  } finally { await context.close(); }
}
function playResult(blob) {
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = URL.createObjectURL(blob);
  ui.audio.src = objectUrl; ui.audio.hidden = false;
  ui.download.href = objectUrl; ui.download.download = `tibetan-tts-${Date.now()}.wav`; ui.download.style.display = "inline-block";
}
function finish(error) { running = false; ui.button.disabled = false; if (error) setResult("Synthesis failed", error, true); }

async function synthesize() {
  const text = ui.text.value.trim();
  if (!text) return setResult("Text required", "Enter Tibetan text or choose one of the examples.", true);
  if (running) return;
  const chunks = splitTextSmart(text);
  running = true; ui.button.disabled = true; ui.audio.hidden = true; ui.download.style.display = "none";
  setResult("Synthesizing", `Preparing ${chunks.length} natural speech ${chunks.length === 1 ? "segment" : "segments"}…`);
  try {
    const response = await fetch(WORKER_HTTP_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ texts: chunks }) });
    if (response.status === 429) return finish("This IP address has used all 10 successful synthesis attempts.");
    if (!response.ok) return finish(parseErrorDetail(await response.text().catch(() => ""), `The speech service returned HTTP ${response.status}.`));
    const result = await response.json();
    const segments = Array.isArray(result.segments) ? result.segments : (result.data ? [result.data] : []);
    if (!segments.length) return finish("The response did not contain audio data.");
    setResult("Finishing audio", "Joining speech segments smoothly…");
    const blob = await joinAudio(segments);
    playResult(blob);
    if (Number.isFinite(Number(result.remaining))) ui.notice.textContent = `${result.remaining} successful synthesis attempts remain for this IP address.`;
    setResult("Audio ready", chunks.length > 1 ? `${chunks.length} speech segments were joined with smooth transitions.` : "Use the player or download the generated audio.");
    finish();
  } catch (error) { finish(error.message || "Could not reach the speech service. Check the Worker URL and deployment."); }
}

renderSamples(); updateCount();
ui.text.addEventListener("input", () => { ui.translation.hidden = true; updateCount(); });
ui.random.addEventListener("click", chooseRandomSample);
ui.button.addEventListener("click", synthesize);
ui.status.className = "status connected"; ui.label.textContent = "Service ready"; ui.button.disabled = false;
setResult("Ready", "Choose an example or enter your own Tibetan text.");
