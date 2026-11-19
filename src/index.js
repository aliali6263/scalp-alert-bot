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

const WEIGHTS = {
EMA: 15,
RSI: 5,
MACD: 5,
FIB: 10,
STRUCTURE: 15,
SMC: 15,
VOLUME: 10,
ORDERBOOK: 10,
SUPPORT: 10
};

const MAX_DIRECTIONAL_WEIGHT = Object.values(WEIGHTS)
.reduce((sum, weight) => sum + weight, 0);

const LABELS = {
"1": "۱ دقیقه",
"5": "۵ دقیقه",
"15": "۱۵ دقیقه",
"30": "۳۰ دقیقه",
"60": "۱ ساعت",
"240": "۴ ساعت",
"D": "روزانه"
};

const ASSET_NAMES = {
BTC: "بیت‌کوین",
ETH: "اتریوم"
};

// ===============================
// BASIC FUNCTIONS
// ===============================

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
headers: {
"Content-Type": "text/plain; charset=utf-8"
}
});
}

async function telegram(method, env, body) {
const r = await fetch(
`${TELEGRAM_API}/bot${env.TELEGRAM_BOT_TOKEN}/${method}`,
{
method: "POST",
headers: {
"Content-Type": "application/json"
},
body: JSON.stringify(body)
}
);

const result = await r.json();

if (!r.ok || !result.ok) {
throw new Error(
result.description || `Telegram error ${r.status}`
);
}

return result;
}

async function send(chatId, text, env, keyboard = null) {
const body = {
chat_id: chatId,
text,
disable_web_page_preview: true
};

if (keyboard) {
body.reply_markup = keyboard;
}

return telegram("sendMessage", env, body);
}

// ===============================
// TELEGRAM MENUS
// ===============================

function mainKeyboard() {
return {
inline_keyboard: [
[
{
text: "₿ تحلیل بیت‌کوین",
callback_data: "asset:BTC"
},
{
text: "Ξ تحلیل اتریوم",
callback_data: "asset:ETH"
}
],
[
{
text: "📊 تحلیل هر دو ارز",
callback_data: "asset:ALL"
}
]
]
};
}

function timeframeKeyboard(asset) {
const buttons = [
["۱ دقیقه", "1"],
["۵ دقیقه", "5"],
["۱۵ دقیقه", "15"],
["۳۰ دقیقه", "30"],
["۱ ساعت", "60"],
["۴ ساعت", "240"],
["روزانه", "D"]
];

return {
inline_keyboard: [
...buttons.map(([label, timeframe]) => [
{
text: label,
callback_data: `tf:${asset}:${timeframe}`
}
]),
[
{
text: "🏠 منوی اصلی",
callback_data: "menu"
}
]
]
};
}

function resultKeyboard(asset, timeframe, detail = false) {
const keyboard = [];

if (!detail) {
keyboard.push([
{
text: "🔍 جزئیات تحلیل",
callback_data: `detail:${asset}:${timeframe}`
}
]);
} else {
keyboard.push([
{
text: "📊 گزارش اصلی",
callback_data: `again:${asset}:${timeframe}`
}
]);
}

keyboard.push([
{
text: "🔄 تغییر تایم‌فریم",
callback_data: `asset:${asset}`
},
{
text: "🏠 منوی اصلی",
callback_data: "menu"
}
]);

return {
inline_keyboard: keyboard
};
}

// ===============================
// INPUT PARSING
// ===============================

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
return /جزئیات|تحلیل کامل|اندیکاتور|توضیح بیشتر/.test(
normalize(text)
);
}

function isAnalysis(text) {
return /تحلیل|بررسی|وضعیت|بازار|سیگنال|لانگ|شورت|long|short|بیت|اتریوم|btc|eth/.test(
normalize(text)
);
}

// ===============================
// MARKET DATA
// ===============================

async function getCandles(symbol, resolution) {
const seconds = TIMEFRAMES[resolution];

if (!seconds) {
throw new Error("تایم‌فریم پشتیبانی نمی‌شود.");
}

const now = Math.floor(Date.now() / 1000);
const url = new URL(`${TRUE_API}/futures/udf/history`);

url.searchParams.set("symbol", symbol);
url.searchParams.set("from", String(now - seconds * 500));
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
})).filter(c =>
Number.isFinite(c.time) &&
Number.isFinite(c.close) &&
Number.isFinite(c.open) &&
Number.isFinite(c.high) &&
Number.isFinite(c.low) &&
c.high >= c.low &&
c.high >= c.open &&
c.high >= c.close &&
c.low <= c.open &&
c.low <= c.close
);

candles.sort((a, b) => a.time - b.time);

if (candles.length < 100) {
throw new Error("تعداد کندل‌های معتبر کافی نیست.");
}

return candles;
}

// ===============================
// INDICATORS
// ===============================

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

gain += Math.max(change, 0);
loss += Math.max(-change, 0);
}

let avgGain = gain / period;
let avgLoss = loss / period;

