const { EventEmitter } = require("events");
const WS = require("ws");

// Ensure global WebSocket is available for Nakama SDK
if (typeof globalThis.WebSocket === "undefined") {
    globalThis.WebSocket = WS;
}

const { Client } = require("@heroiclabs/nakama-js");

class RoshBeRoshBot extends EventEmitter {
    constructor(config = {}) {
        super();
        this.updateConfig(config);

        this.client = null;
        this.session = null;
        this.socket = null;
        this.running = false;
        
        // Control variables
        this.pipelineRetries = 0;
        this.instantDrawCount = 0;
        this.ticketToRequestId = new Map();
        
        // Local keywords for rapid fallback
        this.fallbackKeywords = [
            [/שייקספיר/, "המלט"],
            [/ספרדית/, "ספרד"],
            [/אופניים/, "גלגל"],
            [/חג המולד/, "כוכב"],
            [/אבני חן/, "יהלום"],
            [/שפות/, "אנגלית"],
            [/ספרי התנ|ספרי הת/, "בראשית"],
            [/סימפסונים/, "הומר"],
            [/ליל הסדר/, "מצה"],
            [/רכבת/, "תל אביב"],
            [/בני נוער|עבודה/, "מלצר"],
            [/מדינות|ארצות/, "ישראל"],
            [/פירות/, "תפוח"],
            [/ירקות/, "גזר"],
            [/חיות|בעלי חיים/, "כלב"],
            [/ספרים|ספרות/, "המלך ליר"],
            [/סרטים|קולנוע/, "אביר"],
            [/מוסיקה|זמרים/, "שיר"],
            [/אוכל|מאכל/, "לחם"],
            [/צבעים/, "אדום"],
            [/מספרים/, "אחד"],
            [/ספורט|כדורגל|כדורסל/, "שחייה"],
            [/מקצועות|תפקידים/, "רופא"],
        ];

        // Match and user state
        this.state = {
            status: "offline", // offline, authenticating, preflight, idle, searching, playing, stopped, error
            matchId: null,
            category: "",
            usedAnswers: [],
            turnAnswered: false,
            turnTimeout: null,
            pendingGeminiP: null,
            matchStartTs: 0,
            roundNumber: 0,
            turnsStarted: 0,
            myTurn: false,
            turnEndTime: 0,
            turnDuration: 0,
            player: {
                username: "Player",
                coins: 0,
                points: 0,
                energy: 0,
                diamonds: 0
            },
            opponent: null,
            stats: {
                wins: 0,
                losses: 0,
                draws: 0,
                totalGames: 0
            }
        };
    }

    updateConfig(config) {
        this.config = {
            nakamaHost: config.nakamaHost || "api-roshberosh.clevergames.org",
            port: config.port || "443",
            serverKey: config.serverKey || "rg2uHTDck0Za8Nt0yMUqD3972IGnxLn75o+ANnVLGl0=",
            useSsl: config.useSsl !== undefined ? config.useSsl : true,
            deviceId: config.deviceId || "D6BB4ACF-5E85-4E31-BFD7-1C33411E9211",
            roomCardId: config.roomCardId || "classic_room",
            clientBuild: config.clientBuild || "2.1.4",
            geminiKey: config.geminiKey || "",
            geminiModel: config.geminiModel || "gemini-3.5-flash",
            thinkingLevel: config.thinkingLevel || "low",
            wireDebug: config.wireDebug || false,
            requeueDelayMs: config.requeueDelayMs || 4000,
            maxAuthRetries: config.maxAuthRetries || 5,
            maxPipelineRetries: config.maxPipelineRetries || 10,
            customKeywords: config.customKeywords || []
        };
    }

    log(level, system, message) {
        const logEntry = {
            timestamp: new Date().toISOString(),
            level, // info, success, warn, error, ai, rx, tx
            system, // AUTH, PREFLIGHT, SOCKET, MATCH, AI, QUEUE, SYSTEM
            message
        };
        this.emit("log", logEntry);
    }

    setState(newState) {
        let updated = false;
        for (const [key, val] of Object.entries(newState)) {
            if (JSON.stringify(this.state[key]) !== JSON.stringify(val)) {
                this.state[key] = val;
                updated = true;
            }
        }
        if (updated) {
            this.emit("state-update", this.getStateSummary());
        }
    }

    getStateSummary() {
        return {
            status: this.state.status,
            matchId: this.state.matchId,
            category: this.state.category,
            usedAnswers: Array.from(this.state.usedAnswers || []),
            turnAnswered: this.state.turnAnswered,
            roundNumber: this.state.roundNumber,
            myTurn: this.state.myTurn,
            turnEndTime: this.state.turnEndTime,
            turnDuration: this.state.turnDuration,
            player: this.state.player,
            opponent: this.state.opponent,
            stats: this.state.stats,
            config: {
                nakamaHost: this.config.nakamaHost,
                deviceId: this.config.deviceId,
                roomCardId: this.config.roomCardId,
                clientBuild: this.config.clientBuild,
                hasGeminiKey: !!this.config.geminiKey,
                geminiModel: this.config.geminiModel,
                thinkingLevel: this.config.thinkingLevel,
                wireDebug: this.config.wireDebug
            }
        };
    }

