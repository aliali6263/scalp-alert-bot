const TELEGRAM_API = "https://api.telegram.org";

async function sendMessage(token, chatId, text) {
const response = await fetch(
`${TELEGRAM_API}/bot${token}/sendMessage`,
{
method: "POST",
headers: {
"Content-Type": "application/json"
},
body: JSON.stringify({
chat_id: chatId,
text: text.slice(0, 3500)
})
}
);

const result = await response.json();

if (!response.ok || !result.ok) {
throw new Error(
`Telegram API ${response.status}: ${JSON.stringify(result)}`
);
}

return result;
}

export default {
async fetch(request, env) {
const url = new URL(request.url);

if (request.method === "GET" && url.pathname === "/") {
return Response.json({
ok: true,
message: "Telegram Bot is running"
});
}

if (request.method === "GET" && url.pathname === "/check-token") {
try {
const response = await fetch(
`${TELEGRAM_API}/bot${env.TELEGRAM_BOT_TOKEN}/getMe`
);

const result = await response.json();

return Response.json({
token_exists: !!env.TELEGRAM_BOT_TOKEN,
telegram_ok: result.ok,
bot_username: result.result?.username || null,
error: result.description || null
});
} catch (error) {
return Response.json({
token_exists: !!env.TELEGRAM_BOT_TOKEN,
error: error.message
}, { status: 500 });
}
}

if (request.method === "POST" && url.pathname === "/telegram") {
try {
if (!env.TELEGRAM_BOT_TOKEN) {
throw new Error("TELEGRAM_BOT_TOKEN is missing");
}

if (!env.WEBHOOK_SECRET) {
throw new Error("WEBHOOK_SECRET is missing");
}

const receivedSecret = request.headers.get(
"x-telegram-bot-api-secret-token"
);

if (receivedSecret !== env.WEBHOOK_SECRET) {
return Response.json(
{ ok: false, error: "Unauthorized" },
{ status: 401 }
);
}

const update = await request.json();
const message = update.message;

if (!message || !message.chat || !message.chat.id) {
return Response.json({ ok: true });
}

const chatId = message.chat.id;
const text = message.text;

if (typeof text !== "string") {
return Response.json({ ok: true });
}

let reply;

if (text.trim() === "/start") {
reply = "سلام! ربات فعاله. پیام شما دریافت شد.";
} else {
reply = "پیام شما دریافت شد:\n" + text;
}

await sendMessage(
env.TELEGRAM_BOT_TOKEN,
chatId,
reply
);

return Response.json({
ok: true,
handled: true
});

} catch (error) {
console.error(
"BOT ERROR:",
error.stack || error.message || String(error)
);

return Response.json(
{
ok: false,
error: error.message || String(error)
},
{ status: 500 }
);
}
}

return Response.json(
{ ok: false, error: "Not Found" },
{ status: 404 }
);
}
};