for (let i = period + 1; i < values.length; i++) {
const change = values[i] - values[i - 1];

avgGain =
(avgGain * (period - 1) + Math.max(change, 0)) / period;

avgLoss =
(avgLoss * (period - 1) + Math.max(-change, 0)) / period;
}

if (avgLoss === 0 && avgGain === 0) return 50;
if (avgLoss === 0) return 100;
if (avgGain === 0) return 0;

return 100 - 100 / (1 + avgGain / avgLoss);
}

function calculateMACD(values) {
const fast = emaSeries(values, 12);
const slow = emaSeries(values, 26);

const line = values.map((_, i) => fast[i] - slow[i]);
const signal = emaSeries(line, 9);

const last = line.length - 1;

return {
line: line[last],
signal: signal[last],
histogram: line[last] - signal[last],
previousHistogram: line[last - 1] - signal[last - 1]
};
}

function calculateATR(candles, period = 14) {
const trs = [];

for (let i = 1; i < candles.length; i++) {
const c = candles[i];
const previous = candles[i - 1].close;

trs.push(Math.max(
c.high - c.low,
Math.abs(c.high - previous),
Math.abs(c.low - previous)
));
}

if (trs.length < period) return 0;

let value =
trs.slice(0, period).reduce((a, b) => a + b, 0) / period;

for (let i = period; i < trs.length; i++) {
value =
(value * (period - 1) + trs[i]) / period;
}

return value;
}

function addSignal(signals, name, direction, weight, note) {
signals.push({
name,
direction,
weight,
note
});
}

// ===============================
// MARKET STRUCTURE
// ===============================

function pivots(candles, left = 2, right = 2) {
const highs = [];
const lows = [];

for (let i = left; i < candles.length - right; i++) {
let high = true;
let low = true;

for (let j = i - left; j <= i + right; j++) {
if (j === i) continue;

if (candles[j].high >= candles[i].high) {
high = false;
}

if (candles[j].low <= candles[i].low) {
low = false;
}
}

if (high) {
highs.push({
index: i,
price: candles[i].high
});
}

if (low) {
lows.push({
index: i,
price: candles[i].low
});
}
}

return { highs, lows };
}

function analyzeStructure(candles, price) {
const p = pivots(candles.slice(-100));

const highs = p.highs;
const lows = p.lows;

if (highs.length < 2 || lows.length < 2) {
return {
direction: 0,
text: "داده کافی نیست",
highs,
lows
};
}

const h1 = highs.at(-1).price;
const h0 = highs.at(-2).price;

const l1 = lows.at(-1).price;
const l0 = lows.at(-2).price;

let direction = 0;
let text = "ساختار نامشخص";

if (h1 > h0 && l1 > l0) {
direction = 1;
text = "سقف و کف بالاتر";
} else if (h1 < h0 && l1 < l0) {
direction = -1;
text = "سقف و کف پایین‌تر";
}

const lastHigh = h1;
const lastLow = l1;

if (price > lastHigh) {
direction = 1;
text = "شکست سقف اخیر (BOS صعودی)";
} else if (price < lastLow) {
direction = -1;
text = "شکست کف اخیر (BOS نزولی)";
}

return {
direction,
text,
highs,
lows,
lastHigh,
lastLow
};
}

// ===============================
// FIBONACCI
// ===============================

function analyzeFib(candles, price, trend) {
const recent = candles.slice(-100);

const high = Math.max(...recent.map(c => c.high));
const low = Math.min(...recent.map(c => c.low));

const range = high - low;

if (!Number.isFinite(range) || range <= 0) {
return {
direction: 0,
levels: [],
note: "سطوح فیبوناچی معتبر نیستند"
};
}

const levels = [0.236, 0.382, 0.5, 0.618, 0.786]
.map(level => ({
level,
price: high - range * level
}));

let nearest = levels[0];

for (const item of levels) {
if (
Math.abs(item.price - price) <
Math.abs(nearest.price - price)
) {
nearest = item;
}
}

const distance = Math.abs(nearest.price - price) / range;

let direction = 0;

if (distance < 0.035 && trend !== 0) {
direction = trend;
}

return {
direction,
levels,
high,
low,
nearest,
note: direction === 0
? "قیمت نزدیک سطح تعیین‌کننده نیست"
: `نزدیک فیبوناچی ${(nearest.level * 100).toFixed(1)}٪`
};
}

// ===============================
// VOLUME
// ===============================

function analyzeVolume(candles) {
const recent = candles.slice(-10);
const previous = candles.slice(-30, -10);

const avg = arr =>
arr.reduce((s, c) => s + c.volume, 0) /
Math.max(1, arr.length);

const recentVol = avg(recent);
const previousVol = avg(previous);

if (
recentVol <= 0 ||
previousVol <= 0 ||
!Number.isFinite(recentVol) ||
!Number.isFinite(previousVol)
) {
return {
direction: 0,
available: false,
ratio: null
};
}

const upVolume = recent.reduce(
(s, c) => s + (c.close > c.open ? c.volume : 0),
0
);

const downVolume = recent.reduce(
(s, c) => s + (c.close < c.open ? c.volume : 0),
0
);

const ratio = recentVol / previousVol;

let direction = 0;

if (ratio > 1.15 && upVolume > downVolume * 1.2) {
direction = 1;
}

if (ratio > 1.15 && downVolume > upVolume * 1.2) {
direction = -1;
}

return {
direction,
available: true,
ratio,
recentVol,
previousVol,
upVolume,
downVolume
};
}

