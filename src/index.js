const TELEGRAM_API = "https://api.telegram.org";
const TRUE_API = "https://apiv2.thetruetrade.io";

const SYMBOLS = {
BTC: "BTCUSDT",
ETH: "ETHUSDT"
};

const TIMEFRAMES = {
"1": 60,
"5": 300,
"15": 900,
"30": 1800,
"60": 3600,
"240": 14400,
"D": 86400
};

function normalize(text) {
return String(text || "")
.replace(/[۰-۹]/g, d => "۰۱۲۳۴۵۶۷۸۹".indexOf(d))
.replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d))
.toLowerCase()
.trim();
}

function response(data, status = 200) {
return new Response(data, {
status,
headers: { "Content-Type": "text/plain; charset=utf-8" }
});
}

async function telegram(method, env, body) {
const r = await fetch(
`${TELEGRAM_API}/bot${env.TELEGRAM_BOT_TOKEN}/${method}`,
{
method: "POST",
headers: { "Content-Type": "application/json" },
body: JSON.stringify(body)
}
);

if (!r.ok) {
throw new Error(`Telegram error ${r.status}`);
}

return r.json();
}

async function send(chatId, text, env) {
return telegram("sendMessage", env, {
chat_id: chatId,
text,
disable_web_page_preview: true
});
}

function getTimeframe(text) {
const s = normalize(text);

if (/1\s*دقیقه|1\s*min|1m\b/.test(s)) return "1";
if (/5\s*دقیقه|5\s*min|5m\b/.test(s)) return "5";
if (/15\s*دقیقه|15\s*min|15m\b/.test(s)) return "15";
if (/30\s*دقیقه|30\s*min|30m\b/.test(s)) return "30";
if (/1\s*ساعت|یک\s*ساعت|1h\b/.test(s)) return "60";
if (/4\s*ساعت|چهار\s*ساعت|4h\b/.test(s)) return "240";
if (/روزانه|روز|daily|1d\b/.test(s)) return "D";

return null;
}

function getAssets(text) {
const s = normalize(text);

const btc = /بیت.?کوین|bitcoin|\bbtc\b/.test(s);
const eth = /اتریوم|ethereum|\beth\b/.test(s);

if (btc && eth) return ["BTC", "ETH"];
if (btc) return ["BTC"];
if (eth) return ["ETH"];

if (/بازار|هر دو|همه ارز|وضعیت کلی/.test(s)) {
return ["BTC", "ETH"];
}

return [];
}

function isDetail(text) {
return /جزئیات|تحلیل کامل|اندیکاتور|توضیح بیشتر/.test(text);
}

function isAnalysis(text) {
return /تحلیل|بررسی|وضعیت|بازار|سیگنال|لانگ|شورت|long|short|بیت|اتریوم|btc|eth/.test(text);
}

async function getCandles(symbol, resolution) {
const seconds = TIMEFRAMES[resolution];

if (!seconds) {
throw new Error("تایم‌فریم پشتیبانی نمی‌شود.");
}

const now = Math.floor(Date.now() / 1000);
const from = now - seconds * 500;

const url = new URL(`${TRUE_API}/futures/udf/history`);

url.searchParams.set("symbol", symbol);
url.searchParams.set("from", String(from));
url.searchParams.set("to", String(now));
url.searchParams.set("countback", "500");
url.searchParams.set("resolution", resolution);

const r = await fetch(url.toString());

if (!r.ok) {
throw new Error(`خطای دریافت کندل: ${r.status}`);
}

const data = await r.json();

if (
data.s !== "ok" ||
!Array.isArray(data.t) ||
!Array.isArray(data.o) ||
!Array.isArray(data.h) ||
!Array.isArray(data.l) ||
!Array.isArray(data.c)
) {
throw new Error("ساختار پاسخ کندل معتبر نیست.");
}

const candles = data.t.map((time, i) => ({
time: Number(time),
open: Number(data.o[i]),
high: Number(data.h[i]),
low: Number(data.l[i]),
close: Number(data.c[i]),
volume: Number(data.v?.[i] || 0)
}));

const valid = candles.filter(c =>
Number.isFinite(c.close) &&
Number.isFinite(c.open) &&
Number.isFinite(c.high) &&
Number.isFinite(c.low)
);

if (valid.length < 60) {
throw new Error("تعداد کندل‌های دریافتی کافی نیست.");
}

return valid;
}

