const WORKER_BASE = "https://idleon-upgrade-advisor.zodiacgolem.workers.dev";

const demoData = {
  "CauldronP2W": [
    [35, 20, 15, 40, 25, 20, 30, 18, 10, 50, 30, 22],
    [20, 12, 15, 10, 12, 8, 9, 7],
    [4, 12]
  ],
  "StampLv": [
    { "0": 12, "1": 18, "2": 20, "length": 3 },
    { "0": 15, "1": 10, "length": 2 },
    { "0": 8, "length": 1 }
  ],
  "StampLvM": [
    { "0": 15, "1": 20, "2": 25, "length": 3 },
    { "0": 17, "1": 16, "length": 2 },
    { "0": 12, "length": 1 }
  ],
  "CauldronInfo": [
    { "0": 12, "1": 20, "2": 8, "length": 3 },
    { "0": 25, "1": 14, "length": 2 },
    { "0": 18, "length": 1 },
    { "0": 30, "1": 33, "length": 2 }
  ]
};

function $(id) {
  return document.getElementById(id);
}

function setStatus(message, type = "idle") {
  const el = $("status");
  el.textContent = message;
  el.className = `status ${type}`;
}

function getNested(obj, path, fallback = null) {
  let cur = obj;
  for (const key of path) {
    if (Array.isArray(cur) && Number.isInteger(key)) {
      cur = key < cur.length ? cur[key] : fallback;
    } else if (cur && typeof cur === "object") {
      cur = Object.prototype.hasOwnProperty.call(cur, key) ? cur[key] : fallback;
    } else {
      return fallback;
    }
  }
  return cur;
}

function toSlug(input) {
  const value = String(input || "").trim();
  const m = value.match(/^https?:\/\/([a-zA-Z0-9_-]+)\.idleonefficiency\.com\/?$/i);
  return m ? m[1] : value;
}