// ===============================
// ORDER BOOK
// ===============================

function parseBookSide(side) {
if (!Array.isArray(side)) return 0;

return side.slice(0, 20).reduce((sum, item) => {
if (!item) return sum;

const quantity = Array.isArray(item)
? Number(item[1])
: Number(
item.quantity ??
item.amount ??
item.size ??
item[1]
);

return sum +
(Number.isFinite(quantity) && quantity > 0
? quantity
: 0);
}, 0);
}

async function getOrderBook(symbol) {
try {
const url =
`${TRUE_API}/futures/coinmarketcap/orderbook/${symbol}`;

const r = await fetch(url);

if (!r.ok) return null;

const raw = await r.json();
const data = raw.data || raw.result || raw;

const bids = parseBookSide(data.bids || data.buy);
const asks = parseBookSide(data.asks || data.sell);

if (
!Number.isFinite(bids) ||
!Number.isFinite(asks) ||
bids <= 0 ||
asks <= 0
) {
return null;
}

return {
bidVolume: bids,
askVolume: asks,
ratio: bids / asks,
direction: bids > asks * 1.2
? 1
: asks > bids * 1.2
? -1
: 0
};
} catch {
return null;
}
}

// ===============================
// CONDITIONAL ENTRY PLAN
// ===============================

// فقط کندل‌هایی که زمان بسته‌شدنشان گذشته است.
function getClosedCandles(candles, timeframe) {
const seconds = TIMEFRAMES[timeframe];

if (!seconds) return [];

const now = Math.floor(Date.now() / 1000);

return candles.filter(c =>
c.time + seconds <= now
);
}

function buildEntryPlan(candles, timeframe) {
const closed = getClosedCandles(candles, timeframe);

if (closed.length < 50) {
return null;
}

// آخرین کندل بسته‌شده، کندل بررسی تأیید است.
const confirmationCandle = closed.at(-1);

// ۲۰ کندل قبل از کندل تأیید برای تعیین سطح شکست.
const referenceCandles = closed.slice(-21, -1);

if (referenceCandles.length < 20) {
return null;
}

const previousHigh = Math.max(
...referenceCandles.map(c => c.high)
);

const previousLow = Math.min(
...referenceCandles.map(c => c.low)
);

const atr = calculateATR(closed);

if (!Number.isFinite(atr) || atr <= 0) {
return null;
}

// فاصله کوچک برای جلوگیری از شکست‌های بسیار جزئی.
const buffer = Math.max(
atr * 0.05,
confirmationCandle.close * 0.0001
);

const longLevel = previousHigh + buffer;
const shortLevel = previousLow - buffer;

const closes = closed.map(c => c.close);
const macd = calculateMACD(closes);
const volume = analyzeVolume(closed);

const longPriceConfirmed =
confirmationCandle.close > longLevel;

const shortPriceConfirmed =
confirmationCandle.close < shortLevel;

const longMacdConfirmed =
macd.histogram > 0 &&
macd.histogram > macd.previousHistogram;

const shortMacdConfirmed =
macd.histogram < 0 &&
macd.histogram < macd.previousHistogram;

const longVolumeConfirmed =
volume.available &&
volume.direction === 1;

const shortVolumeConfirmed =
volume.available &&
volume.direction === -1;

const longConfirmed =
longPriceConfirmed &&
longMacdConfirmed &&
longVolumeConfirmed;

const shortConfirmed =
shortPriceConfirmed &&
shortMacdConfirmed &&
shortVolumeConfirmed;

return {
longLevel,
shortLevel,
previousHigh,
previousLow,
close: confirmationCandle.close,
candleTime: confirmationCandle.time,
longPriceConfirmed,
shortPriceConfirmed,
longMacdConfirmed,
shortMacdConfirmed,
longVolumeConfirmed,
shortVolumeConfirmed,
longConfirmed,
shortConfirmed,
volumeAvailable: volume.available,
volumeRatio: volume.ratio,
macdHistogram: macd.histogram,
previousMacdHistogram: macd.previousHistogram
};
}

