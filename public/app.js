const PIN_STORAGE_KEY = "ctf-live:pinned-events";
const DENSE_STORAGE_KEY = "ctf-live:dense-mode";

const dom = {
  metaSource: document.getElementById("metaSource"),
  metaUpdated: document.getElementById("metaUpdated"),
  liveState: document.getElementById("liveState"),
  statTotal: document.getElementById("statTotal"),
  statLive: document.getElementById("statLive"),
  statUpcoming: document.getElementById("statUpcoming"),
  statOnsite: document.getElementById("statOnsite"),
  statKorea: document.getElementById("statKorea"),
  upcomingList: document.getElementById("upcomingList"),
  upcomingCount: document.getElementById("upcomingCount"),
  eventList: document.getElementById("eventList"),
  eventCount: document.getElementById("eventCount"),
  rankKr: document.getElementById("rankKr"),
  rankGlobal: document.getElementById("rankGlobal"),
  filters: [...document.querySelectorAll(".filter")],
  pinnedFilter: document.querySelector('.filter[data-view="pinned"]'),
  sortButtons: [...document.querySelectorAll(".sort-btn")],
  searchInput: document.getElementById("searchInput"),
  clearSearch: document.getElementById("clearSearch"),
  densityToggle: document.getElementById("densityToggle"),
  streamToggle: document.getElementById("streamToggle"),
  eventTemplate: document.getElementById("eventTemplate"),
  rankTemplate: document.getElementById("rankTemplate"),
  upcomingTemplate: document.getElementById("upcomingTemplate")
};

const store = {
  meta: null,
  stats: null,
  events: [],
  rankings: { kr: [], global: [] },
  view: "all",
  query: "",
  sortBy: "start",
  sortDir: "asc",
  pinnedIds: new Set(),
  streamPaused: false,
  pendingSnapshot: null,
  streamState: "connecting",
  dense: false
};

const FORMAT_KO_MAP = {
  jeopardy: "문제풀이형",
  "attack-defence": "공방전형",
  "attack-defense": "공방전형",
  mixed: "혼합형"
};

const libs = {
  gsap: typeof window !== "undefined" ? window.gsap : null,
  scrollTrigger: typeof window !== "undefined" ? window.ScrollTrigger : null,
  anime: typeof window !== "undefined" ? window.anime : null,
  tippy: typeof window !== "undefined" ? window.tippy : null
};

bootstrap();

async function bootstrap() {
  initPreferences();
  initOpenSourceEnhancements();
  bindEvents();
  await fetchInitial();
  connectSse();
}

function initOpenSourceEnhancements() {
  initGsapMotion();
  initTooltips();
}

function initGsapMotion() {
  if (!libs.gsap) return;

  if (libs.scrollTrigger && typeof libs.gsap.registerPlugin === "function") {
    libs.gsap.registerPlugin(libs.scrollTrigger);
  }

  const gsap = libs.gsap;
  const scrollTrigger = libs.scrollTrigger;
  const topbar = document.querySelector(".topbar");
  const header = document.querySelector(".page-header");
  const panels = [...document.querySelectorAll(".panel")];

  const timeline = gsap.timeline({ defaults: { ease: "power2.out" } });
  if (topbar) timeline.from(topbar, { y: -8, autoAlpha: 0, duration: 0.24 });
  if (header) timeline.from(header, { y: 9, autoAlpha: 0, duration: 0.3 }, "-=0.1");
  if (panels.length) timeline.from(panels, { y: 10, autoAlpha: 0, duration: 0.3, stagger: 0.06 }, "-=0.14");

  if (scrollTrigger && panels.length) {
    panels.forEach((panel) => {
      gsap.from(panel, {
        y: 18,
        autoAlpha: 0,
        duration: 0.44,
        ease: "power2.out",
        scrollTrigger: {
          trigger: panel,
          start: "top 88%",
          once: true
        }
      });
    });
  }
}

