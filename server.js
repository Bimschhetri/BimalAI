require("dotenv").config();

const express = require("express");
const fs = require("fs");
const path = require("path");
const multer = require("multer");

const app = express();
const PORT = 3000;

const DATA_DIR = path.join(__dirname, "data");
const CHATS_FILE = path.join(DATA_DIR, "chats.json");
const MEMORY_FILE = path.join(DATA_DIR, "memory.json");

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

if (!fs.existsSync(CHATS_FILE)) {
    fs.writeFileSync(CHATS_FILE, "[]");
}

if (!fs.existsSync(MEMORY_FILE)) {
    fs.writeFileSync(MEMORY_FILE, "[]");
}

app.use(express.json({ limit: "30mb" }));
app.use(express.static(path.join(__dirname, "public")));

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 15 * 1024 * 1024
    }
});


/* =========================================================
   HELPERS
========================================================= */

function loadJSON(file, fallback = []) {
    try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
        return fallback;
    }
}

function saveJSON(file, data) {
    fs.writeFileSync(
        file,
        JSON.stringify(data, null, 2),
        "utf8"
    );
}

function loadChats() {
    return loadJSON(CHATS_FILE, []);
}

function saveChats(chats) {
    saveJSON(CHATS_FILE, chats);
}

function loadMemory() {
    return loadJSON(MEMORY_FILE, []);
}

function saveMemory(memory) {
    saveJSON(MEMORY_FILE, memory);
}


/* =========================================================
   MODELS
========================================================= */

app.get("/api/models", async (req, res) => {

    try {

        const response = await fetch(
            "https://openrouter.ai/api/v1/models"
        );

        if (!response.ok) {
            throw new Error("Could not load OpenRouter models");
        }

        const data = await response.json();

        const models = (data.data || [])
            .filter(model => {

                return (
                    model.pricing?.prompt === "0" &&
                    model.pricing?.completion === "0"
                );

            })
            .map(model => ({
                id: model.id,
                name: model.name,
                context_length: model.context_length || 0
            }))
            .sort((a, b) =>
                a.name.localeCompare(b.name)
            );

        res.json(models);

    } catch (error) {

        console.error("MODEL ERROR:", error);

        res.status(500).json({
            error: "Could not load models"
        });

    }

});


/* =========================================================
   CHATS
========================================================= */

app.get("/api/chats", (req, res) => {

    res.json(loadChats());

});


