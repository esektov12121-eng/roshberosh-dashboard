const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");
const RoshBeRoshBot = require("./bot-runner");

const PORT = process.env.PORT || 3000;
const CONFIG_PATH = path.join(__dirname, "config.json");

// Default configuration parameters
const DEFAULT_CONFIG = {
    nakamaHost: "api-roshberosh.clevergames.org",
    port: "443",
    serverKey: "rg2uHTDck0Za8Nt0yMUqD3972IGnxLn75o+ANnVLGl0=",
    useSsl: true,
    deviceId: "D6BB4ACF-5E85-4E31-BFD7-1C33411E9211",
    roomCardId: "classic_room",
    clientBuild: "2.1.4",
    geminiKey: process.env.GEMINI_API_KEY || "",
    wireDebug: false,
    autoStart: true,
    requeueDelayMs: 4000,
    maxAuthRetries: 5,
    maxPipelineRetries: 10,
    customKeywords: [
        { regex: "אופניים", answer: "גלגל" },
        { regex: "מדינות|ארצות", answer: "ישראל" }
    ]
};

// Ensure config file exists
function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            const fileData = fs.readFileSync(CONFIG_PATH, "utf8");
            return { ...DEFAULT_CONFIG, ...JSON.parse(fileData) };
        }
    } catch (err) {
        console.error("Failed to load config.json, using defaults.", err);
    }
    return DEFAULT_CONFIG;
}

function saveConfig(config) {
    try {
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 4), "utf8");
        return true;
    } catch (err) {
        console.error("Failed to write config.json", err);
        return false;
    }
}

// App bootstrapping
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

let activeConfig = loadConfig();
const bot = new RoshBeRoshBot(activeConfig);

// In-memory log buffer to provide historical logs on load
const LOG_BUFFER_LIMIT = 500;
const logBuffer = [];

function pushToLogBuffer(logEntry) {
    logBuffer.push(logEntry);
    if (logBuffer.length > LOG_BUFFER_LIMIT) {
        logBuffer.shift();
    }
}

// Subscribe to bot events and relay to clients
bot.on("log", (logEntry) => {
    pushToLogBuffer(logEntry);
    io.emit("log", logEntry);
    // Console output for terminal diagnostics
    const colorTag = logEntry.level === "error" ? "\x1b[31m" :
                     logEntry.level === "warn" ? "\x1b[33m" :
                     logEntry.level === "success" ? "\x1b[32m" :
                     logEntry.level === "ai" ? "\x1b[36m" : "\x1b[0m";
    console.log(`${colorTag}[${logEntry.timestamp}] [${logEntry.system}] [${logEntry.level.toUpperCase()}] ${logEntry.message}\x1b[0m`);
});

bot.on("state-update", (summary) => {
    io.emit("state-update", summary);
});

bot.on("timer-update", (remainingSeconds) => {
    io.emit("timer-update", remainingSeconds);
});

