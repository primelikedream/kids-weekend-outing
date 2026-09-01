const WEATHER_FIT_LABEL = { indoor: "室内向き", outdoor: "屋外向き", either: "室内・屋外どちらも" };

let allSpots = [];
let currentFilter = "all";

function escapeHtml(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function spotCardHtml(spot) {
  const accessCar = spot.accessCar ? `<div>🚗 ${escapeHtml(spot.accessCar)}</div>` : "";
  const accessTransit = spot.accessTransit ? `<div>🚌 ${escapeHtml(spot.accessTransit)}</div>` : "";
  const link = spot.url ? `<div class="card-link"><a href="${escapeHtml(spot.url)}" target="_blank" rel="noopener">詳細を見る →</a></div>` : "";
  const event = spot.eventInfo
    ? `<div class="card-event">🎪 <a href="${escapeHtml(spot.eventInfo.url)}" target="_blank" rel="noopener">${escapeHtml(spot.eventInfo.title)}</a><div>${escapeHtml(spot.eventInfo.snippet)}</div></div>`
    : "";

  return `
    <div class="card">
      <div class="card-title">${escapeHtml(spot.name)}</div>
      <div class="card-meta">
        <span>${escapeHtml(spot.category)}</span>
        <span class="tag ${spot.weatherFit}">${WEATHER_FIT_LABEL[spot.weatherFit] ?? spot.weatherFit}</span>
      </div>
      ${spot.reason ? `<div class="card-reason">${escapeHtml(spot.reason)}</div>` : ""}
      <div class="card-access">${accessCar}${accessTransit}</div>
      ${link}
      ${event}
    </div>`;
}

function formatDateLabel(dateIso) {
  const d = new Date(`${dateIso}T00:00:00+09:00`);
  const weekdayLabel = ["日", "月", "火", "水", "木", "金", "土"][d.getDay()];
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日(${weekdayLabel})`;
}

function groupByDate(spots) {
  const groups = new Map();
  for (const spot of spots) {
    if (!groups.has(spot.suggestedFor)) groups.set(spot.suggestedFor, []);
    groups.get(spot.suggestedFor).push(spot);
  }
  return [...groups.entries()].sort((a, b) => b[0].localeCompare(a[0]));
}

function todayJstDateString() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}

function filteredSpots() {
  if (currentFilter === "all") return allSpots;
  return allSpots.filter((s) => s.weatherFit === currentFilter || s.weatherFit === "either");
}

function render() {
  const spots = filteredSpots();
  const groups = groupByDate(spots);

  const upcomingEl = document.getElementById("upcoming-cards");
  const archiveEl = document.getElementById("archive-list");

  if (groups.length === 0) {
    upcomingEl.innerHTML = '<p class="empty">まだ提案履歴がありません。</p>';
    archiveEl.innerHTML = "";
    return;
  }

  const today = todayJstDateString();
  // 金曜の朝に翌土日2日分をまとめて提案するため、今日以降の日付はすべて「次のおでかけ候補」として扱う
  const upcoming = groups.filter(([date]) => date >= today).sort((a, b) => a[0].localeCompare(b[0]));
  const past = groups.filter(([date]) => date < today);

  upcomingEl.innerHTML =
    upcoming.length > 0
      ? upcoming
          .map(
            ([date, spotsForDate]) => `
      <div class="date-group">
        <h3>${formatDateLabel(date)}</h3>
        ${spotsForDate.map(spotCardHtml).join("")}
      </div>`,
          )
          .join("")
      : '<p class="empty">まだ次回分の提案がありません。</p>';

  archiveEl.innerHTML =
    past.length > 0
      ? past
          .map(
            ([date, spotsForDate]) => `
      <div class="date-group">
        <h3>${formatDateLabel(date)}</h3>
        ${spotsForDate.map(spotCardHtml).join("")}
      </div>`,
          )
          .join("")
      : '<p class="empty">過去の提案履歴はまだありません。</p>';
}

function setupFilterPills() {
  document.getElementById("filter-pills").addEventListener("click", (e) => {
    const btn = e.target.closest(".pill");
    if (!btn) return;
    currentFilter = btn.dataset.filter;
    document.querySelectorAll(".pill").forEach((p) => p.classList.toggle("active", p === btn));
    render();
  });
}

// --- 「今すぐ提案を実行」ボタン(GitHub Actions workflow_dispatchを直接呼ぶ) ---
const RUN_REPO = "primelikedream/kids-weekend-outing";
const RUN_WORKFLOW_FILE = "weekend-suggest.yml";
const RUN_TOKEN_STORAGE_KEY = "kwo_gh_pat";

function getSavedRunToken() {
  try {
    return localStorage.getItem(RUN_TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

function saveRunToken(token) {
  try {
    localStorage.setItem(RUN_TOKEN_STORAGE_KEY, token);
  } catch {
    /* localStorageが使えない環境では保存をあきらめる(毎回入力が必要になるだけ) */
  }
}

function clearRunToken() {
  try {
    localStorage.removeItem(RUN_TOKEN_STORAGE_KEY);
  } catch {
    /* noop */
  }
}

function setRunStatus(html, kind) {
  const el = document.getElementById("run-status");
  el.innerHTML = html;
  el.className = `run-status ${kind || ""}`;
}

async function dispatchRunWorkflow(token) {
  setRunStatus("実行をリクエスト中...", "loading");
  try {
    const res = await fetch(
      `https://api.github.com/repos/${RUN_REPO}/actions/workflows/${RUN_WORKFLOW_FILE}/dispatches`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ref: "master" }),
      },
    );

    if (res.status === 204) {
      const actionsUrl = `https://github.com/${RUN_REPO}/actions/workflows/${RUN_WORKFLOW_FILE}`;
      setRunStatus(
        `✅ 実行をリクエストしました。数分後にメールとこのページが更新されます。<a href="${actionsUrl}" target="_blank" rel="noopener">実行状況を見る →</a>`,
        "success",
      );
      return;
    }
    if (res.status === 401) {
      clearRunToken();
      updateRunTokenUi();
      setRunStatus("❌ トークンが無効なため削除しました。お手数ですが発行し直してください。", "error");
      return;
    }
    if (res.status === 403) {
      setRunStatus("❌ このトークンにはActionsを実行する権限がありません(Actions: Read and writeが必要です)。", "error");
      return;
    }
    if (res.status === 404) {
      setRunStatus("❌ リポジトリまたはワークフローが見つかりません。トークンのRepository accessを確認してください。", "error");
      return;
    }
    setRunStatus(`❌ 実行に失敗しました(HTTPステータス ${res.status})。`, "error");
  } catch (err) {
    setRunStatus(`❌ 通信エラーが発生しました: ${escapeHtml(err.message)}`, "error");
  }
}