    resetMatchState() {
        if (this.state.turnTimeout) {
            clearTimeout(this.state.turnTimeout);
        }
        this.setState({
            matchId: null,
            category: "",
            usedAnswers: [],
            turnAnswered: false,
            turnTimeout: null,
            pendingGeminiP: null,
            matchStartTs: 0,
            roundNumber: 0,
            turnsStarted: 0,
            myTurn: false,
            turnEndTime: 0,
            turnDuration: 0,
            opponent: null
        });
    }

    // --- Core Startup & Pipeline --
    async start() {
        if (this.running) {
            this.log("warn", "SYSTEM", "Bot is already running.");
            return;
        }
        this.running = true;
        this.pipelineRetries = 0;
        this.log("info", "SYSTEM", "Starting bot runner...");
        await this.runPipeline();
    }

    async stop() {
        if (!this.running) {
            this.log("warn", "SYSTEM", "Bot is not running.");
            return;
        }
        this.running = false;
        this.log("info", "SYSTEM", "Stopping bot runner...");
        
        if (this.state.turnTimeout) {
            clearTimeout(this.state.turnTimeout);
        }
        
        this.resetMatchState();
        
        if (this.socket) {
            try {
                this.socket.disconnect();
            } catch (err) {
                // Ignore disconnect errors
            }
            this.socket = null;
        }
        
        this.setState({ status: "stopped" });
        this.log("success", "SYSTEM", "Bot runner stopped.");
    }

    async runPipeline() {
        if (!this.running) return;

        if (this.pipelineRetries >= this.config.maxPipelineRetries) {
            this.log("error", "SYSTEM", `Pipeline failed ${this.config.maxPipelineRetries} times. Stopping bot.`);
            this.setState({ status: "error" });
            this.running = false;
            return;
        }

        this.pipelineRetries++;
        this.resetMatchState();

        if (this.socket) {
            try { this.socket.disconnect(); } catch (err) {}
            this.socket = null;
        }

        this.setState({ status: "authenticating" });
        this.client = new Client(this.config.serverKey, this.config.nakamaHost, this.config.port, this.config.useSsl);

        try {
            this.session = await this.authenticate(0);
            this.setState({ status: "preflight" });
            const resumeStatus = await this.preflightChecks();
            
            this.setState({ status: "idle" });
            this.socket = await this.connectSocket();
            this.pipelineRetries = 0;

            if (resumeStatus && resumeStatus.match_id && resumeStatus.status === "active") {
                this.log("info", "MATCH", `Resuming active match: ${resumeStatus.match_id}`);
                this.setState({ status: "playing", matchId: resumeStatus.match_id });
                try {
                    await this.socket.joinMatch(resumeStatus.match_id);
                    this.sendOpcode(resumeStatus.match_id, 3, {}); // Send PlayerReady
                } catch (err) {
                    this.log("warn", "MATCH", `Failed to resume match: ${err.message}. Entering queue instead.`);
                    await this.enterQueue();
                }
            } else {
                await this.enterQueue();
            }
        } catch (err) {
            this.log("error", "SYSTEM", `Pipeline execution failed: ${err.message}`);
            if (this.running) {
                const delay = Math.min(5000 * this.pipelineRetries, 30000);
                this.log("info", "SYSTEM", `Re-running pipeline in ${delay / 1000}s (attempt ${this.pipelineRetries})...`);
                this.setState({ status: "error" });
                await this.sleep(delay);
                return this.runPipeline();
            }
        }
    }

    // --- Nakama Helpers --
    async authenticate(attempt = 0) {
        this.log("info", "AUTH", `Authenticating with Device ID: ${this.config.deviceId.slice(0, 12)}...`);
        try {
            const session = await this.client.authenticateDevice(this.config.deviceId, true);
            this.log("success", "AUTH", `Successfully authenticated. User ID: ${session.user_id.slice(0, 8)}`);
            return session;
        } catch (err) {
            if (attempt >= this.config.maxAuthRetries) {
                throw new Error(`Authentication failed after ${this.config.maxAuthRetries} attempts: ${err.message}`);
            }
            const delay = Math.min(2000 * (2 ** attempt), 30000);
            this.log("warn", "AUTH", `Auth attempt ${attempt + 1} failed. Retrying in ${delay / 1000}s...`);
            await this.sleep(delay);
            return this.authenticate(attempt + 1);
        }
    }

    async callRpc(name, payload = {}) {
        try {
            const result = await this.client.rpc(this.session, name, payload);
            let data = result.payload;
            if (typeof data === "string") {
                try { data = JSON.parse(data); } catch (e) {}
            }
            this.log("info", "SYSTEM", `RPC Call: ${name} success`);
            return data || {};
        } catch (err) {
            const detail = err.status ? `HTTP ${err.status}: ${err.message}` : err.message;
            this.log("error", "SYSTEM", `RPC Call: ${name} failed - ${detail}`);
            return null;
        }
    }

    async probeRpc(name, payloads) {
        for (let idx = 0; idx < payloads.length; idx++) {
            const p = payloads[idx];
            try {
                const result = await this.client.rpc(this.session, name, p);
                let data = result.payload;
                if (typeof data === "string") {
                    try { data = JSON.parse(data); } catch (e) {}
                }
                this.log("info", "SYSTEM", `RPC Call Probe: ${name} success on variant ${idx}`);
                return data || {};
            } catch (err) {
                // Try next variant
            }
        }
        this.log("warn", "SYSTEM", `RPC Call Probe: ${name} - all ${payloads.length} variants failed.`);
        return null;
    }