// Socket.io Real-time API
io.on("connection", (socket) => {
    console.log(`Socket client connected: ${socket.id}`);
    
    // Send immediate initial state
    socket.emit("state-update", bot.getStateSummary());
    socket.emit("logs-history", logBuffer);

    socket.on("get-status", () => {
        socket.emit("state-update", bot.getStateSummary());
    });

    socket.on("bot-start", async () => {
        if (!bot.running) {
            bot.log("info", "SYSTEM", "Web Command: Start Bot received.");
            await bot.start();
        } else {
            socket.emit("notification", { type: "info", message: "Bot is already running." });
        }
    });

    socket.on("bot-stop", async () => {
        if (bot.running) {
            bot.log("info", "SYSTEM", "Web Command: Stop Bot received.");
            await bot.stop();
        } else {
            socket.emit("notification", { type: "info", message: "Bot is not running." });
        }
    });

    socket.on("bot-restart", async () => {
        bot.log("info", "SYSTEM", "Web Command: Restarting Bot...");
        if (bot.running) {
            await bot.stop();
            await bot.sleep(1000);
        }
        await bot.start();
    });

    socket.on("submit-manual-answer", (answer) => {
        if (answer && answer.trim()) {
            bot.submitManualAnswer(answer.trim());
        }
    });

    socket.on("update-config", async (newConfig) => {
        try {
            // Keep the serverKey and other defaults if not supplied
            const updated = {
                ...activeConfig,
                ...newConfig,
                // Ensure port & SSL formats
                useSsl: newConfig.useSsl !== undefined ? !!newConfig.useSsl : activeConfig.useSsl,
                wireDebug: newConfig.wireDebug !== undefined ? !!newConfig.wireDebug : activeConfig.wireDebug,
                autoStart: newConfig.autoStart !== undefined ? !!newConfig.autoStart : activeConfig.autoStart
            };

            activeConfig = updated;
            saveConfig(activeConfig);
            
            bot.updateConfig(activeConfig);
            bot.log("success", "SYSTEM", "Configuration updated and saved to disk.");
            
            // Re-emit new state
            io.emit("state-update", bot.getStateSummary());
            socket.emit("notification", { type: "success", message: "Configuration saved." });

            // If the bot is running, notify that a restart is recommended
            if (bot.running) {
                socket.emit("notification", { type: "warning", message: "Configuration updated! Restart the bot to apply active network parameters." });
            }
        } catch (err) {
            socket.emit("notification", { type: "error", message: `Failed to update config: ${err.message}` });
        }
    });

    socket.on("force-requeue", async () => {
        if (bot.running && bot.socket) {
            bot.log("info", "QUEUE", "Web Command: Forcing matchmaking exit and re-queue.");
            await bot.onMatchEnded("ForcedRequeue");
        } else {
            socket.emit("notification", { type: "error", message: "Cannot re-queue: Bot is not currently running or has no connection." });
        }
    });

    socket.on("claim-rewards", async () => {
        if (bot.running && bot.session) {
            bot.log("info", "SYSTEM", "Web Command: Initiating manual rewards claim...");
            await bot.topUpRewards();
            socket.emit("notification", { type: "success", message: "Claim rewards requested." });
        } else {
            socket.emit("notification", { type: "error", message: "Bot must be running and authenticated to claim rewards." });
        }
    });

    socket.on("test-gemini", async (testKey) => {
        const keyToUse = testKey || activeConfig.geminiKey;
        if (!keyToUse) {
            socket.emit("gemini-test-result", { success: false, message: "No Gemini Key provided or configured." });
            return;
        }

        bot.log("info", "AI", "Testing Gemini key connectivity...");
        const tempBot = new RoshBeRoshBot({ geminiKey: keyToUse });
        try {
            const answer = await tempBot.askGemini("פירות צהובים", []);
            if (answer) {
                socket.emit("gemini-test-result", { 
                    success: true, 
                    message: `Connection successful! Test Category "פירות צהובים" returned: "${answer}"` 
                });
            } else {
                socket.emit("gemini-test-result", { 
                    success: false, 
                    message: "Connection failed or returned empty payload. Verify key validity." 
                });
            }
        } catch (err) {
            socket.emit("gemini-test-result", { 
                success: false, 
                message: `Error: ${err.message}` 
            });
        }
    });

    socket.on("disconnect", () => {
        console.log(`Socket client disconnected: ${socket.id}`);
    });
});

// Auto-start bot if configured
if (activeConfig.autoStart) {
    setTimeout(async () => {
        console.log("Auto-starting RoshBeRosh Bot runner...");
        await bot.start();
    }, 1000);
}

// HTTP API routes
app.get("/api/state", (req, res) => {
    res.json(bot.getStateSummary());
});

app.post("/api/config", (req, res) => {
    const newConfig = req.body;
    activeConfig = { ...activeConfig, ...newConfig };
    saveConfig(activeConfig);
    bot.updateConfig(activeConfig);
    io.emit("state-update", bot.getStateSummary());
    res.json({ success: true, config: activeConfig });
});

app.post("/api/control", async (req, res) => {
    const { action } = req.body;
    if (action === "start") {
        await bot.start();
        res.json({ success: true, status: "starting" });
    } else if (action === "stop") {
        await bot.stop();
        res.json({ success: true, status: "stopping" });
    } else {
        res.status(400).json({ error: "Unknown action" });
    }
});

// Handle graceful terminations
process.on("SIGINT", async () => {
    console.log("SIGINT received, closing server...");
    if (bot.running) {
        await bot.stop();
    }
    process.exit(0);
});

process.on("SIGTERM", async () => {
    console.log("SIGTERM received, closing server...");
    if (bot.running) {
        await bot.stop();
    }
    process.exit(0);
});

server.listen(PORT, "0.0.0.0", () => {
    console.log(`RoshBeRosh Dashboard Server running on http://0.0.0.0:${PORT}`);
});