function initTooltips() {
  if (!libs.tippy) return;

  const tips = [
    ['.filter[data-view="all"]', "전체 이벤트 표시"],
    ['.filter[data-view="live"]', "현재 진행중 이벤트만 표시"],
    ['.filter[data-view="upcoming"]', "예정 이벤트만 표시"],
    ['.filter[data-view="korea"]', "국내 관련 키워드 이벤트 필터"],
    ['.filter[data-view="pinned"]', "즐겨찾기한 이벤트만 보기"],
    ['.sort-btn[data-sort="start"]', "시작 시간 기준 정렬"],
    ['.sort-btn[data-sort="participants"]', "참가팀 수 기준 정렬"],
    ['.sort-btn[data-sort="status"]', "상태 우선 정렬"],
    ["#clearSearch", "검색어 즉시 초기화"],
    ["#densityToggle", "테이블 간격 밀도 전환"],
    ["#streamToggle", "실시간 갱신 일시정지 또는 재개"],
    ["#liveState", "실시간 스트림 연결 상태"]
  ];

  const targets = [];
  for (const [selector, tip] of tips) {
    const node = document.querySelector(selector);
    if (!node) continue;
    node.setAttribute("data-tip", tip);
    targets.push(node);
  }

  if (!targets.length) return;

  libs.tippy(targets, {
    content(reference) {
      return reference.getAttribute("data-tip") || "";
    },
    theme: "light-border modern-tip",
    animation: "shift-away-subtle",
    placement: "bottom",
    delay: [120, 0],
    duration: [180, 140],
    arrow: true
  });
}

function initPreferences() {
  store.pinnedIds = loadPinnedIds();
  store.dense = loadDenseMode();
  applyDensityMode();
  refreshPinnedFilterLabel();
  updateSearchControls();
  updateStreamControls();
}

function bindEvents() {
  for (const button of dom.filters) {
    button.addEventListener("click", () => {
      for (const item of dom.filters) item.classList.remove("active");
      button.classList.add("active");
      store.view = button.dataset.view || "all";
      render();
    });
  }

  for (const button of dom.sortButtons) {
    button.addEventListener("click", () => {
      const key = button.dataset.sort || "start";
      if (store.sortBy === key) {
        store.sortDir = store.sortDir === "asc" ? "desc" : "asc";
      } else {
        store.sortBy = key;
        store.sortDir = defaultSortDir(key);
      }
      renderSortButtons();
      renderEventList({ animate: false });
    });
  }

  dom.searchInput.addEventListener("input", (event) => {
    store.query = String(event.target.value || "").trim().toLowerCase();
    updateSearchControls();
    renderEventList({ animate: false });
  });

  dom.clearSearch.addEventListener("click", () => {
    if (!store.query) return;
    store.query = "";
    dom.searchInput.value = "";
    updateSearchControls();
    renderEventList({ animate: false });
  });

  dom.densityToggle.addEventListener("click", () => {
    store.dense = !store.dense;
    saveDenseMode(store.dense);
    applyDensityMode();
  });

  dom.streamToggle.addEventListener("click", () => {
    toggleStreamPause();
  });

  dom.eventList.addEventListener("click", (event) => {
    const target = event.target.closest(".pin-btn");
    if (!target) return;
    event.preventDefault();

    const key = String(target.dataset.pin || "").trim();
    if (!key) return;

    if (store.pinnedIds.has(key)) {
      store.pinnedIds.delete(key);
    } else {
      store.pinnedIds.add(key);
    }

    savePinnedIds(store.pinnedIds);
    refreshPinnedFilterLabel();
    renderEventList({ animate: false });
  });

  document.addEventListener("keydown", handleHotkeys);
}

function handleHotkeys(event) {
  const tag = event.target?.tagName || "";
  const editing = /INPUT|TEXTAREA|SELECT/.test(tag) || Boolean(event.target?.isContentEditable);

  if (event.key === "/" && !editing) {
    event.preventDefault();
    dom.searchInput.focus();
    dom.searchInput.select();
    return;
  }

  if (editing) return;

  if (event.key.toLowerCase() === "d") {
    event.preventDefault();
    store.dense = !store.dense;
    saveDenseMode(store.dense);
    applyDensityMode();
  }

  if (event.key.toLowerCase() === "p") {
    event.preventDefault();
    toggleStreamPause();
  }
}

async function fetchInitial() {
  try {
    const response = await fetch("/api/dashboard");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    applySnapshot(payload, { flash: false });
  } catch (error) {
    renderEmpty(`초기 데이터 로딩 실패: ${error.message}`);
  }
}