    async getOurIp() {
        try {
            const res = await fetch("https://api.ipify.org?format=json");
            const data = await res.json();
            return data.ip || "unknown";
        } catch (err) {
            return "unknown";
        }
    }

    buildFreshUserData(userId, ip) {
        const suffix = Math.random().toString(36).slice(2, 8);
        return {
            AppleId: null, BlockUser: false, DeviceId: this.config.deviceId, Email: null,
            FbId: null, IsRatedStore: false, LastLoginTime: Date.now(),
            LegacyIdentity: null, NoAds: false, OriginatedAsAnonymous: true,
            UserId: userId, UserIpAddress: ip,
            UserProfile: {
                ShowOnlineStatus: true, DisableChats: false,
                ReceiveChatsOnlyFromFriends: false,
                Avatar: {
                    IsMan: true, SpriteInd: 0, IconURL: null,
                    UseRealImg: false, FrameId: "empty", goldUsername: false,
                },
                Username: `Bot${suffix}`, Coins: 500, Points: 100,
                Energy: 50, Diamonds: 10,
            },
        };
    }

    async preflightChecks() {
        this.log("info", "PREFLIGHT", "Running pre-flight diagnostics...");
        const ourIp = await this.getOurIp();
        this.log("info", "PREFLIGHT", `Client public IP: ${ourIp}`);

        const rpcData = await this.callRpc("rb_user_data_get", {});
        let userData = rpcData?.found ? (rpcData.userData || rpcData) : null;

        if (!userData?.UserProfile) {
            this.log("warn", "PREFLIGHT", "No remote profile found. Provisioning fresh user...");
            const fresh = this.buildFreshUserData(this.session.user_id, ourIp);
            this.updatePlayerProfile(fresh.UserProfile);
            await this.probeRpc("rb_user_data_upsert", [{ userData: fresh }]);
            this.log("success", "PREFLIGHT", `Provisioned username: ${fresh.UserProfile.Username}`);
        } else {
            this.updatePlayerProfile(userData.UserProfile);
            this.log("success", "PREFLIGHT", `Retrieved existing profile: ${this.state.player.username}`);

            // Safety mechanism: Ensure points > 0 to prevent instant desertion draws
            const currentPoints = userData.UserProfile.Points || 0;
            if (currentPoints === 0) {
                this.log("warn", "PREFLIGHT", "Trophies are 0, patching database record to 100 to avoid automatic lobby kicks.");
                userData.UserProfile.Points = 100;
                this.updatePlayerProfile(userData.UserProfile);
                await this.probeRpc("rb_user_data_upsert", [{ userData }]);
            }
        }

        // Validate access
        const accessData = await this.probeRpc("rb_access_status", [
            { platform: "iOS", client_version: this.config.clientBuild },
            {},
            null,
        ]);
        if (accessData) {
            this.log("info", "PREFLIGHT", `Access checks completed: ${JSON.stringify(accessData)}`);
        }

        // Penalty discipline check
        const penalty = await this.callRpc("rb_match_entry_penalty_status", {});
        if (penalty) {
            this.log("info", "PREFLIGHT", `Anti-desertion stats: early leaves ${penalty.early_leave_count}/${penalty.threshold}`);
            if (penalty.blocked) {
                const wait = penalty.retry_after_sec || 60;
                this.log("error", "PREFLIGHT", `🚨 Matchmaking BLOCKED due to early leaves! Must wait ${wait}s.`);
                this.setState({ status: "error" });
                await this.sleep(wait * 1000 + 1000);
            } else if (penalty.penalty_entries > 0) {
                this.log("warn", "PREFLIGHT", `⚠️ Warning: match entry penalties active (penalty count: ${penalty.penalty_entries})`);
            }
        }

        // Refresh/Claim daily rewards
        await this.topUpRewards();

        // Check if there is a match to resume
        const resumeStatus = await this.probeRpc("rb_match_resume_status", [
            { include_terminated: false },
            { user_id: this.session.user_id },
            null,
        ]);
        
        return resumeStatus;
    }

    async topUpRewards() {
        this.log("info", "PREFLIGHT", "Attempting automatic wallet top-ups & reward claims...");
        await this.callRpc("get_daily_reward_config", {});
        await this.callRpc("get_server_time", {});
        
        for (const endpoint of ["claim_daily_reward", "claim_free_coins", "claim_free_energy"]) {
            const claimResult = await this.callRpc(endpoint, {});
            if (claimResult && claimResult.wallet) {
                this.log("success", "PREFLIGHT", `Claimed reward via ${endpoint}!`);
            }
        }
        
        // Refresh wallet
        const refreshed = await this.callRpc("rb_user_data_get", {});
        const profile = refreshed?.userData?.UserProfile || refreshed?.UserProfile;
        if (profile) {
            this.updatePlayerProfile(profile);
        }
    }

    updatePlayerProfile(profile) {
        this.setState({
            player: {
                username: profile.Username || "Player",
                coins: profile.Coins !== undefined ? profile.Coins : 0,
                points: profile.Points !== undefined ? profile.Points : 0,
                energy: profile.Energy !== undefined ? profile.Energy : 0,
                diamonds: profile.Diamonds !== undefined ? profile.Diamonds : 0,
            }
        });
    }

