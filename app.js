const STORAGE_KEY = "boatAiPredictionHistory";

const state = {
  selectedVenueId: null,
  selectedRaceNo: null
};

const sampleData = {
  venues: [
    { id: "toda", name: "戸田", area: "埼玉", races: createRaces("toda") },
    { id: "suminoe", name: "住之江", area: "大阪", races: createRaces("suminoe") },
    { id: "heiwajima", name: "平和島", area: "東京", races: createRaces("heiwajima") },
    { id: "omura", name: "大村", area: "長崎", races: createRaces("omura") }
  ]
};

function createRaces(seedKey) {
  const seed = hashString(seedKey);
  return Array.from({ length: 12 }, (_, i) => {
    const raceNo = i + 1;
    const startHour = 10 + Math.floor((raceNo - 1) * 35 / 60);
    const startMin = 20 + ((raceNo - 1) * 35) % 60;
    const adjustedHour = startHour + Math.floor(startMin / 60);
    const adjustedMin = startMin % 60;

    return {
      raceNo,
      title: raceNo === 12 ? "優勝戦" : raceNo >= 10 ? "特別戦" : "予選",
      deadline: `${String(adjustedHour).padStart(2, "0")}:${String(adjustedMin).padStart(2, "0")}`,
      entries: createEntries(seed + raceNo * 13)
    };
  });
}

function createEntries(seed) {
  const names = [
    "佐藤 太郎", "鈴木 健介", "高橋 海斗", "田中 悠真", "山本 拓也", "伊藤 亮",
    "渡辺 剛", "中村 翔", "小林 直樹", "加藤 蓮", "吉田 颯", "山田 陸"
  ];

  return Array.from({ length: 6 }, (_, i) => {
    const r = pseudo(seed + i * 31);
    const r2 = pseudo(seed + i * 47 + 7);
    const r3 = pseudo(seed + i * 59 + 11);

    return {
      lane: i + 1,
      name: names[(seed + i * 3) % names.length],
      className: r > 0.68 ? "A1" : r > 0.38 ? "A2" : "B1",
      nationalWinRate: round(4.6 + r * 2.5, 2),
      localWinRate: round(4.3 + r2 * 2.8, 2),
      motorRate: round(26 + r3 * 24, 1),
      avgSt: round(0.11 + (1 - r2) * 0.09, 2),
      exhibition: round(6.68 + (1 - r3) * 0.22, 2)
    };
  });
}