function entryPlanText(plan) {
if (!plan) {
return `🎯 ورود شرطی

⚠️ داده کافی از کندل‌های بسته‌شده برای تعیین سطح ورود وجود ندارد.`;
}

const longStatus = plan.longConfirmed
? "🟢 تأیید کامل شرایط LONG"
: plan.longPriceConfirmed
? "🟡 شکست قیمت انجام شده؛ تأییدهای دیگر کامل نیست"
: "⏳ هنوز منتظر شکست و بسته‌شدن کندل هستیم";

const shortStatus = plan.shortConfirmed
? "🔴 تأیید کامل شرایط SHORT"
: plan.shortPriceConfirmed
? "🟡 شکست قیمت انجام شده؛ تأییدهای دیگر کامل نیست"
: "⏳ هنوز منتظر شکست و بسته‌شدن کندل هستیم";

const longChecks = [
`• بسته‌شدن کندل بالای سطح: ${plan.longPriceConfirmed ? "✅" : "❌"}`,
`• تأیید MACD صعودی: ${plan.longMacdConfirmed ? "✅" : "❌"}`,
`• تأیید حجم خرید: ${plan.longVolumeConfirmed ? "✅" : "❌"}`
].join("\n");

const shortChecks = [
`• بسته‌شدن کندل زیر سطح: ${plan.shortPriceConfirmed ? "✅" : "❌"}`,
`• تأیید MACD نزولی: ${plan.shortMacdConfirmed ? "✅" : "❌"}`,
`• تأیید حجم فروش: ${plan.shortVolumeConfirmed ? "✅" : "❌"}`
].join("\n");

return `🎯 سطوح ورود شرطی

🟢 سناریوی LONG
قیمت فعال‌سازی: ${format(plan.longLevel)}
سطح شکست قبلی: ${format(plan.previousHigh)}
وضعیت: ${longStatus}

${longChecks}

🔴 سناریوی SHORT
قیمت فعال‌سازی: ${format(plan.shortLevel)}
سطح شکست قبلی: ${format(plan.previousLow)}
وضعیت: ${shortStatus}

${shortChecks}

📌 قوانین ورود:
۱. قیمت باید از سطح مشخص‌شده عبور کند.
۲. کندل تایم‌فریم انتخابی باید آن سوی سطح بسته شود.
۳. MACD باید جهت شکست را تأیید کند.
۴. حجم معاملات نیز باید همان جهت را تأیید کند.

${!plan.volumeAvailable
? "⚠️ داده حجم معتبر نیست؛ بنابراین شرط حجم تأیید نشده است."
: `نسبت حجم اخیر به قبل: ${format(plan.volumeRatio)} برابر`}

قیمت آخرین کندل بسته‌شده: ${format(plan.close)}

⚠️ اگر همه شروط تأیید نشوند، ورود انجام نده.`;
}

// ===============================
// COMMON ANALYSIS ENGINE
// ===============================