function emaSeries(values, period) {
const k = 2 / (period + 1);
const result = [];
let current = values[0];

result.push(current);

for (let i = 1; i < values.length; i++) {
current = values[i] * k + current * (1 - k);
result.push(current);
}

return result;
}

function calculateRSI(values, period = 14) {
let gain = 0;
let loss = 0;

for (let i = 1; i <= period; i++) {
const change = values[i] - values[i - 1];

if (change > 0) gain += change;
else loss -= change;
}

let avgGain = gain / period;
let avgLoss = loss / period;

for (let i = period + 1; i < values.length; i++) {
const change = values[i] - values[i - 1];

avgGain = (avgGain * (period - 1) + Math.max(change, 0)) / period;
avgLoss = (avgLoss * (period - 1) + Math.max(-change, 0)) / period;
}

if (avgLoss === 0) return 100;

return 100 - 100 / (1 + avgGain / avgLoss);
}

function calculateMACD(values) {
const fast = emaSeries(values, 12);
const slow = emaSeries(values, 26);

const line = values.map((_, i) => fast[i] - slow[i]);
const signal = emaSeries(line, 9);

return {
line: line[line.length - 1],
signal: signal[signal.length - 1],
previous: line[line.length - 2] - signal[line.length - 2]
};
}

function calculateATR(candles, period = 14) {
const trs = [];

for (let i = 1; i < candles.length; i++) {
const current = candles[i];
const previous = candles[i - 1].close;

trs.push(Math.max(
current.high - current.low,
Math.abs(current.high - previous),
Math.abs(current.low - previous)
));
}

let value = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;

for (let i = period; i < trs.length; i++) {
value = (value * (period - 1) + trs[i]) / period;
}

return value;
}

function analyze(candles) {
const closes = candles.map(c => c.close);
const price = closes[closes.length - 1];

const ema20 = emaSeries(closes, 20).at(-1);
const ema50 = emaSeries(closes, 50).at(-1);
const rsi = calculateRSI(closes);
const macd = calculateMACD(closes);
const atr = calculateATR(candles);

const recent = candles.slice(-20);
const previous = candles.slice(-40, -20);

const recentHigh = Math.max(...recent.map(c => c.high));
const recentLow = Math.min(...recent.map(c => c.low));

const previousHigh = Math.max(...previous.map(c => c.high));
const previousLow = Math.min(...previous.map(c => c.low));

const signals = [
{
name: "EMA",
direction: ema20 > ema50 ? 1 : ema20 < ema50 ? -1 : 0
},
{
name: "RSI",
direction: rsi >= 55 ? 1 : rsi <= 45 ? -1 : 0
},
{
name: "MACD",
direction:
macd.line > macd.signal && macd.line > 0 ? 1 :
macd.line < macd.signal && macd.line < 0 ? -1 : 0
},
{
name: "ساختار قیمت",
direction:
recentHigh > previousHigh && recentLow > previousLow ? 1 :
recentHigh < previousHigh && recentLow < previousLow ? -1 : 0
}
];

const bullish = signals.filter(x => x.direction === 1).length;
const bearish = signals.filter(x => x.direction === -1).length;
const neutral = signals.filter(x => x.direction === 0).length;

let direction = "NO TRADE";

if (bullish >= 3 && bearish === 0) direction = "LONG";
if (bearish >= 3 && bullish === 0) direction = "SHORT";

const total = signals.length;

const upPercent = Math.round(bullish / total * 100);
const downPercent = Math.round(bearish / total * 100);
const neutralPercent = Math.round(neutral / total * 100);

let sl = null;
let targets = [];

if (direction === "LONG") {
sl = price - atr * 1.5;
const risk = price - sl;
targets = [1, 2, 3, 4].map(n => price + risk * n);
}

if (direction === "SHORT") {
sl = price + atr * 1.5;
const risk = sl - price;
targets = [1, 2, 3, 4].map(n => price - risk * n);
}

return {
price,
ema20,
ema50,
rsi,
macd,
atr,
recentHigh,
recentLow,
signals,
bullish,
bearish,
neutral,
upPercent,
downPercent,
neutralPercent,
direction,
sl,
targets
};
}

