// ---- 코드 음악 이론 유틸 -------------------------------------------------

const NOTE_BASE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

// 흔히 쓰이는 코드 성질(quality) 표기. 뒤에서부터(긴 것부터) 매칭되도록 길이순 정렬.
const QUALITIES = [
  "maj13", "maj11", "maj9", "maj7", "dim7", "m7b5", "m7#5", "mM7",
  "add11", "add9", "add4", "add2", "sus2", "sus4", "min7", "min9", "min",
  "maj", "dim", "aug", "m13", "m11", "m9", "m7", "m6", "6/9",
  "13", "11", "9", "7", "6", "5", "4", "2", "m", "+", "°", "ø",
].sort((a, b) => b.length - a.length);

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const ROOT_PATTERN = "[A-G](?:#|♯|b|♭)?";
const QUALITY_ALTERNATION = QUALITIES.map(escapeRegExp).join("|");
const CHORD_RE = new RegExp(
  `^(${ROOT_PATTERN})((?:${QUALITY_ALTERNATION})*)(?:/(${ROOT_PATTERN}))?$`
);

function noteToSemitone(note) {
  const letter = note[0].toUpperCase();
  let acc = 0;
  const rest = note.slice(1);
  if (rest === "#" || rest === "♯") acc = 1;
  else if (rest === "b" || rest === "♭") acc = -1;
  return (((NOTE_BASE[letter] ?? 0) + acc) % 12 + 12) % 12;
}

function semitoneToNote(semitone, preferFlat) {
  const n = ((semitone % 12) + 12) % 12;
  return preferFlat ? FLAT_NAMES[n] : SHARP_NAMES[n];
}

function isFlatSpelling(note) {
  return note.length > 1 && (note[1] === "b" || note[1] === "♭");
}

function parseChord(raw) {
  const token = String(raw || "").trim();
  if (!token) return null;
  const match = CHORD_RE.exec(token);
  if (!match) return null;
  const [, root, quality, bass] = match;
  return {
    root,
    quality: quality || "",
    bass: bass || "",
    rootSemitone: noteToSemitone(root),
    bassSemitone: bass ? noteToSemitone(bass) : null,
    preferFlat: isFlatSpelling(root),
  };
}

function formatChord({ root, quality, bass }) {
  return `${root}${quality || ""}${bass ? `/${bass}` : ""}`;
}

function transposeChord(parsed, shift, preferFlat) {
  const newRoot = semitoneToNote(parsed.rootSemitone + shift, preferFlat);
  const newBass = parsed.bass ? semitoneToNote(parsed.bassSemitone + shift, preferFlat) : "";
  return formatChord({ root: newRoot, quality: parsed.quality, bass: newBass });
}

// capo N번 프렛에 채우고 X 모양을 잡으면 실제 소리는 (X + N) 음이 된다.
// 원곡 코드 Y를 모양 X로 연주하려면: N = (Y - X) mod 12
function calcCapoFret(originalRootSemitone, targetRootSemitone) {
  return ((originalRootSemitone - targetRootSemitone) % 12 + 12) % 12;
}

// ---- DOM 참조 -------------------------------------------------------------

const imageInput = document.getElementById("image-input");
const recognizeBtn = document.getElementById("recognize-btn");
const imageHint = document.getElementById("image-hint");
const imagePreview = document.getElementById("image-preview");
const ocrStatus = document.getElementById("ocr-status");
const ocrDebug = document.getElementById("ocr-debug");
const ocrDebugText = document.getElementById("ocr-debug-text");

const manualInput = document.getElementById("manual-input");
const manualApplyBtn = document.getElementById("manual-apply-btn");

const chipList = document.getElementById("chip-list");
const addChipBtn = document.getElementById("add-chip-btn");

const firstChordInput = document.getElementById("first-chord-input");
const targetChordInput = document.getElementById("target-chord");
const calcBtn = document.getElementById("calc-btn");
const resultEl = document.getElementById("result");

// ---- 상태 -----------------------------------------------------------------

