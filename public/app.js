// Establish Socket.IO Connection
const socket = io();

// Global Front-end State
let currentTab = 'board';
let logsHistory = [];
let localCustomKeywords = [];
let botStateSummary = {};

// Cache DOM Elements
const statusBadge = document.getElementById("status-badge");
const statusDot = document.getElementById("status-dot");
const statusText = document.getElementById("status-text");
const quickPowerBtn = document.getElementById("quick-power-btn");

const playerUsername = document.getElementById("player-username");
const playerCoins = document.getElementById("player-coins");
const playerPoints = document.getElementById("player-points");
const playerEnergy = document.getElementById("player-energy");
const playerDiamonds = document.getElementById("player-diamonds");

const activeRoundNum = document.getElementById("active-round-num");
const gameTimerContainer = document.getElementById("game-timer-container");
const gameTimer = document.getElementById("game-timer");
const opponentBar = document.getElementById("opponent-bar");
const opponentUsername = document.getElementById("opponent-username");
const opponentPointsBadge = document.getElementById("opponent-points-badge");
const opponentPoints = document.getElementById("opponent-points");

const activeCategoryText = document.getElementById("active-category-text");
const turnNotice = document.getElementById("turn-notice");
const myTurnBadge = document.getElementById("my-turn-badge");
const manualAnswerInput = document.getElementById("manual-answer-input");

const usedAnswersContainer = document.getElementById("used-answers-container");

const statTotal = document.getElementById("stat-total");
const statWins = document.getElementById("stat-wins");
const statLosses = document.getElementById("stat-losses");
const statRate = document.getElementById("stat-rate");

const terminalWindow = document.getElementById("terminal-window");
const autoScrollToggle = document.getElementById("auto-scroll-toggle");
const btnClearLogs = document.getElementById("btn-clear-logs");
const logFilterSystem = document.getElementById("log-filter-system");
const logFilterLevel = document.getElementById("log-filter-level");
const logSearch = document.getElementById("log-search");

// --- Socket Event Listeners ---
socket.on("connect", () => {
    showNotification("success", "Connected to control server.");
});

socket.on("disconnect", () => {
    showNotification("error", "Lost connection to control server.");
    updateStatusBadge("offline");
});

socket.on("state-update", (summary) => {
    botStateSummary = summary;
    renderStateSummary(summary);
});

socket.on("timer-update", (remainingSeconds) => {
    updateCountdown(remainingSeconds);
});

socket.on("log", (logEntry) => {
    logsHistory.push(logEntry);
    if (logsHistory.length > 500) {
        logsHistory.shift();
    }
    appendLogToTerminal(logEntry);
});

socket.on("logs-history", (history) => {
    logsHistory = history;
    renderLogsHistory();
});

socket.on("notification", (notif) => {
    showNotification(notif.type, notif.message);
});

socket.on("gemini-test-result", (result) => {
    const msgEl = document.getElementById("gemini-test-msg");
    msgEl.classList.remove("hidden");
    if (result.success) {
        msgEl.className = "text-[10px] mt-1 text-emerald-400 font-medium";
        msgEl.innerHTML = `<i class="fa-solid fa-circle-check mr-1"></i> ${result.message}`;
    } else {
        msgEl.className = "text-[10px] mt-1 text-red-400 font-medium";
        msgEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation mr-1"></i> ${result.message}`;
    }
});

