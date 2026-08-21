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
  const backRomajiEl = document.getElementById("backRomaji");
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
  let romajiHeader = "Romaji";
  let meaningHeader = "Meaning";
  let exampleHeader = "Example";
  let deck = [];         // cards loaded from the current CSV, in file order
  let deckLabel = "";     // display name for the loaded deck
  let order = [];         // shuffled copy used for the active session
  let currentIndex = 0;
  let isFlipped = false;
  let isAnimating = false;
  let flipTimeoutId = null;

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

    const rawHeader = meaningfulRows[0].map((s) => s.trim());
    // 5+ columns: front,reading,romaji,meaning,example (built-in decks).
    // Exactly 4: front,reading,meaning,example (legacy custom CSVs, no
    // romaji column) — keep reading it the old way so those still load.
    const hasRomajiColumn = rawHeader.length >= 5;

    const cards = meaningfulRows.slice(1)
      .map((r) => {
        const front = (r[0] || "").trim();
        const reading = (r[1] || "").trim();
        const romaji = hasRomajiColumn ? (r[2] || "").trim() : "";
        const meaning = ((hasRomajiColumn ? r[3] : r[2]) || "").trim();
        const example = ((hasRomajiColumn ? r[4] : r[3]) || "").trim();
        return { front, reading, romaji, meaning, example };
      })
      // A card needs a front value and something to show as its reading —
      // either the reading column itself, or (for decks like the kana
      // charts, where there's no separate furigana-style reading) romaji
      // standing in for it.
      .filter((c) => c.front && (c.reading || c.romaji));
    if (cards.length === 0) {
      throw new Error("No usable card rows were found in that CSV.");
    }

    const header = {
      front: rawHeader[0] || "Front",
      reading: rawHeader[1] || "Reading",
      romaji: (hasRomajiColumn ? rawHeader[2] : "") || "Romaji",
      meaning: (hasRomajiColumn ? rawHeader[3] : rawHeader[2]) || "Meaning",
      example: (hasRomajiColumn ? rawHeader[4] : rawHeader[3]) || "Example",
    };
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
    frontHeader = parsed.header.front;
    backHeader = parsed.header.reading;
    romajiHeader = parsed.header.romaji;
    meaningHeader = parsed.header.meaning;
    exampleHeader = parsed.header.example;
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
    if (flipTimeoutId !== null) { clearTimeout(flipTimeoutId); flipTimeoutId = null; }
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

    // Decks like the kana charts have no separate furigana-style reading —
    // for those, romaji IS the reading, so it's shown as the big primary
    // text and there's no secondary line. Decks with a real reading (e.g.
    // たべる) show that as primary, with romaji (taberu) as a smaller line
    // beneath it, between the reading and the meaning.
    const showRomajiLine = Boolean(card.reading && card.romaji);
    backTextEl.textContent = card.reading || card.romaji;

    backRomajiEl.textContent = card.romaji;
    backRomajiEl.hidden = !showRomajiLine;
    backRomajiEl.setAttribute("aria-label", romajiHeader);

    const hasMeaning = Boolean(card.meaning);
    const hasExample = Boolean(card.example);

    backMeaningEl.textContent = card.meaning;
    backMeaningEl.hidden = !hasMeaning;
    backMeaningEl.setAttribute("aria-label", meaningHeader);

    backExampleEl.textContent = card.example;
    backExampleEl.hidden = !hasExample;
    backExampleEl.setAttribute("aria-label", exampleHeader);

    cardBackEl.classList.toggle("has-details", hasMeaning || hasExample || showRomajiLine);
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

  // Reads .card's actual transition-duration rather than hardcoding it, so
  // this stays correct if the CSS timing ever changes.
  function getFlipDurationMs() {
    const style = getComputedStyle(cardEl);
    const properties = style.transitionProperty.split(",").map((s) => s.trim());
    const durations = style.transitionDuration.split(",").map((s) => s.trim());
    const idx = properties.indexOf("transform");
    const raw = durations[idx === -1 ? 0 : idx] || "0s";
    const value = parseFloat(raw) || 0;
    return raw.trim().endsWith("ms") ? value : value * 1000;
  }

  // Solves the transition's cubic-bezier timing function for the time
  // fraction where eased progress = 0.5 — the instant rotateY crosses
  // 90deg and the card is edge-on. This is NOT simply half the duration:
  // cubic-bezier easing is non-linear, and measuring this app's actual
  // cubic-bezier(.22,.9,.32,1) curve in a real browser shows the rotation
  // is heavily front-loaded — the 90deg crossing lands around 17% of the
  // duration, not 50%. Solving it from the live CSS (instead of hardcoding
  // that 17%) keeps this correct if the easing curve or duration changes.
  function getFlipRetainMs() {
    const durationMs = getFlipDurationMs();

    const style = getComputedStyle(cardEl);
    const properties = style.transitionProperty.split(",").map((s) => s.trim());
    const idx = properties.indexOf("transform");
    // Split on commas that separate multiple timing functions, but not the
    // commas inside a single cubic-bezier(...)'s argument list.
    const timingFns = style.transitionTimingFunction
      .split(/,(?![^(]*\))/)
      .map((s) => s.trim());
    const raw = timingFns[idx === -1 ? 0 : idx] || "";
    const match = raw.match(/cubic-bezier\(([^)]+)\)/);
    if (!match) return durationMs / 2;

    const [x1, y1, x2, y2] = match[1].split(",").map(Number);
    const pointAt = (t) => {
      const mt = 1 - t;
      return {
        x: 3 * mt * mt * t * x1 + 3 * mt * t * t * x2 + t * t * t,
        y: 3 * mt * mt * t * y1 + 3 * mt * t * t * y2 + t * t * t,
      };
    };
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (pointAt(mid).y < 0.5) lo = mid; else hi = mid;
    }
    return durationMs * pointAt((lo + hi) / 2).x;
  }

  // Applies the pending next-card content immediately and cancels the
  // midpoint timer if it's still outstanding. Called both by that timer
  // and, as a safety net, by transitionend — so even if the midpoint timer
  // gets throttled (e.g. a backgrounded tab), the card's content is
  // guaranteed to match `currentIndex` no later than when the flip
  // animation visually finishes.
  function applyPendingCardSwap() {
    if (flipTimeoutId === null) return;
    clearTimeout(flipTimeoutId);
    flipTimeoutId = null;
    applyCardFace(order[currentIndex]);
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
    cardEl.classList.remove("flipped");
    updateProgress();

    const retainTimeMs = getFlipRetainMs();
    flipTimeoutId = setTimeout(applyPendingCardSwap, retainTimeMs);
  }

  cardEl.addEventListener("transitionend", (e) => {
    if (e.propertyName !== "transform") return;
    applyPendingCardSwap();
    isAnimating = false;
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
