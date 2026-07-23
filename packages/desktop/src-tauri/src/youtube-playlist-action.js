(function () {
  "use strict";

  const PLAYLIST_NAME = "Freed Offline";
  const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
  const expectedVideoId = "__EXPECTED_YOUTUBE_VIDEO_ID__";
  let emitted = false;

  function sleep(milliseconds) {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }

  function visible(element) {
    if (!(element instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none"
      && style.visibility !== "hidden"
      && Number(style.opacity || "1") > 0
      && rect.width > 0
      && rect.height > 0;
  }

  function unique(elements) {
    return Array.from(new Set(elements)).filter(visible);
  }

  function firstStructuralMatch(root, selectors) {
    for (const selector of selectors) {
      const candidates = unique(Array.from(root.querySelectorAll(selector)));
      if (candidates.length > 0) return candidates;
    }
    return [];
  }

  function textOf(value) {
    if (!value) return "";
    if (typeof value === "string") return value.trim();
    if (typeof value.simpleText === "string") return value.simpleText.trim();
    if (Array.isArray(value.runs)) {
      return value.runs
        .map((run) => typeof run.text === "string" ? run.text : "")
        .join("")
        .trim();
    }
    return "";
  }

  function backingData(element) {
    if (!element || typeof element !== "object") return undefined;
    return element.data
      || (element.__data && element.__data.data)
      || element.__dataHost
      || undefined;
  }

  function containsEnum(value, expected, seen, depth) {
    if (!value || typeof value !== "object" || depth > 8) return false;
    if (seen.has(value)) return false;
    seen.add(value);
    for (const [key, child] of Object.entries(value)) {
      if ((key === "privacy" || key === "privacyStatus" || key === "value")
        && typeof child === "string" && child.toUpperCase() === expected) {
        return true;
      }
      if (child && typeof child === "object"
        && containsEnum(child, expected, seen, depth + 1)) {
        return true;
      }
    }
    return false;
  }

  function dataIsPrivate(element) {
    const data = backingData(element);
    const hasPrivate = containsEnum(data, "PRIVATE", new WeakSet(), 0);
    const hasNonPrivate = containsEnum(data, "PUBLIC", new WeakSet(), 0)
      || containsEnum(data, "UNLISTED", new WeakSet(), 0);
    if (hasPrivate || hasNonPrivate) return hasPrivate && !hasNonPrivate;
    const privacyNodes = Array.from(element.querySelectorAll(
      "#privacy-icon, [icon*='lock'], [aria-label], [title]",
    ));
    return privacyNodes.some((privacyNode) => {
      const label = `${privacyNode.getAttribute("aria-label") || ""} ${
        privacyNode.getAttribute("title") || ""
      }`.trim();
      return label === "Private" || label.startsWith("Private ");
    });
  }

  function dataIsNonPrivate(element) {
    const data = backingData(element);
    const hasPrivate = containsEnum(data, "PRIVATE", new WeakSet(), 0);
    const hasNonPrivate = containsEnum(data, "PUBLIC", new WeakSet(), 0)
      || containsEnum(data, "UNLISTED", new WeakSet(), 0);
    return hasNonPrivate && !hasPrivate;
  }

  function findStringByKey(value, expectedKey, seen, depth) {
    if (!value || typeof value !== "object" || depth > 10) return undefined;
    if (seen.has(value)) return undefined;
    seen.add(value);
    for (const [key, child] of Object.entries(value)) {
      if (key === expectedKey && typeof child === "string" && child.length > 0) {
        return child;
      }
      if (child && typeof child === "object") {
        const found = findStringByKey(child, expectedKey, seen, depth + 1);
        if (found) return found;
      }
    }
    return undefined;
  }

  function playlistIdFrom(row) {
    const dataId = findStringByKey(backingData(row), "playlistId", new WeakSet(), 0);
    if (dataId) return dataId;
    const anchor = row.querySelector("a[href*='list=']");
    if (!anchor) return undefined;
    try {
      return new URL(anchor.href, location.href).searchParams.get("list") || undefined;
    } catch (_) {
      return undefined;
    }
  }

  function playlistTitle(row) {
    const data = backingData(row);
    const dataTitle = textOf(data && (data.title || data.playlistTitle));
    if (dataTitle) return dataTitle;
    const label = row.querySelector("#label, yt-formatted-string#label, .style-scope#label");
    return label ? label.textContent.trim() : "";
  }

  function rowIsChecked(row) {
    const checkbox = row.querySelector(
      "tp-yt-paper-checkbox, yt-checkbox-renderer, [role='checkbox']",
    );
    if (!checkbox) return false;
    return checkbox.hasAttribute("checked")
      || checkbox.getAttribute("aria-checked") === "true"
      || checkbox.checked === true;
  }

  function clickOne(elements, purpose) {
    const candidates = unique(elements);
    if (candidates.length !== 1) {
      throw new Error(`${purpose} was ${candidates.length === 0 ? "not found" : "ambiguous"}.`);
    }
    candidates[0].click();
    return candidates[0];
  }

  async function waitFor(find, timeoutMs, description) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const value = find();
      if (value) return value;
      await sleep(150);
    }
    throw new Error(`${description} did not appear.`);
  }

  function watchVideoId() {
    try {
      const parsed = new URL(location.href);
      const id = parsed.searchParams.get("v");
      return id && VIDEO_ID_PATTERN.test(id) ? id : undefined;
    } catch (_) {
      return undefined;
    }
  }

  function isLoggedIn() {
    if (window.ytcfg && typeof window.ytcfg.get === "function") {
      const value = window.ytcfg.get("LOGGED_IN");
      if (typeof value === "boolean") return value;
    }
    const avatar = document.querySelector(
      "ytd-topbar-menu-button-renderer #avatar-btn, button#avatar-btn, [aria-label^='Account menu']",
    );
    return Boolean(avatar);
  }

  function saveButtonCandidates() {
    const structural = Array.from(document.querySelectorAll(
      [
        "ytd-watch-metadata ytd-button-renderer#save-button button",
        "ytd-watch-metadata #save-button button",
        "ytd-watch-metadata button-view-model button",
        "ytd-watch-metadata yt-button-view-model button",
      ].join(","),
    )).filter((button) => {
      const host = button.closest(
        "ytd-button-renderer, button-view-model, yt-button-view-model",
      );
      const data = backingData(host) || backingData(button);
      const hasPlaylistIcon = findStringByKey(data, "iconType", new WeakSet(), 0)
        === "PLAYLIST_ADD"
        || findStringByKey(data, "iconName", new WeakSet(), 0)
        === "PLAYLIST_ADD";
      const idMatch = host && host.id === "save-button";
      return hasPlaylistIcon || idMatch;
    });
    if (unique(structural).length > 0) return unique(structural);

    return unique(Array.from(document.querySelectorAll(
      "ytd-watch-metadata button[aria-label], ytd-watch-metadata button[title]",
    )).filter((button) => {
      const label = `${button.getAttribute("aria-label") || ""} ${
        button.getAttribute("title") || ""
      }`.trim();
      return label === "Save" || label === "Save to playlist";
    }));
  }

  function playlistDialog() {
    return unique(Array.from(document.querySelectorAll(
      "ytd-add-to-playlist-renderer, tp-yt-paper-dialog ytd-add-to-playlist-renderer",
    )))[0];
  }

  function playlistRows(dialog) {
    return unique(Array.from(dialog.querySelectorAll(
      "ytd-playlist-add-to-option-renderer",
    )));
  }

  function exactPlaylistRows(dialog) {
    return playlistRows(dialog).filter((row) => playlistTitle(row) === PLAYLIST_NAME);
  }

  async function openPlaylistDialog() {
    clickOne(saveButtonCandidates(), "YouTube Save control");
    return waitFor(playlistDialog, 10000, "YouTube playlist picker");
  }

  async function chooseExisting(dialog, row) {
    if (!dataIsPrivate(row)) {
      if (dataIsNonPrivate(row)) {
        throw new Error(`${PLAYLIST_NAME} exists but is not private.`);
      }
      throw new Error(`YouTube did not expose the privacy of ${PLAYLIST_NAME}.`);
    }

    const playlistId = playlistIdFrom(row);
    if (!playlistId) throw new Error("YouTube did not expose the playlist identifier.");
    const playlistUrl = `https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}`;
    if (rowIsChecked(row)) {
      return { playlistId, playlistUrl, added: false, alreadyPresent: true };
    }

    const checkbox = row.querySelector(
      "tp-yt-paper-checkbox, yt-checkbox-renderer, [role='checkbox']",
    );
    clickOne([checkbox || row], `${PLAYLIST_NAME} playlist row`);
    await waitFor(() => rowIsChecked(row), 8000, `${PLAYLIST_NAME} selection confirmation`);
    return { playlistId, playlistUrl, added: true, alreadyPresent: false };
  }

  function setInputValue(input, value) {
    const descriptor = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    );
    if (!descriptor || !descriptor.set) throw new Error("Playlist name input is unavailable.");
    descriptor.set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function privateMenuItems() {
    return unique(Array.from(document.querySelectorAll(
      "tp-yt-paper-listbox tp-yt-paper-item, ytd-menu-popup-renderer ytd-menu-service-item-renderer",
    )).filter((item) => {
      const data = backingData(item);
      if (containsEnum(data, "PRIVATE", new WeakSet(), 0)) return true;
      const label = item.textContent.trim();
      return label === "Private" || label.startsWith("Private\n");
    }));
  }

  async function createPrivatePlaylist(dialog) {
    const existingRows = exactPlaylistRows(dialog);
    if (existingRows.length > 0) {
      throw new Error(`${PLAYLIST_NAME} changed while the playlist picker was open.`);
    }

    const createToggle = unique(Array.from(dialog.querySelectorAll(
      "#new-playlist-button, ytd-button-renderer#new-playlist-button button",
    ))).map((element) => element.matches("button")
      ? element
      : element.querySelector("button") || element);
    clickOne(createToggle, "New playlist control");

    const createRenderer = await waitFor(
      () => unique(Array.from(document.querySelectorAll(
        "ytd-add-to-playlist-create-renderer",
      )))[0],
      8000,
      "YouTube playlist creation form",
    );
    const input = unique(Array.from(createRenderer.querySelectorAll(
      "input#input, tp-yt-paper-input input, input",
    )));
    const nameInput = clickOne(input, "Playlist name input");
    setInputValue(nameInput, PLAYLIST_NAME);

    const privacyControl = firstStructuralMatch(createRenderer, [
      "#privacy-button",
      "ytd-dropdown-renderer #label",
      "tp-yt-paper-dropdown-menu",
    ]);
    clickOne(privacyControl, "Playlist privacy control");
    const privateItems = await waitFor(
      () => {
        const items = privateMenuItems();
        return items.length > 0 ? items : undefined;
      },
      5000,
      "Private playlist option",
    );
    clickOne(privateItems, "Private playlist option");

    const createButtons = unique(Array.from(createRenderer.querySelectorAll(
      "ytd-button-renderer#create-button button, #create-button button",
    )));
    clickOne(createButtons, "Create playlist control");

    await sleep(1200);
    let refreshedDialog = playlistDialog();
    if (!refreshedDialog) refreshedDialog = await openPlaylistDialog();
    await waitFor(() => exactPlaylistRows(refreshedDialog).length > 0, 10000, PLAYLIST_NAME);
    const rows = exactPlaylistRows(refreshedDialog);
    if (rows.length !== 1) throw new Error(`${PLAYLIST_NAME} is ambiguous after creation.`);
    const result = await chooseExisting(refreshedDialog, rows[0]);
    return { ...result, added: true, alreadyPresent: false };
  }

  async function emitResult(result) {
    if (emitted) return;
    emitted = true;
    await window.__TAURI__.event.emit("yt-playlist-result", result);
  }

  window.setTimeout(() => {
    void emitResult({
      result: "error",
      success: false,
      ok: false,
      videoId: VIDEO_ID_PATTERN.test(expectedVideoId || "") ? expectedVideoId : undefined,
      added: false,
      alreadyPresent: false,
      error: "YouTube playlist action timed out.",
    });
  }, 52000);

  async function run() {
    if (!window.__TAURI__ || !window.__TAURI__.event) {
      throw new Error("YouTube session event bridge is unavailable.");
    }
    const videoId = watchVideoId();
    if (!videoId || videoId !== expectedVideoId) {
      throw new Error("YouTube opened a different video than the one requested.");
    }
    await waitFor(
      () => document.querySelector("ytd-watch-flexy, ytd-watch-metadata"),
      15000,
      "YouTube watch page",
    );
    if (!isLoggedIn()) throw new Error("The YouTube website session is not signed in.");

    const dialog = await openPlaylistDialog();
    await waitFor(() => playlistRows(dialog).length > 0, 10000, "YouTube playlists");
    const exactRows = exactPlaylistRows(dialog);
    if (exactRows.length > 1) throw new Error(`${PLAYLIST_NAME} is ambiguous.`);
    const result = exactRows.length === 1
      ? await chooseExisting(dialog, exactRows[0])
      : await createPrivatePlaylist(dialog);
    await emitResult({
      result: result.alreadyPresent ? "existing" : "added",
      success: true,
      ok: true,
      videoId,
      playlistId: result.playlistId,
      playlistUrl: result.playlistUrl,
      added: result.added,
      alreadyPresent: result.alreadyPresent,
    });
  }

  run().catch((error) => {
    void emitResult({
      result: "error",
      success: false,
      ok: false,
      videoId: VIDEO_ID_PATTERN.test(expectedVideoId || "") ? expectedVideoId : undefined,
      added: false,
      alreadyPresent: false,
      error: error instanceof Error ? error.message : String(error),
    });
  });
})();
