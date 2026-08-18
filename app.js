// ---- Storage keys ----
const SETTINGS_KEY = "jlpt_settings";
const STATE_KEY_PREFIX = "jlpt_state_"; // one state per level, e.g. jlpt_state_N5
const STREAK_KEY = "jlpt_streak"; // global — one streak across all levels

// ---- In-memory data, loaded from /data/*.json on startup ----
let wordPool = [];       // the FULL word list for the currently selected level (unfiltered)
let filteredPool = [];   // wordPool after applying posFilter/categoryFilter
let currentWord = null;
let detailWord = null; // the word currently shown in the word-detail panel
let currentLevelState = null; // the loaded state object for settings.level, kept in sync
let tagLabels = {};      // code -> human-readable label, loaded from data/tags.json

// ---- Elements ----
const els = {
  furigana: document.getElementById("furigana"),
  kanji: document.getElementById("kanji"),
  romaji: document.getElementById("romaji"),
  meaning: document.getElementById("meaning"),
  levelBadge: document.getElementById("level-badge"),
  wordCard: document.getElementById("word-card"),
  speakerBtn: document.getElementById("speaker-btn"),
  browseBtn: document.getElementById("browse-btn"),
  browsePanel: document.getElementById("browse-panel"),
  browseBack: document.getElementById("browse-back"),
  browseSearch: document.getElementById("browse-search"),
  browseList: document.getElementById("browse-list"),
  browseEmpty: document.getElementById("browse-empty"),
  browseLevelLabel: document.getElementById("browse-level-label"),
  detailPanel: document.getElementById("detail-panel"),
  detailBack: document.getElementById("detail-back"),
  detailLevelBadge: document.getElementById("detail-level-badge"),
  detailSpeakerBtn: document.getElementById("detail-speaker-btn"),
  detailFurigana: document.getElementById("detail-furigana"),
  detailPitchDisplay: document.getElementById("detail-pitch-display"),
  detailKanji: document.getElementById("detail-kanji"),
  detailUkTag: document.getElementById("detail-uk-tag"),
  detailRomaji: document.getElementById("detail-romaji"),
  detailMeaning: document.getElementById("detail-meaning"),
  detailInfoRows: document.getElementById("detail-info-rows"),
  detailStarBtn: document.getElementById("detail-star-btn"),
  detailKnowBtn: document.getElementById("detail-know-btn"),
  skipBtn: document.getElementById("skip-btn"),
  starBtn: document.getElementById("star-btn"),
  knowBtn: document.getElementById("know-btn"),
  progressNote: document.getElementById("progress-note"),
  settingsBtn: document.getElementById("settings-btn"),
  overlay: document.getElementById("overlay"),
  settingsPanel: document.getElementById("settings-panel"),
  closeSettings: document.getElementById("close-settings"),
  levelPicker: document.getElementById("level-picker"),
  romajiToggle: document.getElementById("romaji-toggle"),
  pitchToggle: document.getElementById("pitch-toggle"),
  pitchDisplay: document.getElementById("pitch-display"),
  posFilterRow: document.getElementById("pos-filter-row"),
  ukTag: document.getElementById("uk-tag"),
  reviewBtn: document.getElementById("review-btn"),
  reviewPanel: document.getElementById("review-panel"),
  reviewBack: document.getElementById("review-back"),
  reviewTabs: document.getElementById("review-tabs"),
  reviewList: document.getElementById("review-list"),
  reviewEmpty: document.getElementById("review-empty"),
  reviewLevelLabel: document.getElementById("review-level-label"),
  reviewHeadingText: document.getElementById("review-heading-text"),
  reviewRenameBtn: document.getElementById("review-rename-btn"),
  streakBadge: document.getElementById("streak-badge"),
  exportBtn: document.getElementById("export-btn"),
  importBtn: document.getElementById("import-btn"),
  importFileInput: document.getElementById("import-file-input"),
};

let activeReviewTab = "still-learning"; // "still-learning" | "known" | "all-seen"