async function getContracts() {
const r = await fetch(`${TRUE_API}/futures/coinmarketcap/contracts`);

if (!r.ok) return [];

const data = await r.json();

if (Array.isArray(data)) return data;
if (Array.isArray(data.data)) return data.data;
if (Array.isArray(data.contracts)) return data.contracts;

return [];
}

function findContract(contracts, symbol) {
return contracts.find(item =>
String(item.ticker_id || "").toUpperCase() === `${symbol}-PERP` ||
String(item.ticker_id || "").toUpperCase() === symbol
);
}

function format(value) {
if (value === null || value === undefined || !Number.isFinite(Number(value))) {
return "ناموجود";
}

return Number(value).toLocaleString("en-US", {
maximumFractionDigits: 4
});
}

function makeBar(label, percent) {
const filled = Math.round(percent / 10);
return `${label}: ${"█".repeat(filled)}${"░".repeat(10 - filled)} ${percent}%`;
}

function mainReport(name, timeframe, result, contract) {
const direction =
result.direction === "LONG" ? "🟢 LONG" :
result.direction === "SHORT" ? "🔴 SHORT" :
"⚪ NO TRADE";

let text = `📊 تحلیل ${name} | TrueTrade

⏱ تایم‌فریم: ${timeframe}
💰 قیمت: ${format(result.price)}

وضعیت: ${direction}

📈 نمودار همگرایی تحلیل‌ها

${makeBar("صعودی", result.upPercent)}
${makeBar("خنثی", result.neutralPercent)}
${makeBar("نزولی", result.downPercent)}

توافق صعودی: ${result.bullish}
توافق نزولی: ${result.bearish}
خنثی: ${result.neutral}`;

if (contract) {
text += `

💵 Funding Rate: ${format(contract.funding_rate)}
📊 Open Interest: ${format(contract.open_interest)}
حجم: ${format(contract.base_volume)}`;
}

if (result.direction !== "NO TRADE") {
text += `

🎯 محدوده ورود: ${format(result.price - result.atr * 0.2)} تا ${format(result.price + result.atr * 0.2)}
🛑 حد ضرر: ${format(result.sl)}

TP1: ${format(result.targets[0])} | خروج ۲۰٪
TP2: ${format(result.targets[1])} | خروج ۳۰٪
TP3: ${format(result.targets[2])} | خروج ۳۰٪
TP4: ${format(result.targets[3])} | خروج ۲۰٪

مدیریت معامله:
• بعد از TP1، بررسی انتقال حد ضرر به نقطه ورود
• در صورت تغییر ساختار بازار، بازنگری معامله
• در صورت رسیدن قیمت به حد ضرر، خروج`;
} else {
text += `

⛔ شرایط ورود مناسب نیست.
فعلاً معامله‌ای پیشنهاد نمی‌شود.`;
}

text += `

⚠️ درصدها قدرت شواهد هستند، نه احتمال قطعی سود.
برای جزئیات اندیکاتورها بنویس: جزئیات ${name} ${timeframe}`;

return text;
}