    // --- Matchmaking Queue Management --
    async enterQueue() {
        if (!this.socket) {
            throw new Error("Cannot enter queue: socket not established.");
        }

        this.setState({ status: "searching" });
        
        // Generate a cryptographically structured 32-character requestId
        const requestId = Array.from({ length: 32 }, () => 
            Math.floor(Math.random() * 16).toString(16)
        ).join("");

        const profileSummary = {
            ShowOnlineStatus: true,
            DisableChats: false,
            ReceiveChatsOnlyFromFriends: false,
            Avatar: { IsMan: true, SpriteInd: 0, FrameId: "empty", goldUsername: false },
            Username: this.state.player.username,
            Coins: this.state.player.coins,
            Points: this.state.player.points,
            Energy: this.state.player.energy,
            Diamonds: this.state.player.diamonds
        };

        const stringProperties = {
            clientBuild: this.config.clientBuild,
            matchmakingRequestId: requestId,
            roomCardId: this.config.roomCardId,
            userId: this.session.user_id,
            userProfile: JSON.stringify(profileSummary)
        };

        const query = `+properties.roomCardId:${this.config.roomCardId} +properties.clientBuild:${this.config.clientBuild}`;
        this.log("info", "QUEUE", `Entering matchmaking lobby... Query: "${query}"`);

        try {
            const ticket = await this.socket.addMatchmaker(query, 2, 2, stringProperties, {});
            this.ticketToRequestId.set(ticket.ticket, requestId);
            this.log("success", "QUEUE", `In matchmaking queue. Ticket ID: ${ticket.ticket}`);
        } catch (err) {
            this.log("error", "QUEUE", `Failed to enter matchmaker: ${err.message}`);
            this.setState({ status: "idle" });
            throw err;
        }
    }

    // --- WebSocket Sockets & Transport --
    async connectSocket() {
        this.log("info", "SOCKET", "Opening real-time WebSocket connection...");
        const sock = this.client.createSocket(this.config.useSsl);

        sock.onerror = (evt) => {
            this.log("error", "SOCKET", `WebSocket error detected: ${JSON.stringify(evt)}`);
        };

        sock.onclose = async (evt) => {
            this.log("warn", "SOCKET", `WebSocket disconnected. Code: ${evt.code}`);
            this.ticketToRequestId.clear();
            this.resetMatchState();
            this.socket = null;

            if (this.running) {
                this.setState({ status: "offline" });
                this.log("info", "SOCKET", "Scheduling auto-reconnect in 5 seconds...");
                await this.sleep(5000);
                await this.runPipeline();
            }
        };

        sock.onnotification = (n) => {
            const content = n.content || {};
            if (content.wallet) {
                this.log("info", "SOCKET", `Wallet update notification: coins=${content.wallet.coins}, energy=${content.wallet.energy}`);
                const updatedProfile = {
                    ...this.state.player,
                    coins: content.wallet.coins !== undefined ? content.wallet.coins : this.state.player.coins,
                    energy: content.wallet.energy !== undefined ? content.wallet.energy : this.state.player.energy,
                    diamonds: content.wallet.diamonds !== undefined ? content.wallet.diamonds : this.state.player.diamonds,
                };
                this.setState({ player: updatedProfile });
            } else {
                this.log("info", "SOCKET", `Notification [${n.subject}]: ${JSON.stringify(content).slice(0, 150)}`);
            }
        };

        sock.onmatchpresence = (p) => {
            const joins = (p.joins || []).map(u => u.username || u.user_id?.slice(0, 8)).join(", ");
            const leaves = (p.leaves || []).map(u => u.username || u.user_id?.slice(0, 8)).join(", ");
            if (joins) this.log("info", "MATCH", `Player(s) joined lobby: ${joins}`);
            if (leaves) this.log("info", "MATCH", `Player(s) left lobby: ${leaves}`);
        };

        sock.onmatchdata = (data) => this.handleMatchData(data);

        sock.onmatchmakermatched = async (matched) => {
            const matchId = matched.match_id;
            const ticket = matched.ticket;
            const requestId = this.ticketToRequestId.get(ticket) || null;
            this.ticketToRequestId.delete(ticket);

            this.log("success", "QUEUE", `Matchmaker found a slot! Connecting to Match: ${matchId}`);

            const users = matched.users || [];
            const opponentUser = users.find(u => u.presence?.user_id !== this.session.user_id);
            
            if (opponentUser) {
                try {
                    const opProfileStr = opponentUser.string_properties?.userProfile;
                    const opProfile = opProfileStr ? JSON.parse(opProfileStr) : null;
                    if (opProfile) {
                        this.setState({
                            opponent: {
                                username: opProfile.Username || "Opponent",
                                coins: opProfile.Coins || 0,
                                points: opProfile.Points || 0,
                                energy: opProfile.Energy || 0
                            }
                        });
                        this.log("info", "MATCH", `Opponent hydrated: ${this.state.opponent.username} (${this.state.opponent.points} Trophies)`);
                    } else {
                        this.setState({
                            opponent: {
                                username: opponentUser.presence?.username || "Opponent",
                                coins: 0,
                                points: 0,
                                energy: 0
                            }
                        });
                    }
                } catch (e) {
                    this.log("warn", "MATCH", "Failed parsing opponent profile properties.");
                }
            }

            // Check room compatibility shielding
            const opRoom = opponentUser?.string_properties?.roomCardId;
            if (opRoom && opRoom !== this.config.roomCardId) {
                this.log("warn", "MATCH", `Room mismatch shielding: Opponent room "${opRoom}" is incompatible with client room "${this.config.roomCardId}". Requesting matchmaker re-queue.`);
                await this.sleep(1000);
                await this.enterQueue();
                return;
            }

            try {
                this.setState({ status: "playing", matchId });
                await sock.joinMatch(matchId, undefined, { matchmakingRequestId: requestId });
                this.log("success", "MATCH", `*** Match handshake successful! ID: ${matchId} ***`);
                this.sendOpcode(matchId, 3, {}); // Opcode 3: PlayerReady
            } catch (err) {
                this.log("error", "MATCH", `Match connection handshaking failed: ${err.message}`);
                this.setState({ status: "idle" });
                await this.sleep(1000);
                await this.enterQueue();
            }
        };

        await sock.connect(this.session, true);
        this.log("success", "SOCKET", "WebSocket state connected and listening.");
        this.socket = sock;

        if (this.config.wireDebug) {
            this.installWireTap();
        }

        return sock;
    }