// --- Tab Switching Logic (iOS Mobile Friendly) ---
function switchTab(tab) {
    currentTab = tab;
    
    const panelBoard = document.getElementById("tab-panel-board");
    const panelTerminal = document.getElementById("tab-panel-terminal");
    const panelSettings = document.getElementById("tab-panel-settings");

    const btnBoard = document.getElementById("tab-btn-board");
    const btnTerminal = document.getElementById("tab-btn-terminal");
    const btnSettings = document.getElementById("tab-btn-settings");

    // Clear active mobile tab classes
    [btnBoard, btnTerminal, btnSettings].forEach(btn => {
        btn.className = "flex-1 flex flex-col items-center justify-center py-2 text-gray-400 font-medium rounded-lg transition";
    });

    // Default desktop classes
    panelBoard.className = "md:col-span-7 flex flex-col space-y-4";
    panelTerminal.className = "md:col-span-5 flex flex-col space-y-4";
    panelSettings.className = "md:col-span-12 flex flex-col space-y-4";

    // Set mobile display filters
    if (tab === 'board') {
        panelBoard.classList.remove("hidden");
        panelTerminal.classList.add("hidden", "md:flex"); // show on desktop only
        panelSettings.classList.add("hidden");
        btnBoard.className = "flex-1 flex flex-col items-center justify-center py-2 text-indigo-400 font-semibold bg-gray-800 rounded-lg transition";
    } else if (tab === 'terminal') {
        panelBoard.classList.add("hidden");
        panelTerminal.classList.remove("hidden", "md:flex");
        panelTerminal.classList.add("flex"); // show fully on mobile
        panelSettings.classList.add("hidden");
        btnTerminal.className = "flex-1 flex flex-col items-center justify-center py-2 text-indigo-400 font-semibold bg-gray-800 rounded-lg transition";
        setTimeout(scrollTerminalToBottom, 50);
    } else if (tab === 'settings') {
        panelBoard.classList.add("hidden");
        panelTerminal.classList.add("hidden", "md:flex");
        panelSettings.classList.remove("hidden");
        btnSettings.className = "flex-1 flex flex-col items-center justify-center py-2 text-indigo-400 font-semibold bg-gray-800 rounded-lg transition";
        
        // Load configuration inputs when setting panel is activated
        if (botStateSummary.config) {
            populateConfigInputs(botStateSummary.config);
        }
    }
}

// Handle desktop-specific click actions on configuration
// If screens are wide, clicking settings can hide Board+Terminal and show full width configuration settings
// We simulate this by checking if width is desktop size, but keeping index tabs active.

// --- UI Render Helpers ---
function renderStateSummary(summary) {
    // 1. Render Status Banner
    updateStatusBadge(summary.status);

    // 2. Render Account Wallet Info
    playerUsername.innerText = summary.player.username || "Player";
    playerCoins.innerText = Number(summary.player.coins).toLocaleString();
    playerPoints.innerText = Number(summary.player.points).toLocaleString();
    playerEnergy.innerText = Number(summary.player.energy).toLocaleString();
    playerDiamonds.innerText = Number(summary.player.diamonds).toLocaleString();

    // 3. Match Details & Active Session
    activeRoundNum.innerText = summary.roundNumber || 1;
    
    if (summary.status === "playing" && summary.matchId) {
        activeCategoryText.innerText = summary.category || "המתן לקטגוריה...";
        activeCategoryText.classList.add("text-indigo-200");
        activeCategoryText.classList.remove("text-gray-500");
        
        // Hydrate opponent
        if (summary.opponent) {
            opponentUsername.innerText = summary.opponent.username;
            opponentPoints.innerText = summary.opponent.points;
            opponentPointsBadge.classList.remove("hidden");
        } else {
            opponentUsername.innerText = "Authoritative Competitor";
            opponentPointsBadge.classList.add("hidden");
        }
        
        // Show Turn specifics
        if (summary.myTurn) {
            myTurnBadge.classList.remove("hidden");
            activeCategoryText.classList.add("border-emerald-500/50", "bg-emerald-950/15", "shadow-lg", "shadow-emerald-950/20");
            turnNotice.innerHTML = `<span class="text-emerald-400 font-bold animate-pulse"><i class="fa-solid fa-triangle-exclamation mr-1"></i> IT'S YOUR TURN! TYPE AN ANSWER IMMEDIATELY!</span>`;
            // Trigger iOS Vibration if native is supported
            if (navigator.vibrate) {
                navigator.vibrate([100, 50, 100]);
            }
        } else {
            myTurnBadge.classList.add("hidden");
            activeCategoryText.classList.remove("border-emerald-500/50", "bg-emerald-950/15", "shadow-lg", "shadow-emerald-950/20");
            turnNotice.innerHTML = `<span class="text-gray-500"><i class="fa-solid fa-spinner fa-spin mr-1"></i> Opponent thinking or evaluating guess...</span>`;
        }
    } else {
        // Not in active gameplay
        opponentUsername.innerText = "Waiting for Match...";
        opponentPointsBadge.classList.add("hidden");
        gameTimerContainer.classList.add("hidden");
        myTurnBadge.classList.add("hidden");
        activeCategoryText.classList.remove("border-emerald-500/50", "bg-emerald-950/15");
        
        if (summary.status === "searching") {
            activeCategoryText.innerText = "מחפש יריב...";
            turnNotice.innerHTML = `<span class="text-indigo-400 font-medium animate-pulse"><i class="fa-solid fa-magnifying-glass fa-spin mr-1"></i> Registering ticket in Nakama queue...</span>`;
        } else if (summary.status === "preflight") {
            activeCategoryText.innerText = "מריץ בדיקות...";
            turnNotice.innerHTML = `<span class="text-amber-400 font-medium"><i class="fa-solid fa-circle-nodes fa-spin mr-1"></i> Testing latency and claim pipelines...</span>`;
        } else if (summary.status === "authenticating") {
            activeCategoryText.innerText = "מתחבר...";
            turnNotice.innerHTML = `<span class="text-indigo-400 font-medium"><i class="fa-solid fa-shield-halved fa-spin mr-1"></i> Resolving Device ID with database...</span>`;
        } else if (summary.status === "stopped") {
            activeCategoryText.innerText = "הבוט כבוי";
            turnNotice.innerHTML = `<span class="text-gray-500"><i class="fa-solid fa-power-off mr-1"></i> Press start button to launch match loops</span>`;
        } else {
            activeCategoryText.innerText = "אין משחק פעיל";
            turnNotice.innerHTML = `<span class="text-gray-500">Idle / Ready to join matchmaking queue</span>`;
        }
    }

    // 4. Used Answers List
    usedAnswersContainer.innerHTML = "";
    if (summary.usedAnswers && summary.usedAnswers.length > 0) {
        summary.usedAnswers.forEach(ans => {
            const badge = document.createElement("div");
            badge.className = "bg-gray-800 text-gray-300 border border-gray-700/80 px-2.5 py-1 rounded-xl text-xs font-semibold flex items-center space-x-1 shadow-sm";
            badge.innerHTML = `<span>${ans}</span>`;
            usedAnswersContainer.appendChild(badge);
        });
    } else {
        usedAnswersContainer.innerHTML = `<p class="text-xs text-gray-500 italic">No answers logged in this round.</p>`;
    }

    // 5. Statistics Cards
    statTotal.innerText = summary.stats.totalGames;
    statWins.innerText = summary.stats.wins;
    statLosses.innerText = summary.stats.losses;
    
    const rate = summary.stats.totalGames > 0 
        ? Math.round((summary.stats.wins / summary.stats.totalGames) * 100) 
        : 0;
    statRate.innerText = `${rate}%`;

    // 6. Config defaults populator (Only when inactive settings panel is modified)
    if (summary.config && currentTab !== 'settings') {
        localCustomKeywords = summary.config.customKeywords || [];
        renderCustomKeywords();
    }
}

