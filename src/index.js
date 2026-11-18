const SYMBOLS = ["BTCUSDT", "ETHUSDT"];
const API = "https://fapi.binance.com";

const TP_PERCENT = {
tp1: "20%",
tp2: "30%",
tp3: "30%",
tp4: "20%"
};

const TIME_WARNING = 60 * 60 * 1000;
const TIME_EXIT = 90 * 60 * 1000;

export default {
async fetch(request, env, ctx) {
const url = new URL(request.url);

if (url.pathname === "/" || url.pathname === "/health") {
return Response.json({
status: "OK",
bot: "BTC ETH Scalp Alert"
});
}

if (url.pathname === "/setup") {
if (url.searchParams.get("key") !== env.SETUP_SECRET) {
return new Response("Unauthorized", { status: 401 });
}

const result = await telegram(env, "setWebhook", {
url: url.origin + "/telegram",
secret_token: env.WEBHOOK_SECRET
});

return Response.json(result);
}

if (url.pathname === "/telegram" && request.method === "POST") {


const update = await request.json();
try {
await handleUpdate(update, env);
return Response.json({ ok: true, handled: true });
} catch (error) {
console.error("HANDLE UPDATE ERROR:", error);
return Response.json({
ok: false,
error: String(error?.message || error)
}, { status: 500 });
}

return Response.json({ ok: true });
}

return new Response("Not found", { status: 404 });
},

async scheduled(event, env, ctx) {
ctx.waitUntil(autoScan(env));
ctx.waitUntil(monitorPositions(env));
}
};

/* TELEGRAM COMMANDS */

async function handleUpdate(update, env) {
const msg = update.message;

if (!msg || !msg.chat || !msg.text) return;

const id = String(msg.chat.id);
const parts = msg.text.trim().split(/\s+/);
const command = parts[0].split("@")[0].toLowerCase();
const args = parts.slice(1);

if (command === "/start") {
await env.BOT_STATE.put("chat:" + id, "on");

return send(env, id,
"ربات فعال شد.\n\n" +
"دستورات:\n" +
"/scan BTC\n" +
"/scan ETH\n" +
"/scan ALL\n" +
"/status\n" +
"/stop\n" +
"/positions\n\n" +
"ثبت معامله:\n" +
"/open BTC LONG 90000 89500\n\n" +
"تأیید تارگت:\n" +
"/done BTC TP1\n\n" +
"بستن معامله ثبت‌شده:\n" +
"/close BTC"
);
}

if (command === "/stop") {
await env.BOT_STATE.put("chat:" + id, "off");

return send(env, id,
"اسکن خودکار سیگنال متوقف شد.\n" +
"بررسی معاملات باز همچنان ادامه دارد."
);
}

if (command === "/status") {
const state = await env.BOT_STATE.get("chat:" + id);

return send(env, id,
"وضعیت ربات:\n" +
"اسکن خودکار: " + (state === "on" ? "فعال" : "متوقف") + "\n" +
"ارزها: BTC و ETH\n" +
"فاصله اسکن: ۵ دقیقه\n" +
"مدیریت معاملات باز: فعال"
);
}

if (command === "/scan") {
const arg = (args[0] || "ALL").toUpperCase();

let selected;

if (arg === "ALL") {
selected = SYMBOLS;
} else if (arg === "BTC" || arg === "BTCUSDT") {
selected = ["BTCUSDT"];
} else if (arg === "ETH" || arg === "ETHUSDT") {
selected = ["ETHUSDT"];
} else {
return send(env, id,
"فرمت صحیح:\n/scan BTC\n/scan ETH\n/scan ALL"
);
}

await send(env, id, "در حال بررسی بازار...");

for (const symbol of selected) {
try {
const result = await analyze(symbol);
await send(env, id, formatSignal(result));
} catch (error) {
await send(env, id,
symbol + ": خطا در دریافت اطلاعات بازار."
);
}
}

return;
}

if (command === "/open") {
return openPosition(args, env, id);
}

if (command === "/done") {
return confirmTarget(args, env, id);
}

if (command === "/positions") {
return showPositions(env, id);
}

if (command === "/close") {
return closePosition(args, env, id);
}
}

/* MARKET DATA */

async function getCandles(symbol, interval) {
const url =
API + "/fapi/v1/klines?symbol=" +
symbol + "&interval=" + interval + "&limit=100";

const response = await fetch(url);

if (!response.ok) {
throw new Error("Market data error");
}

const raw = await response.json();

return raw.map(x => ({
time: Number(x[0]),
open: Number(x[1]),
high: Number(x[2]),
low: Number(x[3]),
close: Number(x[4])
}));
}

