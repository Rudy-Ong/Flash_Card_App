(() => {
  "use strict";

  const screens = {
    load: document.getElementById("screen-load"),
    play: document.getElementById("screen-play"),
    complete: document.getElementById("screen-complete"),
  };

  // Load screen elements
  const csvInput = document.getElementById("csvInput");
  const fileLabelText = document.getElementById("fileLabelText");
  const loadError = document.getElementById("loadError");
  const startBtn = document.getElementById("startBtn");
  const deckBtns = document.querySelectorAll(".deck-btn");

  // Play screen elements
  const deckNameEl = document.getElementById("deckName");
  const progressCountEl = document.getElementById("progressCount");
  const progressFillEl = document.getElementById("progressFill");
  const cardEl = document.getElementById("card");
  const cardBackEl = document.getElementById("cardBack");
  const frontLabelEl = document.getElementById("frontLabel");
  const frontTextEl = document.getElementById("frontText");
  const backLabelEl = document.getElementById("backLabel");
  const backTextEl = document.getElementById("backText");
  const backMeaningEl = document.getElementById("backMeaning");
  const backExampleEl = document.getElementById("backExample");
  const flipBtn = document.getElementById("flipBtn");
  const finishBtn = document.getElementById("finishBtn");

  // Complete screen elements
  const completeEmoji = document.getElementById("completeEmoji");
  const completeTitle = document.getElementById("completeTitle");
  const completeSubtitle = document.getElementById("completeSubtitle");
  const retryBtn = document.getElementById("retryBtn");
  const exitBtn = document.getElementById("exitBtn");
  const exitNote = document.getElementById("exitNote");

  // ---- State ----
  let frontHeader = "Front";
  let backHeader = "Back";
  let meaningHeader = "Meaning";
  let exampleHeader = "Example";
  let deck = [];         // cards loaded from the current CSV, in file order
  let deckLabel = "";     // display name for the loaded deck
  let order = [];         // shuffled copy used for the active session
  let currentIndex = 0;
  let isFlipped = false;
  let isAnimating = false;

  function showScreen(name) {
    Object.entries(screens).forEach(([key, el]) => {
      el.hidden = key !== name;
    });
    const active = screens[name];
    active.classList.remove("screen-enter");
    void active.offsetWidth; // restart the entrance animation
    active.classList.add("screen-enter");
  }

  // ---- CSV parsing ----
  // A proper quote-aware parser: fields wrapped in "..." may contain commas
  // and embedded newlines (e.g. a kanji line + a romaji line in one Example
  // cell), and "" inside a quoted field is an escaped quote.
  function parseCSV(text) {
    const src = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;

    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      if (inQuotes) {
        if (c === '"') {
          if (src[i + 1] === '"') { field += '"'; i++; }
          else { inQuotes = false; }
        } else {
          field += c;
        }
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        row.push(field);
        field = "";
      } else if (c === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else {
        field += c;
      }
    }
    if (field.length > 0 || row.length > 0) {
      row.push(field);
      rows.push(row);
    }

    const meaningfulRows = rows.filter((r) => r.some((v) => v.trim().length > 0));
    if (meaningfulRows.length < 2) {
      throw new Error("That CSV needs a header row plus at least one card row.");
    }

    const header = meaningfulRows[0].map((s) => s.trim());
    const cards = meaningfulRows.slice(1)
      .filter((r) => (r[0] || "").trim() && (r[1] || "").trim())
      .map((r) => ({
        front: (r[0] || "").trim(),
        back: (r[1] || "").trim(),
        meaning: (r[2] || "").trim(),
        example: (r[3] || "").trim(),
      }));
    if (cards.length === 0) {
      throw new Error("No usable card rows were found in that CSV.");
    }
    return { header, cards };
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function setDeck(parsed, label) {
    frontHeader = parsed.header[0] || "Front";
    backHeader = parsed.header[1] || "Back";
    meaningHeader = parsed.header[2] || "Meaning";
    exampleHeader = parsed.header[3] || "Example";
    deck = parsed.cards;
    deckLabel = label;
    loadError.hidden = true;
    fileLabelText.textContent = `${label} — ${deck.length} cards ready`;
    startBtn.disabled = false;
  }

  function showLoadError(message) {
    loadError.textContent = message;
    loadError.hidden = false;
    startBtn.disabled = true;
  }

  deckBtns.forEach((btn) => {
    btn.addEventListener("click", async () => {
      const path = btn.dataset.path;
      const label = btn.textContent.trim();
      try {
        const res = await fetch(path);
        if (!res.ok) throw new Error("fetch failed");
        const text = await res.text();
        setDeck(parseCSV(text), label);
      } catch (err) {
        showLoadError(
          `Couldn't load ${label} automatically (this happens when opening the page ` +
          `directly from disk instead of a local server). Use "choose a CSV file" below ` +
          `and pick ${path.replace("../", "")} instead.`
        );
        csvInput.click();
      }
    });
  });

  csvInput.addEventListener("change", () => {
    const file = csvInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        setDeck(parseCSV(String(reader.result)), file.name);
      } catch (err) {
        showLoadError(err.message);
      }
    };
    reader.onerror = () => showLoadError("Could not read that file.");
    reader.readAsText(file);
  });

  // ---- Session flow ----
  function startSession() {
    if (deck.length === 0) return;
    order = shuffle(deck);
    currentIndex = 0;
    isFlipped = false;
    isAnimating = false;
    cardEl.classList.remove("flipped");
    deckNameEl.textContent = deckLabel;
    frontLabelEl.textContent = frontHeader;
    backLabelEl.textContent = backHeader;
    renderCard();
    showScreen("play");
    flipBtn.focus();
  }

  function applyCardFace(card) {
    frontTextEl.textContent = card.front;
    backTextEl.textContent = card.back;

    const hasMeaning = Boolean(card.meaning);
    const hasExample = Boolean(card.example);

    backMeaningEl.textContent = card.meaning;
    backMeaningEl.hidden = !hasMeaning;
    backMeaningEl.setAttribute("aria-label", meaningHeader);

    backExampleEl.textContent = card.example;
    backExampleEl.hidden = !hasExample;
    backExampleEl.setAttribute("aria-label", exampleHeader);

    cardBackEl.classList.toggle("has-details", hasMeaning || hasExample);
  }

  function renderCard() {
    const card = order[currentIndex];
    applyCardFace(card);
    updateProgress();
  }

  function updateProgress() {
    progressCountEl.textContent = `Card ${currentIndex + 1} of ${order.length}`;
    const frac = (currentIndex + (isFlipped ? 1 : 0)) / order.length;
    progressFillEl.style.width = `${frac * 100}%`;
  }

  function handleFlip() {
    if (isAnimating) return;

    if (!isFlipped) {
      isAnimating = true;
      isFlipped = true;
      cardEl.classList.add("flipped");
      updateProgress();
      return;
    }

    const next = currentIndex + 1;
    if (next >= order.length) {
      finishSession(false);
      return;
    }

    isAnimating = true;
    currentIndex = next;
    isFlipped = false;
    applyCardFace(order[currentIndex]);
    cardEl.classList.remove("flipped");
    updateProgress();
  }

  cardEl.addEventListener("transitionend", (e) => {
    if (e.propertyName === "transform") isAnimating = false;
  });

  function finishSession(early) {
    const total = order.length;
    const reviewed = early ? currentIndex + 1 : total;
    exitNote.hidden = true;
    if (early) {
      completeEmoji.textContent = "👋";
      completeTitle.textContent = "Session ended";
      completeSubtitle.textContent =
        `You reviewed ${reviewed} of ${total} card${total === 1 ? "" : "s"} before finishing early.`;
    } else {
      completeEmoji.textContent = "🎉";
      completeTitle.textContent = "All done!";
      completeSubtitle.textContent =
        `You flipped through all ${total} card${total === 1 ? "" : "s"}. Nicely done.`;
    }
    showScreen("complete");
    retryBtn.focus();
  }

  function attemptExit() {
    window.close();
    setTimeout(() => { exitNote.hidden = false; }, 150);
  }

  // ---- Wiring ----
  startBtn.addEventListener("click", startSession);
  flipBtn.addEventListener("click", handleFlip);
  cardEl.addEventListener("click", handleFlip);
  cardEl.addEventListener("keydown", (e) => {
    if (e.key === " " || e.key === "Enter") { e.preventDefault(); handleFlip(); }
  });
  finishBtn.addEventListener("click", () => finishSession(true));
  retryBtn.addEventListener("click", startSession);
  exitBtn.addEventListener("click", attemptExit);

  document.addEventListener("keydown", (e) => {
    if (!screens.load.hidden) {
      if (e.key === "Enter" && !startBtn.disabled) {
        e.preventDefault();
        startSession();
      }
      return;
    }
    if (!screens.play.hidden) {
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        handleFlip();
      } else if (e.key === "Escape") {
        e.preventDefault();
        finishSession(true);
      }
      return;
    }
    if (!screens.complete.hidden) {
      if (e.key.toLowerCase() === "r") {
        e.preventDefault();
        startSession();
      } else if (e.key === "Escape" || e.key.toLowerCase() === "q") {
        e.preventDefault();
        attemptExit();
      }
    }
  });

  showScreen("load");
})();