/** @type {{ id: number, value: string }[]} */
let chords = [];
let chipIdSeq = 0;
let selectedImageFile = null;

function setOcrStatus(message, isError = false) {
  if (!message) {
    ocrStatus.hidden = true;
    ocrStatus.textContent = "";
    ocrStatus.classList.remove("error");
    return;
  }
  ocrStatus.hidden = false;
  ocrStatus.textContent = message;
  ocrStatus.classList.toggle("error", isError);
}

function renderChips() {
  if (!chords.length) {
    chipList.innerHTML = `<div class="chip-list-empty">아직 코드가 없습니다. 이미지를 인식하거나 직접 입력해 주세요.</div>`;
  } else {
    chipList.innerHTML = chords
      .map(
        (chord, i) => `
        <div class="chip${i === 0 ? " first-chip" : ""}" data-id="${chord.id}">
          <span class="chip-index">${i === 0 ? "★" : i + 1}</span>
          <input type="text" value="${chord.value.replace(/"/g, "&quot;")}" data-role="chip-input" />
          <button type="button" class="chip-del" data-role="chip-del" aria-label="코드 삭제">×</button>
        </div>`
      )
      .join("");
  }
  updateFirstChordInput();
}

// 첫 마디 코드 입력칸과 코드 목록의 첫 번째 칸은 항상 같은 값을 가리키도록 동기화한다.
function updateFirstChordInput() {
  if (document.activeElement === firstChordInput) return;
  firstChordInput.value = chords[0]?.value ?? "";
}

function syncFirstChipInput(value) {
  if (!chords.length) return;
  const chipInput = chipList.querySelector(`.chip[data-id="${chords[0].id}"] input`);
  if (chipInput) chipInput.value = value;
}

firstChordInput.addEventListener("input", () => {
  const value = firstChordInput.value;
  if (!chords.length) {
    if (!value.trim()) return;
    chords.push({ id: ++chipIdSeq, value });
    renderChips();
    return;
  }
  chords[0].value = value;
  syncFirstChipInput(value);
});

function addChip(value = "") {
  chords.push({ id: ++chipIdSeq, value });
  renderChips();
  const lastInput = chipList.querySelector(`.chip[data-id="${chords[chords.length - 1].id}"] input`);
  lastInput?.focus();
}

function replaceChordsFromTokens(tokens) {
  chords = tokens.map((value) => ({ id: ++chipIdSeq, value }));
  renderChips();
  resultEl.hidden = true;
}

chipList.addEventListener("input", (event) => {
  const input = event.target.closest('[data-role="chip-input"]');
  if (!input) return;
  const id = Number(input.closest(".chip").dataset.id);
  const chord = chords.find((c) => c.id === id);
  if (chord) chord.value = input.value;
  if (chords[0]?.id === id) updateFirstChordInput();
});

chipList.addEventListener("click", (event) => {
  const del = event.target.closest('[data-role="chip-del"]');
  if (!del) return;
  const id = Number(del.closest(".chip").dataset.id);
  chords = chords.filter((c) => c.id !== id);
  renderChips();
});

addChipBtn.addEventListener("click", () => addChip(""));

// ---- 직접 입력 --------------------------------------------------------------

manualApplyBtn.addEventListener("click", () => {
  const tokens = manualInput.value
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (!tokens.length) return;
  replaceChordsFromTokens(tokens);
});

// ---- 이미지 업로드 & OCR ----------------------------------------------------

imageInput.addEventListener("change", () => {
  const file = imageInput.files?.[0] || null;
  selectedImageFile = file;
  recognizeBtn.disabled = !file;
  setOcrStatus("");
  if (file) {
    imagePreview.src = URL.createObjectURL(file);
    imagePreview.hidden = false;
  } else {
    imagePreview.hidden = true;
  }
});