function analyze(candles, orderBook, timeframe) {
const closes = candles.map(c => c.close);
const price = closes.at(-1);

const ema20 = emaSeries(closes, 20).at(-1);
const ema50 = emaSeries(closes, 50).at(-1);

const rsi = calculateRSI(closes);
const macd = calculateMACD(closes);
const atr = calculateATR(candles);

const recent = candles.slice(-20);

const recentHigh = Math.max(...recent.map(c => c.high));
const recentLow = Math.min(...recent.map(c => c.low));

const structure = analyzeStructure(candles, price);
const fib = analyzeFib(candles, price, structure.direction);
const volume = analyzeVolume(candles);

const entryPlan = buildEntryPlan(candles, timeframe);

const signals = [];

// EMA

addSignal(
signals,
"EMA",
ema20 > ema50 && price > ema20
? 1
: ema20 < ema50 && price < ema20
? -1
: 0,
WEIGHTS.EMA,
"روند میانگین‌ها"
);

// RSI

addSignal(
signals,
"RSI",
rsi >= 55 ? 1 : rsi <= 45 ? -1 : 0,
WEIGHTS.RSI,
"مومنتوم RSI"
);

// MACD

addSignal(
signals,
"MACD",
macd.histogram > 0 &&
macd.histogram > macd.previousHistogram
? 1
: macd.histogram < 0 &&
macd.histogram < macd.previousHistogram
? -1
: 0,
WEIGHTS.MACD,
"شتاب MACD"
);

// Fibonacci

addSignal(
signals,
"Fibonacci",
fib.direction,
WEIGHTS.FIB,
fib.note
);

// Market Structure

addSignal(
signals,
"Market Structure",
structure.direction,
WEIGHTS.STRUCTURE,
structure.text
);

// SMC: شکار نقدینگی

const last = candles.at(-1);
const prior = candles.slice(-21, -1);

const priorHigh = Math.max(...prior.map(c => c.high));
const priorLow = Math.min(...prior.map(c => c.low));

let smcDirection = 0;
let smcText = "شکار نقدینگی تأیید نشد";

if (last.low < priorLow && last.close > priorLow) {
smcDirection = 1;
smcText = "احتمال جمع‌آوری نقدینگی زیر کف";
} else if (
last.high > priorHigh &&
last.close < priorHigh
) {
smcDirection = -1;
smcText = "احتمال جمع‌آوری نقدینگی بالای سقف";
}

addSignal(
signals,
"SMC",
smcDirection,
WEIGHTS.SMC,
smcText
);

// Volume

if (volume.available) {
addSignal(
signals,
"Volume",
volume.direction,
WEIGHTS.VOLUME,
`نسبت حجم: ${format(volume.ratio)} برابر`
);
}

// Order Book

if (orderBook) {
addSignal(
signals,
"Order Book",
orderBook.direction,
WEIGHTS.ORDERBOOK,
`نسبت خرید به فروش: ${format(orderBook.ratio)}`
);
}

// Support / Resistance

const supportDistance = Math.abs(price - recentLow);
const resistanceDistance = Math.abs(recentHigh - price);

let supportDirection = 0;

if (
supportDistance < atr * 0.3 &&
structure.direction >= 0
) {
supportDirection = 1;
} else if (
resistanceDistance < atr * 0.3 &&
structure.direction <= 0
) {
supportDirection = -1;
}

addSignal(
signals,
"Support/Resistance",
supportDirection,
WEIGHTS.SUPPORT,
"موقعیت نسبت به سقف و کف اخیر"
);

// ATR فقط فیلتر نوسان است.

const volatilityRatio = price > 0 ? atr / price : 0;

const atrStatus =
atr > 0 && volatilityRatio < 0.01
? "نوسان در محدوده قابل بررسی"
: "نوسان بالا یا شرایط نامناسب";

// WEIGHTED CALCULATION

const totalWeight = signals.reduce(
(sum, item) => sum + item.weight,
0
);

const upWeight = signals
.filter(item => item.direction === 1)
.reduce((sum, item) => sum + item.weight, 0);

const downWeight = signals
.filter(item => item.direction === -1)
.reduce((sum, item) => sum + item.weight, 0);

const neutralWeight = signals
.filter(item => item.direction === 0)
.reduce((sum, item) => sum + item.weight, 0);

const upPercent = totalWeight
? Math.round(upWeight / totalWeight * 100)
: 0;

const downPercent = totalWeight
? Math.round(downWeight / totalWeight * 100)
: 0;

const neutralPercent = Math.max(
0,
100 - upPercent - downPercent
);

const coveragePercent = Math.round(
totalWeight / MAX_DIRECTIONAL_WEIGHT * 100
);

let direction = "NO TRADE";

if (
signals.length >= 4 &&
coveragePercent >= 40 &&
upPercent >= 58 &&
upPercent - downPercent >= 18
) {
direction = "LONG";
} else if (
signals.length >= 4 &&
coveragePercent >= 40 &&
downPercent >= 58 &&
downPercent - upPercent >= 18
) {
direction = "SHORT";
}

const strength = Math.max(upPercent, downPercent);
const opposing = Math.min(upPercent, downPercent);

// TRADE MANAGEMENT

let sl = null;
let targets = [];
let exits = [];

if (direction !== "NO TRADE" && atr > 0) {
const bullish = direction === "LONG";

const swingStop = bullish
? Math.min(
recentLow,
structure.lastLow || recentLow
)
: Math.max(
recentHigh,
structure.lastHigh || recentHigh
);

const atrStop = bullish
? price - atr * 1.5
: price + atr * 1.5;

sl = bullish
? Math.min(atrStop, swingStop - atr * 0.1)
: Math.max(atrStop, swingStop + atr * 0.1);

const risk = Math.abs(price - sl);
const multipliers = [1, 1.8, 2.7, 3.7, 5];

targets = multipliers.map(n =>
bullish
? price + risk * n
: price - risk * n
);

if (strength >= 75 && opposing <= 10) {
exits = [10, 15, 20, 25, 30];
} else if (strength >= 65 && opposing <= 20) {
exits = [15, 20, 20, 20, 25];
} else {
exits = [25, 25, 20, 15, 15];
}
} else {
direction = "NO TRADE";
}

return {
price,
ema20,
ema50,
rsi,
macd,
atr,
atrStatus,
recentHigh,
recentLow,
structure,
fib,
volume,
orderBook,
entryPlan,
signals,
totalWeight,
upWeight,
downWeight,
neutralWeight,
upPercent,
downPercent,
neutralPercent,
coveragePercent,
direction,
strength,
opposing,
sl,
targets,
exits
};
}

// ===============================
// WAIT GUIDANCE
// ===============================