function ema(values, period) {
if (values.length < period) {
throw new Error("Not enough candles");
}

const k = 2 / (period + 1);

let result =
values.slice(0, period).reduce((a, b) => a + b, 0) /
period;

for (let i = period; i < values.length; i++) {
result = values[i] * k + result * (1 - k);
}

return result;
}

function atr(data, period = 14) {
const ranges = [];

for (let i = 1; i < data.length; i++) {
const current = data[i];
const previous = data[i - 1];

ranges.push(Math.max(
current.high - current.low,
Math.abs(current.high - previous.close),
Math.abs(current.low - previous.close)
));
}

const recent = ranges.slice(-period);

return recent.reduce((a, b) => a + b, 0) /
recent.length;
}

/* SIGNAL ANALYSIS */

async function analyze(symbol) {
const [raw1, raw5, raw15] = await Promise.all([
getCandles(symbol, "1m"),
getCandles(symbol, "5m"),
getCandles(symbol, "15m")
]);

// Ignore the currently forming candle.
const m1 = raw1.slice(0, -1);
const m5 = raw5.slice(0, -1);
const m15 = raw15.slice(0, -1);

const close5 = m5.map(x => x.close);
const close15 = m15.map(x => x.close);

const up =
ema(close5, 20) > ema(close5, 50) &&
ema(close15, 20) > ema(close15, 50);

const down =
ema(close5, 20) < ema(close5, 50) &&
ema(close15, 20) < ema(close15, 50);

const last = m1[m1.length - 1];
const previousRange = m1.slice(-21, -1);

const previousHigh = Math.max(
...previousRange.map(x => x.high)
);

const previousLow = Math.min(
...previousRange.map(x => x.low)
);

let direction = null;

if (up && last.close > previousHigh) {
direction = "LONG";
}

if (down && last.close < previousLow) {
direction = "SHORT";
}

if (!direction) {
return {
symbol,
price: last.close,
trend: up ? "صعودی" : down ? "نزولی" : "خنثی",
signal: null
};
}

const entry = last.close;
const volatility = atr(m1);

const distance = Math.max(
volatility * 1.25,
entry * 0.0015
);

const stop = direction === "LONG"
? entry - distance
: entry + distance;

const risk = Math.abs(entry - stop);

const target = r =>
direction === "LONG"
? entry + risk * r
: entry - risk * r;

return {
symbol,
price: entry,
signal: {
direction,
entry,
stop,
tp1: target(1),
tp2: target(1.5),
tp3: target(2),
tp4: target(3),
candle: last.time
}
};
}

function formatSignal(result) {
if (!result.signal) {
return (
result.symbol + "\n" +
"قیمت: " + fmt(result.price) + "\n" +
"روند: " + result.trend + "\n" +
"در حال حاضر سیگنال ورود نداریم."
);
}

const s = result.signal;

return (
"سیگنال " + result.symbol + "\n\n" +
"جهت: " + s.direction + "\n" +
"ورود: " + fmt(s.entry) + "\n" +
"حد ضرر: " + fmt(s.stop) + "\n\n" +
"TP1: " + fmt(s.tp1) + " | خروج ۲۰٪\n" +
"TP2: " + fmt(s.tp2) + " | خروج ۳۰٪\n" +
"TP3: " + fmt(s.tp3) + " | خروج ۳۰٪\n" +
"TP4: " + fmt(s.tp4) + " | خروج ۲۰٪\n\n" +
"برای ثبت معامله:\n" +
"/open " +
(s.symbol === "BTCUSDT" ? "BTC" : "ETH") +
" " + s.direction + " " +
s.entry + " " + s.stop
);
}

/* AUTOMATIC SCAN */

async function autoScan(env) {
const chats = await env.BOT_STATE.list({
prefix: "chat:"
});

for (const item of chats.keys) {
const id = item.name.slice(5);

if (await env.BOT_STATE.get(item.name) !== "on") {
continue;
}

for (const symbol of SYMBOLS) {
try {
const result = await analyze(symbol);

if (!result.signal) continue;

const s = result.signal;

const key =
"signal:" + id + ":" +
symbol + ":" +
s.direction + ":" +
s.candle;

if (await env.BOT_STATE.get(key)) continue;

await env.BOT_STATE.put(
key,
"sent",
{ expirationTtl: 21600 }
);

await send(env, id, formatSignal(result));

} catch (error) {
// Continue with other symbols and users.
}
}
}
}

