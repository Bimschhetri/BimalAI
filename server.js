require("dotenv").config();

const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const mammoth = require("mammoth");
const pdfParse = require("pdf-parse");

const app = express();

const PORT = process.env.PORT || 3000;

app.set("trust proxy", 1);

const DATA_DIR = path.join(__dirname, "data");
const PUBLIC_DIR = path.join(__dirname, "public");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const CHATS_FILE = path.join(DATA_DIR, "chats.json");

for (const dir of [DATA_DIR, UPLOAD_DIR]) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

if (!fs.existsSync(CHATS_FILE)) {
    fs.writeFileSync(CHATS_FILE, "[]", "utf8");
}

/* =========================================
   MIDDLEWARE
========================================= */

app.use(express.json({ limit: "50mb" }));

app.use(
    express.urlencoded({
        extended: true,
        limit: "50mb"
    })
);

app.use(
    session({
        secret:
            process.env.SESSION_SECRET ||
            "bimalai-change-this-secret",

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

/* =========================================
   AUTH
========================================= */

const LOGIN_USERNAME =
    process.env.BIMALAI_USERNAME || "Simran";

const LOGIN_PASSWORD =
    process.env.BIMALAI_PASSWORD || "Bimal";

let PASSWORD_HASH = null;

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

/* =========================================
   LOGIN
========================================= */

app.post("/api/login", async (req, res) => {

    try {

        const username =
            String(req.body?.username || "").trim();

        const password =
            String(req.body?.password || "");

        if (!username || !password) {

            return res.status(400).json({
                error:
                    "Username and password are required"
            });
        }

        if (!PASSWORD_HASH) {

            return res.status(503).json({
                error:
                    "Authentication system is starting. Try again."
            });
        }

        const usernameCorrect =
            username === LOGIN_USERNAME;

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

/* =========================================
   LOGOUT
========================================= */

app.post(
    "/api/logout",
    requireLogin,
    (req, res) => {

        req.session.destroy((error) => {

            if (error) {

                return res.status(500).json({
                    error:
                        "Logout failed"
                });
            }

            res.clearCookie("connect.sid");

            res.json({
                success: true
            });

        });

    }
);

/* =========================================
   AUTH STATUS
========================================= */

app.get("/api/auth", (req, res) => {

    res.json({

        authenticated:
            !!(
                req.session &&
                req.session.authenticated === true
            ),

        username:
            req.session?.username || null

    });

});

/* =========================================
   HEALTH
========================================= */

app.get("/health", (req, res) => {

    res.json({
        status: true,
        name: "BimalAI",
        version: "3.0.0"
    });

});

/* =========================================
   FILE UPLOAD
========================================= */

const upload = multer({

    storage: multer.memoryStorage(),

    limits: {
        fileSize:
            25 * 1024 * 1024,

        files: 10
    }

});

/* =========================================
   FILE TEXT EXTRACTION
========================================= */

async function extractFileContent(file) {

    const filename =
        file.originalname || "file";

    const extension =
        path.extname(filename)
            .toLowerCase();

    const mime =
        file.mimetype || "";

    /* TXT / CSV / JSON / MD */

    if (
        extension === ".txt" ||
        extension === ".csv" ||
        extension === ".json" ||
        extension === ".md"
    ) {

        return {
            type: "text",
            name: filename,
            content:
                file.buffer.toString("utf8")
        };
    }

    /* PDF */

    if (
        extension === ".pdf" ||
        mime === "application/pdf"
    ) {

        try {

            const result =
                await pdfParse(file.buffer);

            return {
                type: "text",
                name: filename,
                content:
                    result.text || ""
            };

        } catch (error) {

            console.error(
                "PDF PARSE ERROR:",
                error
            );

            return {
                type: "error",
                name: filename,
                content:
                    "Could not read this PDF."
            };
        }
    }

    /* DOCX */

    if (
        extension === ".docx" ||
        mime ===
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {

        try {

            const result =
                await mammoth.extractRawText({
                    buffer: file.buffer
                });

            return {
                type: "text",
                name: filename,
                content:
                    result.value || ""
            };

        } catch (error) {

            console.error(
                "DOCX PARSE ERROR:",
                error
            );

            return {
                type: "error",
                name: filename,
                content:
                    "Could not read this DOCX file."
            };
        }
    }

    /* IMAGE */

    if (
        mime.startsWith("image/") ||
        [
            ".png",
            ".jpg",
            ".jpeg",
            ".webp",
            ".gif"
        ].includes(extension)
    ) {

        return {
            type: "image",
            name: filename,

            mime:
                mime ||
                "image/jpeg",

            data:
                file.buffer.toString("base64")
        };
    }

    return {
        type: "unsupported",
        name: filename,
        content:
            "This file type is not currently supported."
    };
}

/* =========================================
   UPLOAD API
========================================= */

app.post(
    "/api/upload",
    requireLogin,
    upload.array("files", 10),
    async (req, res) => {

        try {

            if (
                !req.files ||
                req.files.length === 0
            ) {

                return res.status(400).json({
                    error:
                        "No files uploaded"
                });
            }

            const results = [];

            for (
                const file
                of req.files
            ) {

                const result =
                    await extractFileContent(
                        file
                    );

                results.push(result);
            }

            res.json({
                success: true,
                files: results
            });

        } catch (error) {

            console.error(
                "UPLOAD ERROR:",
                error
            );

            res.status(500).json({
                error:
                    "Could not process uploaded files"
            });
        }

    }
);

/* =========================================
   OPENROUTER MODELS
========================================= */

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

            const models =
                (data.data || [])
                    .map(model => {

                        const prompt =
                            Number(
                                model.pricing?.prompt
                            );

                        const completion =
                            Number(
                                model.pricing?.completion
                            );

                        const isFree =
                            prompt === 0 &&
                            completion === 0;

                        return {

                            id:
                                model.id,

                            name:
                                model.name ||
                                model.id,

                            context_length:
                                model.context_length ||
                                null,

                            free:
                                isFree

                        };

                    })
                    .filter(model =>
                        model.free
                    )
                    .sort(
                        (a, b) =>
                            a.name.localeCompare(
                                b.name
                            )
                    );

            res.json(models);

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

/* =========================================
   CHAT STORAGE
========================================= */

function loadChats() {

    try {

        const data =
            fs.readFileSync(
                CHATS_FILE,
                "utf8"
            );

        const parsed =
            JSON.parse(data);

        return Array.isArray(parsed)
            ? parsed
            : [];

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

/* =========================================
   GET CHATS
========================================= */

app.get(
    "/api/chats",
    requireLogin,
    (req, res) => {

        const chats =
            loadChats();

        chats.sort(
            (a, b) =>
                new Date(
                    b.updatedAt || 0
                ) -
                new Date(
                    a.updatedAt || 0
                )
        );

        res.json(chats);
    }
);

/* =========================================
   SAVE CHAT
========================================= */

app.post(
    "/api/chats",
    requireLogin,
    (req, res) => {

        const chat =
            req.body?.chat;

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
                    String(item.id) ===
                    String(chat.id)
            );

        const cleanChat = {

            id:
                String(
                    chat.id ||
                    Date.now()
                ),

            title:
                String(
                    chat.title ||
                    "New conversation"
                ).slice(0, 200),

            messages:
                Array.isArray(
                    chat.messages
                )
                    ? chat.messages
                    : [],

            updatedAt:
                chat.updatedAt ||
                new Date().toISOString()

        };

        if (index >= 0) {

            chats[index] =
                cleanChat;

        } else {

            chats.unshift(
                cleanChat
            );
        }

        saveChats(chats);

        res.json({
            success: true,
            chat: cleanChat
        });

    }
);

/* =========================================
   RENAME CHAT
========================================= */

app.patch(
    "/api/chats/:id",
    requireLogin,
    (req, res) => {

        const chats =
            loadChats();

        const chat =
            chats.find(
                item =>
                    String(item.id) ===
                    String(req.params.id)
            );

        if (!chat) {

            return res.status(404).json({
                error:
                    "Chat not found"
            });
        }

        if (
            typeof req.body?.title ===
            "string"
        ) {

            chat.title =
                req.body.title
                    .trim()
                    .slice(0, 200);
        }

        chat.updatedAt =
            new Date().toISOString();

        saveChats(chats);

        res.json({
            success: true,
            chat
        });

    }
);

/* =========================================
   DELETE CHAT
========================================= */

app.delete(
    "/api/chats/:id",
    requireLogin,
    (req, res) => {

        const chats =
            loadChats();

        const filtered =
            chats.filter(
                item =>
                    String(item.id) !==
                    String(req.params.id)
            );

        saveChats(filtered);

        res.json({
            success: true
        });

    }
);

/* =========================================
   EXPORT CHAT
========================================= */

app.get(
    "/api/chats/:id/export",
    requireLogin,
    (req, res) => {

        const chats =
            loadChats();

        const chat =
            chats.find(
                item =>
                    String(item.id) ===
                    String(req.params.id)
            );

        if (!chat) {

            return res.status(404).json({
                error:
                    "Chat not found"
            });
        }

        let output =
            `# ${chat.title}\n\n`;

        for (
            const message
            of chat.messages || []
        ) {

            const role =
                message.role === "user"
                    ? "Bimal"
                    : "BimalAI";

            output +=
                `## ${role}\n\n`;

            output +=
                `${message.content || ""}\n\n`;
        }

        res.setHeader(
            "Content-Type",
            "text/markdown; charset=utf-8"
        );

        res.setHeader(
            "Content-Disposition",
            `attachment; filename="BimalAI-${chat.id}.md"`
        );

        res.send(output);

    }
);

/* =========================================
   SYSTEM PROMPT
========================================= */

function buildSystemPrompt(mode) {

    const base = `You are BimalAI, Bimal and Simran's personal AI assistant.

Be intelligent, useful, accurate, practical and clear.

Remember the conversation context.

Do not invent facts. If something is uncertain, say so.

Use Markdown when it improves readability.

When the user provides files or images, carefully analyze them.

For study questions, explain concepts clearly and use examples when useful.

For coding questions, provide working code and explain important parts.

For writing tasks, produce polished, ready-to-use writing.

For planning tasks, create practical structured plans.

Keep responses reasonably concise unless the user asks for detail.`;

    const modes = {

        study:
            `You are currently in Study Mode.
Focus on teaching, explanations, examples, formulas, revision and exam preparation.`,

        coding:
            `You are currently in Coding Mode.
Focus on debugging, architecture, code quality and complete working solutions.`,

        writing:
            `You are currently in Writing Mode.
Focus on polished, natural and professional writing.`,

        planning:
            `You are currently in Planning Mode.
Create realistic step-by-step plans, schedules and actionable checklists.`,

        explain:
            `You are currently in Explain Mode.
Explain difficult concepts in simple language and progressively increase depth.`

    };

    return (
        base +
        "\n\n" +
        (
            modes[mode] ||
            ""
        )
    );
}

/* =========================================
   NORMALIZE MESSAGES
========================================= */

function normalizeMessages(messages) {

    return messages
        .filter(
            message =>
                message &&
                (
                    message.role === "user" ||
                    message.role === "assistant"
                )
        )
        .slice(-50)
        .map(message => {

            const role =
                message.role;

            const content =
                message.content;

            if (
                Array.isArray(content)
            ) {

                return {
                    role,
                    content
                };
            }

            return {
                role,
                content:
                    String(
                        content || ""
                    ).slice(0, 100000)
            };

        });
}

/* =========================================
   AI CHAT
========================================= */

app.post(
    "/api/chat",
    requireLogin,
    async (req, res) => {

        let streamStarted = false;

        try {

            const {
                messages,
                model,
                mode
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

            const safeMessages =
                normalizeMessages(
                    messages
                );

            const systemPrompt =
                buildSystemPrompt(
                    mode
                );

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
                                            systemPrompt
                                    },

                                    ...safeMessages

                                ],

                                stream:
                                    true

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

                let message =
                    errorText ||
                    "OpenRouter request failed";

                try {

                    const parsed =
                        JSON.parse(
                            errorText
                        );

                    message =
                        parsed.error?.message ||
                        parsed.error ||
                        message;

                } catch {}

                return res.status(
                    response.status
                ).json({
                    error:
                        String(message)
                });
            }

            if (!response.body) {

                return res.status(500).json({
                    error:
                        "No response body received"
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

            streamStarted = true;

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

            if (
                !streamStarted &&
                !res.headersSent
            ) {

                return res.status(500).json({
                    error:
                        error.message ||
                        "Internal server error"
                });
            }

            if (
                !res.writableEnded
            ) {

                res.end();
            }
        }
    }
);

/* =========================================
   STATIC FRONTEND
========================================= */

app.use(
    express.static(
        PUBLIC_DIR
    )
);

/* =========================================
   FRONTEND FALLBACK
========================================= */

app.use(
    (req, res) => {

        res.sendFile(
            path.join(
                PUBLIC_DIR,
                "index.html"
            )
        );

    }
);

/* =========================================
   START SERVER
========================================= */

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
========================================
             BimalAI 3.0
========================================

Port:
${PORT}

Login:
${LOGIN_USERNAME}

Features:
✓ Persistent authentication
✓ OpenRouter
✓ Streaming chat
✓ Model selection
✓ Chat history
✓ Rename/delete/export
✓ PDF extraction
✓ DOCX extraction
✓ TXT/CSV/JSON/MD extraction
✓ Image upload
✓ Vision-ready messages
✓ Study/Coding/Writing/Planning modes

========================================
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