function waitGuidance(a) {
const neutral = a.signals.filter(s => s.direction === 0);

const longConditions = {
"EMA": "EMA20 بالاتر از EMA50 قرار بگیرد و قیمت بالای EMA20 تثبیت شود.",
"RSI": "RSI به ۵۵ یا بالاتر برسد.",
"MACD": "هیستوگرام MACD مثبت باشد و از مقدار کندل قبلی بیشتر شود.",
"Fibonacci": "قیمت به یکی از سطوح فیبوناچی نزدیک شود و ساختار بازار صعودی باشد.",
"Market Structure": "ساختار سقف و کف بالاتر یا شکست معتبر سقف اخیر شکل بگیرد.",
"SMC": "قیمت کف قبلی را بشکند و دوباره بالای آن بسته شود.",
"Volume": "نسبت حجم از ۱٫۱۵ بیشتر شود و حجم کندل‌های صعودی حداقل ۱٫۲ برابر حجم نزولی باشد.",
"Order Book": "حجم سفارش‌های خرید حداقل ۱٫۲ برابر سفارش‌های فروش شود.",
"Support/Resistance": "قیمت به کف ۲۰ کندل اخیر نزدیک شود و ساختار بازار نزولی نباشد."
};

const shortConditions = {
"EMA": "EMA20 پایین‌تر از EMA50 قرار بگیرد و قیمت زیر EMA20 تثبیت شود.",
"RSI": "RSI به ۴۵ یا پایین‌تر برسد.",
"MACD": "هیستوگرام MACD منفی باشد و از مقدار کندل قبلی کمتر شود.",
"Fibonacci": "قیمت به یکی از سطوح فیبوناچی نزدیک شود و ساختار بازار نزولی باشد.",
"Market Structure": "ساختار سقف و کف پایین‌تر یا شکست معتبر کف اخیر شکل بگیرد.",
"SMC": "قیمت سقف قبلی را بشکند و دوباره پایین‌تر از آن بسته شود.",
"Volume": "نسبت حجم از ۱٫۱۵ بیشتر شود و حجم کندل‌های نزولی حداقل ۱٫۲ برابر حجم صعودی باشد.",
"Order Book": "حجم سفارش‌های فروش حداقل ۱٫۲ برابر سفارش‌های خرید شود.",
"Support/Resistance": "قیمت به سقف ۲۰ کندل اخیر نزدیک شود و ساختار بازار صعودی نباشد."
};

const makeList = conditions => {
const available = neutral.filter(s => conditions[s.name]);

if (!available.length) {
return "روش خنثی قابل‌تبدیل مشخصی در داده‌های فعلی وجود ندارد.";
}

return available
.sort((x, y) => y.weight - x.weight)
.map(s => `• ${s.name} (وزن ${s.weight}): ${conditions[s.name]}`)
.join("\n");
};

const missingOrderBook = !a.orderBook;

return `🧭 شرایط خروج از WAIT

🟢 برای فعال‌شدن LONG:
${makeList(longConditions)}

🔴 برای فعال‌شدن SHORT:
${makeList(shortConditions)}

📌 شرط نهایی صدور سیگنال:
• سهم شواهد جهت موردنظر حداقل ۵۸٪ باشد.
• اختلاف شواهد آن جهت با جهت مخالف حداقل ۱۸ واحد درصد باشد.
• حداقل ۴ روش معتبر و پوشش وزن حداقل ۴۰٪ وجود داشته باشد.
• ATR معتبر باشد.

${missingOrderBook
? "⚠️ داده Order Book موجود نیست و در محاسبه رأی لحاظ نشده است."
: "Order Book در محاسبه لحاظ شده است."}

این شرایط باید در تحلیل بعدی تأیید شوند؛ صرف نزدیک‌شدن قیمت به یک سطح به‌تنهایی سیگنال ورود نیست.`;
}

// ===============================
// CONTRACTS / FUNDING / OI
// ===============================

async function getContracts() {
const r = await fetch(
`${TRUE_API}/futures/coinmarketcap/contracts`
);

if (!r.ok) return [];

const data = await r.json();

if (Array.isArray(data)) return data;
if (Array.isArray(data.data)) return data.data;
if (Array.isArray(data.contracts)) return data.contracts;

return [];
}

function findContract(contracts, symbol) {
return contracts.find(item => {
const ticker = String(
item.ticker_id || ""
).toUpperCase();

return (
ticker === `${symbol}-PERP` ||
ticker === symbol
);
});
}

// ===============================
// FORMATTING
// ===============================

function format(value) {
if (
value === null ||
value === undefined ||
!Number.isFinite(Number(value))
) {
return "ناموجود";
}

return Number(value).toLocaleString("en-US", {
maximumFractionDigits: 4
});
}

function makeBar(label, percent) {
const filled = Math.max(
0,
Math.min(10, Math.round(percent / 10))
);

return `${label}: ${"█".repeat(filled)}${"░".repeat(10 - filled)} ${percent}%`;
}

// ===============================
// MAIN REPORT
// ===============================

