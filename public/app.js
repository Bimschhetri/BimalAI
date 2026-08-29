const state = {
    chats: [],
    currentChatId: null,
    messages: [],
    mode: "",
    model: "openrouter/free",
    files: []
};

const $ = (id) => document.getElementById(id);

const loginScreen = $("loginScreen");
const appScreen = $("appScreen");
const loginForm = $("loginForm");
const loginError = $("loginError");

const messagesEl = $("messages");
const chatListEl = $("chatList");
const chatTitleEl = $("chatTitle");
const modeLabelEl = $("modeLabel");

const messageInput = $("messageInput");
const chatForm = $("chatForm");
const sendBtn = $("sendBtn");

const fileInput = $("fileInput");
const filePreview = $("filePreview");

const modelSelect = $("modelSelect");
const modeSelect = $("modeSelect");

const newChatBtn = $("newChatBtn");
const logoutBtn = $("logoutBtn");
const renameBtn = $("renameBtn");
const deleteBtn = $("deleteBtn");
const attachBtn = $("attachBtn");

/* =========================================
   UTILITIES
========================================= */

function escapeHTML(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function simpleMarkdown(text) {
    let html = escapeHTML(text);

    html = html.replace(
        /```([\s\S]*?)```/g,
        (_, code) => `<pre><code>${code.trim()}</code></pre>`
    );

    html = html.replace(
        /`([^`]+)`/g,
        "<code>$1</code>"
    );

    html = html.replace(
        /\*\*(.*?)\*\*/g,
        "<strong>$1</strong>"
    );

    html = html.replace(
        /\*(.*?)\*/g,
        "<em>$1</em>"
    );

    html = html.replace(
        /^### (.*)$/gm,
        "<h3>$1</h3>"
    );

    html = html.replace(
        /^## (.*)$/gm,
        "<h2>$1</h2>"
    );

    html = html.replace(
        /^# (.*)$/gm,
        "<h1>$1</h1>"
    );

    html = html.replace(/\n/g, "<br>");

    return html;
}

function createId() {
    return String(
        Date.now() +
        Math.random().toString(36).slice(2)
    );
}

function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
}

/* =========================================
   AUTH
========================================= */

async function checkAuth() {
    try {
        const response = await fetch("/api/auth");
        const data = await response.json();

        if (data.authenticated) {
            await showApp();
        } else {
            showLogin();
        }
    } catch {
        showLogin();
    }
}

function showLogin() {
    loginScreen.classList.remove("hidden");
    appScreen.classList.add("hidden");
}

async function showApp() {
    loginScreen.classList.add("hidden");
    appScreen.classList.remove("hidden");

    await loadModels();
    await loadChats();

    if (!state.currentChatId) {
        createNewChat(false);
    }
}

loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    loginError.textContent = "";

    const username = $("username").value.trim();
    const password = $("password").value;

    try {
        const response = await fetch("/api/login", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            credentials: "include",
            body: JSON.stringify({
                username,
                password
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(
                data.error || "Login failed"
            );
        }

        await showApp();

    } catch (error) {
        loginError.textContent = error.message;
    }
});

logoutBtn.addEventListener("click", async () => {
    try {
        await fetch("/api/logout", {
            method: "POST",
            credentials: "include"
        });
    } catch {}

    state.chats = [];
    state.currentChatId = null;
    state.messages = [];

    showLogin();
});

/* =========================================
   MODELS
========================================= */

async function loadModels() {
    try {
        const response = await fetch("/api/models");

        if (!response.ok) {
            return;
        }

        const models = await response.json();

        modelSelect.innerHTML = "";

        const freeModels =
            Array.isArray(models)
                ? models
                : [];

        if (freeModels.length === 0) {
            const option =
                document.createElement("option");

            option.value = "openrouter/free";
            option.textContent = "Free model";

            modelSelect.appendChild(option);
            return;
        }

        for (const model of freeModels) {
            const option =
                document.createElement("option");

            option.value = model.id;
            option.textContent =
                model.name || model.id;

            modelSelect.appendChild(option);
        }

        modelSelect.value =
            state.model || "openrouter/free";

    } catch (error) {
        console.error(
            "MODEL LOAD ERROR:",
            error
        );
    }
}

modelSelect.addEventListener("change", () => {
    state.model = modelSelect.value;
});

/* =========================================
   MODES
========================================= */

modeSelect.addEventListener("change", () => {
    state.mode = modeSelect.value;

    const selected =
        modeSelect.options[
            modeSelect.selectedIndex
        ];

    modeLabelEl.textContent =
        selected
            ? selected.textContent
            : "General";
});

/* =========================================
   CHATS
========================================= */

async function loadChats() {
    try {
        const response =
            await fetch("/api/chats", {
                credentials: "include"
            });

        if (!response.ok) {
            return;
        }

        const data = await response.json();

        state.chats =
            Array.isArray(data)
                ? data
                : [];

        renderChatList();

    } catch (error) {
        console.error(
            "CHAT LOAD ERROR:",
            error
        );
    }
}

function renderChatList() {
    chatListEl.innerHTML = "";

    for (const chat of state.chats) {
        const item =
            document.createElement("div");

        item.className = "chat-item";

        if (
            String(chat.id) ===
            String(state.currentChatId)
        ) {
            item.classList.add("active");
        }

        item.innerHTML = `
            <span>💬</span>
            <span class="chat-title">
                ${escapeHTML(
                    chat.title ||
                    "New conversation"
                )}
            </span>
        `;

        item.addEventListener(
            "click",
            () => openChat(chat.id)
        );

        chatListEl.appendChild(item);
    }
}

function createNewChat(save = true) {
    const id = createId();

    state.currentChatId = id;
    state.messages = [];

    const chat = {
        id,
        title: "New conversation",
        messages: [],
        updatedAt:
            new Date().toISOString()
    };

    state.chats.unshift(chat);

    renderChatList();
    renderMessages();

    chatTitleEl.textContent =
        chat.title;

    if (save) {
        saveCurrentChat();
    }
}

newChatBtn.addEventListener(
    "click",
    () => {
        createNewChat(true);
        messageInput.focus();
    }
);

function openChat(id) {
    const chat =
        state.chats.find(
            (item) =>
                String(item.id) ===
                String(id)
        );

    if (!chat) {
        return;
    }

    state.currentChatId = chat.id;

    state.messages =
        Array.isArray(chat.messages)
            ? [...chat.messages]
            : [];

    chatTitleEl.textContent =
        chat.title ||
        "New conversation";

    renderChatList();
    renderMessages();
}

async function saveCurrentChat() {
    const chat =
        state.chats.find(
            (item) =>
                String(item.id) ===
                String(state.currentChatId)
        );

    if (!chat) {
        return;
    }

    chat.messages = state.messages;
    chat.updatedAt =
        new Date().toISOString();

    try {
        const response =
            await fetch(
                "/api/chats",
                {
                    method: "POST",
                    headers: {
                        "Content-Type":
                            "application/json"
                    },
                    credentials: "include",
                    body: JSON.stringify({
                        chat
                    })
                }
            );

        if (!response.ok) {
            console.error(
                "CHAT SAVE FAILED"
            );
        }

    } catch (error) {
        console.error(
            "CHAT SAVE ERROR:",
            error
        );
    }

    renderChatList();
}

renameBtn.addEventListener(
    "click",
    async () => {
        const chat =
            state.chats.find(
                (item) =>
                    String(item.id) ===
                    String(state.currentChatId)
            );

        if (!chat) {
            return;
        }

        const title =
            prompt(
                "Enter new conversation name:",
                chat.title
            );

        if (
            title === null ||
            !title.trim()
        ) {
            return;
        }

        try {
            const response =
                await fetch(
                    `/api/chats/${encodeURIComponent(
                        chat.id
                    )}`,
                    {
                        method: "PATCH",
                        headers: {
                            "Content-Type":
                                "application/json"
                        },
                        credentials: "include",
                        body: JSON.stringify({
                            title:
                                title.trim()
                        })
                    }
                );

            const data =
                await response.json();

            if (!response.ok) {
                throw new Error(
                    data.error ||
                    "Rename failed"
                );
            }

            chat.title =
                data.chat?.title ||
                title.trim();

            chatTitleEl.textContent =
                chat.title;

            renderChatList();

        } catch (error) {
            alert(error.message);
        }
    }
);

deleteBtn.addEventListener(
    "click",
    async () => {
        const chat =
            state.chats.find(
                (item) =>
                    String(item.id) ===
                    String(state.currentChatId)
            );

        if (!chat) {
            return;
        }

        if (
            !confirm(
                "Delete this conversation?"
            )
        ) {
            return;
        }

        try {
            const response =
                await fetch(
                    `/api/chats/${encodeURIComponent(
                        chat.id
                    )}`,
                    {
                        method: "DELETE",
                        credentials: "include"
                    }
                );

            if (!response.ok) {
                throw new Error(
                    "Delete failed"
                );
            }

            state.chats =
                state.chats.filter(
                    (item) =>
                        String(item.id) !==
                        String(chat.id)
                );

            createNewChat(false);

        } catch (error) {
            alert(error.message);
        }
    }
);

/* =========================================
   MESSAGE RENDERING
========================================= */

function renderMessages() {
    messagesEl.innerHTML = "";

    if (state.messages.length === 0) {
        messagesEl.innerHTML = `
            <div id="welcome" class="welcome">
                <div class="welcome-icon">✦</div>
                <h1>BimalAI</h1>
                <p>Your personal AI assistant</p>

                <div class="suggestions">
                    <button data-prompt="Explain this concept to me simply.">
                        Explain something
                    </button>

                    <button data-prompt="Help me make a study plan.">
                        Create study plan
                    </button>

                    <button data-prompt="Help me write something professionally.">
                        Write something
                    </button>

                    <button data-prompt="Help me with coding.">
                        Help with coding
                    </button>
                </div>
            </div>
        `;

        document
            .querySelectorAll(
                ".suggestions button"
            )
            .forEach((button) => {
                button.addEventListener(
                    "click",
                    () => {
                        messageInput.value =
                            button.dataset.prompt ||
                            "";

                        messageInput.focus();
                        autoResize();
                    }
                );
            });

        return;
    }

    for (const message of state.messages) {
        addMessageElement(message);
    }

    scrollToBottom();
}

function addMessageElement(message) {
    const wrapper =
        document.createElement("div");

    wrapper.className =
        `message ${
            message.role === "user"
                ? "user"
                : "assistant"
        }`;

    const avatar =
        message.role === "user"
            ? "B"
            : "✦";

    wrapper.innerHTML = `
        <div class="message-avatar">
            ${avatar}
        </div>

        <div class="message-body">
            <div class="message-role">
                ${
                    message.role === "user"
                        ? "Bimal"
                        : "BimalAI"
                }
            </div>

            <div class="message-content">
                ${
                    message.role === "assistant"
                        ? simpleMarkdown(
                            message.content
                        )
                        : escapeHTML(
                            message.content
                        ).replace(
                            /\n/g,
                            "<br>"
                        )
                }
            </div>
        </div>
    `;

    messagesEl.appendChild(wrapper);

    return wrapper.querySelector(
        ".message-content"
    );
}

/* =========================================
   FILE UPLOAD
========================================= */

attachBtn.addEventListener(
    "click",
    () => fileInput.click()
);

fileInput.addEventListener(
    "change",
    () => {
        state.files =
            Array.from(
                fileInput.files || []
            );

        renderFilePreview();
    }
);

function renderFilePreview() {
    if (state.files.length === 0) {
        filePreview.classList.add("hidden");
        filePreview.innerHTML = "";
        return;
    }

    filePreview.classList.remove("hidden");

    filePreview.innerHTML =
        state.files
            .map(
                (file) => `
                    <span class="file-chip">
                        📎
                        ${escapeHTML(file.name)}
                    </span>
                `
            )
            .join("");
}

async function uploadFiles() {
    if (state.files.length === 0) {
        return [];
    }

    const formData =
        new FormData();

    for (const file of state.files) {
        formData.append(
            "files",
            file
        );
    }

    const response =
        await fetch(
            "/api/upload",
            {
                method: "POST",
                credentials: "include",
                body: formData
            }
        );

    const data =
        await response.json();

    if (!response.ok) {
        throw new Error(
            data.error ||
            "File upload failed"
        );
    }

    state.files = [];
    fileInput.value = "";
    renderFilePreview();

    return data.files || [];
}

/* =========================================
   FILE GENERATION
========================================= */

async function generateBimalAIFile(
    type,
    filename,
    content
) {
    const response =
        await fetch(
            "/api/generate",
            {
                method: "POST",
                headers: {
                    "Content-Type":
                        "application/json"
                },
                credentials: "include",
                body: JSON.stringify({
                    type,
                    filename,
                    content
                })
            }
        );

    const data =
        await response.json();

    if (!response.ok || !data.success) {
        throw new Error(
            data.error ||
            "File generation failed"
        );
    }

    const link =
        document.createElement("a");

    link.href = data.downloadUrl;
    link.download = data.filename;

    document.body.appendChild(link);
    link.click();
    link.remove();

    return data;
}

/* =========================================
   CHAT SEND
========================================= */

chatForm.addEventListener(
    "submit",
    async (event) => {
        event.preventDefault();
        await sendMessage();
    }
);

async function sendMessage() {
    const text =
        messageInput.value.trim();

    if (
        !text &&
        state.files.length === 0
    ) {
        return;
    }

    sendBtn.disabled = true;

    try {
        let uploadedFiles = [];

        if (state.files.length) {
            uploadedFiles =
                await uploadFiles();
        }

        let finalText = text;

        if (uploadedFiles.length) {
            const fileText =
                uploadedFiles
                    .map((file) => {
                        if (
                            file.type === "text"
                        ) {
                            return (
                                `[Attached file: ${file.name}]\n` +
                                `${file.content}`
                            );
                        }

                        if (
                            file.type === "image"
                        ) {
                            return (
                                `[Attached image: ${file.name}]`
                            );
                        }

                        return (
                            `[Attached file: ${file.name}]\n` +
                            `${file.content || ""}`
                        );
                    })
                    .join("\n");

            finalText =
                `${text || "Please analyze the attached files."}\n\n${fileText}`;
        }

        if (!finalText) {
            return;
        }

        if (state.messages.length === 0) {
            const chat =
                state.chats.find(
                    (item) =>
                        String(item.id) ===
                        String(
                            state.currentChatId
                        )
                );

            if (chat) {
                chat.title =
                    text.slice(0, 60) ||
                    "New conversation";

                chatTitleEl.textContent =
                    chat.title;
            }
        }

        const userMessage = {
            role: "user",
            content: finalText
        };

        state.messages.push(userMessage);

        renderMessages();

        messageInput.value = "";
        autoResize();

        const assistantMessage = {
            role: "assistant",
            content: ""
        };

        state.messages.push(
            assistantMessage
        );

        const assistantContent =
            addMessageElement(
                assistantMessage
            );

        scrollToBottom();

        const response =
            await fetch(
                "/api/chat",
                {
                    method: "POST",
                    headers: {
                        "Content-Type":
                            "application/json"
                    },
                    credentials: "include",
                    body: JSON.stringify({
                        messages:
                            state.messages
                                .filter(
                                    (message) =>
                                        message.content
                                )
                                .slice(0, -1),

                        model:
                            state.model ||
                            modelSelect.value ||
                            "openrouter/free",

                        mode:
                            state.mode ||
                            modeSelect.value ||
                            ""
                    })
                }
            );

        if (!response.ok) {
            let errorMessage =
                "AI request failed";

            try {
                const data =
                    await response.json();

                errorMessage =
                    data.error ||
                    errorMessage;

            } catch {}

            assistantMessage.content =
                `❌ ${errorMessage}`;

            assistantContent.innerHTML =
                simpleMarkdown(
                    assistantMessage.content
                );

            return;
        }

        if (!response.body) {
            throw new Error(
                "No AI response received"
            );
        }

        const reader =
            response.body.getReader();

        const decoder =
            new TextDecoder();

        let buffer = "";

        while (true) {
            const {
                value,
                done
            } = await reader.read();

            if (done) {
                break;
            }

            buffer +=
                decoder.decode(
                    value,
                    {
                        stream: true
                    }
                );

            const lines =
                buffer.split("\n");

            buffer =
                lines.pop() || "";

            for (const line of lines) {
                const trimmed =
                    line.trim();

                if (
                    !trimmed ||
                    trimmed ===
                        "data: [DONE]"
                ) {
                    continue;
                }

                if (
                    !trimmed.startsWith(
                        "data:"
                    )
                ) {
                    continue;
                }

                const jsonText =
                    trimmed
                        .slice(5)
                        .trim();

                try {
                    const data =
                        JSON.parse(
                            jsonText
                        );

                    const delta =
                        data
                            .choices?.[0]
                            ?.delta?.content;

                    if (delta) {
                        assistantMessage.content +=
                            delta;

                        assistantContent.innerHTML =
                            simpleMarkdown(
                                assistantMessage.content
                            );

                        scrollToBottom();
                    }

                } catch {
                    /* Ignore incomplete SSE chunks */
                }
            }
        }

        /* =========================================
           AUTOMATIC FILE GENERATION
        ========================================= */

        const pdfRequested =
            /\b(pdf|downloadable pdf|generate pdf|create pdf|make pdf)\b/i
                .test(text);

        const docxRequested =
            /\b(docx|word document|word file|generate word|create word)\b/i
                .test(text);

        const xlsxRequested =
            /\b(xlsx|excel|spreadsheet|excel file|create spreadsheet)\b/i
                .test(text);

        const pptxRequested =
            /\b(pptx|powerpoint|presentation|ppt)\b/i
                .test(text);

        if (assistantMessage.content.trim()) {
            try {
                if (pdfRequested) {
                    console.log(
                        "BimalAI: Generating PDF..."
                    );

                    await generateBimalAIFile(
                        "pdf",
                        "BimalAI-PDF",
                        assistantMessage.content
                    );

                    assistantMessage.content +=
                        "\n\n📄 PDF generated and downloaded successfully.";
                }

                else if (docxRequested) {
                    console.log(
                        "BimalAI: Generating DOCX..."
                    );

                    await generateBimalAIFile(
                        "docx",
                        "BimalAI-Document",
                        assistantMessage.content
                    );

                    assistantMessage.content +=
                        "\n\n📄 DOCX generated and downloaded successfully.";
                }

                else if (xlsxRequested) {
                    console.log(
                        "BimalAI: Generating XLSX..."
                    );

                    await generateBimalAIFile(
                        "xlsx",
                        "BimalAI-Spreadsheet",
                        assistantMessage.content
                    );

                    assistantMessage.content +=
                        "\n\n📊 XLSX generated and downloaded successfully.";
                }

                else if (pptxRequested) {
                    console.log(
                        "BimalAI: Generating PPTX..."
                    );

                    await generateBimalAIFile(
                        "pptx",
                        "BimalAI-Presentation",
                        assistantMessage.content
                    );

                    assistantMessage.content +=
                        "\n\n📊 PPTX generated and downloaded successfully.";
                }

                assistantContent.innerHTML =
                    simpleMarkdown(
                        assistantMessage.content
                    );

                scrollToBottom();

            } catch (fileError) {
                console.error(
                    "FILE GENERATION ERROR:",
                    fileError
                );

                assistantMessage.content +=
                    `\n\n⚠️ File generation failed: ${
                        fileError.message ||
                        "Unknown error."
                    }`;

                assistantContent.innerHTML =
                    simpleMarkdown(
                        assistantMessage.content
                    );
            }
        }

        await saveCurrentChat();

    } catch (error) {
        console.error(
            "SEND ERROR:",
            error
        );

        const last =
            state.messages[
                state.messages.length - 1
            ];

        if (
            last &&
            last.role === "assistant"
        ) {
            last.content =
                `❌ ${
                    error.message ||
                    "Something went wrong."
                }`;

            renderMessages();
        }

    } finally {
        sendBtn.disabled = false;
        messageInput.focus();
    }
}

/* =========================================
   TEXTAREA
========================================= */

messageInput.addEventListener(
    "input",
    autoResize
);

messageInput.addEventListener(
    "keydown",
    (event) => {
        if (
            event.key === "Enter" &&
            !event.shiftKey
        ) {
            event.preventDefault();
            sendMessage();
        }
    }
);

function autoResize() {
    messageInput.style.height = "auto";

    messageInput.style.height =
        Math.min(
            messageInput.scrollHeight,
            180
        ) + "px";
}

/* =========================================
   START
========================================= */

checkAuth();
