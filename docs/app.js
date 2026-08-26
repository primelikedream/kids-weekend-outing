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

  const [latestDate, latestSpots] = groups[0];
  upcomingEl.innerHTML = `
    <div class="date-group">
      <h3>${formatDateLabel(latestDate)}</h3>
      ${latestSpots.map(spotCardHtml).join("")}
    </div>`;

  const rest = groups.slice(1);
  archiveEl.innerHTML =
    rest.length > 0
      ? rest
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

async function main() {
  setupFilterPills();
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