function groupWordsIntoRows(words) {
  const sorted = [...words].sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
  const rows = [];
  for (const word of sorted) {
    const height = Math.max(1, word.bbox.y1 - word.bbox.y0);
    const yCenter = (word.bbox.y0 + word.bbox.y1) / 2;
    const row = rows.find((r) => Math.abs(r.yCenter - yCenter) < r.height * 0.7);
    if (row) {
      row.words.push(word);
      row.yCenter = (row.yCenter * row.count + yCenter) / (row.count + 1);
      row.count += 1;
    } else {
      rows.push({ yCenter, height, count: 1, words: [word] });
    }
  }
  rows.sort((a, b) => a.yCenter - b.yCenter);
  for (const row of rows) row.words.sort((a, b) => a.bbox.x0 - b.bbox.x0);
  return rows;
}

function cleanToken(raw) {
  return String(raw || "").trim().replace(/[^0-9A-Za-z#♯b♭/+°ø]/g, "");
}

// 이 해상도·글꼴에서는 샤프(#) 기호가 소문자 "i"로 잘못 읽히는 경우가 매우 흔하다
// (예: "F#m" -> "Fim"). 근음 바로 뒤에 오는 "i"를 "#"으로 바꿔서도 시도해 본다.
function chordCandidates(token) {
  const candidates = [token];
  if (/^[A-G]i/.test(token)) candidates.push(token.replace(/^([A-G])i/, "$1#"));
  return candidates;
}

// 두 인식 결과가 같은 위치를 가리키는지 비교할 때 쓰는 정규화된 키.
// "Fim/A"와 "F#m/A"처럼 표기는 다르지만 같은 코드를 가리키는 경우를 같은 것으로 취급한다.
function canonicalChordToken(rawText) {
  const token = cleanToken(rawText);
  for (const candidate of chordCandidates(token)) {
    if (parseChord(candidate)) return candidate;
  }
  return token;
}

// 근음 하나짜리 단순 코드(A, C, G...)는 A~G 알파벳 한 글자만 맞으면 통과되므로,
// 한글 글자나 음표 기둥을 잘못 읽어도 우연히 걸리기 쉽다. 이런 경우만 높은 신뢰도를
// 요구한다. 코드 성질·베이스가 붙은 복합 표기(F#m, B7, E/G# 등)는 우리 문법과 우연히
// 맞아떨어질 확률이 낮아 그 자체가 이미 좋은 필터라, 신뢰도가 낮아도 받아들인다.
const MIN_BARE_ROOT_CONFIDENCE = 70;

function extractChordsFromWords(words) {
  const rows = groupWordsIntoRows(words);
  const found = [];
  for (const row of rows) {
    for (const word of row.words) {
      const token = cleanToken(word.text);
      if (!token) continue;
      let match = null;
      for (const candidate of chordCandidates(token)) {
        const parsed = parseChord(candidate);
        if (parsed) {
          match = { candidate, parsed };
          break;
        }
      }
      if (!match) continue;
      const isBareRoot = !match.parsed.quality && !match.parsed.bass;
      if (isBareRoot && (word.confidence ?? 0) < MIN_BARE_ROOT_CONFIDENCE) continue;
      found.push(match.candidate);
    }
  }
  return found;
}

function formatOcrDebugText(words) {
  const rows = groupWordsIntoRows(words);
  const lines = [];
  for (const row of rows) {
    lines.push(row.words.map((w) => `"${w.text}"(${Math.round(w.confidence ?? 0)}%)`).join("  "));
  }
  return lines.join("\n");
}

function bboxOverlapRatio(a, b) {
  const overlapX = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const overlapY = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  if (overlapX <= 0 || overlapY <= 0) return 0;
  const areaA = (a.x1 - a.x0) * (a.y1 - a.y0);
  const areaB = (b.x1 - b.x0) * (b.y1 - b.y0);
  return (overlapX * overlapY) / Math.max(1, Math.min(areaA, areaB));
}

// 서로 다른 페이지 분석 모드(PSM)로 같은 이미지를 두 번 인식하면, 한쪽이 놓친 글자를
// 다른 쪽이 잡아내는 경우가 많다. 같은 위치를 가리키는 결과는 하나로 합친다.
function mergeOcrWordPasses(wordLists) {
  const merged = [];
  for (const words of wordLists) {
    for (const word of words) {
      const dup = merged.find(
        (w) => canonicalChordToken(w.text) === canonicalChordToken(word.text) && bboxOverlapRatio(w.bbox, word.bbox) > 0.4
      );
      if (dup) {
        if ((word.confidence ?? 0) > (dup.confidence ?? 0)) {
          dup.text = word.text;
          dup.confidence = word.confidence;
        }
        continue;
      }
      merged.push(word);
    }
  }
  return merged;
}

// 오선보 위의 작은 코드 글자는 실제 픽셀 크기가 매우 작은 경우가 많아
// 인식 전에 확대하면 정확도가 크게 올라간다.
async function upscaleForOcr(file, minLongSide = 2400) {
  const bitmap = await createImageBitmap(file);
  const longSide = Math.max(bitmap.width, bitmap.height);
  const scale = Math.max(1, minLongSide / longSide);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return canvas;
}

recognizeBtn.addEventListener("click", async () => {
  if (!selectedImageFile) return;
  if (!window.Tesseract) {
    setOcrStatus("코드 인식 엔진을 불러오지 못했습니다. 인터넷 연결을 확인하거나 아래에서 직접 입력해 주세요.", true);
    return;
  }

  recognizeBtn.disabled = true;
  imageInput.disabled = true;
  setOcrStatus("코드 인식 엔진을 불러오는 중…");

  try {
    const worker = await window.Tesseract.createWorker("eng", 1, {
      logger: (m) => {
        if (m.status && typeof m.progress === "number") {
          const pct = Math.round(m.progress * 100);
          setOcrStatus(`${describeOcrStatus(m.status)} (${pct}%)`);
        }
      },
    });
    try {
      const prepared = await upscaleForOcr(selectedImageFile);

      // 페이지 분석 모드(PSM)에 따라 잘 잡히는 글자가 다르다 — 오선보 위에 흩어진
      // 짧은 글자는 "흩어진 텍스트" 모드(11)가 유리하고, 음자리표 옆처럼 다른 그림과
      // 붙어 있는 글자는 오히려 기본 모드(3)가 더 잘 잡는 경우가 있다. 같은 이미지를
      // 두 모드로 각각 인식해서 결과를 합친다.
      setOcrStatus("코드 인식 중… (1/2)");
      await worker.setParameters({ tessedit_pageseg_mode: "11" });
      const sparsePass = await worker.recognize(prepared);

      setOcrStatus("코드 인식 중… (2/2)");
      await worker.setParameters({ tessedit_pageseg_mode: "3" });
      const defaultPass = await worker.recognize(prepared);

      const mergedWords = mergeOcrWordPasses([sparsePass.data?.words || [], defaultPass.data?.words || []]);
      const found = extractChordsFromWords(mergedWords);
      if (ocrDebug) {
        ocrDebugText.textContent = formatOcrDebugText(mergedWords) || "(인식된 글자가 없습니다)";
        ocrDebug.hidden = false;
      }
      if (!found.length) {
        setOcrStatus("코드로 보이는 글자를 찾지 못했습니다. 목록에 직접 추가하거나 아래 직접 입력을 이용해 주세요.", true);
      } else {
        replaceChordsFromTokens(found);
        setOcrStatus(
          `코드 ${found.length}개를 인식했습니다. 특히 ★표시된 첫 번째 코드는 인식이 자주 틀리니 사진과 비교해 꼭 확인해 주세요.`
        );
        firstChordInput.focus();
        firstChordInput.select();
      }
    } finally {
      await worker.terminate();
    }
  } catch (err) {
    setOcrStatus(err?.message || "코드 인식 중 문제가 발생했습니다.", true);
  } finally {
    recognizeBtn.disabled = false;
    imageInput.disabled = false;
  }
});

function describeOcrStatus(status) {
  const map = {
    "loading tesseract core": "엔진 불러오는 중",
    "initializing tesseract": "엔진 준비 중",
    "loading language traineddata": "언어 데이터 불러오는 중",
    "initializing api": "초기화 중",
    "recognizing text": "글자 인식 중",
  };
  return map[status] || status;
}

// ---- 카포 계산 --------------------------------------------------------------

calcBtn.addEventListener("click", () => {
  const originalRaw = chords[0]?.value?.trim() || "";
  const targetRaw = targetChordInput.value.trim();

  if (!originalRaw) {
    showResultError("먼저 코드 목록에 첫 마디 코드를 입력해 주세요.");
    return;
  }
  if (!targetRaw) {
    showResultError("연주하고 싶은 코드 모양을 입력해 주세요.");
    return;
  }

  const original = parseChord(originalRaw);
  const target = parseChord(targetRaw);

  if (!original) {
    showResultError(`첫 마디 코드 "${originalRaw}"를(을) 알아볼 수 없습니다. 표기를 확인해 주세요. (예: C, Am7, G/B)`);
    return;
  }
  if (!target) {
    showResultError(`목표 코드 "${targetRaw}"를(을) 알아볼 수 없습니다. 표기를 확인해 주세요. (예: C, Am, G7)`);
    return;
  }

  const capoFret = calcCapoFret(original.rootSemitone, target.rootSemitone);
  const preferFlat = target.preferFlat || (!/[#♯]/.test(targetRaw) && original.preferFlat);

  const rows = chords.map((chord, i) => {
    if (i === 0) {
      return { idx: i + 1, first: true, original: chord.value, next: targetRaw, warn: false };
    }
    const parsed = parseChord(chord.value);
    if (!parsed) {
      return { idx: i + 1, first: false, original: chord.value, next: chord.value, warn: true };
    }
    return {
      idx: i + 1,
      first: false,
      original: chord.value,
      next: transposeChord(parsed, -capoFret, preferFlat),
      warn: false,
    };
  });

  renderResult(capoFret, rows);
});

function showResultError(message) {
  resultEl.hidden = false;
  resultEl.classList.add("error");
  resultEl.innerHTML = `<p>${message}</p>`;
}

function renderResult(capoFret, rows) {
  resultEl.classList.remove("error");
  resultEl.hidden = false;

  const headline =
    capoFret === 0
      ? `<div class="capo-headline"><span class="capo-fret">카포 불필요</span><span class="capo-note">이미 원곡과 같은 코드예요.</span></div>`
      : `<div class="capo-headline"><span class="capo-fret">카포 ${capoFret}번 프렛</span><span class="capo-note">${
          capoFret > 7 ? "일반적인 범위(0~7프렛)를 벗어났어요. 낮은 프렛에서 더 쉬운 모양이 있는지도 확인해 보세요." : "위 프렛에 카포를 채우고 아래 오른쪽 코드 모양으로 연주하면 원곡과 같은 음이 납니다."
        }</span></div>`;

  const table = rows
    .map(
      (r) => `
      <div class="result-row${r.first ? " first" : ""}">
        <span class="idx">${r.idx}</span>
        <span class="orig">${escapeHtml(r.original)}</span>
        <span class="arrow2">→</span>
        <span class="new${r.warn ? " warn" : ""}">${escapeHtml(r.next)}${r.warn ? " ⚠" : ""}</span>
      </div>`
    )
    .join("");

  const newLine = rows.map((r) => r.next).join(" ");

  resultEl.innerHTML = `
    ${headline}
    <div class="result-table">${table}</div>
    <div class="result-actions">
      <button type="button" class="secondary-btn small" id="copy-result-btn">새 코드 진행 복사</button>
      <span class="hint" id="copy-result-hint"></span>
    </div>
  `;

  document.getElementById("copy-result-btn").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(newLine);
      document.getElementById("copy-result-hint").textContent = "복사했습니다.";
    } catch {
      document.getElementById("copy-result-hint").textContent = "복사에 실패했습니다.";
    }
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// ---- 초기 상태 --------------------------------------------------------------

renderChips();