// ---- Settings ----
function loadSettings() {
  const raw = localStorage.getItem(SETTINGS_KEY);
  const defaultListNames = { "still-learning": "Still Learning", "known": "Known" };
  if (raw) {
    const s = JSON.parse(raw);
    // Fill in defaults for settings added after this app was first built
    if (s.showPitchAccent === undefined) s.showPitchAccent = false;
    if (s.posFilter === undefined) s.posFilter = "";
    if (!s.listNames) s.listNames = defaultListNames;
    delete s.categoryFilter; // removed feature — drop any old saved value
    return s;
  }
  return { level: "N5", showRomaji: false, showPitchAccent: false, posFilter: "", listNames: defaultListNames };
}

function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

let settings = loadSettings();

// ---- Per-level state (today's word + which words have already been shown) ----
function loadState(level) {
  const raw = localStorage.getItem(STATE_KEY_PREFIX + level);
  if (raw) {
    const state = JSON.parse(raw);
    // wordStatus/allSeenIds were added after this app was first built — make
    // sure older saved states from before these features still work fine.
    if (!state.wordStatus) state.wordStatus = {};
    if (!state.allSeenIds) state.allSeenIds = [...state.seenWordIds]; // best-effort backfill
    return state;
  }
  return { date: null, currentWordId: null, seenWordIds: [], allSeenIds: [], wordStatus: {} };
}

function saveState(level, state) {
  localStorage.setItem(STATE_KEY_PREFIX + level, JSON.stringify(state));
}

function todayString() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