function connectSse() {
  store.streamState = "connecting";
  updateLiveState();

  const stream = new EventSource("/api/stream");

  stream.addEventListener("open", () => {
    store.streamState = "live";
    updateLiveState();
  });

  stream.addEventListener("snapshot", (event) => {
    const payload = JSON.parse(event.data);

    if (store.streamPaused) {
      store.pendingSnapshot = payload;
      updateLiveState();
      return;
    }

    store.pendingSnapshot = null;
    applySnapshot(payload, { flash: true });
    store.streamState = "live";
    updateLiveState();
  });

  stream.addEventListener("error", () => {
    store.streamState = "error";
    updateLiveState();

    setTimeout(() => {
      if (stream.readyState === EventSource.CLOSED) connectSse();
    }, 1200);
  });
}

function toggleStreamPause() {
  store.streamPaused = !store.streamPaused;

  if (!store.streamPaused && store.pendingSnapshot) {
    const pending = store.pendingSnapshot;
    store.pendingSnapshot = null;
    applySnapshot(pending, { flash: true });
    store.streamState = "live";
  }

  updateStreamControls();
}

function applySnapshot(payload, options = {}) {
  const { flash = false } = options;

  store.meta = payload.meta || null;
  store.stats = payload.stats || null;
  store.events = Array.isArray(payload.events) ? payload.events : [];
  store.rankings = payload.rankings || { kr: [], global: [] };
  render();

  if (flash) {
    flashTable(dom.eventList);
    flashTable(dom.upcomingList);
  }
}

function render() {
  renderMeta();
  renderStats();
  refreshPinnedFilterLabel();
  updateSearchControls();
  renderSortButtons();
  renderUpcomingList({ animate: true });
  renderEventList({ animate: true });
  renderRankList(dom.rankKr, store.rankings.kr);
  renderRankList(dom.rankGlobal, store.rankings.global);
}

function renderMeta() {
  if (!store.meta) return;
  dom.metaSource.textContent = `소스: ${store.meta.source || "-"}`;

  const absolute = formatDate(store.meta.lastUpdatedAt);
  const relative = formatRelativeTime(store.meta.lastUpdatedAt);
  dom.metaUpdated.textContent = relative ? `업데이트: ${absolute} (${relative})` : `업데이트: ${absolute}`;
}

function renderStats() {
  const stats = store.stats || {
    total: 0,
    live: 0,
    upcoming: 0,
    onsite: 0,
    koreaRelated: 0
  };

  setStatValue(dom.statTotal, stats.total);
  setStatValue(dom.statLive, stats.live);
  setStatValue(dom.statUpcoming, stats.upcoming);
  setStatValue(dom.statOnsite, stats.onsite);
  setStatValue(dom.statKorea, stats.koreaRelated);
}

function renderEventList(options = {}) {
  const { animate = true } = options;
  const events = getFilteredEventsSorted();

  dom.eventCount.textContent = `${events.length}개`;
  dom.eventList.innerHTML = "";

  if (!events.length) {
    renderEmpty("조건에 맞는 이벤트가 없습니다.");
    return;
  }

  const fragment = document.createDocumentFragment();
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    const row = dom.eventTemplate.content.firstElementChild.cloneNode(true);

    row.querySelector(".status-cell").innerHTML = statusPill(event);
    row.querySelector(".title-cell").innerHTML = eventTitleHtml(event, true);
    row.querySelector(".start-cell").textContent = formatDate(event.start);
    row.querySelector(".finish-cell").textContent = formatDate(event.finish);
    row.querySelector(".participants-cell").textContent = number(event.participants || 0);
    row.querySelector(".type-cell").textContent = typeText(event);
    renderEventLinks(row.querySelector(".links-cell"), event);

    if (isPinned(event)) row.classList.add("pinned-row");

    if (animate && !libs.gsap) {
      row.classList.add("row-enter");
      row.style.animationDelay = `${Math.min(index, 12) * 22}ms`;
    }

    fragment.appendChild(row);
  }

  dom.eventList.appendChild(fragment);

  if (animate) animateRows(dom.eventList);
}