function updateRunTokenUi() {
  const hasToken = Boolean(getSavedRunToken());
  document.getElementById("run-token-clear").hidden = !hasToken;
  document.getElementById("run-token-form").hidden = true;
}

function setupRunButton() {
  const button = document.getElementById("run-button");
  const clearBtn = document.getElementById("run-token-clear");
  const form = document.getElementById("run-token-form");
  const input = document.getElementById("run-token-input");

  updateRunTokenUi();

  button.addEventListener("click", () => {
    const token = getSavedRunToken();
    if (token) {
      dispatchRunWorkflow(token);
      return;
    }
    form.hidden = !form.hidden;
    if (!form.hidden) input.focus();
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const token = input.value.trim();
    if (!token) return;
    saveRunToken(token);
    input.value = "";
    updateRunTokenUi();
    dispatchRunWorkflow(token);
  });

  clearBtn.addEventListener("click", () => {
    clearRunToken();
    updateRunTokenUi();
    setRunStatus("トークンを削除しました。", "");
  });
}

async function main() {
  setupFilterPills();
  setupRunButton();
  try {
    const res = await fetch("data/history.json");
    const data = await res.json();
    allSpots = data.spots ?? [];
  } catch (err) {
    document.getElementById("upcoming-cards").innerHTML = '<p class="empty">データの読み込みに失敗しました。</p>';
    console.error(err);
    return;
  }
  render();
}

main();
