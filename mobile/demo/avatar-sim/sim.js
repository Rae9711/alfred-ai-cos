(() => {
  // mobile/src/lib/avatarEvolution.ts
  var EVOLUTION_FORMS = [
    {
      minLevel: 1,
      name: "Cloud core",
      shellAsset: "/avatar-pack/evo-core-lv1.svg",
      lottieSkin: "cloud-core-base.json"
    },
    {
      minLevel: 5,
      name: "Cloud core · advanced",
      shellAsset: "/avatar-pack/evo-core-lv5.svg",
      lottieSkin: "cloud-core-base.json"
    },
    {
      minLevel: 10,
      name: "Cloud core · awakened",
      shellAsset: "/avatar-pack/evo-core-lv10.svg",
      lottieSkin: "cloud-core-base.json"
    }
  ];
  function getEvolutionForm(level) {
    let form = EVOLUTION_FORMS[0];
    for (const item of EVOLUTION_FORMS) {
      if (level >= item.minLevel)
        form = item;
    }
    return form;
  }

  // mobile/src/lib/agentMeta.ts
  var COSMETICS = [
    {
      id: "head-crown",
      slot: "head",
      name: "Cloud crown",
      unlockLevel: 7,
      icon: "\uD83D\uDC51",
      asset: "/cosmetics/hat-crown.svg"
    },
    {
      id: "face-visor",
      slot: "face",
      name: "Smart visor",
      unlockLevel: 5,
      icon: "\uD83D\uDD76️",
      asset: "/cosmetics/face-visor.svg"
    },
    {
      id: "back-pack",
      slot: "back",
      name: "Task pack",
      unlockLevel: 5,
      icon: "\uD83C\uDF92",
      asset: "/cosmetics/back-pack.svg"
    },
    {
      id: "back-wing",
      slot: "back",
      name: "Data wings",
      unlockLevel: 10,
      icon: "\uD83E\uDEBD",
      asset: "/cosmetics/back-wing.svg"
    },
    {
      id: "aura-glow",
      slot: "aura",
      name: "Data glow",
      unlockLevel: 2,
      icon: "✨",
      asset: "/cosmetics/aura-glow.svg"
    },
    {
      id: "aura-sun",
      slot: "aura",
      name: "Orbit ring",
      unlockLevel: 9,
      icon: "☀️",
      asset: "/cosmetics/aura-sun.svg"
    },
    {
      id: "back-particles",
      slot: "back",
      name: "Data particles",
      unlockLevel: 4,
      icon: "\uD83D\uDCA0",
      asset: "/cosmetics/effect-particles.svg"
    },
    {
      id: "back-ribbon",
      slot: "back",
      name: "Celebration ribbon",
      unlockLevel: 8,
      icon: "\uD83C\uDF8A",
      asset: "/cosmetics/effect-ribbon.svg"
    },
    {
      id: "badge-streak",
      slot: "badge",
      name: "Streak badge",
      unlockLevel: 5,
      icon: "\uD83C\uDFC5",
      asset: "/cosmetics/badge-streak.svg"
    },
    {
      id: "badge-pro",
      slot: "badge",
      name: "Pro collaborator",
      unlockLevel: 10,
      icon: "\uD83D\uDEE1️",
      asset: "/cosmetics/badge-pro.svg"
    }
  ];
  var DAILY_CAPS = {
    agent_message_sent: 20,
    task_completed: 10,
    tool_used: 40,
    streak_day: 1,
    user_feedback_positive: 8,
    shared_result: 5
  };
  var BASE_XP = {
    agent_message_sent: 5,
    task_completed: 40,
    tool_used: 6,
    streak_day: 20,
    user_feedback_positive: 20,
    shared_result: 35
  };
  var LEVEL_THRESHOLDS = [
    0,
    80,
    180,
    320,
    520,
    780,
    1120,
    1560,
    2120,
    2820,
    3680,
    4720
  ];
  var MAX_LEVEL_THRESHOLD = LEVEL_THRESHOLDS[LEVEL_THRESHOLDS.length - 1] ?? LEVEL_THRESHOLDS[0];
  function isoDay(ts) {
    return new Date(ts).toISOString().slice(0, 10);
  }
  function levelFromXp(xp) {
    let level = 1;
    for (let i = 1;i < LEVEL_THRESHOLDS.length; i += 1) {
      const threshold = LEVEL_THRESHOLDS[i];
      if (threshold !== undefined && xp >= threshold)
        level = i + 1;
    }
    return level;
  }
  function nextLevelXp(level) {
    const idx = Math.max(1, level);
    return LEVEL_THRESHOLDS[idx] ?? MAX_LEVEL_THRESHOLD;
  }
  function currentLevelXp(level) {
    const idx = Math.max(0, level - 1);
    return LEVEL_THRESHOLDS[idx] ?? 0;
  }
  function getFormByLevel(level) {
    const form = getEvolutionForm(level);
    return {
      name: form.name,
      lottieSkin: form.lottieSkin,
      shellAsset: form.shellAsset
    };
  }
  function getLevelFx(level) {
    if (level >= 10) {
      return { scale: 1.08, glowBlur: 32, glowAlpha: 0.4 };
    }
    if (level >= 5) {
      return { scale: 1.02, glowBlur: 24, glowAlpha: 0.3 };
    }
    return { scale: 1, glowBlur: 18, glowAlpha: 0.2 };
  }
  function getDefaultMeta() {
    return {
      xp: 0,
      level: 1,
      streakDays: 0,
      lastActiveDate: null,
      todayCounters: {
        agent_message_sent: 0,
        task_completed: 0,
        tool_used: 0,
        streak_day: 0,
        user_feedback_positive: 0,
        shared_result: 0
      },
      equipped: {},
      customAssets: {},
      inventory: [],
      color: "#3A5DA8"
    };
  }
  function withTodayCounters(meta, nowTs) {
    const today = isoDay(nowTs);
    if (meta.lastActiveDate === today)
      return meta;
    return {
      ...meta,
      todayCounters: {
        agent_message_sent: 0,
        task_completed: 0,
        tool_used: 0,
        streak_day: 0,
        user_feedback_positive: 0,
        shared_result: 0
      }
    };
  }
  function applyUnlocks(meta) {
    const unlocked = COSMETICS.filter((item) => item.unlockLevel <= meta.level).map((item) => item.id);
    const mergedInventory = Array.from(new Set([...meta.inventory, ...unlocked]));
    const next = { ...meta, inventory: mergedInventory };
    const bySlot = {
      head: [],
      face: [],
      back: [],
      aura: [],
      badge: []
    };
    for (const c of COSMETICS)
      bySlot[c.slot].push(c);
    const equipped = { ...next.equipped };
    Object.keys(bySlot).forEach((slot) => {
      if (equipped[slot])
        return;
      const best = bySlot[slot].filter((item) => mergedInventory.includes(item.id)).sort((a, b) => b.unlockLevel - a.unlockLevel)[0];
      if (best)
        equipped[slot] = best.id;
    });
    return { ...next, equipped };
  }
  function applyEvent(meta, eventType, nowTs = Date.now()) {
    const updated = withTodayCounters(meta, nowTs);
    const count = updated.todayCounters[eventType] ?? 0;
    const cap = DAILY_CAPS[eventType] ?? 0;
    let gainedXp = 0;
    if (count < cap) {
      const streakMultiplier = 1 + Math.min(updated.streakDays, 20) * 0.05;
      const value = BASE_XP[eventType] ?? 0;
      gainedXp = Math.round(value * streakMultiplier);
    }
    const today = isoDay(nowTs);
    let streakDays = updated.streakDays;
    if (eventType === "streak_day" && count < cap) {
      if (!updated.lastActiveDate) {
        streakDays = 1;
      } else {
        const prev = new Date(updated.lastActiveDate + "T00:00:00.000Z").getTime();
        const nowDay = new Date(today + "T00:00:00.000Z").getTime();
        const diff = Math.round((nowDay - prev) / 86400000);
        if (diff === 1)
          streakDays += 1;
        else if (diff > 1)
          streakDays = 1;
      }
    }
    const nextXp = updated.xp + gainedXp;
    const nextLevel = levelFromXp(nextXp);
    const leveledUp = nextLevel > updated.level;
    const next = applyUnlocks({
      ...updated,
      xp: nextXp,
      level: nextLevel,
      streakDays,
      lastActiveDate: today,
      todayCounters: {
        ...updated.todayCounters,
        [eventType]: Math.min(cap, count + 1)
      }
    });
    return { next, gainedXp, leveledUp };
  }
  function getCosmeticById(id) {
    if (!id)
      return;
    return COSMETICS.find((item) => item.id === id);
  }
  var AVATAR_STATE_FACE = {
    idle: "(｡•̀ᴗ-)✧",
    thinking: "( •̀ .̫ •́ )✧",
    focused: "(ง •̀_•́)ง",
    success: "٩(ˊᗜˋ*)و",
    error: "(；′⌒`)",
    sleep: "(－_－) zzZ"
  };

  // mobile/demo/avatar-sim/sim.ts
  var STORAGE_KEY = "albert.companion.meta.sim";
  function loadMeta() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw)
        return getDefaultMeta();
      return { ...getDefaultMeta(), ...JSON.parse(raw) };
    } catch {
      return getDefaultMeta();
    }
  }
  function loadMetaSheetDefault() {
    const m = loadMeta();
    if (m.color === "#3A5DA8" || m.color === "#41A1F7") {
      return { ...m, color: "#4787F7" };
    }
    return m;
  }
  var S = {
    meta: loadMetaSheetDefault(),
    placement: "today",
    thinking: false,
    moodOverride: "auto",
    visual: "butler",
    dayOffset: 0,
    log: [],
    chat: [{ role: "alfred", text: "Afternoon. Two things need you today — want the rundown?" }]
  };
  var nowTs = () => Date.now() + S.dayOffset * 86400000;
  function saveMeta() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(S.meta));
  }
  function mood() {
    if (S.moodOverride !== "auto")
      return S.moodOverride;
    if (S.thinking)
      return "thinking";
    return "idle";
  }
  function pushLog(text, kind) {
    const d = new Date(nowTs());
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    S.log.unshift({ time: `${hh}:${mm}`, text, kind });
    S.log = S.log.slice(0, 40);
  }
  var EVENT_INFO = {
    agent_message_sent: { label: "Ask Alfred replies", desc: "each assistant reply in Ask" },
    task_completed: { label: "Task completed", desc: "mark a priority done on Today" },
    tool_used: { label: "Tool used", desc: "Alfred runs a capability (draft, schedule…)" },
    streak_day: { label: "Daily streak", desc: "first activity of the day" },
    user_feedback_positive: { label: "Positive feedback", desc: "thumbs-up on a briefing/draft" },
    shared_result: { label: "Shared a result", desc: "share-sheet export" }
  };
  var SWATCHES = ["#4787F7", "#0B102D", "#D9F5EC", "#EDE6FF", "#3A5DA8", "#A8513A"];
  var gradSeq = 0;
  function orbSvg(size, color, level, state) {
    const ringCount = level >= 10 ? 3 : level >= 5 ? 2 : 1;
    const outerDash = state === "thinking" ? "4 6" : "";
    const outerOpacity = state === "sleep" ? 0.35 : 0.55;
    const coreR = state === "success" ? 12 : 8;
    const coreOpacity = state === "sleep" ? 0.5 : 1;
    const gid = `g${gradSeq++}`;
    return `
  <svg width="${size}" height="${size}" viewBox="0 0 240 240">
    <defs>
      <radialGradient id="${gid}" cx="120" cy="126" r="92" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="${color}" stop-opacity="0.35"/>
        <stop offset="1" stop-color="${color}" stop-opacity="0.08"/>
      </radialGradient>
    </defs>
    <circle cx="120" cy="120" r="82" fill="url(#${gid})"/>
    <circle cx="120" cy="120" r="74" stroke="${color}" stroke-width="3"
      ${outerDash ? `stroke-dasharray="${outerDash}"` : ""} stroke-opacity="${outerOpacity}" fill="none"/>
    ${ringCount >= 2 ? `<circle cx="120" cy="120" r="64" stroke="${color}" stroke-width="2.5" stroke-opacity="0.65" fill="none"/>` : ""}
    ${ringCount >= 3 ? `<circle cx="120" cy="120" r="54" stroke="${color}" stroke-width="2" stroke-opacity="0.85" fill="none"/>` : ""}
    <circle cx="120" cy="120" r="${coreR}" fill="${color}" opacity="${coreOpacity}"/>
  </svg>`;
  }
  var SHEET = {
    sky: "#4787F7",
    navy: "#0B102D",
    gray: "#E2EBF0",
    white: "#F1F5FF",
    cape: "#93A5DB",
    capeShade: "#7487C2"
  };
  function glossyEye(cx, cy, r, gid) {
    return `
    <ellipse cx="${cx}" cy="${cy}" rx="${r + 7}" ry="${r + 7}" fill="${SHEET.sky}" opacity="0.25"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#eye-${gid})"/>
    <circle cx="${cx - r * 0.32}" cy="${cy - r * 0.35}" r="${r * 0.26}" fill="#FFFFFF" opacity="0.75"/>`;
  }
  function butlerEyes(state, gid) {
    const arc = "#BFE0FF";
    switch (state) {
      case "focused":
        return `
        <path d="M82 100 a13 13 0 0 0 26 0 z" fill="url(#eye-${gid})"/>
        <path d="M132 100 a13 13 0 0 0 26 0 z" fill="url(#eye-${gid})"/>
        <line x1="80" y1="100" x2="110" y2="100" stroke="${SHEET.navy}" stroke-width="3"/>
        <line x1="130" y1="100" x2="160" y2="100" stroke="${SHEET.navy}" stroke-width="3"/>`;
      case "thinking":
        return `${glossyEye(101, 96, 11, gid)}${glossyEye(149, 96, 11, gid)}`;
      case "success":
        return `
        <path d="M82 109 Q95 94 108 109" stroke="${arc}" stroke-width="7.5" fill="none" stroke-linecap="round"/>
        <path d="M132 109 Q145 94 158 109" stroke="${arc}" stroke-width="7.5" fill="none" stroke-linecap="round"/>`;
      case "error":
        return `
        <path d="M82 99 Q95 111 108 99" stroke="${arc}" stroke-width="6.5" fill="none" stroke-linecap="round"/>
        <path d="M132 99 Q145 111 158 99" stroke="${arc}" stroke-width="6.5" fill="none" stroke-linecap="round"/>`;
      case "sleep":
        return `
        <path d="M83 104 Q95 112 107 104" stroke="#5E7CB8" stroke-width="5.5" fill="none" stroke-linecap="round"/>
        <path d="M133 104 Q145 112 157 104" stroke="#5E7CB8" stroke-width="5.5" fill="none" stroke-linecap="round"/>`;
      default:
        return `
        <g class="eye-blink">${glossyEye(95, 103, 13, gid)}</g>
        <g class="eye-blink">${glossyEye(145, 103, 13, gid)}</g>`;
    }
  }
  function butlerSvg(size, color, level, state) {
    const gid = `b${gradSeq++}`;
    const dim = state === "sleep" ? 0.85 : 1;
    const halos = (level >= 5 ? `<ellipse cx="120" cy="208" rx="78" ry="13" stroke="${color}" stroke-opacity="0.32" stroke-width="2.5" fill="none"/>` : "") + (level >= 10 ? `<ellipse cx="120" cy="208" rx="94" ry="18" stroke="${color}" stroke-opacity="0.45" stroke-width="2" fill="none"/>
         <circle cx="36" cy="64" r="3" fill="${color}" opacity="0.7"/>
         <circle cx="208" cy="88" r="2.6" fill="${color}" opacity="0.7"/>
         <circle cx="198" cy="40" r="2" fill="${color}" opacity="0.55"/>` : "");
    const thinkingBits = state === "thinking" ? `<path d="M168 34 L160 16" stroke="${color}" stroke-width="4" stroke-linecap="round"/>
         <path d="M182 38 L182 20" stroke="${color}" stroke-width="4" stroke-linecap="round"/>
         <path d="M195 46 L204 30" stroke="${color}" stroke-width="4" stroke-linecap="round"/>
         <circle cx="120" cy="130" r="114" stroke="${color}" stroke-width="2" stroke-dasharray="3 9" stroke-opacity="0.3" fill="none"/>` : "";
    const approvedCheck = state === "success" ? `<circle cx="192" cy="52" r="15" fill="#34B87C"/>
         <path d="M185 52 L190 58 L200 45" stroke="#FFFFFF" stroke-width="3.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>` : "";
    const sweat = state === "error" ? `<path d="M176 76 q7 12 0 17 q-7 -5 0 -17" fill="#BFE6FF" opacity="0.9"/>` : "";
    const zzz = state === "sleep" ? `<text x="184" y="44" font-size="17" fill="${color}" opacity="0.65" font-family="Georgia,serif" font-style="italic">z z Z</text>` : "";
    return `
  <svg width="${size}" height="${Math.round(size * 1.07)}" viewBox="0 0 240 256">
    <defs>
      <radialGradient id="eye-${gid}" cx="0.38" cy="0.32" r="0.85">
        <stop offset="0" stop-color="#D9F2FF"/>
        <stop offset="0.55" stop-color="#8CC0FB"/>
        <stop offset="1" stop-color="${SHEET.sky}"/>
      </radialGradient>
    </defs>
    <ellipse cx="120" cy="246" rx="44" ry="8" fill="#19171A" opacity="0.10"/>
    <g class="${state === "thinking" ? "hover-fast" : "hover"}" opacity="${dim}">
      <!-- flowing cape: light, dynamic, airy (soft blue-violet, draped points) -->
      <path class="cape" d="M88 150
        Q46 178 58 222 Q70 214 80 220 Q90 212 100 218 L100 158 Z" fill="${SHEET.cape}"/>
      <path class="cape" d="M152 150
        Q194 178 182 222 Q170 214 160 220 Q150 212 140 218 L140 158 Z" fill="${SHEET.cape}"/>
      <path class="cape" d="M92 152 Q70 180 76 212 L92 200 Z" fill="${SHEET.capeShade}" opacity="0.45"/>
      <path class="cape" d="M148 152 Q170 180 164 212 L148 200 Z" fill="${SHEET.capeShade}" opacity="0.45"/>
      ${halos}
      <!-- feet -->
      <ellipse cx="105" cy="216" rx="11" ry="8" fill="${SHEET.white}" stroke="${SHEET.gray}"/>
      <ellipse cx="135" cy="216" rx="11" ry="8" fill="${SHEET.white}" stroke="${SHEET.gray}"/>
      <!-- tuxedo torso: navy jacket, white shirt panel, buttons -->
      <rect x="80" y="144" width="80" height="70" rx="26" fill="${SHEET.navy}"/>
      <path d="M104 144 L136 144 L133 200 Q120 207 107 200 Z" fill="#FFFFFF"/>
      <path d="M104 144 L120 162 L111 170 L101 150 Z" fill="${SHEET.navy}" opacity="0.92"/>
      <path d="M136 144 L120 162 L129 170 L139 150 Z" fill="${SHEET.navy}" opacity="0.92"/>
      <circle cx="120" cy="176" r="2.6" fill="${SHEET.navy}"/>
      <circle cx="120" cy="190" r="2.6" fill="${SHEET.navy}"/>
      <!-- arms: small white mitts -->
      <ellipse cx="73" cy="176" rx="11" ry="15" fill="${SHEET.white}" stroke="${SHEET.gray}"/>
      <ellipse cx="167" cy="176" rx="11" ry="15" fill="${SHEET.white}" stroke="${SHEET.gray}"/>
      <!-- smooth ears: short, wide, rounded for a softer feel -->
      <path d="M58 70 Q50 14 96 34 Q106 42 100 62 Z" fill="${SHEET.white}" stroke="${SHEET.gray}" stroke-width="1.5"/>
      <path d="M182 70 Q190 14 144 34 Q134 42 140 62 Z" fill="${SHEET.white}" stroke="${SHEET.gray}" stroke-width="1.5"/>
      <!-- head: big soft blob, warm white -->
      <rect x="44" y="44" width="152" height="118" rx="56" fill="${SHEET.white}" stroke="${SHEET.gray}" stroke-width="1.5"/>
      <path d="M58 142 Q120 168 182 142 L182 150 Q120 174 58 150 Z" fill="${SHEET.gray}" opacity="0.45"/>
      <!-- glowing eye-mask: wide goggle blob, deep navy -->
      <path d="M64 104
        Q64 74 96 72 L144 72 Q176 74 176 104
        Q176 132 142 134 L98 134 Q64 132 64 104 Z" fill="${SHEET.navy}"/>
      <ellipse cx="96" cy="83" rx="26" ry="9" fill="#FFFFFF" opacity="0.10"/>
      ${butlerEyes(state, gid)}
      <!-- signature bow tie: bright accent — drawn over the chin like the sheet -->
      <path d="M99 148 Q94 159 99 170 L117 162 Q119 159 117 156 Z" fill="${color}"/>
      <path d="M141 148 Q146 159 141 170 L123 162 Q121 159 123 156 Z" fill="${color}"/>
      <rect x="113" y="152" width="14" height="14" rx="5" fill="${color}"/>
      <rect x="113" y="152" width="14" height="6" rx="3" fill="#FFFFFF" opacity="0.25"/>
      ${thinkingBits}
      ${approvedCheck}
      ${sweat}
      ${zzz}
    </g>
  </svg>`;
  }
  function homeSvg(size, color, occupied, state) {
    const gid = `h${gradSeq++}`;
    const peekEyes = state === "success" ? `<path d="M50 64 Q54.5 59.5 59 64" stroke="#BFE0FF" stroke-width="2.6" fill="none" stroke-linecap="round"/>
         <path d="M61 64 Q65.5 59.5 70 64" stroke="#BFE0FF" stroke-width="2.6" fill="none" stroke-linecap="round"/>` : state === "sleep" ? `<path d="M50 63 Q54.5 66 59 63" stroke="#5E7CB8" stroke-width="2.4" fill="none" stroke-linecap="round"/>
           <path d="M61 63 Q65.5 66 70 63" stroke="#5E7CB8" stroke-width="2.4" fill="none" stroke-linecap="round"/>` : `<circle cx="54.5" cy="63" r="4.6" fill="url(#heye-${gid})"/>
           <circle cx="65.5" cy="63" r="4.6" fill="url(#heye-${gid})"/>
           <circle cx="53" cy="61.5" r="1.3" fill="#FFFFFF" opacity="0.8"/>
           <circle cx="64" cy="61.5" r="1.3" fill="#FFFFFF" opacity="0.8"/>`;
    const door = occupied ? `<!-- butler at home, peeking out -->
       <path d="M40 86 L40 64 Q60 44 80 64 L80 86 Z" fill="${SHEET.navy}"/>
       <path d="M46 40 Q43 26 55 31 Q58 34 56 40 Z" fill="${SHEET.white}" stroke="${SHEET.gray}"/>
       <path d="M74 40 Q77 26 65 31 Q62 34 64 40 Z" fill="${SHEET.white}" stroke="${SHEET.gray}"/>
       <ellipse cx="60" cy="66" rx="19" ry="17" fill="${SHEET.white}" stroke="${SHEET.gray}"/>
       <path d="M44 62 Q44 52 60 52 Q76 52 76 62 Q76 72 60 72 Q44 72 44 62 Z" fill="${SHEET.navy}"/>
       ${peekEyes}
       <path d="M53 80 L60 84 L67 80 L64 77 L56 77 Z" fill="${color}"/>` : `<!-- away working: the light's left on -->
       <path d="M40 86 L40 64 Q60 44 80 64 L80 86 Z" fill="${SHEET.navy}"/>
       <ellipse cx="60" cy="72" rx="14" ry="12" fill="url(#hglow-${gid})"/>
       <circle cx="55" cy="62" r="1.6" fill="${color}" opacity="0.8"/>
       <circle cx="64" cy="56" r="1.2" fill="${color}" opacity="0.6"/>
       <circle cx="61" cy="66" r="1" fill="#FFFFFF" opacity="0.7"/>`;
    return `
  <svg width="${size}" height="${size}" viewBox="0 0 120 104">
    <defs>
      <radialGradient id="hglow-${gid}" cx="0.5" cy="0.6" r="0.8">
        <stop offset="0" stop-color="${color}" stop-opacity="0.55"/>
        <stop offset="1" stop-color="${color}" stop-opacity="0.05"/>
      </radialGradient>
      <radialGradient id="heye-${gid}" cx="0.38" cy="0.32" r="0.85">
        <stop offset="0" stop-color="#D9F2FF"/>
        <stop offset="0.55" stop-color="#8CC0FB"/>
        <stop offset="1" stop-color="${SHEET.sky}"/>
      </radialGradient>
    </defs>
    <ellipse cx="60" cy="99" rx="30" ry="4.5" fill="#19171A" opacity="0.10"/>
    <g class="hover-slow">
      <!-- pennant flag: accent, echoes the bow tie -->
      <line x1="90" y1="34" x2="90" y2="12" stroke="${SHEET.gray}" stroke-width="2.5" stroke-linecap="round"/>
      <path d="M90 12 L106 17 L90 22 Z" fill="${color}"/>
      <!-- cloud cottage body -->
      <circle cx="36" cy="62" r="22" fill="${SHEET.white}" stroke="${SHEET.gray}" stroke-width="1.5"/>
      <circle cx="86" cy="60" r="24" fill="${SHEET.white}" stroke="${SHEET.gray}" stroke-width="1.5"/>
      <circle cx="60" cy="44" r="26" fill="${SHEET.white}" stroke="${SHEET.gray}" stroke-width="1.5"/>
      <rect x="20" y="56" width="80" height="30" rx="15" fill="${SHEET.white}"/>
      <!-- portholes -->
      <circle cx="30" cy="66" r="5" fill="${SHEET.navy}"/>
      <circle cx="30" cy="66" r="2" fill="${color}" opacity="0.85"/>
      <circle cx="92" cy="66" r="5" fill="${SHEET.navy}"/>
      <circle cx="92" cy="66" r="2" fill="${color}" opacity="0.85"/>
      ${door}
      <!-- cloud base line -->
      <path d="M22 86 Q60 92 98 86" stroke="${SHEET.gray}" stroke-width="1.5" fill="none"/>
    </g>
  </svg>`;
  }
  function orbHtml(size, opts = {}) {
    const st = mood();
    const fx = getLevelFx(S.meta.level);
    const scaled = Math.round(size * fx.scale);
    const glow = `filter: drop-shadow(0 4px ${Math.round(fx.glowBlur * 0.35)}px ${hexA(S.meta.color, fx.glowAlpha)});`;
    if (S.visual === "butler") {
      return `
    <div class="orb-wrap">
      ${opts.speech ? `<div class="bubble">${opts.speech}<div class="bubble-tail"></div></div>` : ""}
      <div style="${glow}">${butlerSvg(scaled, S.meta.color, S.meta.level, st)}</div>
    </div>`;
    }
    const breathing = st === "thinking" ? "breathe-fast" : "breathe";
    return `
  <div class="orb-wrap">
    ${opts.speech ? `<div class="bubble">${opts.speech}<div class="bubble-tail"></div></div>` : ""}
    <div class="${breathing}" style="${glow}">${orbSvg(scaled, S.meta.color, S.meta.level, st)}</div>
    ${!opts.compact ? `<div class="face">${AVATAR_STATE_FACE[st]}</div>` : ""}
  </div>`;
  }
  function hexA(hex, alpha) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${alpha})`;
  }
  function fireEvent(type) {
    const before = S.meta;
    const { next, gainedXp, leveledUp } = applyEvent(S.meta, type, nowTs());
    S.meta = next;
    saveMeta();
    if (gainedXp > 0) {
      pushLog(`+${gainedXp} XP — ${EVENT_INFO[type].label}`, "xp");
      floatXp(`+${gainedXp} XP`);
    } else {
      pushLog(`0 XP — daily cap reached for "${EVENT_INFO[type].label}"`, "info");
    }
    if (leveledUp) {
      pushLog(`LEVEL UP → ${next.level} (${getFormByLevel(next.level).name})`, "level");
      toast(`Level ${next.level} — ${getFormByLevel(next.level).name}`);
      for (const id of next.inventory) {
        if (!before.inventory.includes(id)) {
          const c = getCosmeticById(id);
          if (c)
            pushLog(`Unlocked ${c.icon} ${c.name} (${c.slot})`, "unlock");
        }
      }
    }
    render();
  }
  function askSend(text) {
    if (S.thinking)
      return;
    S.chat.push({ role: "user", text });
    S.thinking = true;
    render();
    setTimeout(() => {
      S.chat.push({ role: "alfred", text: "Done — drafted it and put it in your approval queue." });
      S.thinking = false;
      fireEvent("agent_message_sent");
    }, 1800);
  }
  function nextDay() {
    S.dayOffset += 1;
    pushLog(`— a new day dawns (virtual day +${S.dayOffset}) — caps reset`, "info");
    fireEvent("streak_day");
  }
  function setColor(c) {
    S.meta = { ...S.meta, color: c };
    saveMeta();
    pushLog(`Tint changed to ${c} — context + storage updated together`, "info");
    render();
  }
  function devGrantXp(amount) {
    const xp = S.meta.xp + amount;
    const level = levelFromXp(xp);
    const leveled = level > S.meta.level;
    S.meta = applyUnlocks({ ...S.meta, xp, level });
    saveMeta();
    pushLog(`DEV: +${amount} XP shortcut → level ${level}`, "info");
    if (leveled)
      toast(`Level ${level} — ${getFormByLevel(level).name}`);
    render();
  }
  function resetAll() {
    localStorage.removeItem(STORAGE_KEY);
    S.meta = { ...getDefaultMeta(), color: "#4787F7" };
    S.dayOffset = 0;
    S.log = [];
    S.chat = [{ role: "alfred", text: "Afternoon. Two things need you today — want the rundown?" }];
    pushLog("Reset to first launch (getDefaultMeta)", "info");
    render();
  }
  function toast(text) {
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2600);
  }
  function floatXp(text) {
    const host = document.querySelector(".phone");
    if (!host)
      return;
    const el = document.createElement("div");
    el.className = "float-xp";
    el.textContent = text;
    host.appendChild(el);
    setTimeout(() => el.remove(), 1400);
  }
  function phoneScreen() {
    const p = S.placement;
    if (p === "today") {
      return `
    <div class="screen">
      <div class="screen-head">
        <div>
          <div class="eyebrow">THURSDAY, JUNE 11</div>
          <div class="greet">Good evening, <em>Rae</em></div>
        </div>
        <div class="avatar-today">${orbHtml(56, { speech: "Hi!" })}</div>
      </div>
      <div class="card"><div class="card-warn">TODAY</div><b>Reply to Sarah re: Q3 contract</b><div class="muted">She asked for the redline by EOD.</div>
        <div class="row-btns"><button data-act="task">Mark done (+XP)</button><button data-act="tool">Let Alfred draft it (+XP)</button></div></div>
      <div class="card"><div class="card-soon">SOON</div><b>Book dentist appointment</b><div class="muted">From your capture on Tuesday.</div></div>
    </div>`;
    }
    if (p === "ask") {
      return `
    <div class="screen">
      <div class="chat">
        ${S.chat.map((m) => `<div class="msg ${m.role}">${m.text}</div>`).join("")}
        ${S.thinking ? `<div class="msg alfred thinking-dots">thinking…</div>` : ""}
      </div>
      <div class="avatar-ask">${orbHtml(48, { compact: true })}</div>
      <div class="composer">
        <input id="ask-input" placeholder="Ask Alfred…" />
        <button id="ask-send">Send</button>
      </div>
    </div>`;
    }
    return `
  <div class="screen">
    <div class="placeholder-screen">
      <div class="eyebrow">${p === "inbox" ? "INBOX" : "YOU"}</div>
      <div class="muted" style="margin-top:8px">On ${p === "inbox" ? "Inbox" : "You"}, the butler goes home —
      look at the cloud cottage in the tab bar below: he's peeking out of the doorway.
      On Today/Ask he's out working and the doorway light stays on. Tapping the home
      still opens Capture.</div>
    </div>
  </div>`;
  }
  function tabBar() {
    const atHome = S.placement === "inbox" || S.placement === "settings";
    const tab = (key, label) => `<button class="tab ${S.placement === key ? "on" : ""}" data-tab="${key}">${label}</button>`;
    return `
  <div class="tabbar">
    ${tab("today", "Today")}
    ${tab("inbox", "Inbox")}
    <div class="capture homey" title="Capture">${homeSvg(54, S.meta.color, atHome, mood())}</div>
    ${tab("ask", "Ask")}
    ${tab("settings", "You")}
  </div>`;
  }
  function previewPanel() {
    return `
  <div class="panel">
    <h3>Design preview — "Light Airy Butler" <span class="muted">(vectorized from your sheet)</span></h3>
    <div class="preview-stage">${orbHtml(190, { compact: true })}</div>
    <div class="muted" style="text-align:center">mood: <b>${mood()}</b> · level ${S.meta.level} · ${getFormByLevel(S.meta.level).name}</div>
    <h3 style="margin-top:16px">The cloud home <span class="muted">(center tab slot — replaces the + glyph)</span></h3>
    <div class="home-row">
      <div class="home-cell">${homeSvg(120, S.meta.color, false, mood())}<div class="muted">away working — light on</div></div>
      <div class="home-cell">${homeSvg(120, S.meta.color, true, mood())}<div class="muted">home (Inbox / You) — peeking out</div></div>
    </div>
  </div>`;
  }
  function statsPanel() {
    const m = S.meta;
    const floor = currentLevelXp(m.level);
    const ceil = nextLevelXp(m.level);
    const pct = Math.min(100, Math.round((m.xp - floor) / Math.max(1, ceil - floor) * 100));
    const form = getFormByLevel(m.level);
    const fx = getLevelFx(m.level);
    const rings = m.level >= 10 ? 3 : m.level >= 5 ? 2 : 1;
    return `
  <div class="panel">
    <h3>Growth</h3>
    <div class="stat-row"><span>Level</span><b>${m.level} — ${form.name}</b></div>
    <div class="xpbar"><div class="xpfill" style="width:${pct}%"></div></div>
    <div class="stat-row muted"><span>${m.xp} XP</span><span>next level at ${ceil} XP</span></div>
    <div class="stat-row"><span>Streak</span><b>${m.streakDays} day${m.streakDays === 1 ? "" : "s"} ${m.streakDays > 0 ? `(+${Math.round(Math.min(m.streakDays, 20) * 5)}% XP)` : ""}</b></div>
    <div class="stat-row"><span>Visual</span><b>${rings} ring${rings > 1 ? "s" : ""}, ${Math.round(fx.scale * 100)}% scale, glow ${fx.glowAlpha}</b></div>
    <div class="stat-row"><span>Virtual day</span><b>+${S.dayOffset} <button class="mini" id="next-day">advance day →</button></b></div>
  </div>`;
  }
  function eventsPanel() {
    const m = S.meta;
    const rows = Object.keys(EVENT_INFO).map((t) => {
      const used = m.todayCounters[t] ?? 0;
      return `
      <div class="ev-row">
        <button class="ev" data-ev="${t}">${EVENT_INFO[t].label}</button>
        <span class="muted ev-desc">${EVENT_INFO[t].desc}</span>
        <span class="cap">${used} today</span>
      </div>`;
    }).join("");
    return `
  <div class="panel">
    <h3>XP events <span class="muted">(real applyEvent — daily caps live)</span></h3>
    ${rows}
    <div class="row-btns" style="margin-top:10px">
      <button class="mini" id="dev-xp">DEV: +250 XP (jump levels)</button>
      <button class="mini" id="reset">Reset to first launch</button>
    </div>
  </div>`;
  }
  function moodPanel() {
    const states = ["auto", "idle", "thinking", "focused", "success", "error", "sleep"];
    return `
  <div class="panel">
    <h3>Mood <span class="muted">(auto = derived like the app: thinking while Ask waits)</span></h3>
    <div class="chips">${states.map((s) => `<button class="chip ${S.moodOverride === s ? "on" : ""}" data-mood="${s}">${s}</button>`).join("")}</div>
    <h3 style="margin-top:14px">Tint <span class="muted">(provider setColor — the stale-UI bug fix)</span></h3>
    <div class="chips">${SWATCHES.map((c) => `<button class="swatch ${S.meta.color === c ? "on" : ""}" data-color="${c}" style="background:${c}"></button>`).join("")}</div>
    <h3 style="margin-top:14px">Visual <span class="muted">(swap is one component — screens don't change)</span></h3>
    <div class="chips">
      <button class="chip ${S.visual === "butler" ? "on" : ""}" data-visual="butler">Light Airy Butler</button>
      <button class="chip ${S.visual === "orb" ? "on" : ""}" data-visual="orb">Cloud orb (old placeholder)</button>
    </div>
  </div>`;
  }
  function cosmeticsPanel() {
    const m = S.meta;
    const items = COSMETICS.map((c) => {
      const owned = m.inventory.includes(c.id);
      const equipped = m.equipped[c.slot] === c.id;
      return `
    <div class="cosmetic ${owned ? "" : "locked"}">
      <div class="c-icon">${c.icon}</div>
      <div class="c-name">${c.name}</div>
      <div class="c-sub">${c.slot} · lv${c.unlockLevel}</div>
      <div class="c-state">${equipped ? "equipped" : owned ? "owned" : "locked"}</div>
    </div>`;
    }).join("");
    return `
  <div class="panel">
    <h3>Cosmetics <span class="muted">(auto-unlock + auto-equip on level-up — rendering on the orb ships with the Lottie pack)</span></h3>
    <div class="cosmetics">${items}</div>
  </div>`;
  }
  function logPanel() {
    return `
  <div class="panel">
    <h3>Event log</h3>
    <div class="log">${S.log.length ? S.log.map((l) => `<div class="log-row ${l.kind}"><span class="muted">${l.time}</span> ${l.text}</div>`).join("") : `<div class="muted">Interact with the phone or fire XP events…</div>`}</div>
  </div>`;
  }
  function render() {
    gradSeq = 0;
    const root = document.getElementById("root");
    root.innerHTML = `
  <header>
    <h1>Alfred companion avatar — live simulation</h1>
    <p class="muted">Running the branch's real <code>agentMeta.ts</code> + <code>avatarEvolution.ts</code>.
    The phone mock mirrors the three placements; everything persists to localStorage like SecureStore.</p>
  </header>
  <div class="cols">
    <div class="phone-col">
      <div class="phone">
        ${phoneScreen()}
        ${tabBar()}
      </div>
    </div>
    <div class="panels">
      ${previewPanel()}
      ${statsPanel()}
      ${eventsPanel()}
      ${moodPanel()}
      ${cosmeticsPanel()}
      ${logPanel()}
    </div>
  </div>`;
    root.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => {
      S.placement = b.dataset.tab;
      render();
    }));
    root.querySelectorAll("[data-ev]").forEach((b) => b.addEventListener("click", () => fireEvent(b.dataset.ev)));
    root.querySelectorAll("[data-mood]").forEach((b) => b.addEventListener("click", () => {
      S.moodOverride = b.dataset.mood;
      render();
    }));
    root.querySelectorAll("[data-color]").forEach((b) => b.addEventListener("click", () => setColor(b.dataset.color)));
    root.querySelectorAll("[data-visual]").forEach((b) => b.addEventListener("click", () => {
      S.visual = b.dataset.visual;
      render();
    }));
    root.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", () => fireEvent(b.dataset.act === "task" ? "task_completed" : "tool_used")));
    document.getElementById("next-day")?.addEventListener("click", nextDay);
    document.getElementById("dev-xp")?.addEventListener("click", () => devGrantXp(250));
    document.getElementById("reset")?.addEventListener("click", resetAll);
    document.getElementById("ask-send")?.addEventListener("click", () => {
      const input = document.getElementById("ask-input");
      const v = input.value.trim() || "Move my 3pm and tell Sam I'll be late";
      askSend(v);
    });
    document.getElementById("ask-input")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter")
        document.getElementById("ask-send").click();
    });
  }
  render();
})();