app.post("/api/chats", (req, res) => {

    const { chat } = req.body;

    if (!chat) {

        return res.status(400).json({
            error: "Chat is required"
        });

    }

    const chats = loadChats();

    const index =
        chats.findIndex(
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


app.delete("/api/chats/:id", (req, res) => {

    const chats = loadChats();

    const filtered =
        chats.filter(
            item => item.id !== req.params.id
        );

    saveChats(filtered);

    res.json({
        success: true
    });

});


/* =========================================================
   MEMORY
========================================================= */

app.get("/api/memory", (req, res) => {

    res.json(loadMemory());

});


app.post("/api/memory", (req, res) => {

    const { text } = req.body;

    if (!text || !text.trim()) {

        return res.status(400).json({
            error: "Memory text required"
        });

    }

    const memory = loadMemory();

    memory.unshift({
        id: Date.now().toString(),
        text: text.trim(),
        createdAt: new Date().toISOString()
    });

    saveMemory(memory);

    res.json({
        success: true,
        memory
    });

});


app.delete("/api/memory/:id", (req, res) => {

    const memory =
        loadMemory().filter(
            item => item.id !== req.params.id
        );

    saveMemory(memory);

    res.json({
        success: true
    });

});


/* =========================================================
   FILE EXTRACTION
========================================================= */

app.post("/api/upload", upload.single("file"), async (req, res) => {

    try {

        if (!req.file) {

            return res.status(400).json({
                error: "No file uploaded"
            });

        }

        const filename =
            req.file.originalname;

        const extension =
            path.extname(filename).toLowerCase();

        let text = "";

        if (extension === ".txt" ||
            extension === ".md" ||
            extension === ".csv") {

            text =
                req.file.buffer.toString("utf8");

        }

        else if (extension === ".pdf") {

            const pdfParse =
                require("pdf-parse");

            const result =
                await pdfParse(req.file.buffer);

            text =
                result.text || "";

        }

        else if (extension === ".docx") {

            const mammoth =
                require("mammoth");

            const result =
                await mammoth.extractRawText({
                    buffer: req.file.buffer
                });

            text =
                result.value || "";

        }

        else {

            return res.status(400).json({
                error:
                    "Supported files: PDF, DOCX, TXT, MD, CSV"
            });

        }

        text =
            text
                .replace(/\0/g, "")
                .trim();

        if (!text) {

            return res.status(400).json({
                error: "Could not extract readable text"
            });

        }

        /*
          Avoid sending enormous files directly.
          Keep approximately the first 100k characters.
        */

        const limitedText =
            text.slice(0, 100000);

        res.json({

            success: true,

            filename,

            characters:
                limitedText.length,

            text:
                limitedText

        });

    } catch (error) {

        console.error(
            "FILE ERROR:",
            error
        );

        res.status(500).json({
            error:
                "Could not read the file: " +
                error.message
        });

    }

});


/* =========================================================
   AI CHAT
========================================================= */

app.post("/api/chat", async (req, res) => {

    try {

        const {
            messages,
            model,
            webSearch,
            memory
        } = req.body;

        if (
            !Array.isArray(messages) ||
            messages.length === 0
        ) {

            return res.status(400).json({
                error: "Messages are required"
            });

        }

        const selectedModel =
            model || "openrouter/free";

        const storedMemory =
            Array.isArray(memory)
                ? memory
                : loadMemory();

        let memoryText = "";

        if (storedMemory.length) {

            memoryText =
                "\n\nIMPORTANT USER MEMORY:\n" +
                storedMemory
                    .slice(0, 30)
                    .map(
                        item =>
                            "- " + item.text
                    )
                    .join("\n");

        }

        const systemPrompt = `
You are BimalAI, Bimal's personal AI assistant.

Your job is to be highly useful, intelligent, accurate and practical.

Communication:
- Be natural and conversational.
- Use clear formatting.
- Use Markdown when useful.
- Do not unnecessarily repeat the user's question.
- For technical tasks, give exact commands and explain where to run them.
- If something is uncertain, say so rather than inventing information.
- If the user asks for current information and web search is available, use it.
- When the user asks in Nepali, you may answer naturally in Nepali.
- When the user mixes Nepali and English, respond naturally in the same style.

You are running as BimalAI, a private personal assistant.
${memoryText}
        `.trim();


        const requestBody = {

            model: selectedModel,

            messages: [
                {
                    role: "system",
                    content: systemPrompt
                },
                ...messages
            ],

            stream: true

        };


        /*
          Web search is optional.
          OpenRouter's web plugin lets the model
          use current web information.
        */

        if (webSearch === true) {

            requestBody.plugins = [
                {
                    id: "web",
                    max_results: 5
                }
            ];

        }


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
                        "http://localhost:3000",

                    "X-Title":
                        "BimalAI"

                },

                body:
                    JSON.stringify(
                        requestBody
                    )

            }
        );


        if (!response.ok) {

            const errorText =
                await response.text();

            return res.status(
                response.status
            ).json({

                error:
                    errorText ||
                    "OpenRouter request failed"

            });

        }


        res.setHeader(
            "Content-Type",
            "text/event-stream"
        );

        res.setHeader(
            "Cache-Control",
            "no-cache, no-transform"
        );

        res.setHeader(
            "Connection",
            "keep-alive"
        );

        res.flushHeaders();


        for await (
            const chunk of response.body
        ) {

            res.write(
                Buffer.from(chunk)
            );

        }

        res.end();


    } catch (error) {

        console.error(
            "AI ERROR:",
            error
        );

        if (!res.headersSent) {

            res.status(500).json({
                error: error.message
            });

        } else {

            res.end();

        }

    }

});


/* =========================================================
   HEALTH
========================================================= */

app.get("/api/health", (req, res) => {

    res.json({
        status: "ok",
        name: "BimalAI",
        version: "2.0"
    });

});


/* =========================================================
   START
========================================================= */

app.listen(
    PORT,
    () => {

        console.log("");
        console.log("=================================");
        console.log("        BimalAI 2.0");
        console.log("=================================");
        console.log(
            `Running at http://localhost:${PORT}`
        );
        console.log("");
        console.log("Features:");
        console.log("- Free OpenRouter models");
        console.log("- Streaming");
        console.log("- Web search");
        console.log("- PDF/DOCX/TXT upload");
        console.log("- Persistent memory");
        console.log("- Chat history");
        console.log("=================================");
        console.log("");

    }
);