    sendOpcode(matchId, opcode, payload) {
        if (!this.socket) return;
        try {
            const bytes = new TextEncoder().encode(JSON.stringify(payload));
            this.socket.sendMatchState(matchId, opcode, bytes);
            this.log("tx", "SOCKET", `TX Opcode ${opcode}: ${JSON.stringify(payload)}`);
        } catch (err) {
            this.log("error", "SOCKET", `Failed to send Opcode ${opcode}: ${err.message}`);
        }
    }

    decodeMatchData(raw) {
        try {
            const str = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
            return JSON.parse(str);
        } catch {
            return {};
        }
    }

    handleMatchData(data) {
        const opcode = data.op_code;
        const payload = this.decodeMatchData(data.data);

        // Keep raw websocket logs if wireDebug is off, but structured
        this.log("rx", "SOCKET", `RX Opcode ${opcode}: ${JSON.stringify(payload).slice(0, 250)}`);

        switch (opcode) {
            // --- 107: MatchFound ---
            case 107: {
                this.setState({ matchId: data.match_id });
                const wp = payload.wallet_points || {};
                this.log("info", "MATCH", `Match fully assembled. Current ranking trophies: ${JSON.stringify(wp)}`);
                break;
            }

            // --- 108: RoundPrepare ---
            case 108: {
                const category = payload.question_text || "";
                this.setState({
                    matchId: data.match_id,
                    category,
                    matchStartTs: Date.now(),
                    roundNumber: payload.round_number || 0,
                    usedAnswers: [],
                    turnAnswered: false,
                    myTurn: false
                });

                this.log("info", "MATCH", `ROUND ${this.state.roundNumber} PREPARING. Category: "${category}"`);
                
                // Approve the question instantly
                this.sendOpcode(data.match_id, 6, {}); // Opcode 6: ApproveQuestion

                if (category) {
                    this.log("info", "AI", `Pre-fetching answer from AI for category: "${category}"...`);
                    this.state.pendingGeminiP = this.askGemini(category, []);
                }

                // Check if we are starting the turn first. Fast-path handles early inactivity lock
                if (payload.first_turn === this.session.user_id) {
                    const mid = data.match_id;
                    setTimeout(() => {
                        if (this.state.matchId === mid && !this.state.turnAnswered) {
                            this.log("warn", "MATCH", `Immediate Turn Start: Opcode 101 delayed, executing quick-guess fast-path trigger.`);
                            this.handleOurTurn(mid, category, 0);
                        }
                    }, 80);
                }
                break;
            }

            // --- 109: RoundPrepareTimer ---
            case 109: {
                const countdown = payload.round_start_time && payload.server_time_now
                    ? Math.max(0, Math.floor((payload.round_start_time - payload.server_time_now) / 1000))
                    : "?";
                this.log("info", "MATCH", `Countdown until Round Active: ${countdown}s`);
                break;
            }

            // --- 100: RoundStart ---
            case 100: {
                this.log("info", "MATCH", `Round ${this.state.roundNumber} is now LIVE!`);
                break;
            }

            // --- 101: TurnStart ---
            case 101: {
                this.setState({ matchId: data.match_id, turnAnswered: false });
                this.state.turnsStarted++;

                const turnPlayerId = payload.current_turn_pid || payload.current_turn;
                const durationMs = payload.turn_duration_ms || (payload.turn_duration ? payload.turn_duration * 1000 : 0);
                const isOurTurn = turnPlayerId === this.session.user_id;

                this.setState({
                    myTurn: isOurTurn,
                    turnDuration: durationMs,
                    turnEndTime: Date.now() + durationMs
                });

                this.log("info", "MATCH", `Turn transition: active player = ${isOurTurn ? "YOU" : "Opponent"} (timeout ${durationMs}ms)`);

                if (isOurTurn) {
                    this.handleOurTurn(data.match_id, this.state.category || payload.question_text || "", durationMs);
                }
                break;
            }

            // --- 102: AnswerResult ---
            case 102: {
                const submitted = payload.submitted_answer || payload.answer || "";
                if (submitted) {
                    const newUsed = new Set(this.state.usedAnswers);
                    newUsed.add(submitted);
                    this.setState({ usedAnswers: Array.from(newUsed) });
                }

                const indicator = payload.correct ? "✅ APPROVED" : "❌ REJECTED";
                const submitterLabel = payload.submitter_pid === this.session.user_id ? "You" : "Opponent";
                
                this.log("info", "MATCH", `Answer submitted by ${submitterLabel}: "${submitted}" is ${indicator}.`);
                if (payload.similarity_score !== undefined) {
                    this.log("info", "MATCH", `Similarity weight: ${payload.similarity_score} | Canonical: "${payload.canonical_answer}"`);
                }

                if (this.state.turnTimeout) {
                    clearTimeout(this.state.turnTimeout);
                }
                this.setState({ turnAnswered: false, myTurn: false });

                // If opponent submitted, check if we must trigger immediately on success
                if (payload.next_turn_pid === this.session.user_id) {
                    const mid = data.match_id;
                    const cat = this.state.category;
                    setTimeout(() => {
                        if (!this.state.turnAnswered && this.state.matchId === mid) {
                            this.log("warn", "MATCH", "Opcode 101 TurnStart not yet received post-answer evaluation. Forcing turn start.");
                            this.handleOurTurn(mid, cat, 0);
                        }
                    }, 200);
                }
                break;
            }

            // --- 103: GameOver ---
            case 103: {
                const isWinner = payload.winner_pid === this.session.user_id;
                const isDraw = payload.winner_pid === "draw";
                
                let winStatus = "DRAW";
                if (!isDraw) {
                    winStatus = isWinner ? "VICTORY 🏆" : "DEFEAT ❌";
                }

                this.log("success", "MATCH", `🏁 GAME COMPLETED! Outcome: ${winStatus}. Reason: ${payload.reason || "normal"}`);
                this.log("info", "MATCH", `Final Scores: ${JSON.stringify(payload.scores)} | Coins Δ: ${JSON.stringify(payload.coin_delta)}`);

                // Update local session stats
                const newStats = { ...this.state.stats };
                newStats.totalGames++;
                if (isWinner) {
                    newStats.wins++;
                } else if (isDraw) {
                    newStats.draws++;
                } else {
                    newStats.losses++;
                }
                this.setState({ stats: newStats });

                // Detect fast abort loops/inactivity draws
                const isZeroDraw = isDraw && Object.values(payload.scores || {}).every(val => val === 0);
                const noTurnsPlayed = this.state.turnsStarted === 0;

                if (noTurnsPlayed && isZeroDraw) {
                    this.instantDrawCount++;
                    this.log("warn", "MATCH", `Game terminated before any turns initiated (Sequential Abort Streak: ${this.instantDrawCount})`);
                    if (this.instantDrawCount >= 5) {
                        this.log("error", "SYSTEM", "Critical: Detected 5 consecutive immediate aborts. Self-stopping to save account status.");
                        this.stop();
                        return;
                    }
                } else {
                    this.instantDrawCount = 0;
                }

                // Check if profile updated on game over (rewards/penalties)
                this.queryUpdatedProfileDelayed(1500);
                this.onMatchEnded("GameOver");
                break;
            }

            // --- 104: OpponentLeft ---
            case 104: {
                this.log("warn", "MATCH", "Opponent disconnected or fled active match.");
                const newStats = { ...this.state.stats, wins: this.state.stats.wins + 1, totalGames: this.state.stats.totalGames + 1 };
                this.setState({ stats: newStats });
                this.onMatchEnded("OpponentLeft");
                break;
            }

            // --- 105: TimerUpdate ---
            case 105: {
                if (payload.remaining_seconds !== undefined) {
                    this.emit("timer-update", payload.remaining_seconds);
                }
                break;
            }

            // --- 106: RoundEnd ---
            case 106: {
                const rWinner = payload.round_winner_pid === this.session.user_id ? "YOU" : "Opponent";
                this.log("info", "MATCH", `Round End. Winner: ${rWinner} | Scores: ${JSON.stringify(payload.scores)}`);
                this.setState({ turnAnswered: false, myTurn: false });
                if (this.state.turnTimeout) {
                    clearTimeout(this.state.turnTimeout);
                }
                break;
            }

            // --- 110: OnPlayerApprovedQuestion ---
            case 110: {
                this.log("info", "MATCH", "Opponent approved the current question.");
                break;
            }

            // --- 111: TurnEnded ---
            case 111: {
                this.log("info", "MATCH", `Turn Expired. Winner: ${payload.round_winner_pid === this.session.user_id ? "YOU" : "Opponent"}. Reason: ${payload.reason}`);
                this.setState({ turnAnswered: false, myTurn: false });
                if (this.state.turnTimeout) {
                    clearTimeout(this.state.turnTimeout);
                }
                break;
            }

            // --- 113: PlayerInactivity ---
            case 113: {
                const targetId = payload.player_id === this.session.user_id ? "YOU" : "Opponent";
                this.log("warn", "MATCH", `🚨 INACTIVITY WARNING for target: ${targetId}`);
                break;
            }

            // --- 114: PowerUpFailed ---
            case 114: {
                this.log("error", "MATCH", `Strategic Power-Up Failed: ${payload.powerup_type} - Reason: ${payload.reason}`);
                break;
            }

            // --- 115: MatchTerminated ---
            case 115: {
                this.log("error", "MATCH", `Match terminated abnormally. Reason: ${payload.reason}`);
                this.onMatchEnded("MatchTerminated");
                break;
            }
        }
    }