// ---- Streak tracking (global, not per-level) ----
function dateOnly(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function daysBetween(a, b) {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((dateOnly(b) - dateOnly(a)) / msPerDay);
}

function loadStreak() {
  const raw = localStorage.getItem(STREAK_KEY);
  if (raw) return JSON.parse(raw);
  return { lastActiveDate: null, currentStreak: 0 };
}

function updateStreak() {
  const streak = loadStreak();
  const now = new Date();

  if (!streak.lastActiveDate) {
    streak.currentStreak = 1;
  } else {
    const last = new Date(streak.lastActiveDate);
    const gap = daysBetween(last, now);
    if (gap === 0) {
      // already counted today, no change
    } else if (gap === 1) {
      streak.currentStreak += 1;
    } else {
      streak.currentStreak = 1; // streak broken, restart
    }
  }

  streak.lastActiveDate = now.toISOString();
  localStorage.setItem(STREAK_KEY, JSON.stringify(streak));
  return streak;
}

function renderStreak() {
  const streak = loadStreak();
  if (streak.currentStreak >= 2) {
    els.streakBadge.textContent = `🔥 ${streak.currentStreak} day streak`;
    els.streakBadge.classList.remove("hidden");
  } else {
    els.streakBadge.classList.add("hidden");
  }
}

// ---- Audio pronunciation ----
const speechSupported = "speechSynthesis" in window;

function speakText(text) {
  if (!speechSupported || !text) return;
  try {
    window.speechSynthesis.cancel(); // stop anything already playing
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "ja-JP";
    utterance.rate = 0.85;
    window.speechSynthesis.speak(utterance);
  } catch (err) {
    console.warn("Speech synthesis failed:", err);
  }
}

function speakCurrentWord() {
  if (currentWord) speakText(currentWord.furigana);
}
// ---- Backup / restore ----
const ALL_LEVELS = ["N5", "N4", "N3"];

function exportProgress() {
  const backup = {
    exportedAt: new Date().toISOString(),
    settings: JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null"),
    streak: JSON.parse(localStorage.getItem(STREAK_KEY) || "null"),
    levelStates: {},
  };
  ALL_LEVELS.forEach((level) => {
    const raw = localStorage.getItem(STATE_KEY_PREFIX + level);
    if (raw) backup.levelStates[level] = JSON.parse(raw);
  });

  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const dateStamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `jlpt-word-app-backup-${dateStamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function importProgress(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let backup;
    try {
      backup = JSON.parse(reader.result);
    } catch (err) {
      alert("That file doesn't look like a valid backup — couldn't read it as JSON.");
      return;
    }

    if (!backup || typeof backup !== "object" || !backup.levelStates) {
      alert("That file doesn't look like a JLPT app backup.");
      return;
    }

    if (!confirm("This will replace your current progress with the backup. Continue?")) {
      return;
    }

    if (backup.settings) localStorage.setItem(SETTINGS_KEY, JSON.stringify(backup.settings));
    if (backup.streak) localStorage.setItem(STREAK_KEY, JSON.stringify(backup.streak));
    Object.entries(backup.levelStates).forEach(([level, state]) => {
      localStorage.setItem(STATE_KEY_PREFIX + level, JSON.stringify(state));
    });

    alert("Backup restored. The app will now reload.");
    location.reload();
  };
  reader.readAsText(file);
}

// ---- Word pool loading ----
async function loadWordPool(level) {
  const res = await fetch(`data/${level.toLowerCase()}.json`);
  if (!res.ok) throw new Error(`Failed to load word list for ${level}`);
  return res.json();
}

async function loadTagLabels() {
  if (Object.keys(tagLabels).length > 0) return tagLabels;
  try {
    const res = await fetch("data/tags.json");
    if (res.ok) tagLabels = await res.json();
  } catch (err) {
    console.warn("Could not load tag labels, falling back to raw codes.", err);
  }
  return tagLabels;
}

// ---- Filtering ----
function applyFilters(pool) {
  if (!settings.posFilter) return pool;
  return pool.filter((w) => (w.posBuckets || []).includes(settings.posFilter));
}

function buildFilterChips(pool) {
  const posValues = [...new Set(pool.flatMap((w) => w.posBuckets || []))].sort();

  // Reset the filter if the currently selected value no longer exists in this level's pool
  if (settings.posFilter && !posValues.includes(settings.posFilter)) settings.posFilter = "";
  saveSettings(settings);

  renderChipRow(els.posFilterRow, posValues, settings.posFilter, (v) => v, (value) => {
    settings.posFilter = value;
    saveSettings(settings);
    initLevel(settings.level, { forceNewWord: true });
  });
}

function renderChipRow(container, values, activeValue, labelFn, onSelect) {
  container.innerHTML = "";

  const allChip = document.createElement("button");
  allChip.className = "chip" + (activeValue === "" ? " active" : "");
  allChip.textContent = "All";
  allChip.addEventListener("click", () => onSelect(""));
  container.appendChild(allChip);

  values.forEach((value) => {
    const chip = document.createElement("button");
    chip.className = "chip" + (value === activeValue ? " active" : "");
    chip.textContent = labelFn(value);
    chip.addEventListener("click", () => onSelect(value));
    container.appendChild(chip);
  });
}

// ---- Picking words ----
function pickRandomUnseen(pool, seenIds) {
  const unseen = pool.filter((w) => !seenIds.includes(wordId(w)));
  const source = unseen.length > 0 ? unseen : pool; // cycle restart once exhausted
  return source[Math.floor(Math.random() * source.length)];
}

function wordId(word) {
  // kanji + furigana together uniquely identify a word in our dataset
  return `${word.kanji}|${word.furigana}`;
}

// ---- Rendering ----
function render(word, { animate = false } = {}) {
  const doRender = () => {
    els.furigana.textContent = word.furigana;
    els.kanji.textContent = word.kanji;
    els.romaji.textContent = word.romaji;
    els.romaji.classList.toggle("hidden", !settings.showRomaji);
    els.meaning.textContent = word.meaning;
    els.levelBadge.textContent = word.level;

    // Words usually written in kana: swap visual hierarchy so kana is the
    // hero and the rarely-used kanji becomes a small reference line.
    els.furigana.classList.toggle("hero-text", word.usuallyKana);
    els.kanji.classList.toggle("minor-text", word.usuallyKana);
    els.ukTag.classList.toggle("hidden", !word.usuallyKana);

    renderPitchAccent(word);
  };

  if (!animate) {
    doRender();
    return;
  }

  els.wordCard.classList.add("fade");
  setTimeout(() => {
    doRender();
    els.wordCard.classList.remove("fade");
  }, 150);
}

function renderPitchAccentInto(word, targetEl, forceShow) {
  const pattern = word.pitchAccent && word.pitchAccent.zoPatts;
  if ((!forceShow && !settings.showPitchAccent) || !pattern) {
    targetEl.classList.add("hidden");
    targetEl.innerHTML = "";
    return;
  }
  targetEl.innerHTML = "";
  [...pattern].forEach((mora) => {
    const dot = document.createElement("span");
    dot.className = "pitch-dot " + (mora === "H" ? "high" : "low");
    targetEl.appendChild(dot);
  });
  targetEl.classList.remove("hidden");
}

function renderPitchAccent(word) {
  renderPitchAccentInto(word, els.pitchDisplay, false);
}

function renderProgress(state, pool) {
  const seenCount = Math.min(state.seenWordIds.length, pool.length);
  els.progressNote.textContent = `${seenCount} / ${pool.length} ${settings.level} words seen`;
}

// ---- Core flow ----
async function initLevel(level, { forceNewWord = false } = {}) {
  wordPool = await loadWordPool(level);
  buildFilterChips(wordPool);
  filteredPool = applyFilters(wordPool);

  let state = loadState(level);
  const today = todayString();

  if (filteredPool.length === 0) {
    currentWord = null;
    currentLevelState = state;
    els.furigana.textContent = "–";
    els.kanji.textContent = "–";
    els.romaji.textContent = "";
    els.meaning.textContent = "No words match this filter for this level.";
    els.pitchDisplay.classList.add("hidden");
    els.progressNote.textContent = "";
    return;
  }

  const needsNewWord =
    forceNewWord ||
    state.date !== today ||
    state.currentWordId === null ||
    !filteredPool.some((w) => wordId(w) === state.currentWordId);

  if (needsNewWord) {
    // If every word in the filtered pool has already been shown, start a fresh cycle
    if (state.seenWordIds.length >= filteredPool.length) {
      state.seenWordIds = [];
    }

    const picked = pickRandomUnseen(filteredPool, state.seenWordIds);
    const id = wordId(picked);

    state.seenWordIds.push(id);
    state.currentWordId = id;
    state.date = today;

    // allSeenIds is permanent — it never resets, unlike seenWordIds above,
    // so a word stays reachable in "All Seen" even after the rotation cycles.
    if (!state.allSeenIds.includes(id)) state.allSeenIds.push(id);

    saveState(level, state);
  }

  currentWord = wordPool.find((w) => wordId(w) === state.currentWordId) || filteredPool[0];
  currentLevelState = state;
  render(currentWord, { animate: forceNewWord });
  renderProgress(state, filteredPool);
  updateActionButtonsUI();
}

async function skipWord() {
  await initLevel(settings.level, { forceNewWord: true });
}

// ---- Word status: "still-learning" / "known" / (absent = "new") ----
function getWordStatus(wordIdValue) {
  if (!currentLevelState) return null;
  return currentLevelState.wordStatus[wordIdValue] || null;
}

function setWordStatus(level, state, wordIdValue, status) {
  // Tapping the same status again clears it back to "new"
  if (state.wordStatus[wordIdValue] === status) {
    delete state.wordStatus[wordIdValue];
  } else {
    state.wordStatus[wordIdValue] = status;
  }
  saveState(level, state);
}

function updateActionButtonsUI() {
  if (!currentWord) return;
  const status = getWordStatus(wordId(currentWord));
  els.starBtn.classList.toggle("active", status === "still-learning");
  els.knowBtn.classList.toggle("active", status === "known");
}

function handleMarkStatus(status) {
  if (!currentWord || !currentLevelState) return;
  setWordStatus(settings.level, currentLevelState, wordId(currentWord), status);
  updateActionButtonsUI();
  // If the review panel is open on this tab, keep it in sync
  if (els.reviewPanel.classList.contains("open")) {
    renderReviewList();
  }
}

// ---- Settings panel ----
function openSettings() {
  els.overlay.classList.add("open");
  els.settingsPanel.classList.add("open");
}

function closeSettingsPanel() {
  els.overlay.classList.remove("open");
  els.settingsPanel.classList.remove("open");
}

function refreshSettingsUI() {
  [...els.levelPicker.children].forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.level === settings.level);
  });
  els.romajiToggle.checked = settings.showRomaji;
  els.pitchToggle.checked = settings.showPitchAccent;
}

// ---- Review panel ----
function currentTabDisplayName() {
  if (activeReviewTab === "all-seen") return "All Seen";
  return settings.listNames[activeReviewTab];
}

function openReview() {
  els.reviewLevelLabel.textContent = settings.level;
  refreshReviewHeader();
  renderReviewList();
  els.reviewPanel.classList.add("open");
}

function closeReviewPanel() {
  els.reviewPanel.classList.remove("open");
}

function refreshReviewHeader() {
  els.reviewHeadingText.textContent = currentTabDisplayName();
  // "All Seen" is a fixed, permanent list — renaming doesn't apply to it
  els.reviewRenameBtn.style.visibility = activeReviewTab === "all-seen" ? "hidden" : "visible";

  [...els.reviewTabs.children].forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.status === activeReviewTab);
    if (btn.dataset.status !== "all-seen") {
      btn.textContent = settings.listNames[btn.dataset.status];
    }
  });
}

function startRenamingActiveList() {
  if (activeReviewTab === "all-seen") return;

  const input = document.createElement("input");
  input.type = "text";
  input.className = "review-heading-input";
  input.value = settings.listNames[activeReviewTab];
  input.maxLength = 24;

  els.reviewHeadingText.replaceWith(input);
  input.focus();
  input.select();

  const commit = () => {
    const newName = input.value.trim() || settings.listNames[activeReviewTab];
    settings.listNames[activeReviewTab] = newName;
    saveSettings(settings);
    input.replaceWith(els.reviewHeadingText);
    refreshReviewHeader();
  };

  input.addEventListener("blur", commit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") input.blur();
  });
}

function renderReviewList() {
  els.reviewList.innerHTML = "";
  if (!currentLevelState) return;

  let entries;
  if (activeReviewTab === "all-seen") {
    entries = currentLevelState.allSeenIds.map((id) => [id, currentLevelState.wordStatus[id] || null]);
  } else {
    entries = Object.entries(currentLevelState.wordStatus).filter(
      ([, status]) => status === activeReviewTab
    );
  }

  if (entries.length === 0) {
    els.reviewEmpty.style.display = "block";
    els.reviewList.appendChild(els.reviewEmpty);
    return;
  }
  els.reviewEmpty.style.display = "none";

  entries.forEach(([id, status]) => {
    const word = wordPool.find((w) => wordId(w) === id);
    if (!word) return; // shouldn't happen, but guard just in case

    const row = document.createElement("div");
    row.className = "review-item";

    if (activeReviewTab === "all-seen") {
      row.innerHTML = `
        <div class="review-item-text">
          <span class="review-item-word">${word.kanji}</span><span class="review-item-furigana">${word.furigana}</span>
          <div class="review-item-meaning">${word.meaning}</div>
        </div>
        <div class="review-item-actions">
          <button class="star-status ${status === "still-learning" ? "status-active" : ""}" aria-label="Mark still learning">☆</button>
          <button class="know-status ${status === "known" ? "status-active" : ""}" aria-label="Mark known">✓</button>
        </div>
      `;

      row.querySelector(".star-status").addEventListener("click", () => {
        setWordStatus(settings.level, currentLevelState, id, "still-learning");
        renderReviewList();
        updateActionButtonsUI();
      });

      row.querySelector(".know-status").addEventListener("click", () => {
        setWordStatus(settings.level, currentLevelState, id, "known");
        renderReviewList();
        updateActionButtonsUI();
      });

      row.querySelector(".review-item-text").addEventListener("click", () => openWordDetail(word));
    } else {
      const otherStatus = status === "still-learning" ? "known" : "still-learning";
      const moveIcon = status === "still-learning" ? "✓" : "☆";
      const moveLabel = status === "still-learning" ? "Mark known" : "Mark still learning";

      row.innerHTML = `
        <div class="review-item-text">
          <span class="review-item-word">${word.kanji}</span><span class="review-item-furigana">${word.furigana}</span>
          <div class="review-item-meaning">${word.meaning}</div>
        </div>
        <div class="review-item-actions">
          <button class="move-btn" aria-label="${moveLabel}">${moveIcon}</button>
          <button class="remove-btn" aria-label="Remove from list">✕</button>
        </div>
      `;

      row.querySelector(".move-btn").addEventListener("click", () => {
        setWordStatus(settings.level, currentLevelState, id, otherStatus);
        renderReviewList();
        updateActionButtonsUI();
      });

      row.querySelector(".remove-btn").addEventListener("click", () => {
        delete currentLevelState.wordStatus[id];
        saveState(settings.level, currentLevelState);
        renderReviewList();
        updateActionButtonsUI();
      });

      row.querySelector(".review-item-text").addEventListener("click", () => openWordDetail(word));
    }

    els.reviewList.appendChild(row);
  });
}

// ---- Browse / search ----
function openBrowse() {
  els.browseLevelLabel.textContent = settings.level;
  renderBrowseList();
  els.browsePanel.classList.add("open");
  els.browseSearch.focus();
}

function closeBrowsePanel() {
  els.browsePanel.classList.remove("open");
}

function renderBrowseList() {
  const term = els.browseSearch.value.trim().toLowerCase();
  const matches = !term
    ? wordPool
    : wordPool.filter(
        (w) =>
          w.kanji.toLowerCase().includes(term) ||
          w.furigana.toLowerCase().includes(term) ||
          w.romaji.toLowerCase().includes(term) ||
          w.meaning.toLowerCase().includes(term)
      );

  els.browseList.innerHTML = "";
  if (matches.length === 0) {
    els.browseEmpty.style.display = "block";
    els.browseList.appendChild(els.browseEmpty);
    return;
  }
  els.browseEmpty.style.display = "none";

  matches.forEach((word) => {
    const id = wordId(word);
    const status = currentLevelState ? currentLevelState.wordStatus[id] || null : null;

    const row = document.createElement("div");
    row.className = "review-item";
    row.innerHTML = `
      <div class="review-item-text">
        <span class="review-item-word">${word.kanji}</span><span class="review-item-furigana">${word.furigana}</span>
        <div class="review-item-meaning">${word.meaning}</div>
      </div>
      <div class="review-item-actions">
        <button class="star-status ${status === "still-learning" ? "status-active" : ""}" aria-label="Mark still learning">☆</button>
        <button class="know-status ${status === "known" ? "status-active" : ""}" aria-label="Mark known">✓</button>
      </div>
    `;

    row.querySelector(".star-status").addEventListener("click", () => {
      setWordStatus(settings.level, currentLevelState, id, "still-learning");
      renderBrowseList();
      updateActionButtonsUI();
    });

    row.querySelector(".know-status").addEventListener("click", () => {
      setWordStatus(settings.level, currentLevelState, id, "known");
      renderBrowseList();
      updateActionButtonsUI();
    });

    row.querySelector(".review-item-text").addEventListener("click", () => openWordDetail(word));

    els.browseList.appendChild(row);
  });
}

// ---- Word detail panel ----
const POS_BUCKET_LABELS = {
  Verbs: "Verb", Nouns: "Noun", Adjectives: "Adjective", Adverbs: "Adverb",
  Particles: "Particle", Expressions: "Expression", Conjunctions: "Conjunction",
  Interjections: "Interjection", "Prefix/Suffix": "Prefix/Suffix",
  Pronouns: "Pronoun", Counters: "Counter", Other: "Other",
};

function buildDetailInfoRows(word) {
  let html = "";

  if (word.posBuckets && word.posBuckets.length) {
    const tags = word.posBuckets.map((b) => `<span class="chip">${POS_BUCKET_LABELS[b] || b}</span>`).join("");
    html += `<div class="detail-info-row"><span class="detail-info-label">Word type</span><div class="detail-info-tags">${tags}</div></div>`;
  }

  if (word.pitchAccent && word.pitchAccent.zoPatts) {
    html += `<div class="detail-info-row"><span class="detail-info-label">Pitch pattern</span><span class="detail-info-value">${word.pitchAccent.zoPatts} (position ${word.pitchAccent.accPatts})</span></div>`;
  }

  els.detailInfoRows.innerHTML = html;
}

function openWordDetail(word) {
  detailWord = word;
  const id = wordId(word);
  const status = currentLevelState ? currentLevelState.wordStatus[id] || null : null;

  els.detailLevelBadge.textContent = word.level;
  els.detailFurigana.textContent = word.furigana;
  els.detailKanji.textContent = word.kanji;
  els.detailRomaji.textContent = word.romaji;
  els.detailMeaning.textContent = word.meaning;

  els.detailFurigana.classList.toggle("hero-text", word.usuallyKana);
  els.detailKanji.classList.toggle("minor-text", word.usuallyKana);
  els.detailUkTag.classList.toggle("hidden", !word.usuallyKana);

  // Detail view always shows pitch accent when available, regardless of
  // the home-screen setting — this is the deliberate deep-dive view.
  renderPitchAccentInto(word, els.detailPitchDisplay, true);

  buildDetailInfoRows(word);

  els.detailStarBtn.classList.toggle("active", status === "still-learning");
  els.detailKnowBtn.classList.toggle("active", status === "known");

  els.detailPanel.classList.add("open");
}

function closeWordDetail() {
  els.detailPanel.classList.remove("open");
  // A status mark made from the detail view needs to be reflected back in
  // whichever list opened it, and on the main card if it's the same word.
  if (els.reviewPanel.classList.contains("open")) renderReviewList();
  if (els.browsePanel.classList.contains("open")) renderBrowseList();
  if (currentWord) updateActionButtonsUI();
}

function handleDetailMark(status) {
  if (!detailWord || !currentLevelState) return;
  const id = wordId(detailWord);
  setWordStatus(settings.level, currentLevelState, id, status);
  const newStatus = currentLevelState.wordStatus[id] || null;
  els.detailStarBtn.classList.toggle("active", newStatus === "still-learning");
  els.detailKnowBtn.classList.toggle("active", newStatus === "known");
}

// ---- Event wiring ----
els.skipBtn.addEventListener("click", skipWord);
els.starBtn.addEventListener("click", () => handleMarkStatus("still-learning"));
els.knowBtn.addEventListener("click", () => handleMarkStatus("known"));
els.settingsBtn.addEventListener("click", openSettings);
els.overlay.addEventListener("click", closeSettingsPanel);
els.closeSettings.addEventListener("click", closeSettingsPanel);
els.reviewBtn.addEventListener("click", openReview);
els.reviewBack.addEventListener("click", closeReviewPanel);
els.reviewRenameBtn.addEventListener("click", startRenamingActiveList);

els.reviewTabs.addEventListener("click", (e) => {
  const btn = e.target.closest(".review-tab");
  if (!btn) return;
  activeReviewTab = btn.dataset.status;
  refreshReviewHeader();
  renderReviewList();
});

els.levelPicker.addEventListener("click", async (e) => {
  const btn = e.target.closest(".level-option");
  if (!btn) return;
  const newLevel = btn.dataset.level;
  if (newLevel === settings.level) return;

  settings.level = newLevel;
  saveSettings(settings);
  refreshSettingsUI();
  await initLevel(newLevel);
});

els.romajiToggle.addEventListener("change", () => {
  settings.showRomaji = els.romajiToggle.checked;
  saveSettings(settings);
  els.romaji.classList.toggle("hidden", !settings.showRomaji);
});

els.pitchToggle.addEventListener("change", () => {
  settings.showPitchAccent = els.pitchToggle.checked;
  saveSettings(settings);
  if (currentWord) renderPitchAccent(currentWord);
});

els.exportBtn.addEventListener("click", exportProgress);
els.importBtn.addEventListener("click", () => els.importFileInput.click());
els.importFileInput.addEventListener("change", () => {
  const file = els.importFileInput.files[0];
  if (file) importProgress(file);
  els.importFileInput.value = ""; // allow re-selecting the same file later
});

els.speakerBtn.addEventListener("click", speakCurrentWord);

els.browseBtn.addEventListener("click", openBrowse);
els.browseBack.addEventListener("click", closeBrowsePanel);
els.browseSearch.addEventListener("input", renderBrowseList);

els.detailBack.addEventListener("click", closeWordDetail);
els.detailStarBtn.addEventListener("click", () => handleDetailMark("still-learning"));
els.detailKnowBtn.addEventListener("click", () => handleDetailMark("known"));
els.detailSpeakerBtn.addEventListener("click", () => {
  if (detailWord) speakText(detailWord.furigana);
});

// ---- Startup ----
(async function start() {
  refreshSettingsUI();
  updateStreak();
  renderStreak();
  if (speechSupported) els.speakerBtn.classList.remove("hidden");
  try {
    await initLevel(settings.level);
  } catch (err) {
    els.meaning.textContent = "Couldn't load word data. Check your connection.";
    console.error(err);
  }
})();