function renderUpcomingList(options = {}) {
  const { animate = true } = options;

  const events = [...store.events]
    .filter((event) => event.status === "upcoming")
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
    .slice(0, 8);

  dom.upcomingCount.textContent = `${events.length}개`;
  dom.upcomingList.innerHTML = "";

  if (!events.length) {
    dom.upcomingList.innerHTML = '<tr><td class="empty" colspan="3">다가오는 행사가 없습니다.</td></tr>';
    return;
  }

  const fragment = document.createDocumentFragment();
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    const row = dom.upcomingTemplate.content.firstElementChild.cloneNode(true);

    row.querySelector(".upcoming-name").innerHTML = eventTitleHtml(event, false);
    row.querySelector(".upcoming-start").textContent = formatDate(event.start);
    row.querySelector(".upcoming-duration").textContent = formatDuration(event.start, event.finish);

    if (animate && !libs.gsap) {
      row.classList.add("row-enter");
      row.style.animationDelay = `${Math.min(index, 10) * 20}ms`;
    }

    fragment.appendChild(row);
  }

  dom.upcomingList.appendChild(fragment);

  if (animate) animateRows(dom.upcomingList);
}

function getFilteredEvents() {
  return store.events.filter((event) => {
    if (store.view === "korea" && !event.koreaRelated) return false;
    if (store.view === "live" && event.status !== "live") return false;
    if (store.view === "upcoming" && event.status !== "upcoming") return false;
    if (store.view === "pinned" && !isPinned(event)) return false;
    if (store.query && !`${event.title} ${event.location}`.toLowerCase().includes(store.query)) return false;
    return true;
  });
}

function getFilteredEventsSorted() {
  const events = getFilteredEvents();
  const sorted = [...events];

  sorted.sort((a, b) => {
    let diff = 0;

    if (store.sortBy === "participants") {
      diff = Number(a.participants || 0) - Number(b.participants || 0);
    } else if (store.sortBy === "status") {
      diff = statusRank(a.status) - statusRank(b.status);
      if (diff === 0) diff = Date.parse(a.start) - Date.parse(b.start);
    } else {
      diff = Date.parse(a.start) - Date.parse(b.start);
    }

    if (Number.isNaN(diff)) diff = 0;
    return store.sortDir === "asc" ? diff : -diff;
  });

  return sorted;
}

function renderRankList(element, list) {
  element.innerHTML = "";

  if (!Array.isArray(list) || !list.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 3;
    cell.textContent = "데이터 없음";
    row.appendChild(cell);
    element.appendChild(row);
    return;
  }

  list.forEach((entry, index) => {
    const tr = dom.rankTemplate.content.firstElementChild.cloneNode(true);
    tr.querySelector(".rank-cell").textContent = entry.rank === 1 ? `♛ ${entry.rank}` : String(entry.rank);
    tr.querySelector(".team-cell").textContent = entry.teamName;
    tr.querySelector(".points-cell").textContent = Number(entry.points || 0).toFixed(2);

    if (!libs.gsap) {
      tr.classList.add("row-enter");
      tr.style.animationDelay = `${Math.min(index, 10) * 18}ms`;
    }

    element.appendChild(tr);
  });

  animateRows(element);
}

function renderEmpty(text) {
  dom.eventList.innerHTML = `<tr><td class="empty" colspan="7">${escapeHtml(text)}</td></tr>`;
  dom.eventCount.textContent = "0개";
}

function statusLabel(status) {
  if (status === "live") return "진행중";
  if (status === "upcoming") return "예정";
  if (status === "ended") return "종료";
  return "미확인";
}

