require("dotenv").config();

const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");

const app = express();

const PORT =
    process.env.PORT || 3000;


/* =========================================
   TRUST RENDER PROXY
========================================= */

app.set("trust proxy", 1);


/* =========================================
   DIRECTORIES
========================================= */

const DATA_DIR =
    path.join(__dirname, "data");

const CHATS_FILE =
    path.join(DATA_DIR, "chats.json");

const UPLOAD_DIR =
    path.join(DATA_DIR, "uploads");


if (!fs.existsSync(DATA_DIR)) {

    fs.mkdirSync(
        DATA_DIR,
        { recursive: true }
    );

}


if (!fs.existsSync(UPLOAD_DIR)) {

    fs.mkdirSync(
        UPLOAD_DIR,
        { recursive: true }
    );

}


if (!fs.existsSync(CHATS_FILE)) {

    fs.writeFileSync(
        CHATS_FILE,
        "[]",
        "utf8"
    );

}


/* =========================================
   MIDDLEWARE
========================================= */

app.use(
    express.json({
        limit: "35mb"
    })
);


app.use(
    express.urlencoded({
        extended: true,
        limit: "35mb"
    })
);


/* =========================================
   SESSION
========================================= */

app.use(
    session({

        secret:
            process.env.SESSION_SECRET ||
            "bimalai-session-secret-change-this",

        resave: false,

        saveUninitialized: false,

        cookie: {

            httpOnly: true,

            secure:
                process.env.NODE_ENV ===
                "production",

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
    process.env.BIMALAI_USERNAME ||
    "Simran";


const LOGIN_PASSWORD =
    process.env.BIMALAI_PASSWORD ||
    "Bimal";


let PASSWORD_HASH = null;


function requireLogin(
    req,
    res,
    next
){

    if(
        req.session &&
        req.session.authenticated === true
    ){

        return next();

    }


    return res.status(401).json({

        error:
            "Authentication required"

    });

}


/* =========================================
   LOGIN
========================================= */

app.post(
    "/api/login",
    async (req, res) => {

        try {

            const {
                username,
                password
            } =
                req.body || {};


            if(
                !username ||
                !password
            ){

                return res.status(400).json({

                    error:
                        "Username and password are required"

                });

            }


            if(!PASSWORD_HASH){

                return res.status(503).json({

                    error:
                        "Authentication system is starting. Please try again."

                });

            }


            const usernameCorrect =
                username.trim() ===
                LOGIN_USERNAME;


            const passwordCorrect =
                await bcrypt.compare(
                    password,
                    PASSWORD_HASH
                );


            if(
                !usernameCorrect ||
                !passwordCorrect
            ){

                return res.status(401).json({

                    error:
                        "Incorrect username or password"

                });

            }


            req.session.authenticated =
                true;


            req.session.username =
                LOGIN_USERNAME;


            req.session.save(
                error => {

                    if(error){

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

                        username:
                            LOGIN_USERNAME

                    });

                }
            );


        } catch(error){

            console.error(
                "LOGIN ERROR:",
                error
            );


            return res.status(500).json({

                error:
                    "Login failed"

            });

        }

    }
);


/* =========================================
   LOGOUT
========================================= */

app.post(
    "/api/logout",
    requireLogin,
    (req, res) => {

        req.session.destroy(
            error => {

                if(error){

                    console.error(
                        "LOGOUT ERROR:",
                        error
                    );


                    return res.status(500).json({

                        error:
                            "Logout failed"

                    });

                }


                res.clearCookie(
                    "connect.sid"
                );


                return res.json({

                    success: true

                });

            }
        );

    }
);


/* =========================================
   AUTH STATUS
========================================= */

app.get(
    "/api/auth",
    (req, res) => {

        return res.json({

            authenticated:
                !!(
                    req.session &&
                    req.session.authenticated === true
                ),

            username:
                req.session?.username ||
                null

        });

    }
);


/* =========================================
   HEALTH
========================================= */

app.get(
    "/health",
    (req, res) => {

        res.json({

            status: "ok",

            name: "BimalAI",

            version: "3.0"

        });

    }
);


/* =========================================
   STATIC FILES
========================================= */

app.use(
    express.static(
        path.join(
            __dirname,
            "public"
        )
    )
);


/* =========================================
   UPLOADS
========================================= */

app.use(
    "/uploads",
    requireLogin,
    express.static(
        UPLOAD_DIR
    )
);


/* =========================================
   FILE SAVE API
========================================= */

app.post(
    "/api/upload",
    requireLogin,
    async (req, res) => {

        try {

            const {
                name,
                type,
                data
            } =
                req.body || {};


            if(
                !name ||
                !data
            ){

                return res.status(400).json({

                    error:
                        "File name and data are required"

                });

            }


            /*
             * Expected format:
             * data:image/png;base64,.....
             */

            const match =
                String(data).match(
                    /^data:([^;]+);base64,(.+)$/
                );


            if(!match){

                return res.status(400).json({

                    error:
                        "Invalid file data"

                });

            }


            const base64 =
                match[2];


            const buffer =
                Buffer.from(
                    base64,
                    "base64"
                );


            /*
             * Prevent very large uploads.
             */

            if(
                buffer.length >
                20 * 1024 * 1024
            ){

                return res.status(413).json({

                    error:
                        "File too large"

                });

            }


            const safeName =
                path.basename(name)
                    .replace(
                        /[^a-zA-Z0-9._-]/g,
                        "_"
                    );


            const filename =
                Date.now() +
                "-" +
                Math.random()
                    .toString(36)
                    .slice(2) +
                "-" +
                safeName;


            const filePath =
                path.join(
                    UPLOAD_DIR,
                    filename
                );


            fs.writeFileSync(
                filePath,
                buffer
            );


            return res.json({

                success: true,

                name: safeName,

                type:
                    type ||
                    match[1],

                size:
                    buffer.length,

                url:
                    "/uploads/" +
                    encodeURIComponent(
                        filename
                    )

            });


        } catch(error){

            console.error(
                "UPLOAD ERROR:",
                error
            );


            return res.status(500).json({

                error:
                    "Upload failed"

            });

        }

    }
);


/* =========================================
   MODELS
========================================= */

app.get(
    "/api/models",
    requireLogin,
    async (req, res) => {

        try {

            if(
                !process.env.OPENROUTER_API_KEY
            ){

                return res.json([]);

            }


            const response =
                await fetch(
                    "https://openrouter.ai/api/v1/models"
                );


            if(!response.ok){

                throw new Error(
                    `Models request failed: ${response.status}`
                );

            }


            const data =
                await response.json();


            const freeModels =
                (data.data || [])

                    .filter(
                        model => {

                            const prompt =
                                String(
                                    model.pricing?.prompt ??
                                    ""
                                );

                            const completion =
                                String(
                                    model.pricing?.completion ??
                                    ""
                                );


                            return (
                                prompt === "0" &&
                                completion === "0"
                            );

                        }
                    )

                    .map(
                        model => ({

                            id:
                                model.id,

                            name:
                                model.name,

                            context_length:
                                model.context_length

                        })
                    )

                    .sort(
                        (a,b)=>
                            a.name.localeCompare(
                                b.name
                            )
                    );


            res.json(
                freeModels
            );


        } catch(error){

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

function loadChats(){

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


function saveChats(chats){

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

        res.json(
            loadChats()
        );

    }
);


/* =========================================
   SAVE CHAT
========================================= */

app.post(
    "/api/chats",
    requireLogin,
    (req, res) => {

        try {

            const {
                chat
            } =
                req.body || {};


            if(!chat){

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


            if(index >= 0){

                chats[index] =
                    chat;

            }else{

                chats.unshift(
                    chat
                );

            }


            /*
             * Keep latest 100 conversations.
             */

            const limited =
                chats.slice(
                    0,
                    100
                );


            saveChats(
                limited
            );


            res.json({

                success: true

            });


        } catch(error){

            console.error(
                "SAVE CHAT ERROR:",
                error
            );


            res.status(500).json({

                error:
                    "Could not save chat"

            });

        }

    }
);


/* =========================================
   DELETE CHAT
========================================= */

app.delete(
    "/api/chats/:id",
    requireLogin,
    (req, res) => {

        try {

            const chats =
                loadChats();


            const filtered =
                chats.filter(
                    item =>
                        String(item.id) !==
                        String(req.params.id)
                );


            saveChats(
                filtered
            );


            res.json({

                success: true

            });


        } catch(error){

            console.error(
                "DELETE CHAT ERROR:",
                error
            );


            res.status(500).json({

                error:
                    "Could not delete chat"

            });

        }

    }
);


/* =========================================
   AI CHAT
========================================= */

app.post(
    "/api/chat",
    requireLogin,
    async (req, res) => {

        try {

            const {
                messages,
                model
            } =
                req.body || {};


            if(
                !Array.isArray(messages) ||
                messages.length === 0
            ){

                return res.status(400).json({

                    error:
                        "Messages are required"

                });

            }


            if(
                !process.env.OPENROUTER_API_KEY
            ){

                return res.status(500).json({

                    error:
                        "OpenRouter API key is not configured"

                });

            }


            /*
             * Protect server from accidentally
             * receiving an enormous request.
             */

            const requestSize =
                Buffer.byteLength(
                    JSON.stringify(messages),
                    "utf8"
                );


            if(
                requestSize >
                30 * 1024 * 1024
            ){

                return res.status(413).json({

                    error:
                        "Conversation or attachment is too large"

                });

            }


            const selectedModel =
                model ||
                "openrouter/free";


            const systemPrompt = {

                role:
                    "system",

                content:
`You are BimalAI, Bimal's personal AI assistant.

You are shared by Bimal and Simran.

Be intelligent, helpful, accurate, clear and friendly.

You can help with:
- study and exam preparation
- mathematics
- physics
- civil engineering
- thermodynamics
- hydraulics
- hydropower
- coding
- programming
- planning
- writing
- documents
- images
- everyday tasks

When an image is attached, analyze what is actually visible.
Do not invent details that cannot be seen.

When files are provided as text, use their contents carefully.

Use Markdown when useful.

For calculations, show the important steps.

If information is uncertain, say so instead of inventing facts.

Keep answers practical and easy to understand.`
            };


            const response =
                await fetch(
                    "https://openrouter.ai/api/v1/chat/completions",
                    {

                        method:
                            "POST",

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
                                    systemPrompt,
                                    ...messages
                                ],

                                stream:
                                    true

                            })

                    }
                );


            if(!response.ok){

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


            if(!response.body){

                return res.status(500).json({

                    error:
                        "No response body"

                });

            }


            /*
             * Streaming response
             */

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


            if(
                typeof res.flushHeaders ===
                "function"
            ){

                res.flushHeaders();

            }


            try {

                for await(
                    const chunk
                    of response.body
                ){

                    if(
                        res.writableEnded
                    ){

                        break;

                    }


                    res.write(
                        Buffer.from(
                            chunk
                        )
                    );

                }


            } catch(streamError){

                console.error(
                    "STREAM ERROR:",
                    streamError
                );

            }


            if(
                !res.writableEnded
            ){

                res.end();

            }


        } catch(error){

            console.error(
                "AI ERROR:",
                error
            );


            if(
                !res.headersSent
            ){

                res.status(500).json({

                    error:
                        error.message ||
                        "Internal server error"

                });

            }else if(
                !res.writableEnded
            ){

                res.end();

            }

        }

    }
);


/* =========================================
   FRONTEND FALLBACK
========================================= */

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


/* =========================================
   START
========================================= */

async function startServer(){

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

Running on port:
${PORT}

Login:
Username: ${LOGIN_USERNAME}

Password:
Protected

Features:
✓ Persistent login
✓ OpenRouter AI
✓ Streaming responses
✓ Free model list
✓ Chat history
✓ File upload
✓ Image upload
✓ Image analysis
✓ Browser photo editor
✓ Mobile responsive

========================================
                `);

            }
        );


    } catch(error){

        console.error(
            "STARTUP ERROR:",
            error
        );


        process.exit(1);

    }

}


startServer();