function updateStatusBadge(status) {
    statusText.innerText = status.toUpperCase();
    
    // Clear dynamic styles
    statusBadge.className = "px-2.5 py-1 rounded-full text-xs font-semibold flex items-center space-x-1.5 ";
    statusDot.className = "w-2 h-2 rounded-full ";
    
    switch (status) {
        case "playing":
            statusBadge.classList.add("bg-emerald-950", "text-emerald-400", "border", "border-emerald-800/40");
            statusDot.classList.add("bg-emerald-500", "animate-ping");
            quickPowerBtn.className = "bg-red-600 hover:bg-red-500 active:bg-red-700 text-white w-9 h-9 rounded-lg flex items-center justify-center transition shadow-md shadow-red-950/20";
            quickPowerBtn.innerHTML = `<i class="fa-solid fa-stop"></i>`;
            quickPowerBtn.onclick = stopBot;
            break;
        case "searching":
            statusBadge.classList.add("bg-indigo-950", "text-indigo-400", "border", "border-indigo-800/40");
            statusDot.classList.add("bg-indigo-500", "animate-pulse");
            quickPowerBtn.className = "bg-red-600 hover:bg-red-500 active:bg-red-700 text-white w-9 h-9 rounded-lg flex items-center justify-center transition shadow-md shadow-red-950/20";
            quickPowerBtn.innerHTML = `<i class="fa-solid fa-stop"></i>`;
            quickPowerBtn.onclick = stopBot;
            break;
        case "authenticating":
        case "preflight":
            statusBadge.classList.add("bg-amber-950", "text-amber-400", "border", "border-amber-800/40");
            statusDot.classList.add("bg-amber-500", "animate-pulse");
            quickPowerBtn.className = "bg-red-600 hover:bg-red-500 active:bg-red-700 text-white w-9 h-9 rounded-lg flex items-center justify-center transition shadow-md shadow-red-950/20";
            quickPowerBtn.innerHTML = `<i class="fa-solid fa-stop"></i>`;
            quickPowerBtn.onclick = stopBot;
            break;
        case "idle":
            statusBadge.classList.add("bg-blue-950", "text-blue-400", "border", "border-blue-800/40");
            statusDot.classList.add("bg-blue-500");
            quickPowerBtn.className = "bg-red-600 hover:bg-red-500 active:bg-red-700 text-white w-9 h-9 rounded-lg flex items-center justify-center transition shadow-md shadow-red-950/20";
            quickPowerBtn.innerHTML = `<i class="fa-solid fa-stop"></i>`;
            quickPowerBtn.onclick = stopBot;
            break;
        case "stopped":
            statusBadge.classList.add("bg-gray-800", "text-gray-400");
            statusDot.classList.add("bg-gray-500");
            quickPowerBtn.className = "bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white w-9 h-9 rounded-lg flex items-center justify-center transition shadow-md shadow-emerald-950/20";
            quickPowerBtn.innerHTML = `<i class="fa-solid fa-play"></i>`;
            quickPowerBtn.onclick = startBot;
            break;
        case "error":
            statusBadge.classList.add("bg-red-950", "text-red-400", "border", "border-red-800/40");
            statusDot.classList.add("bg-red-500");
            quickPowerBtn.className = "bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white w-9 h-9 rounded-lg flex items-center justify-center transition shadow-md";
            quickPowerBtn.innerHTML = `<i class="fa-solid fa-play"></i>`;
            quickPowerBtn.onclick = startBot;
            break;
        default:
            statusBadge.classList.add("bg-gray-800", "text-gray-400");
            statusDot.classList.add("bg-gray-500");
            quickPowerBtn.className = "bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white w-9 h-9 rounded-lg flex items-center justify-center transition";
            quickPowerBtn.innerHTML = `<i class="fa-solid fa-play"></i>`;
            quickPowerBtn.onclick = startBot;
    }
}