function hashString(str) {
  let h = 0;
  for (const ch of str) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

function pseudo(n) {
  const x = Math.sin(n * 999) * 10000;
  return x - Math.floor(x);
}

function round(v, digits) {
  const p = 10 ** digits;
  return Math.round(v * p) / p;
}

function normalize(value, min, max, reverse = false) {
  if (max === min) return 0.5;
  let n = (value - min) / (max - min);
  n = Math.max(0, Math.min(1, n));
  return reverse ? 1 - n : n;
}

function calculateScores(entries) {
  const national = entries.map(x => x.nationalWinRate);
  const local = entries.map(x => x.localWinRate);
  const motor = entries.map(x => x.motorRate);
  const st = entries.map(x => x.avgSt);
  const exhibition = entries.map(x => x.exhibition);

  const scored = entries.map(x => {
    const laneBonusMap = [1.00, 0.78, 0.68, 0.62, 0.56, 0.50];
    const laneScore = laneBonusMap[x.lane - 1];

    const nationalScore = normalize(x.nationalWinRate, Math.min(...national), Math.max(...national));
    const localScore = normalize(x.localWinRate, Math.min(...local), Math.max(...local));
    const motorScore = normalize(x.motorRate, Math.min(...motor), Math.max(...motor));
    const stScore = normalize(x.avgSt, Math.min(...st), Math.max(...st), true);
    const exhibitionScore = normalize(x.exhibition, Math.min(...exhibition), Math.max(...exhibition), true);

    // MVP用の重み付け。後で学習モデルへ差し替え可能。
    const raw =
      laneScore * 0.24 +
      nationalScore * 0.23 +
      localScore * 0.12 +
      motorScore * 0.18 +
      stScore * 0.13 +
      exhibitionScore * 0.10;

    return {
      ...x,
      rawScore: raw
    };
  });

  const expScores = scored.map(x => Math.exp(x.rawScore * 3.1));
  const total = expScores.reduce((a, b) => a + b, 0);

  return scored
    .map((x, idx) => ({
      ...x,
      aiScore: round(x.rawScore * 100, 1),
      winProb: round((expScores[idx] / total) * 100, 1)
    }))
    .sort((a, b) => b.rawScore - a.rawScore);
}

function generateTrifecta(scored) {
  const combos = [];
  const byLane = [...scored];

  for (const first of byLane) {
    for (const second of byLane) {
      if (second.lane === first.lane) continue;
      for (const third of byLane) {
        if (third.lane === first.lane || third.lane === second.lane) continue;

        const score =
          first.winProb * 0.58 +
          second.winProb * 0.27 +
          third.winProb * 0.15;

        combos.push({
          combo: `${first.lane}-${second.lane}-${third.lane}`,
          score
        });
      }
    }
  }

  const top = combos.sort((a, b) => b.score - a.score).slice(0, 8);
  const max = top[0]?.score || 1;

  return top.map(x => ({
    ...x,
    relative: round((x.score / max) * 100, 1)
  }));
}

function buildReasons(scored) {
  const top = scored[0];
  const second = scored[1];
  const motorBest = [...scored].sort((a, b) => b.motorRate - a.motorRate)[0];
  const stBest = [...scored].sort((a, b) => a.avgSt - b.avgSt)[0];
  const exhibitionBest = [...scored].sort((a, b) => a.exhibition - b.exhibition)[0];

  const reasons = [
    `${top.lane}号艇 ${top.name} は総合AIスコアが最上位（${top.aiScore}点）で、1着推定 ${top.winProb}% です。`,
    `${second.lane}号艇 ${second.name} は対抗評価。全国勝率 ${second.nationalWinRate}、当地勝率 ${second.localWinRate} を加味しています。`,
    `モーター評価では ${motorBest.lane}号艇が最高（2連率 ${motorBest.motorRate}%）です。`,
    `平均STは ${stBest.lane}号艇が最速クラス（${stBest.avgSt}）です。`,
    `展示タイムは ${exhibitionBest.lane}号艇が最上位（${exhibitionBest.exhibition}）です。`
  ];

  if (top.lane === 1) {
    reasons.push("1号艇が総合1位のため、イン優位を加味した本命寄りの予想です。");
  } else {
    reasons.push(`1号艇以外の ${top.lane}号艇が総合1位のため、やや波乱寄りの評価です。`);
  }

  return reasons;
}

function renderVenues() {
  const list = document.getElementById("venueList");
  const template = document.getElementById("venueTemplate");
  list.innerHTML = "";

  sampleData.venues.forEach(v => {
    const node = template.content.cloneNode(true);
    const btn = node.querySelector(".venue-card");
    node.querySelector(".venue-name").textContent = v.name;
    node.querySelector(".venue-meta").textContent = `${v.area} / 12R`;
    btn.dataset.venueId = v.id;

    if (state.selectedVenueId === v.id) btn.classList.add("active");

    btn.addEventListener("click", () => {
      state.selectedVenueId = v.id;
      state.selectedRaceNo = null;
      renderVenues();
      renderRaceList();
      hidePrediction();
    });

    list.appendChild(node);
  });
}

function renderRaceList() {
  const grid = document.getElementById("raceList");
  const sub = document.getElementById("raceListSub");
  grid.innerHTML = "";

  const venue = sampleData.venues.find(v => v.id === state.selectedVenueId);
  if (!venue) {
    sub.textContent = "開催場を選択してください。";
    return;
  }

  sub.textContent = `${venue.name}のレース一覧`;

  venue.races.forEach(race => {
    const btn = document.createElement("button");
    btn.className = "race-btn";
    if (state.selectedRaceNo === race.raceNo) btn.classList.add("active");

    btn.innerHTML = `<strong>${race.raceNo}R</strong><span>${race.deadline} / ${race.title}</span>`;
    btn.addEventListener("click", () => {
      state.selectedRaceNo = race.raceNo;
      renderRaceList();
      renderSelectedRace();
    });

    grid.appendChild(btn);
  });
}

function renderSelectedRace() {
  const venue = sampleData.venues.find(v => v.id === state.selectedVenueId);
  const race = venue?.races.find(r => r.raceNo === state.selectedRaceNo);
  if (!venue || !race) return;

  const scored = calculateScores(race.entries);
  const byLane = [...scored].sort((a, b) => a.lane - b.lane);
  const tickets = generateTrifecta(scored);
  const reasons = buildReasons(scored);

  document.getElementById("raceDetailPanel").classList.remove("hidden");
  document.getElementById("predictionPanel").classList.remove("hidden");
  document.getElementById("raceTitle").textContent = `${venue.name} ${race.raceNo}R ${race.title}`;
  document.getElementById("raceMeta").textContent = `締切目安 ${race.deadline} / サンプルデータ`;
  document.getElementById("raceStatus").textContent = "分析完了";

  const body = document.getElementById("entryBody");
  body.innerHTML = "";

  byLane.forEach(e => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><span class="lane-badge lane-${e.lane}">${e.lane}</span></td>
      <td>${e.name}</td>
      <td>${e.className}</td>
      <td>${e.nationalWinRate}</td>
      <td>${e.localWinRate}</td>
      <td>${e.motorRate}%</td>
      <td>${e.avgSt}</td>
      <td>${e.exhibition}</td>
      <td class="score">${e.aiScore}</td>
      <td class="prob">${e.winProb}%</td>
    `;
    body.appendChild(tr);
  });

  const rankSymbols = ["◎", "○", "▲", "△", "☆", "－"];
  document.getElementById("rankList").innerHTML = scored.map((e, i) => `
    <div class="rank-row">
      <div>
        <span class="rank-symbol">${rankSymbols[i] || "・"}</span>
        <strong style="margin-left:8px">${e.lane}号艇 ${e.name}</strong>
      </div>
      <div>${e.aiScore}点 / ${e.winProb}%</div>
    </div>
  `).join("");

  document.getElementById("ticketList").innerHTML = tickets.map((t, i) => `
    <div class="ticket-item">
      <div class="ticket-combo">${t.combo}</div>
      <div class="ticket-bar"><span style="width:${t.relative}%"></span></div>
      <div class="ticket-score">${i < 3 ? "本線" : "候補"} ${t.relative}%</div>
    </div>
  `).join("");

  document.getElementById("reasonList").innerHTML =
    reasons.map(x => `<div class="reason-item">・${x}</div>`).join("");

  saveHistory({
    venue: venue.name,
    raceNo: race.raceNo,
    title: race.title,
    topPick: `${scored[0].lane}号艇 ${scored[0].name}`,
    topTicket: tickets[0]?.combo || "-",
    timestamp: new Date().toLocaleString("ja-JP")
  });
}

function hidePrediction() {
  document.getElementById("raceDetailPanel").classList.add("hidden");
  document.getElementById("predictionPanel").classList.add("hidden");
}

function saveHistory(item) {
  const current = getHistory();
  const filtered = current.filter(x =>
    !(x.venue === item.venue && x.raceNo === item.raceNo && x.title === item.title)
  );
  filtered.unshift(item);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered.slice(0, 30)));
  renderHistory();
}

function getHistory() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function renderHistory() {
  const list = document.getElementById("historyList");
  const history = getHistory();

  if (!history.length) {
    list.innerHTML = `<div class="history-item"><span>まだ予想履歴はありません。</span></div>`;
    return;
  }

  list.innerHTML = history.map(h => `
    <div class="history-item">
      <div>
        <strong>${h.venue} ${h.raceNo}R ${h.title}</strong><br>
        <small>本命: ${h.topPick} / 3連単1位: ${h.topTicket}</small>
      </div>
      <small>${h.timestamp}</small>
    </div>
  `).join("");
}

function rerunCurrent() {
  if (state.selectedVenueId && state.selectedRaceNo) {
    renderSelectedRace();
  }
}

document.getElementById("refreshBtn").addEventListener("click", rerunCurrent);

document.getElementById("clearHistoryBtn").addEventListener("click", () => {
  localStorage.removeItem(STORAGE_KEY);
  renderHistory();
});

renderVenues();
renderRaceList();
renderHistory();