    // --- Turn Solver & Gemini Integration ---
    async handleOurTurn(matchId, category, durationMs) {
        if (!category) {
            this.log("warn", "MATCH", "Turn started but question text/category is missing.");
            return;
        }
        if (this.state.turnAnswered) {
            return; // Duplicate guard
        }

        this.log("info", "MATCH", `🤖 YOUR TURN! Category: "${category}" | Opponent: ${this.state.opponent?.username || "Unknown"}`);
        this.setState({ turnAnswered: false });

        // Set local security fail-safe timer
        if (durationMs && durationMs > 2000) {
            if (this.state.turnTimeout) clearTimeout(this.state.turnTimeout);
            this.state.turnTimeout = setTimeout(() => {
                if (!this.state.turnAnswered) {
                    this.log("warn", "AI", "AI deadline elapsed. Submitting local fallback answer to prevent default loss.");
                    this.submitFallbackAndSetAnswered(matchId, category);
                }
            }, durationMs - 1500); // 1.5s margin
        }

        const geminiPromise = this.state.pendingGeminiP || this.askGemini(category, this.state.usedAnswers);
        this.state.pendingGeminiP = null;

        // Fast-path evaluation
        if (durationMs === 0) {
            if (this.state.turnTimeout) clearTimeout(this.state.turnTimeout);
            this.setState({ turnAnswered: true });
            
            const localGuess = this.quickLocalGuess(category);
            this.log("info", "AI", `Fast-path instant first turn. Submitting dictionary guess: "${localGuess}"`);
            this.submitAnswer(matchId, localGuess);

            // Let the Gemini promise complete in background to pre-load next round
            geminiPromise.then(ans => {
                if (ans && !this.state.pendingGeminiP) {
                    this.state.pendingGeminiP = Promise.resolve(ans);
                }
            }).catch(() => {});
            return;
        }

        // Standard path with strict response deadline
        const AI_RESPONSE_WINDOW = 800; // ms
        let isWindowExceeded = false;
        
        const timeoutPromise = new Promise(res => {
            setTimeout(() => {
                isWindowExceeded = true;
                res(null);
            }, AI_RESPONSE_WINDOW);
        });

        try {
            const aiResult = await Promise.race([geminiPromise, timeoutPromise]);
            
            if (this.state.turnAnswered) {
                return; // Guard against timeout trigger
            }

            if (this.state.turnTimeout) clearTimeout(this.state.turnTimeout);
            this.setState({ turnAnswered: true });

            if (isWindowExceeded || !aiResult) {
                const localGuess = this.quickLocalGuess(category);
                this.log("warn", "AI", `Gemini response timed out (> ${AI_RESPONSE_WINDOW}ms). Executing local heuristic guess: "${localGuess}"`);
                this.submitAnswer(matchId, localGuess);
            } else {
                this.log("success", "AI", `AI response succeeded! Selected answer: "${aiResult}"`);
                this.submitAnswer(matchId, aiResult);
            }
        } catch (err) {
            this.log("error", "AI", `AI evaluation error: ${err.message}. Using fallback.`);
            this.submitFallbackAndSetAnswered(matchId, category);
        }
    }

