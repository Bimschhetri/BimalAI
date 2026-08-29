require("dotenv").config();

const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");

const app = express();

// Render ले PORT दिन्छ, local मा 3000
const PORT = process.env.PORT || 3000;

// Render HTTPS proxy पछाडि session cookie सही काम गर्न
app.set("trust proxy", 1);

// =================================
// FILE STORAGE
// =================================

const DATA_DIR = path.join(__dirname, "data");
const CHATS_FILE = path.join(DATA_DIR, "chats.json");

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

if (!fs.existsSync(CHATS_FILE)) {
    fs.writeFileSync(CHATS_FILE, "[]", "utf8");
}

// =================================
// MIDDLEWARE
// =================================

app.use(express.json({ limit: "20mb" }));

app.use(
    session({
        secret:
            process.env.SESSION_SECRET ||
            "bimalai-session-secret-change-me",

        resave: false,

        saveUninitialized: false,

        cookie: {
            httpOnly: true,

            secure:
                process.env.NODE_ENV === "production",

            sameSite: "lax",

            maxAge:
                1000 *
                60 *
                60 *
                24 *
                30
        }
    })
);

// =================================
// AUTH CONFIG
// =================================

const LOGIN_USERNAME =
    process.env.BIMALAI_USERNAME || "Simran";

const LOGIN_PASSWORD =
    process.env.BIMALAI_PASSWORD || "Bimal";

let PASSWORD_HASH = null;

// =================================
// AUTH MIDDLEWARE
// =================================

function requireLogin(req, res, next) {

    if (
        req.session &&
        req.session.authenticated === true
    ) {
        return next();
    }

    return res.status(401).json({
        error: "Authentication required"
    });
}

// =================================
// LOGIN
// =================================

app.post("/api/login", async (req, res) => {

    try {

        const {
            username,
            password
        } = req.body || {};

        if (!username || !password) {

            return res.status(400).json({
                error:
                    "Username and password are required"
            });

        }

        if (!PASSWORD_HASH) {

            return res.status(503).json({
                error:
                    "Authentication system is starting. Please try again."
            });

        }

        const usernameCorrect =
            username.trim() === LOGIN_USERNAME;

        const passwordCorrect =
            await bcrypt.compare(
                password,
                PASSWORD_HASH
            );

        if (
            !usernameCorrect ||
            !passwordCorrect
        ) {

            return res.status(401).json({
                error:
                    "Incorrect username or password"
            });

        }

        req.session.authenticated = true;
        req.session.username = LOGIN_USERNAME;

        // Important:
        // session लाई पहिले save गराएर मात्र response पठाउने
        req.session.save((error) => {

            if (error) {

                console.error(
                    "SESSION SAVE ERROR:",
                    error
                );

                return res.status(500).json({
                    error:
                        "Could not create login session"
                });

            }

            return res.json({
                success: true,
                username: LOGIN_USERNAME
            });

        });

    } catch (error) {

        console.error(
            "LOGIN ERROR:",
            error
        );

        return res.status(500).json({
            error: "Login failed"
        });

    }

});

// =================================
// LOGOUT
// =================================

app.post(
    "/api/logout",
    requireLogin,
    (req, res) => {

        req.session.destroy((error) => {

            if (error) {

                console.error(
                    "LOGOUT ERROR:",
                    error
                );

                return res.status(500).json({
                    error: "Logout failed"
                });

            }

            res.clearCookie("connect.sid");

            return res.json({
                success: true
            });

        });

    }
);

// =================================
// AUTH STATUS
// =================================

app.get("/api/auth", (req, res) => {

    return res.json({

        authenticated:
            !!(
                req.session &&
                req.session.authenticated === true
            ),

        username:
            req.session?.username || null

    });

});

// =================================
// HEALTH
// =================================

app.get("/health", (req, res) => {

    res.json({
        status: "ok",
        name: "BimalAI",
        version: "2.0"
    });

});

// =================================
// STATIC FRONTEND
// =================================

app.use(
    express.static(
        path.join(__dirname, "public")
    )
);

// =================================
// MODELS
// =================================

app.get(
    "/api/models",
    requireLogin,
    async (req, res) => {

        try {

            const response =
                await fetch(
                    "https://openrouter.ai/api/v1/models"
                );

            if (!response.ok) {

                throw new Error(
                    `Models request failed: ${response.status}`
                );

            }

            const data =
                await response.json();

            const freeModels =
                (data.data || [])

                    .filter(model =>
                        model.pricing?.prompt === "0" &&
                        model.pricing?.completion === "0"
                    )

                    .map(model => ({
                        id: model.id,
                        name: model.name,
                        context_length:
                            model.context_length
                    }))

                    .sort((a, b) =>
                        a.name.localeCompare(b.name)
                    );

            res.json(freeModels);

        } catch (error) {

            console.error(
                "MODEL ERROR:",
                error
            );

            res.status(500).json({
                error:
                    "Could not load models"
            });

        }

    }
);

// =================================
// CHAT STORAGE
// =================================

function loadChats() {

    try {

        return JSON.parse(
            fs.readFileSync(
                CHATS_FILE,
                "utf8"
            )
        );

    } catch {

        return [];

    }

}