function mainReport(name, timeframe, a, contract) {
const direction =
a.direction === "LONG"
? "🟢 LONG"
: a.direction === "SHORT"
? "🔴 SHORT"
: "⚪ انتظار | NO TRADE";

let text = `📊 تحلیل ${name} | TrueTrade

⏱ تایم‌فریم: ${timeframe}
💰 قیمت: ${format(a.price)}

وضعیت: ${direction}

📈 همگرایی وزنی تحلیل‌ها

${makeBar("صعودی", a.upPercent)}
${makeBar("خنثی", a.neutralPercent)}
${makeBar("نزولی", a.downPercent)}

قدرت شواهد: ${a.strength}٪
پوشش وزن روش‌ها: ${a.coveragePercent}٪
روش‌های قابل محاسبه: ${a.signals.length} از ۹

${entryPlanText(a.entryPlan)}`;

if (contract) {
text += `

💵 Funding Rate: ${format(contract.funding_rate)}
📊 Open Interest: ${format(contract.open_interest)}
حجم بازار: ${format(contract.base_volume)}`;
}

if (a.direction !== "NO TRADE") {
const entryLow = a.direction === "LONG"
? a.price - a.atr * 0.2
: a.price - a.atr * 0.05;

const entryHigh = a.direction === "LONG"
? a.price + a.atr * 0.05
: a.price + a.atr * 0.2;

text += `

🎯 محدوده ورود بر اساس سیگنال کلی: ${format(entryLow)} تا ${format(entryHigh)}
🛑 حد ضرر: ${format(a.sl)}

📍 اهداف و تقسیم خروج پویا:
TP1: ${format(a.targets[0])} | ${a.exits[0]}٪
TP2: ${format(a.targets[1])} | ${a.exits[1]}٪
TP3: ${format(a.targets[2])} | ${a.exits[2]}٪
TP4: ${format(a.targets[3])} | ${a.exits[3]}٪
TP5: ${format(a.targets[4])} | ${a.exits[4]}٪

🧭 مدیریت معامله:
• درصدها سهم خروج از حجم اولیه‌اند.
• پس از هر هدف، ساختار و قدرت روند باید دوباره بررسی شود.
• انتقال حد ضرر به نقطه ورود فقط پس از تأیید شرایط انجام شود.
• شکست ساختار در خلاف جهت، هشدار خروج یا کاهش حجم است.
• حد ضرر کلوزی: بسته‌شدن کندل در آن سوی سطح SL؛ این ربات آن را زنده پایش نمی‌کند.`;
} else {
text += `

⛔ شواهد برای ورود کافی نیست.
فعلاً از ورود اجباری خودداری کن.

${waitGuidance(a)}`;
}

text += `

⚠️ درصدها سهم شواهد تحلیل‌اند، نه احتمال سود.
⚠️ سطح ورود شرطی با محدوده ورود سیگنال کلی متفاوت است.`;

return text;
}

// ===============================
// DETAIL REPORT
// ===============================

function detailReport(name, timeframe, a) {
const methodLines = a.signals.map(s =>
`${s.name}: ${
s.direction === 1
? "صعودی"
: s.direction === -1
? "نزولی"
: "خنثی"
} | وزن ${s.weight}٪
${s.note}`
).join("\n\n");

const fibLines = a.fib.levels.length
? a.fib.levels.map(x =>
`${(x.level * 100).toFixed(1)}٪: ${format(x.price)}`
).join("\n")
: "سطوح معتبر موجود نیست";

const direction =
a.direction === "LONG"
? "🟢 LONG"
: a.direction === "SHORT"
? "🔴 SHORT"
: "⚪ انتظار";

let report = `🔬 جزئیات تحلیل ${name}

⏱ تایم‌فریم: ${timeframe}
💰 قیمت: ${format(a.price)}
وضعیت نهایی: ${direction}

EMA 20: ${format(a.ema20)}
EMA 50: ${format(a.ema50)}
RSI 14: ${format(a.rsi)}
MACD: ${format(a.macd.line)}
MACD Signal: ${format(a.macd.signal)}
MACD Histogram: ${format(a.macd.histogram)}
ATR 14: ${format(a.atr)}

سقف ۲۰ کندل: ${format(a.recentHigh)}
کف ۲۰ کندل: ${format(a.recentLow)}

📐 فیبوناچی
${fibLines}
نزدیک‌ترین سطح: ${a.fib.note}

📊 ساختار بازار:
${a.structure.text}

💧 حجم:
${a.volume.available
? `نسبت حجم اخیر به قبل: ${format(a.volume.ratio)}`
: "داده حجم معتبر موجود نیست"}

📚 Order Book:
${a.orderBook
? `نسبت حجم خرید به فروش: ${format(a.orderBook.ratio)}`
: "داده معتبر دریافت نشد"}

📈 روش‌های تحلیل و سهم آن‌ها:
${methodLines}

📊 نتیجه وزنی مشترک:
صعودی: ${a.upPercent}٪
خنثی: ${a.neutralPercent}٪
نزولی: ${a.downPercent}٪

وزن معتبر محاسبه‌شده: ${a.totalWeight} از ${MAX_DIRECTIONAL_WEIGHT}
پوشش وزن روش‌ها: ${a.coveragePercent}٪

📏 فیلتر نوسان ATR:
${a.atrStatus}

ATR در تشخیص جهت رأی نمی‌دهد و فقط برای ارزیابی نوسان و مدیریت ریسک استفاده می‌شود.

${entryPlanText(a.entryPlan)}

CVD واقعی: هنوز پیاده‌سازی نشده است.
SMC فعلی بر اساس بررسی ساده شکار نقدینگی است و مدل کامل SMC نیست.`;

if (a.direction === "NO TRADE") {
report += `

${waitGuidance(a)}`;
}

report += `

⚠️ درصدها قدرت شواهد هستند، نه احتمال قطعی سود.`;

return report;
}