function statusRank(status) {
  if (status === "live") return 1;
  if (status === "upcoming") return 2;
  if (status === "ended") return 3;
  return 9;
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";

  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function formatRelativeTime(value) {
  if (!value) return "";

  const time = Date.parse(value);
  if (Number.isNaN(time)) return "";

  const diffSec = Math.floor((Date.now() - time) / 1000);
  if (diffSec < 5) return "방금 전";
  if (diffSec < 60) return `${diffSec}초 전`;

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}분 전`;

  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}시간 전`;

  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay}일 전`;
}

function statusPill(event) {
  const label = statusLabel(event.status);
  const klass = `status-${event.status || "unknown"}`;
  return `<span class="status-pill ${klass}">${escapeHtml(label)}</span>`;
}

function typeText(event) {
  const format = toKoreanFormat(event.format);
  if (event.onsite) return `${format} / 오프라인`;
  return `${format} / 온라인`;
}

function renderSortButtons() {
  for (const button of dom.sortButtons) {
    const key = button.dataset.sort || "";
    const base = button.dataset.label || button.textContent;
    button.classList.remove("active");

    if (key !== store.sortBy) {
      button.textContent = base;
      continue;
    }

    button.classList.add("active");
    button.textContent = `${base} ${store.sortDir === "asc" ? "↑" : "↓"}`;
  }
}

function appendLink(parent, label, href) {
  if (!href) return;
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.target = "_blank";
  anchor.rel = "noreferrer noopener";
  anchor.textContent = label;
  parent.appendChild(anchor);
}

function renderEventLinks(parent, event) {
  parent.textContent = "";

  const links = [
    { label: "CTFtime", href: event.ctftimeUrl },
    { label: "공식", href: event.eventUrl }
  ].filter((item) => Boolean(item.href));

  if (!links.length) {
    const span = document.createElement("span");
    span.className = "muted";
    span.textContent = "-";
    parent.appendChild(span);
    return;
  }

  links.forEach((item, index) => {
    appendLink(parent, item.label, item.href);
    if (index < links.length - 1) parent.append(" | ");
  });
}

function number(value) {
  return new Intl.NumberFormat("ko-KR").format(Number(value || 0));
}

function defaultSortDir(key) {
  if (key === "participants") return "desc";
  return "asc";
}

function formatDuration(start, finish) {
  const startedAt = Date.parse(start);
  const finishedAt = Date.parse(finish);
  if (Number.isNaN(startedAt) || Number.isNaN(finishedAt) || finishedAt <= startedAt) return "-";

  const totalMinutes = Math.floor((finishedAt - startedAt) / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);

  if (days > 0 && hours > 0) return `${days}일 ${hours}시간`;
  if (days > 0) return `${days}일`;
  if (hours > 0) return `${hours}시간`;
  return `${totalMinutes}분`;
}

function setStatValue(element, value) {
  const next = Number(value || 0);
  const prev = Number(element.dataset.value || NaN);

  element.dataset.value = String(next);

  if (!Number.isNaN(prev) && prev !== next && libs.anime) {
    animateStatNumber(element, prev, next);
  } else {
    element.textContent = number(next);
  }

  if (!Number.isNaN(prev) && prev !== next) {
    element.classList.remove("value-bump");
    void element.offsetWidth;
    element.classList.add("value-bump");
  }
}

function animateStatNumber(element, from, to) {
  if (!libs.anime) {
    element.textContent = number(to);
    return;
  }

  if (element._countAnim && typeof element._countAnim.pause === "function") {
    element._countAnim.pause();
  }

  const state = { value: from };
  element._countAnim = libs.anime({
    targets: state,
    value: to,
    round: 1,
    duration: 620,
    easing: "easeOutQuart",
    update() {
      element.textContent = number(state.value);
    },
    complete() {
      element.textContent = number(to);
      element._countAnim = null;
    }
  });
}

function applyDensityMode() {
  document.body.classList.toggle("dense-mode", store.dense);
  dom.densityToggle.classList.toggle("active", store.dense);
  dom.densityToggle.textContent = store.dense ? "보통 간격" : "컴팩트 보기";
}

function updateSearchControls() {
  dom.clearSearch.disabled = !store.query;
}

function refreshPinnedFilterLabel() {
  if (!dom.pinnedFilter) return;
  dom.pinnedFilter.textContent = `즐겨찾기 ${store.pinnedIds.size}`;
}

function updateStreamControls() {
  dom.streamToggle.classList.toggle("active", store.streamPaused);
  dom.streamToggle.textContent = store.streamPaused ? "실시간 재개" : "실시간 일시정지";
  updateLiveState();
}

function updateLiveState() {
  if (!dom.liveState) return;

  let stateClass = "live";
  let text = "실시간 연결";

  if (store.streamPaused && store.pendingSnapshot) {
    stateClass = "pending";
    text = "일시정지 (새 데이터 대기)";
  } else if (store.streamPaused) {
    stateClass = "paused";
    text = "일시정지";
  } else if (store.streamState === "connecting") {
    stateClass = "connecting";
    text = "연결중";
  } else if (store.streamState === "error") {
    stateClass = "error";
    text = "재연결중";
  }

  dom.liveState.className = `live-state ${stateClass}`;
  dom.liveState.textContent = text;

  if (libs.anime) {
    libs.anime.remove(dom.liveState);
    libs.anime({
      targets: dom.liveState,
      opacity: [0.74, 1],
      scale: [0.985, 1],
      duration: 240,
      easing: "easeOutQuad"
    });
  }
}

function flashTable(body) {
  const table = body?.closest("table");
  if (!table) return;

  if (libs.gsap) {
    const cells = table.querySelectorAll("tbody tr td");
    if (!cells.length) return;

    libs.gsap.killTweensOf(cells);
    libs.gsap.fromTo(
      cells,
      { backgroundColor: "#fff6cf" },
      { backgroundColor: "", duration: 0.55, ease: "power2.out", stagger: 0.002 }
    );
    return;
  }

  table.classList.remove("table-flash");
  void table.offsetWidth;
  table.classList.add("table-flash");

  setTimeout(() => {
    table.classList.remove("table-flash");
  }, 420);
}

function animateRows(tbody) {
  if (!libs.gsap) return;
  const rows = [...tbody.querySelectorAll("tr")].filter((row) => !row.querySelector(".empty"));
  if (!rows.length) return;

  libs.gsap.killTweensOf(rows);
  libs.gsap.fromTo(
    rows,
    { y: 6, autoAlpha: 0.01 },
    {
      y: 0,
      autoAlpha: 1,
      duration: 0.29,
      ease: "power2.out",
      stagger: 0.024,
      clearProps: "transform,opacity"
    }
  );
}

function eventKey(event) {
  if (event.id) return `id:${event.id}`;
  if (event.ctfId) return `ctf:${event.ctfId}`;
  return `name:${event.title}|${event.start}`;
}

function isPinned(event) {
  return store.pinnedIds.has(eventKey(event));
}

function eventTitleHtml(event, withPin) {
  const title = escapeHtml(event.title);
  const href = escapeHtml(event.ctftimeUrl || event.eventUrl || "#");
  const location = escapeHtml(toKoreanLocation(event.location) || (event.onsite ? "오프라인" : "온라인"));

  const content = `<a href="${href}" target="_blank" rel="noreferrer noopener">${title}</a><div class="event-sub">${location}</div>`;

  if (!withPin) return content;

  const pinned = isPinned(event);
  const pin = pinned ? "★" : "☆";
  const pinClass = pinned ? "pin-btn active" : "pin-btn";
  const key = escapeHtml(eventKey(event));
  const pinLabel = pinned ? "즐겨찾기 해제" : "즐겨찾기 추가";

  return `<div class="title-wrap"><button class="${pinClass}" type="button" data-pin="${key}" aria-label="${pinLabel}" title="${pinLabel}">${pin}</button><div class="title-main">${content}</div></div>`;
}

function escapeHtml(raw) {
  return String(raw)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function toKoreanFormat(raw) {
  if (!raw) return "미분류";
  const key = String(raw).trim().toLowerCase();
  return FORMAT_KO_MAP[key] || raw;
}

function toKoreanLocation(raw) {
  if (!raw) return "";
  const value = String(raw);
  if (value.toLowerCase() === "online") return "온라인";
  return value;
}

function savePinnedIds(value) {
  try {
    localStorage.setItem(PIN_STORAGE_KEY, JSON.stringify([...value]));
  } catch {
    // ignore storage failures
  }
}

function loadPinnedIds() {
  try {
    const raw = localStorage.getItem(PIN_STORAGE_KEY);
    if (!raw) return new Set();

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();

    return new Set(parsed.map((entry) => String(entry)));
  } catch {
    return new Set();
  }
}

function saveDenseMode(enabled) {
  try {
    localStorage.setItem(DENSE_STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    // ignore storage failures
  }
}

function loadDenseMode() {
  try {
    return localStorage.getItem(DENSE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}