function saveChats(chats) {

    fs.writeFileSync(
        CHATS_FILE,
        JSON.stringify(
            chats,
            null,
            2
        ),
        "utf8"
    );

}

// =================================
// GET CHATS
// =================================

app.get(
    "/api/chats",
    requireLogin,
    (req, res) => {

        res.json(
            loadChats()
        );

    }
);

// =================================
// SAVE CHAT
// =================================

app.post(
    "/api/chats",
    requireLogin,
    (req, res) => {

        const { chat } =
            req.body || {};

        if (!chat) {

            return res.status(400).json({
                error:
                    "Chat is required"
            });

        }

        const chats =
            loadChats();

        const index =
            chats.findIndex(
                item =>
                    item.id === chat.id
            );

        if (index >= 0) {

            chats[index] = chat;

        } else {

            chats.unshift(chat);

        }

        saveChats(chats);

        res.json({
            success: true
        });

    }
);

// =================================
// DELETE CHAT
// =================================

app.delete(
    "/api/chats/:id",
    requireLogin,
    (req, res) => {

        const chats =
            loadChats();

        const filtered =
            chats.filter(
                item =>
                    item.id !==
                    req.params.id
            );

        saveChats(filtered);

        res.json({
            success: true
        });

    }
);

// =================================
// AI CHAT
// =================================

app.post(
    "/api/chat",
    requireLogin,
    async (req, res) => {

        try {

            const {
                messages,
                model
            } = req.body || {};

            if (
                !Array.isArray(messages) ||
                messages.length === 0
            ) {

                return res.status(400).json({
                    error:
                        "Messages are required"
                });

            }

            if (
                !process.env.OPENROUTER_API_KEY
            ) {

                return res.status(500).json({
                    error:
                        "OpenRouter API key is not configured"
                });

            }

            const selectedModel =
                model ||
                "openrouter/free";

            const response =
                await fetch(
                    "https://openrouter.ai/api/v1/chat/completions",
                    {

                        method: "POST",

                        headers: {

                            "Authorization":
                                `Bearer ${process.env.OPENROUTER_API_KEY}`,

                            "Content-Type":
                                "application/json",

                            "HTTP-Referer":
                                process.env.APP_URL ||
                                "https://bimalai.onrender.com",

                            "X-Title":
                                "BimalAI"

                        },

                        body:
                            JSON.stringify({

                                model:
                                    selectedModel,

                                messages: [

                                    {
                                        role:
                                            "system",

                                        content:
                                            `You are BimalAI, Bimal's personal AI assistant.

You are shared by Bimal and Simran.

Be intelligent, helpful, accurate and clear.
Remember conversation context.
Help with study, coding, planning, writing and everyday tasks.
Use Markdown when useful.
Do not invent facts.`
                                    },

                                    ...messages

                                ],

                                stream: true

                            })

                    }
                );

            if (!response.ok) {

                const errorText =
                    await response.text();

                console.error(
                    "OPENROUTER ERROR:",
                    errorText
                );

                return res.status(
                    response.status
                ).json({
                    error:
                        errorText ||
                        "OpenRouter request failed"
                });

            }

            if (!response.body) {

                return res.status(500).json({
                    error:
                        "No response body"
                });

            }

            res.setHeader(
                "Content-Type",
                "text/event-stream; charset=utf-8"
            );

            res.setHeader(
                "Cache-Control",
                "no-cache, no-transform"
            );

            res.setHeader(
                "Connection",
                "keep-alive"
            );

            res.setHeader(
                "X-Accel-Buffering",
                "no"
            );

            if (
                typeof res.flushHeaders ===
                "function"
            ) {

                res.flushHeaders();

            }

            try {

                for await (
                    const chunk
                    of response.body
                ) {

                    if (
                        res.writableEnded
                    ) {
                        break;
                    }

                    res.write(
                        Buffer.from(chunk)
                    );

                }

            } catch (streamError) {

                console.error(
                    "STREAM ERROR:",
                    streamError
                );

            }

            if (
                !res.writableEnded
            ) {

                res.end();

            }

        } catch (error) {

            console.error(
                "AI ERROR:",
                error
            );

            if (!res.headersSent) {

                res.status(500).json({
                    error:
                        error.message ||
                        "Internal server error"
                });

            } else if (
                !res.writableEnded
            ) {

                res.end();

            }

        }

    }
);

// =================================
// FRONTEND FALLBACK
// =================================

app.use(
    (req, res) => {

        res.sendFile(
            path.join(
                __dirname,
                "public",
                "index.html"
            )
        );

    }
);

// =================================
// START SERVER
// =================================

async function startServer() {

    try {

        PASSWORD_HASH =
            await bcrypt.hash(
                LOGIN_PASSWORD,
                12
            );

        app.listen(
            PORT,
            "0.0.0.0",
            () => {

                console.log(`
=================================
        BimalAI 2.0
=================================
Running on port ${PORT}

🔐 Login enabled
👤 Username: ${LOGIN_USERNAME}
🔒 Password: protected
🤖 OpenRouter enabled
☁️ Cloud ready
=================================
                `);

            }
        );

    } catch (error) {

        console.error(
            "STARTUP ERROR:",
            error
        );

        process.exit(1);

    }

}

startServer();