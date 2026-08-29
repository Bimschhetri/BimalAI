require("dotenv").config();

const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();

// Render provides PORT automatically.
// Locally it will use 3000.
const PORT = process.env.PORT || 3000;

// ================================
// DIRECTORIES
// ================================

const DATA_DIR = path.join(__dirname, "data");
const CHATS_FILE = path.join(DATA_DIR, "chats.json");

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

if (!fs.existsSync(CHATS_FILE)) {
    fs.writeFileSync(CHATS_FILE, "[]", "utf8");
}

// ================================
// MIDDLEWARE
// ================================

app.use(express.json({ limit: "20mb" }));

app.use(
    express.static(
        path.join(__dirname, "public")
    )
);

// ================================
// CHAT STORAGE
// ================================

function loadChats() {
    try {
        return JSON.parse(
            fs.readFileSync(CHATS_FILE, "utf8")
        );
    } catch (error) {
        console.error("Chat load error:", error);
        return [];
    }
}

function saveChats(chats) {
    try {
        fs.writeFileSync(
            CHATS_FILE,
            JSON.stringify(chats, null, 2),
            "utf8"
        );
    } catch (error) {
        console.error("Chat save error:", error);
    }
}

// ================================
// HEALTH CHECK
// ================================

app.get("/health", (req, res) => {
    res.json({
        status: "ok",
        name: "BimalAI",
        version: "2.0"
    });
});

// ================================
// MODELS
// ================================

app.get("/api/models", async (req, res) => {
    try {
        const response = await fetch(
            "https://openrouter.ai/api/v1/models"
        );

        if (!response.ok) {
            throw new Error(
                `OpenRouter models request failed: ${response.status}`
            );
        }

        const data = await response.json();

        const freeModels = (data.data || [])
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
            error: "Could not load models"
        });
    }
});

// ================================
// GET CHATS
// ================================

app.get("/api/chats", (req, res) => {
    res.json(loadChats());
});

// ================================
// SAVE CHAT
// ================================

app.post("/api/chats", (req, res) => {

    const { chat } = req.body;

    if (!chat) {
        return res.status(400).json({
            error: "Chat is required"
        });
    }

    const chats = loadChats();

    const index = chats.findIndex(
        item => item.id === chat.id
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
});

// ================================
// DELETE CHAT
// ================================

app.delete("/api/chats/:id", (req, res) => {

    const chats = loadChats();

    const filtered = chats.filter(
        item => item.id !== req.params.id
    );

    saveChats(filtered);

    res.json({
        success: true
    });
});

// ================================
// AI CHAT
// ================================

app.post("/api/chat", async (req, res) => {

    try {

        const {
            messages,
            model
        } = req.body;

        if (
            !Array.isArray(messages) ||
            messages.length === 0
        ) {
            return res.status(400).json({
                error: "Messages are required"
            });
        }

        // Check API key
        if (!process.env.OPENROUTER_API_KEY) {
            return res.status(500).json({
                error:
                    "OPENROUTER_API_KEY is not configured."
            });
        }

        const selectedModel =
            model || "openrouter/free";

        const response = await fetch(
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
                        "http://localhost:3000",

                    "X-Title":
                        "BimalAI"
                },

                body: JSON.stringify({

                    model: selectedModel,

                    messages: [

                        {
                            role: "system",

                            content:
                                `You are BimalAI, Bimal's personal AI assistant.

Your goals:
- Be helpful, intelligent and accurate.
- Understand conversation context.
- Explain difficult topics clearly.
- Help with studying, coding, planning and everyday tasks.
- Use concise answers when the question is simple.
- Give detailed explanations when needed.
- Never pretend to know something you don't know.
- Use Markdown when it improves readability.`
                        },

                        ...messages

                    ],

                    stream: true

                })
            }
        );

        // ================================
        // OPENROUTER ERROR
        // ================================

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
                    "OpenRouter returned no response body."
            });
        }

        // ================================
        // STREAM RESPONSE
        // ================================

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

        // Send headers immediately
        if (typeof res.flushHeaders === "function") {
            res.flushHeaders();
        }

        try {

            for await (
                const chunk of response.body
            ) {

                if (res.writableEnded) {
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

        if (!res.writableEnded) {
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

        } else if (!res.writableEnded) {

            res.end();

        }
    }
});

// ================================
// FRONTEND FALLBACK
// ================================

app.use((req, res) => {

    res.sendFile(
        path.join(
            __dirname,
            "public",
            "index.html"
        )
    );
});

// ================================
// START SERVER
// ================================

app.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(`
=================================
        BimalAI 2.0
=================================
Running on port ${PORT}

Features:
- Free OpenRouter models
- Streaming
- Chat history
- Persistent local storage
- Cloud ready
=================================
        `);
    }
);