function updateCountdown(remainingSeconds) {
    if (remainingSeconds !== undefined && remainingSeconds > 0) {
        gameTimer.innerText = `${remainingSeconds}s`;
        gameTimerContainer.classList.remove("hidden");
    } else {
        gameTimerContainer.classList.add("hidden");
    }
}

// --- Terminal Log Rendering ---
function getSystemStyles(system) {
    switch (system) {
        case "AUTH": return { text: "text-amber-400", icon: "fa-shield-halved" };
        case "PREFLIGHT": return { text: "text-violet-400", icon: "fa-circle-nodes" };
        case "SOCKET": return { text: "text-blue-400", icon: "fa-ethernet" };
        case "MATCH": return { text: "text-pink-400", icon: "fa-gamepad" };
        case "AI": return { text: "text-cyan-400", icon: "fa-brain" };
        case "QUEUE": return { text: "text-indigo-400", icon: "fa-magnifying-glass" };
        case "SYSTEM": return { text: "text-gray-400", icon: "fa-microchip" };
        default: return { text: "text-gray-400", icon: "fa-terminal" };
    }
}

function getLevelColor(level) {
    switch (level) {
        case "success": return "text-emerald-400 font-semibold";
        case "warn": return "text-yellow-500 font-medium";
        case "error": return "text-red-500 font-bold";
        case "tx": return "text-orange-400/80";
        case "rx": return "text-teal-400/80";
        default: return "text-gray-300";
    }
}

function appendLogToTerminal(log) {
    // Apply client-side filters
    const filterSys = logFilterSystem.value;
    const filterLvl = logFilterLevel.value;
    const searchText = logSearch.value.toLowerCase().trim();

    if (filterSys !== "ALL" && log.system !== filterSys) return;
    if (filterLvl !== "ALL" && log.level.toUpperCase() !== filterLvl) return;
    if (searchText && !log.message.toLowerCase().includes(searchText)) return;

    const sysMeta = getSystemStyles(log.system);
    const lvlColor = getLevelColor(log.level);

    const logRow = document.createElement("div");
    logRow.className = "log-entry flex items-start space-x-2 py-1 leading-relaxed border-b border-gray-900/40 text-[11px] font-medium";
    
    // ISO time string extraction
    const logTime = new Date(log.timestamp).toLocaleTimeString();

    logRow.innerHTML = `
        <span class="text-gray-600 select-none">${logTime}</span>
        <span class="inline-flex items-center space-x-1 font-bold ${sysMeta.text} min-w-[85px] select-none">
            <i class="fa-solid ${sysMeta.icon} text-[9px]"></i>
            <span class="tracking-wide text-[9px] uppercase">${log.system}</span>
        </span>
        <span class="text-gray-700 font-bold select-none">&gt;&gt;</span>
        <span class="${lvlColor} flex-1 break-all whitespace-pre-wrap">${log.message}</span>
    `;

    terminalWindow.appendChild(logRow);

    if (autoScrollToggle.checked) {
        scrollTerminalToBottom();
    }
}