/* POSITION STORAGE */

function positionKey(id, symbol) {
return "position:" + id + ":" + symbol;
}

async function openPosition(args, env, id) {
if (args.length !== 4) {
return send(env, id,
"فرمت ثبت معامله:\n" +
"/open BTC LONG 90000 89500\n\n" +
"ترتیب: ارز، جهت، ورود، حد ضرر"
);
}

const coin = args[0].toUpperCase();
const symbol =
coin === "BTC" ? "BTCUSDT" :
coin === "ETH" ? "ETHUSDT" : null;

const direction = args[1].toUpperCase();
const entry = Number(args[2]);
const stop = Number(args[3]);

if (
!symbol ||
!["LONG", "SHORT"].includes(direction) ||
!Number.isFinite(entry) ||
!Number.isFinite(stop) ||
entry <= 0 ||
stop <= 0 ||
(direction === "LONG" && stop >= entry) ||
(direction === "SHORT" && stop <= entry)
) {
return send(env, id, "اطلاعات معامله معتبر نیست.");
}

const key = positionKey(id, symbol);

if (await env.BOT_STATE.get(key)) {
return send(env, id,
"برای این ارز معامله بازی ثبت شده است."
);
}

const risk = Math.abs(entry - stop);

const target = r =>
direction === "LONG"
? entry + risk * r
: entry - risk * r;

const position = {
symbol,
direction,
entry,
stop,
tp1: target(1),
tp2: target(1.5),
tp3: target(2),
tp4: target(3),
completed: [],
pending: null,
created: Date.now(),
warned60: false,
warned90: false,
stopAlerted: false
};

await env.BOT_STATE.put(
key,
JSON.stringify(position)
);

return send(env, id,
"معامله ثبت شد: " + symbol + "\n\n" +
"جهت: " + direction + "\n" +
"ورود: " + fmt(entry) + "\n" +
"حد ضرر: " + fmt(stop) + "\n\n" +
"TP1: " + fmt(position.tp1) + " | ۲۰٪\n" +
"TP2: " + fmt(position.tp2) + " | ۳۰٪\n" +
"TP3: " + fmt(position.tp3) + " | ۳۰٪\n" +
"TP4: " + fmt(position.tp4) + " | ۲۰٪"
);
}

/* MONITOR OPEN POSITIONS */

async function monitorPositions(env) {
const items = await env.BOT_STATE.list({
prefix: "position:"
});

for (const item of items.keys) {
try {
const raw = await env.BOT_STATE.get(item.name);
if (!raw) continue;

const p = JSON.parse(raw);

const rest = item.name.slice("position:".length);
const separator = rest.lastIndexOf(":");
const id = rest.slice(0, separator);

const response = await fetch(
API + "/fapi/v1/ticker/price?symbol=" + p.symbol
);

if (!response.ok) continue;

const ticker = await response.json();
const price = Number(ticker.price);

const stopHit =
p.direction === "LONG"
? price <= p.stop
: price >= p.stop;

if (stopHit && !p.stopAlerted) {
p.stopAlerted = true;

await send(env, id,
"⚠️ هشدار حد ضرر " + p.symbol + "\n" +
"قیمت فعلی: " + fmt(price) + "\n" +
"حد ضرر: " + fmt(p.stop) + "\n\n" +
"وضعیت معامله را بررسی کن.\n" +
"اگر خارج شدی، دستور /close را بفرست."
);

await env.BOT_STATE.put(
item.name,
JSON.stringify(p)
);

continue;
}

if (p.stopAlerted) continue;

const levels = ["tp1", "tp2", "tp3", "tp4"];

for (const level of levels) {
if (
p.completed.includes(level) ||
p.pending === level
) {
continue;
}

const target = p[level];

const reached =
p.direction === "LONG"
? price >= target
: price <= target;

if (reached) {
p.pending = level;

await env.BOT_STATE.put(
item.name,
JSON.stringify(p)
);

await send(env, id,
"🎯 تارگت " + level.toUpperCase() +
" در " + p.symbol + " لمس شد.\n\n" +
"قیمت فعلی: " + fmt(price) + "\n" +
"خروج پیشنهادی: " + TP_PERCENT[level] + "\n\n" +
"بعد از انجام خروج، تأیید کن:\n" +
"/done " +
(p.symbol === "BTCUSDT" ? "BTC" : "ETH") +
" " + level.toUpperCase()
);

break;
}
}

const elapsed = Date.now() - p.created;

if (elapsed >= TIME_WARNING && !p.warned60) {
p.warned60 = true;

await send(env, id,
"⏱ هشدار زمانی " + p.symbol + "\n" +
"۶۰ دقیقه از ورود گذشته است.\n" +
"قیمت فعلی: " + fmt(price) + "\n" +
"قدرت حرکت و وضعیت معامله را بررسی کن."
);
}

if (elapsed >= TIME_EXIT && !p.warned90) {
p.warned90 = true;

await send(env, id,
"⚠️ هشدار خروج زمانی " + p.symbol + "\n" +
"۹۰ دقیقه از ورود گذشته است.\n" +
"اگر معامله پیشرفت نکرده، خروج یا کاهش حجم را بررسی کن.\n" +
"قیمت فعلی: " + fmt(price)
);
}

await env.BOT_STATE.put(
item.name,
JSON.stringify(p)
);

} catch (error) {
// Continue monitoring other positions.
}
}
}

