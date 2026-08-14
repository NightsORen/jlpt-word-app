// ---- Storage keys ----
const SETTINGS_KEY = "jlpt_settings";
const STATE_KEY_PREFIX = "jlpt_state_"; // one state per level, e.g. jlpt_state_N5

// ---- In-memory data, loaded from /data/*.json on startup ----
let wordPool = [];       // the full word list for the currently selected level
let currentWord = null;
let currentLevelState = null; // the loaded state object for settings.level, kept in sync

// ---- Elements ----
const els = {
  furigana: document.getElementById("furigana"),
  kanji: document.getElementById("kanji"),
  romaji: document.getElementById("romaji"),
  meaning: document.getElementById("meaning"),
  levelBadge: document.getElementById("level-badge"),
  wordCard: document.getElementById("word-card"),
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
  reviewBtn: document.getElementById("review-btn"),
  reviewOverlay: document.getElementById("review-overlay"),
  reviewPanel: document.getElementById("review-panel"),
  closeReview: document.getElementById("close-review"),
  reviewTabs: document.getElementById("review-tabs"),
  reviewList: document.getElementById("review-list"),
  reviewEmpty: document.getElementById("review-empty"),
  reviewLevelLabel: document.getElementById("review-level-label"),
};

let activeReviewTab = "still-learning"; // "still-learning" | "known"

// ---- Settings ----
function loadSettings() {
  const raw = localStorage.getItem(SETTINGS_KEY);
  if (raw) return JSON.parse(raw);
  return { level: "N5", showRomaji: false };
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
    // wordStatus was added after this app was first built — make sure
    // older saved states from before this feature still work fine.
    if (!state.wordStatus) state.wordStatus = {};
    return state;
  }
  return { date: null, currentWordId: null, seenWordIds: [], wordStatus: {} };
}

function saveState(level, state) {
  localStorage.setItem(STATE_KEY_PREFIX + level, JSON.stringify(state));
}

function todayString() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

// ---- Word pool loading ----
async function loadWordPool(level) {
  const res = await fetch(`data/${level.toLowerCase()}.json`);
  if (!res.ok) throw new Error(`Failed to load word list for ${level}`);
  return res.json();
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

function renderProgress(state, pool) {
  const seenCount = Math.min(state.seenWordIds.length, pool.length);
  els.progressNote.textContent = `${seenCount} / ${pool.length} ${settings.level} words seen`;
}

// ---- Core flow ----
async function initLevel(level, { forceNewWord = false } = {}) {
  wordPool = await loadWordPool(level);
  let state = loadState(level);
  const today = todayString();

  const needsNewWord =
    forceNewWord || state.date !== today || state.currentWordId === null;

  if (needsNewWord) {
    // If every word in the pool has already been shown, start a fresh cycle
    if (state.seenWordIds.length >= wordPool.length) {
      state.seenWordIds = [];
    }

    const picked = pickRandomUnseen(wordPool, state.seenWordIds);
    const id = wordId(picked);

    state.seenWordIds.push(id);
    state.currentWordId = id;
    state.date = today;
    saveState(level, state);
  }

  currentWord = wordPool.find((w) => wordId(w) === state.currentWordId) || wordPool[0];
  currentLevelState = state;
  render(currentWord, { animate: forceNewWord });
  renderProgress(state, wordPool);
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
}

// ---- Review panel ----
function openReview() {
  els.reviewLevelLabel.textContent = settings.level;
  renderReviewList();
  els.reviewOverlay.classList.add("open");
  els.reviewPanel.classList.add("open");
}

function closeReviewPanel() {
  els.reviewOverlay.classList.remove("open");
  els.reviewPanel.classList.remove("open");
}

function renderReviewList() {
  els.reviewList.innerHTML = "";
  if (!currentLevelState) return;

  const entries = Object.entries(currentLevelState.wordStatus).filter(
    ([, status]) => status === activeReviewTab
  );

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

    els.reviewList.appendChild(row);
  });
}

// ---- Event wiring ----
els.skipBtn.addEventListener("click", skipWord);
els.starBtn.addEventListener("click", () => handleMarkStatus("still-learning"));
els.knowBtn.addEventListener("click", () => handleMarkStatus("known"));
els.settingsBtn.addEventListener("click", openSettings);
els.overlay.addEventListener("click", closeSettingsPanel);
els.closeSettings.addEventListener("click", closeSettingsPanel);
els.reviewBtn.addEventListener("click", openReview);
els.reviewOverlay.addEventListener("click", closeReviewPanel);
els.closeReview.addEventListener("click", closeReviewPanel);

els.reviewTabs.addEventListener("click", (e) => {
  const btn = e.target.closest(".review-tab");
  if (!btn) return;
  activeReviewTab = btn.dataset.status;
  [...els.reviewTabs.children].forEach((b) =>
    b.classList.toggle("active", b === btn)
  );
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

// ---- Startup ----
(async function start() {
  refreshSettingsUI();
  try {
    await initLevel(settings.level);
  } catch (err) {
    els.meaning.textContent = "Couldn't load word data. Check your connection.";
    console.error(err);
  }
})();