function scrollTerminalToBottom() {
    terminalWindow.scrollTop = terminalWindow.scrollHeight;
}

function renderLogsHistory() {
    terminalWindow.innerHTML = "";
    logsHistory.forEach(appendLogToTerminal);
}

// --- Log Filters Event Triggers ---
[logFilterSystem, logFilterLevel, logSearch].forEach(ctrl => {
    ctrl.addEventListener("input", renderLogsHistory);
});

btnClearLogs.addEventListener("click", () => {
    logsHistory = [];
    terminalWindow.innerHTML = `<p class="text-[11px] text-gray-600 italic">Console cleared by user.</p>`;
});

// --- Settings Form Population & Save ---
function populateConfigInputs(cfg) {
    document.getElementById("cfg-host").value = cfg.nakamaHost || "";
    document.getElementById("cfg-server-key").value = cfg.serverKey || "";
    document.getElementById("cfg-port").value = cfg.port || "443";
    document.getElementById("cfg-client-build").value = cfg.clientBuild || "";
    document.getElementById("cfg-room-card").value = cfg.roomCardId || "";
    document.getElementById("cfg-device-id").value = cfg.deviceId || "";
    document.getElementById("cfg-gemini-key").value = cfg.geminiKey || "";
    document.getElementById("cfg-gemini-model").value = cfg.geminiModel || "gemini-3.5-flash";
    document.getElementById("cfg-thinking-level").value = cfg.thinkingLevel || "low";
    document.getElementById("cfg-use-ssl").checked = cfg.useSsl !== false;
    document.getElementById("cfg-auto-start").checked = cfg.autoStart !== false;
    document.getElementById("cfg-wire-debug").checked = !!cfg.wireDebug;
}

function saveConfigForm(e) {
    e.preventDefault();

    const payload = {
        nakamaHost: document.getElementById("cfg-host").value.trim(),
        serverKey: document.getElementById("cfg-server-key").value.trim(),
        port: document.getElementById("cfg-port").value.trim(),
        clientBuild: document.getElementById("cfg-client-build").value.trim(),
        roomCardId: document.getElementById("cfg-room-card").value.trim(),
        deviceId: document.getElementById("cfg-device-id").value.trim(),
        geminiKey: document.getElementById("cfg-gemini-key").value.trim(),
        geminiModel: document.getElementById("cfg-gemini-model").value,
        thinkingLevel: document.getElementById("cfg-thinking-level").value,
        useSsl: document.getElementById("cfg-use-ssl").checked,
        autoStart: document.getElementById("cfg-auto-start").checked,
        wireDebug: document.getElementById("cfg-wire-debug").checked,
        customKeywords: localCustomKeywords
    };

    socket.emit("update-config", payload);
}

function generateDeviceUUID() {
    // Generate standard RFC4122 v4 UUID
    const uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16).toUpperCase();
    });
    document.getElementById("cfg-device-id").value = uuid;
    showNotification("info", "Generated temporary device UUID layout.");
}

function testGeminiConnection() {
    const key = document.getElementById("cfg-gemini-key").value.trim();
    if (!key) {
        showNotification("error", "Provide a Gemini key to test connection.");
        return;
    }
    const msgEl = document.getElementById("gemini-test-msg");
    msgEl.classList.remove("hidden");
    msgEl.className = "text-[10px] mt-1 text-yellow-500 font-medium";
    msgEl.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-1"></i> Invoking post-flight API ping to Gemini endpoint...`;

    socket.emit("test-gemini", key);
}