/* CONFIRM TARGET */

async function confirmTarget(args, env, id) {
if (args.length !== 2) {
return send(env, id, "فرمت:\n/done BTC TP1");
}

const coin = args[0].toUpperCase();
const symbol =
coin === "BTC" ? "BTCUSDT" :
coin === "ETH" ? "ETHUSDT" : null;

const level = args[1].toLowerCase();

if (
!symbol ||
!["tp1", "tp2", "tp3", "tp4"].includes(level)
) {
return send(env, id, "اطلاعات تأیید معتبر نیست.");
}

const key = positionKey(id, symbol);
const raw = await env.BOT_STATE.get(key);

if (!raw) {
return send(env, id, "معامله بازی ثبت نشده است.");
}

const p = JSON.parse(raw);

if (p.pending !== level) {
return send(env, id,
"این تارگت در انتظار تأیید نیست."
);
}

p.completed.push(level);
p.pending = null;

if (level === "tp1") {
p.stop = p.entry;
}

if (level === "tp4") {
await env.BOT_STATE.delete(key);

return send(env, id,
"TP4 تأیید شد.\nمعامله از فهرست معاملات باز حذف شد."
);
}

await env.BOT_STATE.put(
key,
JSON.stringify(p)
);

return send(env, id,
level.toUpperCase() + " تأیید شد.\n" +
(level === "tp1"
? "حد ضرر به نقطه ورود منتقل شد: " + fmt(p.entry) + "\n"
: "") +
"مدیریت معامله ادامه دارد."
);
}

/* SHOW OPEN POSITIONS */

async function showPositions(env, id) {
const output = [];

for (const symbol of SYMBOLS) {
const raw = await env.BOT_STATE.get(
positionKey(id, symbol)
);

if (!raw) continue;

const p = JSON.parse(raw);

output.push(
symbol + " " + p.direction + "\n" +
"ورود: " + fmt(p.entry) + "\n" +
"حد ضرر فعلی: " + fmt(p.stop) + "\n" +
"تارگت‌های تأییدشده: " +
(p.completed.join(", ") || "هیچ‌کدام")
);
}

return send(env, id,
output.length
? output.join("\n\n")
: "معامله بازی ثبت نشده است."
);
}

/* CLOSE POSITION RECORD */

async function closePosition(args, env, id) {
if (args.length !== 1) {
return send(env, id, "فرمت:\n/close BTC");
}

const coin = args[0].toUpperCase();
const symbol =
coin === "BTC" ? "BTCUSDT" :
coin === "ETH" ? "ETHUSDT" : null;

if (!symbol) {
return send(env, id, "فقط BTC یا ETH مجاز است.");
}

const key = positionKey(id, symbol);

if (!(await env.BOT_STATE.get(key))) {
return send(env, id, "معامله بازی ثبت نشده است.");
}

await env.BOT_STATE.delete(key);

return send(env, id,
"معامله " + symbol +
" از فهرست معاملات باز حذف شد."
);
}

/* TELEGRAM HELPERS */

async function send(env, id, message) {
return telegram(env, "sendMessage", {
chat_id: id,
text: message,
disable_web_page_preview: true
});
}

async function telegram(env, method, payload) {
const response = await fetch(
"https://api.telegram.org/bot" +
env.TELEGRAM_BOT_TOKEN + "/" + method,
{
method: "POST",
headers: {
"Content-Type": "application/json"
},
body: JSON.stringify(payload)
}
);

const result = await response.json();

if (!response.ok || !result.ok) {
throw new Error(
result.description || "Telegram error"
);
}

return result;
}

function fmt(number) {
return Number(number).toLocaleString("en-US", {
maximumFractionDigits: 6
});
}