// ===============================
// RUN ANALYSIS
// ===============================

async function runAnalysis(chatId, assets, timeframe, detail, env) {
await send(
chatId,
"⏳ در حال دریافت داده‌های TrueTrade و تحلیل چندروشی...",
env
);

let contracts = [];

try {
contracts = await getContracts();
} catch {
contracts = [];
}

for (const asset of assets) {
try {
const symbol = SYMBOLS[asset];

const candles = await getCandles(
symbol,
timeframe
);

const orderBook = await getOrderBook(symbol);
const result = analyze(candles, orderBook, timeframe);

const contract = findContract(
contracts,
symbol
);

const name = ASSET_NAMES[asset];

const report = detail
? detailReport(name, LABELS[timeframe], result)
: mainReport(
name,
LABELS[timeframe],
result,
contract
);

await send(
chatId,
report,
env,
resultKeyboard(asset, timeframe, detail)
);

} catch (error) {
await send(
chatId,
`❌ خطا در تحلیل ${ASSET_NAMES[asset] || asset}\n${error.message}`,
env,
mainKeyboard()
);
}
}
}

// ===============================
// PROCESS TEXT MESSAGE
// ===============================

async function processMessage(message, env) {
const chatId = message.chat.id;
const originalText = message.text || "";
const text = normalize(originalText);

if (!text) return;

if (text.startsWith("/start")) {
await send(
chatId,
"سلام! من Traid هستم 🤖\n\nبرای شروع، ارز موردنظرت را انتخاب کن:",
env,
mainKeyboard()
);
return;
}

if (text.startsWith("/help")) {
await send(
chatId,
"از منوی زیر برای تحلیل استفاده کن:",
env,
mainKeyboard()
);
return;
}

if (!isAnalysis(originalText) && !isDetail(originalText)) {
await send(
chatId,
"برای شروع تحلیل، یکی از گزینه‌های زیر را انتخاب کن:",
env,
mainKeyboard()
);
return;
}

const assets = getAssets(originalText);
const timeframe = getTimeframe(originalText);

if (!assets.length) {
await send(
chatId,
"کدام ارز را تحلیل کنم؟",
env,
mainKeyboard()
);
return;
}

if (!timeframe) {
const selectedAsset =
assets.length === 2 ? "ALL" : assets[0];

await send(
chatId,
"⏱ تایم‌فریم تحلیل را انتخاب کن:",
env,
timeframeKeyboard(selectedAsset)
);
return;
}

await runAnalysis(
chatId,
assets,
timeframe,
isDetail(originalText),
env
);
}

// ===============================
// PROCESS BUTTON CLICKS
// ===============================

async function processCallback(query, env) {
const chatId = query.message?.chat?.id;
const data = query.data || "";

if (!chatId) return;

await telegram("answerCallbackQuery", env, {
callback_query_id: query.id
});

if (data === "menu") {
await send(
chatId,
"🤖 Traid\n\nکدام ارز را تحلیل کنم؟",
env,
mainKeyboard()
);
return;
}

const parts = data.split(":");

const action = parts[0];
const asset = parts[1];

if (action === "asset") {
if (!["BTC", "ETH", "ALL"].includes(asset)) {
return;
}

await send(
chatId,
"⏱ تایم‌فریم موردنظرت را انتخاب کن:",
env,
timeframeKeyboard(asset)
);
return;
}

const timeframe = parts[2];

if (!Object.prototype.hasOwnProperty.call(TIMEFRAMES, timeframe)) {
await send(
chatId,
"تایم‌فریم معتبر نیست. دوباره انتخاب کن.",
env,
mainKeyboard()
);
return;
}

if (action === "tf") {
if (!["BTC", "ETH", "ALL"].includes(asset)) {
return;
}

const assets = asset === "ALL"
? ["BTC", "ETH"]
: [asset];

await runAnalysis(
chatId,
assets,
timeframe,
false,
env
);

return;
}

if (action === "detail" || action === "again") {
if (!["BTC", "ETH"].includes(asset)) {
return;
}

await runAnalysis(
chatId,
[asset],
timeframe,
action === "detail",
env
);

return;
}
}

// ===============================
// CLOUDFLARE WORKER
// ===============================

export default {
async fetch(request, env) {
const url = new URL(request.url);

if (
url.pathname === "/" &&
request.method === "GET"
) {
return response("Traid is running");
}

if (
url.pathname !== "/telegram" ||
request.method !== "POST"
) {
return response("Not found", 404);
}

if (
env.WEBHOOK_SECRET &&
request.headers.get(
"X-Telegram-Bot-Api-Secret-Token"
) !== env.WEBHOOK_SECRET
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

if (update.callback_query) {
try {
await processCallback(
update.callback_query,
env
);
} catch (error) {
console.error("Callback error:", error);
}
}

return response("OK");
}
};