// --- Custom Overrides Keywords Engine ---
function renderCustomKeywords() {
    const container = document.getElementById("custom-keywords-list");
    container.innerHTML = "";

    if (localCustomKeywords.length === 0) {
        container.innerHTML = `<p class="text-xs text-gray-600 italic">No custom evaluation keywords configured yet.</p>`;
        return;
    }

    localCustomKeywords.forEach((kw, index) => {
        const item = document.createElement("div");
        item.className = "flex items-center justify-between bg-gray-950/60 border border-gray-800 rounded-xl px-3 py-2";
        item.innerHTML = `
            <div class="flex flex-col">
                <span class="text-xs font-semibold text-gray-300">${kw.regex}</span>
                <span class="text-[10px] text-indigo-400 text-right hebrew-font font-medium" dir="rtl">${kw.answer}</span>
            </div>
            <button onclick="removeCustomKeyword(${index})" class="text-red-500 hover:text-red-400 p-1.5 transition">
                <i class="fa-solid fa-trash-can text-xs"></i>
            </button>
        `;
        container.appendChild(item);
    });
}

function addNewCustomKeyword() {
    const rxInput = document.getElementById("kw-regex");
    const ansInput = document.getElementById("kw-answer");

    const regex = rxInput.value.trim();
    const answer = ansInput.value.trim();

    if (!regex || !answer) {
        showNotification("error", "Both rule regex matching term and Hebrew output are required.");
        return;
    }

    localCustomKeywords.push({ regex, answer });
    renderCustomKeywords();
    
    rxInput.value = "";
    ansInput.value = "";

    showNotification("info", "Temporary override keyword appended. Click Save Settings to persist.");
}

function removeCustomKeyword(idx) {
    localCustomKeywords.splice(idx, 1);
    renderCustomKeywords();
    showNotification("info", "Removed matching keyword. Click Save Settings to persist.");
}

// --- Action Commands ---
function startBot() {
    socket.emit("bot-start");
}

// Global action fallback functions (exposes functions for HTML elements)
window.startBot = startBot;

function stopBot() {
    socket.emit("bot-stop");
}

window.stopBot = stopBot;

function triggerRestart() {
    socket.emit("bot-restart");
    showNotification("info", "Reboot trigger requested.");
}

window.triggerRestart = triggerRestart;

function triggerRequeue() {
    socket.emit("force-requeue");
}

window.triggerRequeue = triggerRequeue;

function triggerClaim() {
    const btn = document.getElementById("diagnostics-claim");
    btn.disabled = true;
    socket.emit("claim-rewards");
    setTimeout(() => { btn.disabled = false; }, 3000);
}

window.triggerClaim = triggerClaim;

function submitManualAnswer(e) {
    e.preventDefault();
    const val = manualAnswerInput.value.trim();
    if (!val) return;
    socket.emit("submit-manual-answer", val);
    manualAnswerInput.value = "";
}

window.submitManualAnswer = submitManualAnswer;

// --- Floating Notifications Manager ---
function showNotification(type, message) {
    const container = document.getElementById("notification-container");
    const toast = document.createElement("div");
    
    // Setup color weights
    let bgColor = "bg-gray-900 border-gray-800 text-gray-100";
    let icon = "fa-info-circle text-indigo-400";
    
    if (type === "success") {
        bgColor = "bg-emerald-950/95 border-emerald-800 text-emerald-200";
        icon = "fa-circle-check text-emerald-400";
    } else if (type === "error") {
        bgColor = "bg-red-950/95 border-red-800 text-red-200";
        icon = "fa-circle-exclamation text-red-400";
    } else if (type === "warning") {
        bgColor = "bg-amber-950/95 border-amber-800 text-amber-200";
        icon = "fa-triangle-exclamation text-amber-400";
    }

    toast.className = `flex items-center space-x-3 border px-4 py-3 rounded-xl shadow-2xl pointer-events-auto transition duration-300 ease-in-out transform translate-x-12 opacity-0 ${bgColor}`;
    toast.innerHTML = `
        <i class="fa-solid ${icon} text-base flex-shrink-0"></i>
        <p class="text-xs font-semibold leading-tight flex-1">${message}</p>
    `;

    container.appendChild(toast);
    
    // CSS animations in-flight
    setTimeout(() => {
        toast.classList.remove("translate-x-12", "opacity-0");
    }, 10);

    setTimeout(() => {
        toast.classList.add("translate-x-12", "opacity-0");
        setTimeout(() => {
            toast.remove();
        }, 300);
    }, 4000);
}

window.showNotification = showNotification;

// Initialize layout for active viewports on startup
window.addEventListener("DOMContentLoaded", () => {
    // Detect mobile vs desktop viewports
    if (window.innerWidth >= 768) {
        // Desktop forces side-by-side splits
        switchTab('board');
    } else {
        // Mobile starts on game board tab
        switchTab('board');
    }
});