function detailReport(name, timeframe, a) {
return `🔬 جزئیات تحلیل ${name}

⏱ تایم‌فریم: ${timeframe}

EMA 20: ${format(a.ema20)}
EMA 50: ${format(a.ema50)}

RSI 14: ${format(a.rsi)}
MACD: ${format(a.macd.line)}
MACD Signal: ${format(a.macd.signal)}

ATR 14: ${format(a.atr)}

سقف ۲۰ کندل: ${format(a.recentHigh)}
کف ۲۰ کندل: ${format(a.recentLow)}

نتیجه روش‌ها:
صعودی: ${a.bullish}
نزولی: ${a.bearish}
خنثی: ${a.neutral}

این نسخه شامل تحلیل اولیه روند و اندیکاتورهاست.
تحلیل پیشرفته فیبوناچی، الیوت، اسمارت‌مانی، Order Book و CVD هنوز پیاده‌سازی نشده است.`;
}

async function processMessage(message, env) {
const chatId = message.chat.id;
const originalText = message.text || "";
const text = normalize(originalText);

if (!text) return;

if (text.startsWith("/start")) {
await send(chatId,
`سلام! من Traid هستم.

می‌توانی طبیعی با من صحبت کنی.

مثال:
تحلیل بیت‌کوین در ۱۵ دقیقه
وضعیت اتریوم در یک ساعت
تحلیل بازار در ۴ ساعت

من فقط تحلیل می‌کنم و سفارش معاملاتی ثبت نمی‌کنم.`,
env
);
return;
}

if (text.startsWith("/help")) {
await send(chatId,
"نام ارز و تایم‌فریم را در پیام بنویس.\nمثال: تحلیل بیت‌کوین در ۱۵ دقیقه",
env
);
return;
}

if (!isAnalysis(originalText) && !isDetail(originalText)) {
await send(chatId,
"برای شروع بگو کدام ارز را در چه تایم‌فریمی تحلیل کنم.",
env
);
return;
}

const timeframe = getTimeframe(originalText);

if (!timeframe) {
await send(chatId,
"تحلیل را در چه تایم‌فریمی می‌خواهی؟\n۱، ۵، ۱۵، ۳۰ دقیقه، یک ساعت، چهار ساعت یا روزانه؟",
env
);
return;
}

const assets = getAssets(originalText);

if (!assets.length) {
await send(chatId,
"کدام ارز را تحلیل کنم؟ بیت‌کوین یا اتریوم؟",
env
);
return;
}

const timeframeLabel = {
"1": "۱ دقیقه",
"5": "۵ دقیقه",
"15": "۱۵ دقیقه",
"30": "۳۰ دقیقه",
"60": "۱ ساعت",
"240": "۴ ساعت",
"D": "روزانه"
}[timeframe];

await send(chatId, "در حال دریافت اطلاعات از TrueTrade و تحلیل بازار...", env);

let contracts = [];

try {
contracts = await getContracts();
} catch {
contracts = [];
}

for (const asset of assets) {
try {
const symbol = SYMBOLS[asset];
const candles = await getCandles(symbol, timeframe);
const result = analyze(candles);
const contract = findContract(contracts, symbol);

const name = asset === "BTC" ? "بیت‌کوین" : "اتریوم";

const report = isDetail(originalText)
? detailReport(name, timeframeLabel, result)
: mainReport(name, timeframeLabel, result, contract);

await send(chatId, report, env);
} catch (error) {
await send(chatId,
`❌ خطا در تحلیل ${asset}\n${error.message}`,
env
);
}
}
}

export default {
async fetch(request, env) {
const url = new URL(request.url);

if (url.pathname === "/" && request.method === "GET") {
return response("Traid is running");
}

if (url.pathname !== "/telegram" || request.method !== "POST") {
return response("Not found", 404);
}

if (
env.WEBHOOK_SECRET &&
request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.WEBHOOK_SECRET
) {
return response("Unauthorized", 401);
}

let update;

try {
update = await request.json();
} catch {
return response("Bad request", 400);
}

if (update.message) {
try {
await processMessage(update.message, env);
} catch (error) {
console.error("Bot error:", error);
}
}

return response("OK");
}
};