    submitFallbackAndSetAnswered(matchId, category) {
        this.setState({ turnAnswered: true });
        const localGuess = this.quickLocalGuess(category);
        this.submitAnswer(matchId, localGuess);
    }

    submitAnswer(matchId, answer) {
        this.sendOpcode(matchId, 1, { answer }); // Opcode 1: SubmitAnswer
    }

    submitManualAnswer(answer) {
        if (!this.state.matchId) {
            this.log("warn", "SYSTEM", "Cannot submit manual answer: No active match session.");
            return;
        }
        if (this.state.turnTimeout) clearTimeout(this.state.turnTimeout);
        this.setState({ turnAnswered: true });
        this.log("info", "SYSTEM", `Submitting manual user override: "${answer}"`);
        this.submitAnswer(this.state.matchId, answer);
    }

    // --- Gemini AI Connector ---
    async askGemini(category, usedAnswersList) {
        if (!this.config.geminiKey) {
            return null;
        }

        const cleanUsed = Array.from(usedAnswersList || []);
        const usedStr = cleanUsed.length > 0 ? cleanUsed.join(", ") : "None";

        const prompt = `You are playing a Hebrew word-battle game called "Rosh BeRosh".
The current category is: "${category}"
Players alternate naming valid members of this category.
Answers already used this round: [${usedStr}]

Give me ONE answer that:
1. Clearly belongs to the category "${category}"
2. Is NOT in the used list: [${usedStr}]
3. Is a common, well-known, valid example
4. Is written in Hebrew

Reply with ONLY the Hebrew word or short phrase. No punctuation, no English, no explanation. Just the plain text answer.`;

        const requestBody = {
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: {
                temperature: 0.4,
                maxOutputTokens: 100
            }
        };

        const model = this.config.geminiModel || "gemini-3.5-flash";
        
        // Add thinkingConfig if model supports thinking levels (Gemini 3/3.5 models)
        if (model.startsWith("gemini-3") || model.includes("gemini-3")) {
            const level = this.config.thinkingLevel || "low";
            if (level === "disabled") {
                requestBody.generationConfig.thinkingConfig = {
                    thinkingBudget: 0
                };
            } else {
                requestBody.generationConfig.thinkingConfig = {
                    thinkingLevel: level
                };
            }
        }

        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.config.geminiKey}`;

        try {
            const res = await fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(requestBody)
            });

            if (!res.ok) {
                const errText = await res.text();
                this.log("error", "AI", `Gemini API returned HTTP ${res.status}: ${errText.slice(0, 150)}`);
                return null;
            }

            const json = await res.json();
            let parsedText = json?.candidates?.[0]?.content?.parts?.[0]?.text || "";
            
            parsedText = parsedText.trim().split("\n")[0].trim();
            parsedText = parsedText.replace(/^["'`«»״\-–—\s]+|["'`«»״\-–—\s]+$/g, "").trim();

            this.log("info", "AI", `Gemini AI proposal (${model}): "${parsedText}" (for category "${category}")`);
            return parsedText || null;
        } catch (err) {
            this.log("error", "AI", `Gemini integration error: ${err.message}`);
            return null;
        }
    }

    // --- Heuristic Heuristic Heuristic ---
    quickLocalGuess(category) {
        // Evaluate custom keywords first
        if (this.config.customKeywords && this.config.customKeywords.length > 0) {
            for (const item of this.config.customKeywords) {
                try {
                    const regex = new RegExp(item.regex, 'i');
                    if (regex.test(category)) {
                        return item.answer;
                    }
                } catch (e) {
                    // Ignore malformed custom regexes
                }
            }
        }

        // Fallback keywords search
        for (const [re, ans] of this.fallbackKeywords) {
            if (re.test(category)) {
                return ans;
            }
        }

        // Syntactic extraction
        const words = category.replace(/["\-–—«»״]/g, " ").split(/\s+/);
        const exclusions = /^(של|עם|את|על|אל|בין|כל|את|אין|יש|לא|ה|ב|ל|מ|ו|כ|ש|מה|הם|הן|זה|זו|אנחנו|אותו|אותה|אחד)$/;
        const candidate = words.find(w => w.length >= 3 && !exclusions.test(w));
        
        return candidate || "כן";
    }

    // --- Post-Match Flows ---
    async onMatchEnded(reason) {
        this.resetMatchState();
        this.setState({ status: "idle" });
        this.log("info", "QUEUE", `Match terminated due to "${reason}". Initializing re-queue pipeline in ${this.config.requeueDelayMs / 1000}s...`);
        
        await this.sleep(this.config.requeueDelayMs);

        if (!this.running) {
            this.log("info", "QUEUE", "Bot runner stopped while in cool-down. Aborting re-queue.");
            return;
        }

        if (!this.socket) {
            this.log("warn", "QUEUE", "WebSocket connection lost. Re-establishing connection pipelines...");
            await this.runPipeline();
            return;
        }

        try {
            await this.enterQueue();
        } catch (err) {
            this.log("error", "QUEUE", `Re-queue attempt failed: ${err.message}. Restarting connection lifecycle.`);
            await this.runPipeline();
        }
    }

    async queryUpdatedProfileDelayed(delayMs) {
        await this.sleep(delayMs);
        if (this.session) {
            const rpcData = await this.callRpc("rb_user_data_get", {});
            const profile = rpcData?.userData?.UserProfile || rpcData?.UserProfile;
            if (profile) {
                this.updatePlayerProfile(profile);
            }
        }
    }

    // --- Wire Debug ---
    installWireTap() {
        if (!this.socket || !this.socket.adapter) return;
        try {
            const adapter = this.socket.adapter;
            const originalOnMessage = adapter.onmessage;
            const originalSend = adapter.send;

            adapter.onmessage = (msg) => {
                try {
                    const str = typeof msg.data === "string" ? msg.data
                        : Buffer.isBuffer(msg.data) ? msg.data.toString("utf8") : "[binary]";
                    this.log("rx", "SOCKET", `[WIRE IN] ${str.slice(0, 300)}`);
                } catch (e) {}
                if (originalOnMessage) {
                    originalOnMessage.call(adapter, msg);
                }
            };

            adapter.send = (raw) => {
                try {
                    const str = typeof raw === "string" ? raw
                        : Buffer.isBuffer(raw) ? raw.toString("utf8")
                        : raw instanceof Uint8Array ? Buffer.from(raw).toString("utf8")
                        : JSON.stringify(raw);
                    this.log("tx", "SOCKET", `[WIRE OUT] ${str.slice(0, 300)}`);
                } catch (e) {}
                return originalSend.call(adapter, raw);
            };
            this.log("success", "SOCKET", "Low-level wiretap diagnostic listeners successfully active.");
        } catch (e) {
            this.log("warn", "SOCKET", "Unable to inject wiretap on Nakama adapter.");
        }
    }

    // --- Utility ---
    sleep(ms) {
        return new Promise(r => setTimeout(r, ms));
    }
}

module.exports = RoshBeRoshBot;