async function fetchProfileJson(profileInput) {
  const slug = toSlug(profileInput);
  const url = `${WORKER_BASE}/?slug=${encodeURIComponent(slug)}`;

  const res = await fetch(url, { cache: "no-store" });
  const text = await res.text();

  if (!res.ok) {
    throw new Error(text || `Proxy failed with status ${res.status}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Worker returned non-JSON data.");
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function average(nums) {
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function scoreFormula({
  impact,
  effort,
  urgency = 0,
  accountWide = 0,
  catchUp = 0,
  confidence = 7
}) {
  return Math.round(
    impact * 8 +
    accountWide * 6 +
    urgency * 5 +
    catchUp * 4 +
    confidence * 2 -
    effort * 6
  );
}

function inferStage(data) {
  const p2w = getNested(data, ["CauldronP2W"], []);
  const cauld = Array.isArray(p2w[0]) ? p2w[0] : [];
  const bubbleLevels = getNested(data, ["CauldronInfo"], [])
    .slice(0, 4)
    .flatMap(group => group && typeof group === "object"
      ? Object.entries(group)
          .filter(([k]) => k !== "length")
          .map(([, v]) => Number(v))
      : []
    );

  const stampLevels = getNested(data, ["StampLv"], [])
    .flatMap(group => group && typeof group === "object"
      ? Object.entries(group)
          .filter(([k]) => k !== "length")
          .map(([, v]) => Number(v))
      : []
    );

  const avgCauld = average(cauld.map(Number).filter(n => Number.isFinite(n)));
  const avgBubble = average(bubbleLevels.filter(n => Number.isFinite(n)));
  const avgStamp = average(stampLevels.filter(n => Number.isFinite(n)));

  const stageScore = avgCauld * 0.5 + avgBubble * 1.2 + avgStamp * 0.9;

  if (stageScore < 22) return "early";
  if (stageScore < 50) return "mid";
  return "late";
}

function buildAlchemyP2WRecs(data, stage) {
  const recs = [];
  const p2w = getNested(data, ["CauldronP2W"], []);
  if (!Array.isArray(p2w) || p2w.length < 3) return recs;

  const cauld = Array.isArray(p2w[0]) ? p2w[0] : [];
  const liq = Array.isArray(p2w[1]) ? p2w[1] : [];
  const vial = Array.isArray(p2w[2]) ? p2w[2] : [];

  const stageImpactBoost = {
    early: 1.15,
    mid: 1.0,
    late: 0.9
  }[stage];

  ["Power", "Quicc", "High-IQ", "Kazam"].forEach((name, idx) => {
    const base = idx * 3;
    const values = base + 2 < cauld.length ? cauld.slice(base, base + 3).map(Number) : [0, 0, 0];

    [
      {
        label: "Cauldron Speed",
        level: values[0],
        cap: 150,
        impact: 9.5,
        accountWide: 9.5,
        preferredBelow: 110
      },
      {
        label: "New Bubble",
        level: values[1],
        cap: 125,
        impact: 9.2,
        accountWide: 9.0,
        preferredBelow: 95
      },
      {
        label: "Boost Req",
        level: values[2],
        cap: 100,
        impact: 6.5,
        accountWide: 7.0,
        preferredBelow: 75
      }
    ].forEach((item) => {
      const gap = Math.max(0, item.cap - item.level);
      if (!gap) return;

      const progress = item.level / item.cap;
      const effort =
        progress < 0.35 ? 2 :
        progress < 0.7 ? 3 :
        progress < 0.9 ? 5 : 7;

      const urgency =
        item.level < item.preferredBelow ? 8 : 4;

      const catchUp =
        gap >= item.cap * 0.5 ? 8 :
        gap >= item.cap * 0.3 ? 6 : 3;

      const score = scoreFormula({
        impact: item.impact * stageImpactBoost,
        effort,
        urgency,
        accountWide: item.accountWide,
        catchUp,
        confidence: 9
      });

      recs.push({
        title: `${name} ${item.label}`,
        category: "Alchemy P2W",
        impact: Math.round(item.impact),
        effort,
        confidence: 9,
        score,
        why: `${item.label} is still low at ${item.level}/${item.cap}, and this is one of the broadest account-wide progression upgrades.`,
        detail: `Gap to cap: ${gap}. Best-effort priority favors broad alchemy progression.`
      });
    });
  });

  ["Water", "N2", "Trench", "Toxic"].forEach((name, idx) => {
    const base = idx * 2;
    const values = base + 1 < liq.length ? liq.slice(base, base + 2).map(Number) : [0, 0];

    [
      {
        label: "Liquid Regen",
        level: values[0],
        cap: 100,
        impact: 7.8,
        accountWide: 8.0
      },
      {
        label: "Liquid Capacity",
        level: values[1],
        cap: 80,
        impact: 7.0,
        accountWide: 7.5
      }
    ].forEach((item) => {
      const gap = Math.max(0, item.cap - item.level);
      if (!gap) return;

      const effort =
        item.level < item.cap * 0.35 ? 2 :
        item.level < item.cap * 0.75 ? 3 : 5;

      const urgency =
        gap > item.cap * 0.45 ? 7 :
        gap > item.cap * 0.2 ? 5 : 3;

      const catchUp =
        item.level < item.cap * 0.4 ? 8 :
        item.level < item.cap * 0.7 ? 5 : 2;

      const score = scoreFormula({
        impact: item.impact,
        effort,
        urgency,
        accountWide: item.accountWide,
        catchUp,
        confidence: 8
      });

      recs.push({
        title: `${name} ${item.label}`,
        category: "Alchemy P2W",
        impact: Math.round(item.impact),
        effort,
        confidence: 8,
        score,
        why: `${item.label} is behind at ${item.level}/${item.cap}, making your liquid flow worse than it should be.`,
        detail: `Gap to cap: ${gap}. This tends to smooth many future alchemy upgrades.`
      });
    });
  });

  if (vial.length >= 2) {
    [
      {
        label: "Vial Attempts",
        level: Number(vial[0]),
        cap: 15,
        impact: 6.2,
        accountWide: 6.4
      },
      {
        label: "Vial RNG",
        level: Number(vial[1]),
        cap: 45,
        impact: 5.2,
        accountWide: 5.5
      }
    ].forEach((item) => {
      const gap = Math.max(0, item.cap - item.level);
      if (!gap) return;

      const effort =
        item.level < item.cap * 0.35 ? 2 :
        item.level < item.cap * 0.75 ? 3 : 5;

      const urgency =
        item.label === "Vial Attempts" ? 6 : 4;

      const catchUp =
        gap > item.cap * 0.4 ? 6 : 3;

      const score = scoreFormula({
        impact: item.impact,
        effort,
        urgency,
        accountWide: item.accountWide,
        catchUp,
        confidence: 8
      });

      recs.push({
        title: item.label,
        category: "Alchemy P2W",
        impact: Math.round(item.impact),
        effort,
        confidence: 8,
        score,
        why: `${item.label} is below a healthy level at ${item.level}/${item.cap} and is usually a simple account-wide cleanup.`,
        detail: `Gap to cap: ${gap}.`
      });
    });
  }

  return recs;
}

function buildStampRecs(data, stage) {
  const recs = [];
  const stampLv = getNested(data, ["StampLv"], []);
  const stampMax = getNested(data, ["StampLvM"], []);

  if (!Array.isArray(stampLv) || !Array.isArray(stampMax)) return recs;

  stampLv.forEach((tab, tabIndex) => {
    if (!tab || typeof tab !== "object") return;
    const maxTab = stampMax[tabIndex] && typeof stampMax[tabIndex] === "object"
      ? stampMax[tabIndex]
      : {};

    Object.entries(tab).forEach(([key, value]) => {
      if (key === "length") return;

      const cur = Number(value);
      const mx = Number(maxTab[key] ?? cur);
      const gap = Math.max(0, mx - cur);

      if (cur <= 0 || gap <= 0) return;

      const isEasyFinish = gap <= 3;
      const isReasonableFinish = gap <= 8;
      if (!isReasonableFinish) return;

      const effort =
        gap <= 2 ? 1 :
        gap <= 4 ? 2 :
        gap <= 6 ? 3 : 4;

      const impact =
        tabIndex === 0 ? 5.5 :
        tabIndex === 1 ? 6.0 : 5.0;

      const urgency =
        isEasyFinish ? 8 :
        gap <= 5 ? 6 : 4;

      const catchUp =
        stage === "early" ? 5 :
        stage === "mid" ? 6 : 7;

      const score = scoreFormula({
        impact,
        effort,
        urgency,
        accountWide: 6.5,
        catchUp,
        confidence: 7
      });

      recs.push({
        title: `Stamp tab ${tabIndex + 1} slot ${key}`,
        category: "Stamps",
        impact: Math.round(impact),
        effort,
        confidence: 7,
        score,
        why: `This stamp is near its current max (${cur}/${mx}), which makes it one of the easier account-wide cleanup wins available.`,
        detail: `Missing ${gap} levels to current cap.`
      });
    });
  });

  return recs;
}

function buildBubbleRecs(data, stage) {
  const recs = [];
  const bubbles = getNested(data, ["CauldronInfo"], []);
  if (!Array.isArray(bubbles)) return recs;

  bubbles.slice(0, 4).forEach((group, groupIndex) => {
    if (!group || typeof group !== "object") return;

    Object.entries(group).forEach(([key, value]) => {
      if (key === "length") return;
      const lvl = Number(value);

      if (!Number.isFinite(lvl) || lvl < 1) return;

      let impact = 0;
      let urgency = 0;
      let effort = 0;

      if (lvl >= 5 && lvl <= 20) {
        impact = 7.0;
        urgency = 8.0;
        effort = 2;
      } else if (lvl > 20 && lvl <= 35) {
        impact = 6.0;
        urgency = 5.0;
        effort = 3;
      } else if (lvl > 35 && lvl <= 50 && stage !== "early") {
        impact = 4.5;
        urgency = 3.0;
        effort = 4;
      } else {
        return;
      }

      const score = scoreFormula({
        impact,
        effort,
        urgency,
        accountWide: 5.5,
        catchUp: stage === "early" ? 7 : 5,
        confidence: 6
      });

      recs.push({
        title: `Cauldron ${groupIndex + 1} bubble ${key}`,
        category: "Bubbles",
        impact: Math.round(impact),
        effort,
        confidence: 6,
        score,
        why: `Bubble level ${lvl} is in a range where a few more levels are often still fast, efficient gains.`,
        detail: `Best-effort bubble recommendation based on level band priority.`
      });
    });
  });

  return recs;
}

function dedupeRecommendations(recs) {
  const seen = new Set();
  const out = [];

  for (const rec of recs) {
    const key = `${rec.category}::${rec.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(rec);
  }

  return out;
}

function rankRecommendations(data) {
  const stage = inferStage(data);

  const recs = [
    ...buildAlchemyP2WRecs(data, stage),
    ...buildStampRecs(data, stage),
    ...buildBubbleRecs(data, stage)
  ];

  const deduped = dedupeRecommendations(recs).sort((a, b) => b.score - a.score);

  const categoryCounts = {};
  for (const rec of deduped) {
    categoryCounts[rec.category] = (categoryCounts[rec.category] || 0) + 1;
  }

  const p2w = getNested(data, ["CauldronP2W"], []);
  const stampLv = getNested(data, ["StampLv"], []);
  const bubbles = getNested(data, ["CauldronInfo"], []);

  const dataSourcesFound = [
    Array.isArray(p2w) && p2w.length >= 3,
    Array.isArray(stampLv) && stampLv.length > 0,
    Array.isArray(bubbles) && bubbles.length > 0
  ].filter(Boolean).length;

  const quality = [
    {
      label: "Alchemy P2W data",
      found: Array.isArray(p2w) && p2w.length >= 3,
      detail: Array.isArray(p2w) && p2w.length >= 3 ? "Detected and weighted heavily." : "Missing from payload."
    },
    {
      label: "Stamp data",
      found: Array.isArray(stampLv) && stampLv.length > 0,
      detail: Array.isArray(stampLv) && stampLv.length > 0 ? "Detected and used for easy-win cleanup logic." : "Missing from payload."
    },
    {
      label: "Bubble data",
      found: Array.isArray(bubbles) && bubbles.length > 0,
      detail: Array.isArray(bubbles) && bubbles.length > 0 ? "Detected and used for mid-level catch-up logic." : "Missing from payload."
    },
    {
      label: "Estimated account stage",
      found: true,
      detail: stage.charAt(0).toUpperCase() + stage.slice(1)
    },
    {
      label: "Overall confidence",
      found: true,
      detail: dataSourcesFound >= 3 ? "High" : dataSourcesFound === 2 ? "Medium" : "Low"
    }
  ];

  return { recs: deduped, categoryCounts, quality, stage };
}

function renderRecCard(rec, rank = null) {
  return `
    <article class="rec-card">
      <div class="rec-top">
        <div>
          ${rank ? `<div class="pill">#${rank}</div>` : ""}
          <h4 class="rec-title">${rec.title}</h4>
          <div class="muted">${rec.why}</div>
          ${rec.detail ? `<div class="muted" style="margin-top:8px;font-size:.92rem">${rec.detail}</div>` : ""}
        </div>
        <div class="score-pill">Score ${rec.score}</div>
      </div>
      <div class="rec-meta">
        <span class="tag">${rec.category}</span>
        <span class="tag">Impact ${rec.impact}</span>
        <span class="tag">Effort ${rec.effort}</span>
        <span class="tag">Confidence ${rec.confidence}</span>
      </div>
    </article>
  `;
}

function renderResults(result) {
  const { recs, categoryCounts, quality, stage } = result;
  if (!recs.length) {
    throw new Error("No recommendations were produced from this profile.");
  }

  const best = recs[0];

  $("emptyState").classList.add("hidden");
  $("results").classList.remove("hidden");

  $("primaryCategory").textContent = `${best.category} • ${stage}`;
  $("primaryScore").textContent = `Score ${best.score}`;
  $("primaryTitle").textContent = best.title;
  $("primaryWhy").textContent = best.why;
  $("primaryImpact").textContent = best.impact;
  $("primaryEffort").textContent = best.effort;
  $("primaryConfidence").textContent = best.confidence;

  $("kpiTotal").textContent = recs.length;
  $("kpiEasy").textContent = recs.filter(r => r.effort <= 2).length;
  $("kpiCategories").textContent = Object.keys(categoryCounts).length;
  $("kpiBest").textContent = best.score;

  $("top3List").innerHTML = recs.slice(0, 3).map((rec, i) => renderRecCard(rec, i + 1)).join("");
  $("backupList").innerHTML = recs.slice(3, 8).map(rec => renderRecCard(rec)).join("");

  const maxCategoryCount = Math.max(...Object.values(categoryCounts), 1);
  $("categoryBreakdown").innerHTML = Object.entries(categoryCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => `
      <div class="breakdown-row">
        <div class="breakdown-top">
          <strong>${name}</strong>
          <span>${count}</span>
        </div>
        <div class="bar">
          <span style="width: ${(count / maxCategoryCount) * 100}%"></span>
        </div>
      </div>
    `)
    .join("");

  $("qualityList").innerHTML = quality.map(item => `
    <div class="quality-card">
      <div class="rec-top">
        <strong>${item.label}</strong>
        <span class="tag">${item.found ? "Yes" : "No"}</span>
      </div>
      <div class="muted">${item.detail}</div>
    </div>
  `).join("");
}

function clearResults() {
  $("results").classList.add("hidden");
  $("emptyState").classList.remove("hidden");
  $("top3List").innerHTML = "";
  $("backupList").innerHTML = "";
  $("categoryBreakdown").innerHTML = "";
  $("qualityList").innerHTML = "";
}

async function analyze() {
  const jsonInput = $("jsonInput").value.trim();
  const profileInput = $("profileInput").value.trim();

  try {
    setStatus("Loading profile data...", "loading");
    clearResults();

    let data;
    if (jsonInput) {
      data = JSON.parse(jsonInput);
    } else if (profileInput) {
      data = await fetchProfileJson(profileInput);
    } else {
      throw new Error("Enter a profile URL/slug or paste Raw JSON.");
    }

    const result = rankRecommendations(data);
    renderResults(result);
    setStatus(`Loaded ${result.recs.length} recommendations.`, "success");
  } catch (err) {
    setStatus(err.message || "Something went wrong.", "error");
  }
}

function loadDemo() {
  $("jsonInput").value = JSON.stringify(demoData, null, 2);
  $("profileInput").value = "";
  analyze();
}

function clearAll() {
  $("profileInput").value = "";
  $("jsonInput").value = "";
  clearResults();
  setStatus("Ready.", "idle");
}

$("analyzeBtn").addEventListener("click", analyze);
$("demoBtn").addEventListener("click", loadDemo);
$("clearBtn").addEventListener("click", clearAll);
