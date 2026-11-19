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
.reduce((sum, value) => sum + value, 0);

// ===============================
// BASIC
// ===============================

function normalize(text) {
return String(text || "")
.replace(/[۰-۹]/g, d => "0123456789"["۰۱۲۳۴۵۶۷۸۹".indexOf(d)])
.replace(/[٠-٩]/g, d => "0123456789"["٠١٢٣٤٥٦٧٨٩".indexOf(d)])
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

const result = await r.json();

if (!r.ok || !result.ok) {
throw new Error(result.description || `Telegram error ${r.status}`);
}

return result;
}

async function send(chatId, text, env, keyboard = null) {
const body = {
chat_id: chatId,
text,
disable_web_page_preview: true
};

if (keyboard) body.reply_markup = keyboard;

return telegram("sendMessage", env, body);
}

function format(value) {
if (value === null || value === undefined || !Number.isFinite(Number(value))) {
return "ناموجود";
}

return Number(value).toLocaleString("en-US", {
maximumFractionDigits: 4
});
}

// ===============================
// TELEGRAM MENUS
// ===============================

function mainKeyboard() {
return {
inline_keyboard: [
[
{ text: "₿ تحلیل بیت‌کوین", callback_data: "asset:BTC" },
{ text: "Ξ تحلیل اتریوم", callback_data: "asset:ETH" }
],
[
{ text: "📊 تحلیل هر دو ارز", callback_data: "asset:ALL" }
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
...buttons.map(([label, tf]) => [{
text: label,
callback_data: `tf:${asset}:${tf}`
}]),
[{ text: "🏠 منوی اصلی", callback_data: "menu" }]
]
};
}

function resultKeyboard(asset, timeframe, detail = false) {
const keyboard = [];

keyboard.push([
detail
? { text: "📊 گزارش اصلی", callback_data: `again:${asset}:${timeframe}` }
: { text: "🔍 جزئیات تحلیل", callback_data: `detail:${asset}:${timeframe}` }
]);

keyboard.push([
{ text: "🔄 تغییر تایم‌فریم", callback_data: `asset:${asset}` },
{ text: "🏠 منوی اصلی", callback_data: "menu" }
]);

return { inline_keyboard: keyboard };
}

// ===============================
// INPUT
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
return /جزئیات|تحلیل کامل|اندیکاتور|توضیح بیشتر/.test(normalize(text));
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

if (!seconds) throw new Error("تایم‌فریم پشتیبانی نمی‌شود.");

const now = Math.floor(Date.now() / 1000);
const url = new URL(`${TRUE_API}/futures/udf/history`);

url.searchParams.set("symbol", symbol);
url.searchParams.set("from", String(now - seconds * 500));
url.searchParams.set("to", String(now));
url.searchParams.set("countback", "500");
url.searchParams.set("resolution", resolution);

const r = await fetch(url.toString());

if (!r.ok) throw new Error(`خطای دریافت کندل: ${r.status}`);

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
Number.isFinite(c.open) &&
Number.isFinite(c.high) &&
Number.isFinite(c.low) &&
Number.isFinite(c.close) &&
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

// تمام محاسبات اصلی فقط با کندل بسته‌شده انجام می‌شوند.
function getClosedCandles(candles, timeframe) {
const seconds = TIMEFRAMES[timeframe];
if (!seconds) return [];

const now = Math.floor(Date.now() / 1000);

return candles.filter(c => c.time + seconds <= now);
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
if (values.length <= period) return 50;

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

avgGain = (avgGain * (period - 1) + Math.max(change, 0)) / period;
avgLoss = (avgLoss * (period - 1) + Math.max(-change, 0)) / period;
}

if (avgGain === 0 && avgLoss === 0) return 50;
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

let value = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;

for (let i = period; i < trs.length; i++) {
value = (value * (period - 1) + trs[i]) / period;
}

return value;
}

function addSignal(signals, name, direction, weight, note) {
signals.push({ name, direction, weight, note });
}

// ===============================
// MARKET STRUCTURE
// ===============================

function pivots(candles, left = 2, right = 2) {
const highs = [];
const lows = [];

for (let i = left; i < candles.length - right; i++) {
let isHigh = true;
let isLow = true;

for (let j = i - left; j <= i + right; j++) {
if (j === i) continue;
if (candles[j].high >= candles[i].high) isHigh = false;
if (candles[j].low <= candles[i].low) isLow = false;
}

if (isHigh) highs.push({ index: i, price: candles[i].high });
if (isLow) lows.push({ index: i, price: candles[i].low });
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
text: "ساختار نامشخص",
highs,
lows,
lastHigh: null,
lastLow: null
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

if (price > h1) {
direction = 1;
text = "شکست سقف اخیر";
} else if (price < l1) {
direction = -1;
text = "شکست کف اخیر";
}

return {
direction,
text,
highs,
lows,
lastHigh: h1,
lastLow: l1
};
}

// ===============================
// FIBONACCI
// ===============================

// نزدیکی به سطح فیبوناچی به‌تنهایی رأی صعودی یا نزولی نمی‌دهد.
// رأی فقط با واکنش کندل بسته‌شده در همان محدوده صادر می‌شود.
function analyzeFib(candles, price, atr) {
const recent = candles.slice(-100);
const high = Math.max(...recent.map(c => c.high));
const low = Math.min(...recent.map(c => c.low));
const range = high - low;

if (!Number.isFinite(range) || range <= 0) {
return {
direction: 0,
levels: [],
note: "سطوح معتبر نیستند",
nearest: null
};
}

const levels = [0.236, 0.382, 0.5, 0.618, 0.786].map(level => ({
level,
price: high - range * level
}));

let nearest = levels[0];

for (const item of levels) {
if (Math.abs(item.price - price) < Math.abs(nearest.price - price)) {
nearest = item;
}
}

const distance = Math.abs(nearest.price - price);
const last = candles.at(-1);
const previous = candles.at(-2);

let direction = 0;

if (distance <= Math.max(atr * 0.15, range * 0.012)) {
if (last.close > last.open && last.close > previous.close) {
direction = 1;
} else if (last.close < last.open && last.close < previous.close) {
direction = -1;
}
}

return {
direction,
levels,
high,
low,
nearest,
note: direction === 0
? `نزدیک سطح ${(nearest.level * 100).toFixed(1)}٪؛ واکنش جهت‌دار تأیید نشد`
: `واکنش ${direction === 1 ? "صعودی" : "نزولی"} نزدیک فیبوناچی ${(nearest.level * 100).toFixed(1)}٪`
};
}

// ===============================
// VOLUME
// ===============================

function analyzeVolume(candles) {
if (candles.length < 31) {
return { direction: 0, available: false, ratio: null };
}

const recent = candles.slice(-10);
const previous = candles.slice(-30, -10);

const average = arr =>
arr.reduce((sum, c) => sum + c.volume, 0) / arr.length;

const recentVol = average(recent);
const previousVol = average(previous);

if (
recentVol <= 0 ||
previousVol <= 0 ||
!Number.isFinite(recentVol) ||
!Number.isFinite(previousVol)
) {
return { direction: 0, available: false, ratio: null };
}

const upVolume = recent.reduce(
(sum, c) => sum + (c.close > c.open ? c.volume : 0),
0
);

const downVolume = recent.reduce(
(sum, c) => sum + (c.close < c.open ? c.volume : 0),
0
);

const ratio = recentVol / previousVol;

let direction = 0;

if (ratio > 1.15 && upVolume > downVolume * 1.2) direction = 1;
if (ratio > 1.15 && downVolume > upVolume * 1.2) direction = -1;

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
: Number(item.quantity ?? item.amount ?? item.size ?? item[1]);

return sum + (
Number.isFinite(quantity) && quantity > 0 ? quantity : 0
);
}, 0);
}

async function getOrderBook(symbol) {
try {
const url = `${TRUE_API}/futures/coinmarketcap/orderbook/${symbol}`;
const r = await fetch(url);

if (!r.ok) return null;

const raw = await r.json();
const data = raw.data || raw.result || raw;

const bids = parseBookSide(data.bids || data.buy);
const asks = parseBookSide(data.asks || data.sell);

if (bids <= 0 || asks <= 0) return null;

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
// CONDITIONAL ENTRY
// ===============================

function buildEntryPlan(candles, timeframe) {
const closed = getClosedCandles(candles, timeframe);

if (closed.length < 50) return null;

const confirmationCandle = closed.at(-1);
const referenceCandles = closed.slice(-21, -1);

if (referenceCandles.length !== 20) return null;

const previousHigh = Math.max(...referenceCandles.map(c => c.high));
const previousLow = Math.min(...referenceCandles.map(c => c.low));
const atr = calculateATR(closed);

if (!Number.isFinite(atr) || atr <= 0) return null;

const buffer = Math.max(
atr * 0.05,
confirmationCandle.close * 0.0001
);

const longLevel = previousHigh + buffer;
const shortLevel = previousLow - buffer;

const closes = closed.map(c => c.close);
const macd = calculateMACD(closes);
const volume = analyzeVolume(closed);

const longPriceConfirmed = confirmationCandle.close > longLevel;
const shortPriceConfirmed = confirmationCandle.close < shortLevel;

const longMacdConfirmed =
macd.histogram > 0 &&
macd.histogram > macd.previousHistogram;

const shortMacdConfirmed =
macd.histogram < 0 &&
macd.histogram < macd.previousHistogram;

const longVolumeConfirmed =
volume.available && volume.direction === 1;

const shortVolumeConfirmed =
volume.available && volume.direction === -1;

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
longConfirmed:
longPriceConfirmed && longMacdConfirmed && longVolumeConfirmed,
shortConfirmed:
shortPriceConfirmed && shortMacdConfirmed && shortVolumeConfirmed,
volumeAvailable: volume.available,
volumeRatio: volume.ratio
};
}

// ===============================
// TRADE PLAN
// ===============================

// حد ضرر و اهداف فقط پس از تأیید ورود هم‌جهت با تحلیل کلی ساخته می‌شوند.
function buildTradePlan(direction, entryPlan, atr, structure, recentHigh, recentLow) {
if (!entryPlan || atr <= 0) return null;

const isLong = direction === "LONG";
const confirmed = isLong
? entryPlan.longConfirmed
: entryPlan.shortConfirmed;

if (!confirmed) return null;

const entry = entryPlan.close;

let stop;

if (isLong) {
const structuralStop = structure.lastLow ?? recentLow;
stop = Math.min(entry - atr * 1.5, structuralStop - atr * 0.1);
} else {
const structuralStop = structure.lastHigh ?? recentHigh;
stop = Math.max(entry + atr * 1.5, structuralStop + atr * 0.1);
}

const risk = Math.abs(entry - stop);

if (!Number.isFinite(risk) || risk <= 0) return null;

const multipliers = [1, 1.8, 2.7, 3.7, 5];
const exits = [15, 20, 20, 20, 25];

const targets = multipliers.map(n =>
isLong ? entry + risk * n : entry - risk * n
);

return { entry, stop, targets, exits, risk };
}

// ===============================
// ANALYSIS ENGINE
// ===============================

function analyze(candles, orderBook, timeframe) {
const closed = getClosedCandles(candles, timeframe);

if (closed.length < 100) {
throw new Error("تعداد کندل‌های بسته‌شده کافی نیست.");
}

const closes = closed.map(c => c.close);
const price = closes.at(-1);

const ema20 = emaSeries(closes, 20).at(-1);
const ema50 = emaSeries(closes, 50).at(-1);
const rsi = calculateRSI(closes);
const macd = calculateMACD(closes);
const atr = calculateATR(closed);

const recent = closed.slice(-20);
const recentHigh = Math.max(...recent.map(c => c.high));
const recentLow = Math.min(...recent.map(c => c.low));

const structure = analyzeStructure(closed, price);
const fib = analyzeFib(closed, price, atr);
const volume = analyzeVolume(closed);
const entryPlan = buildEntryPlan(candles, timeframe);

const signals = [];

addSignal(
signals,
"EMA",
ema20 > ema50 && price > ema20 ? 1 :
ema20 < ema50 && price < ema20 ? -1 : 0,
WEIGHTS.EMA,
"روند میانگین‌ها"
);

addSignal(
signals,
"RSI",
rsi >= 55 ? 1 : rsi <= 45 ? -1 : 0,
WEIGHTS.RSI,
"مومنتوم RSI"
);

addSignal(
signals,
"MACD",
macd.histogram > 0 && macd.histogram > macd.previousHistogram ? 1 :
macd.histogram < 0 && macd.histogram < macd.previousHistogram ? -1 : 0,
WEIGHTS.MACD,
"جهت و شتاب هیستوگرام"
);

addSignal(signals, "Fibonacci", fib.direction, WEIGHTS.FIB, fib.note);

addSignal(
signals,
"Market Structure",
structure.direction,
WEIGHTS.STRUCTURE,
structure.text
);

// بررسی شکار نقدینگی روی آخرین کندل بسته‌شده
const last = closed.at(-1);
const prior = closed.slice(-21, -1);
const priorHigh = Math.max(...prior.map(c => c.high));
const priorLow = Math.min(...prior.map(c => c.low));

let smcDirection = 0;
let smcText = "شکار نقدینگی تأیید نشد";

if (last.low < priorLow && last.close > priorLow) {
smcDirection = 1;
smcText = "جمع‌آوری نقدینگی زیر کف و بازگشت قیمت";
} else if (last.high > priorHigh && last.close < priorHigh) {
smcDirection = -1;
smcText = "جمع‌آوری نقدینگی بالای سقف و بازگشت قیمت";
}

addSignal(signals, "SMC", smcDirection, WEIGHTS.SMC, smcText);

if (volume.available) {
addSignal(
signals,
"Volume",
volume.direction,
WEIGHTS.VOLUME,
`نسبت حجم: ${format(volume.ratio)} برابر`
);
}

if (orderBook) {
addSignal(
signals,
"Order Book",
orderBook.direction,
WEIGHTS.ORDERBOOK,
`نسبت خرید به فروش: ${format(orderBook.ratio)}`
);
}

const supportDistance = Math.abs(price - recentLow);
const resistanceDistance = Math.abs(recentHigh - price);

let supportDirection = 0;

if (atr > 0 && supportDistance < atr * 0.3 && structure.direction >= 0) {
supportDirection = 1;
} else if (atr > 0 && resistanceDistance < atr * 0.3 && structure.direction <= 0) {
supportDirection = -1;
}

addSignal(
signals,
"Support/Resistance",
supportDirection,
WEIGHTS.SUPPORT,
"موقعیت قیمت نسبت به سقف و کف ۲۰ کندل"
);

const totalWeight = signals.reduce((sum, s) => sum + s.weight, 0);

const upWeight = signals
.filter(s => s.direction === 1)
.reduce((sum, s) => sum + s.weight, 0);

const downWeight = signals
.filter(s => s.direction === -1)
.reduce((sum, s) => sum + s.weight, 0);

const neutralWeight = signals
.filter(s => s.direction === 0)
.reduce((sum, s) => sum + s.weight, 0);

const upPercent = totalWeight ? Math.round(upWeight / totalWeight * 100) : 0;
const downPercent = totalWeight ? Math.round(downWeight / totalWeight * 100) : 0;
const neutralPercent = Math.max(0, 100 - upPercent - downPercent);

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
const volatilityRatio = price > 0 ? atr / price : 0;

const atrStatus =
atr > 0 && volatilityRatio < 0.01
? "نوسان در محدوده قابل بررسی"
: "نوسان بالا یا شرایط نامناسب";

// تأیید ورود باید هم با جهت کلی بازار هم‌جهت باشد.
let entryConfirmed = false;

if (direction === "LONG" && entryPlan?.longConfirmed) {
entryConfirmed = true;
}

if (direction === "SHORT" && entryPlan?.shortConfirmed) {
entryConfirmed = true;
}

const tradePlan = entryConfirmed
? buildTradePlan(
direction,
entryPlan,
atr,
structure,
recentHigh,
recentLow
)
: null;

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
entryConfirmed: Boolean(entryConfirmed && tradePlan),
tradePlan
};
}

// ===============================
// REPORT HELPERS
// ===============================

function directionText(direction) {
if (direction === "LONG") return "🟢 صعودی";
if (direction === "SHORT") return "🔴 نزولی";
return "⚪ نامشخص";
}

function entryStatusText(a) {
if (a.direction === "NO TRADE") {
return "⚪ جهت مشخصی با شرایط فعلی صادر نشده";
}

if (a.entryConfirmed) {
return a.direction === "LONG"
? "🟢 ورود LONG تأیید شده"
: "🔴 ورود SHORT تأیید شده";
}

return a.direction === "LONG"
? "🟡 تمایل صعودی؛ فعلاً منتظر تأیید ورود"
: "🟡 تمایل نزولی؛ فعلاً منتظر تأیید ورود";
}

function entryConditionsText(a) {
const p = a.entryPlan;

if (!p) {
return "داده کافی برای تعیین سطح شکست وجود ندارد.";
}

const isLong = a.direction === "LONG";
const isShort = a.direction === "SHORT";

if (!isLong && !isShort) {
return `سطح شکست صعودی: ${format(p.longLevel)}
سطح شکست نزولی: ${format(p.shortLevel)}

برای انتخاب جهت ورود، ابتدا باید جهت کلی بازار مشخص شود.`;
}

const priceOk = isLong ? p.longPriceConfirmed : p.shortPriceConfirmed;
const macdOk = isLong ? p.longMacdConfirmed : p.shortMacdConfirmed;
const volumeOk = isLong ? p.longVolumeConfirmed : p.shortVolumeConfirmed;
const level = isLong ? p.longLevel : p.shortLevel;

return `سطح فعال‌سازی ${isLong ? "LONG" : "SHORT"}: ${format(level)}
• بسته‌شدن کندل در سمت شکست: ${priceOk ? "✅" : "❌"}
• تأیید MACD: ${macdOk ? "✅" : "❌"}
• تأیید حجم: ${volumeOk ? "✅" : "❌"}`;
}

function tradePlanText(a) {
if (!a.entryConfirmed || !a.tradePlan) return "";

const p = a.tradePlan;

return `
📍 برنامه معامله تأییدشده
قیمت مبنا: ${format(p.entry)}
حد ضرر: ${format(p.stop)}
TP1: ${format(p.targets[0])} | ۱۵٪
TP2: ${format(p.targets[1])} | ۲۰٪
TP3: ${format(p.targets[2])} | ۲۰٪
TP4: ${format(p.targets[3])} | ۲۰٪
TP5: ${format(p.targets[4])} | ۲۵٪

حد ضرر و اهداف بر اساس قیمت کندل تأییدشده محاسبه شده‌اند.
ربات معامله را اجرا یا حد ضرر را زنده پایش نمی‌کند.`;
}

// ===============================
// MAIN REPORT
// ===============================

function mainReport(name, timeframe, a) {
const direction = a.direction === "LONG"
? "LONG"
: a.direction === "SHORT"
? "SHORT"
: "WAIT";

let report = `📊 ${name} | ${timeframe}

💰 قیمت: ${format(a.price)}
جهت بازار: ${directionText(direction)}
وضعیت ورود: ${entryStatusText(a)}

📈 شواهد تحلیل
صعودی: ${a.upPercent}٪ | نزولی: ${a.downPercent}٪ | خنثی: ${a.neutralPercent}٪
پوشش داده‌ها: ${a.coveragePercent}٪

🎯 بررسی ورود
${entryConditionsText(a)}`;

if (a.entryConfirmed) {
report += tradePlanText(a);
} else {
report += `

⛔ فعلاً وارد معامله نشو.
تا تأیید همه شروط ورود منتظر بمان.`;
}

report += `

⚠️ درصدها سهم شواهد هستند، نه احتمال سود.
⚠️ این ربات معامله را اجرا یا بازار را به‌صورت زنده پایش نمی‌کند.`;

return report;
}

// ===============================
// DETAIL REPORT
// ===============================

function detailReport(name, timeframe, a) {
const methodLines = a.signals.map(s =>
`${s.name}: ${
s.direction === 1 ? "صعودی" :
s.direction === -1 ? "نزولی" : "خنثی"
} | وزن ${s.weight}
${s.note}`
).join("\n\n");

const fibLines = a.fib.levels.length
? a.fib.levels.map(x =>
`${(x.level * 100).toFixed(1)}٪: ${format(x.price)}`
).join("\n")
: "سطوح معتبر موجود نیست";

let report = `🔬 جزئیات ${name}

⏱ تایم‌فریم: ${timeframe}
💰 قیمت آخرین کندل بسته‌شده: ${format(a.price)}

وضعیت: ${entryStatusText(a)}

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
${a.fib.note}

📊 ساختار بازار
${a.structure.text}

💧 حجم
${a.volume.available
? `نسبت حجم اخیر به قبل: ${format(a.volume.ratio)}`
: "داده حجم معتبر موجود نیست"}

📚 Order Book
${a.orderBook
? `نسبت خرید به فروش: ${format(a.orderBook.ratio)}`
: "داده معتبر دریافت نشد"}

📈 روش‌های تحلیل
${methodLines}

📊 جمع‌بندی شواهد
صعودی: ${a.upPercent}٪
نزولی: ${a.downPercent}٪
خنثی: ${a.neutralPercent}٪
وزن معتبر: ${a.totalWeight} از ${MAX_DIRECTIONAL_WEIGHT}
پوشش داده‌ها: ${a.coveragePercent}٪

📏 وضعیت نوسان
${a.atrStatus}

🎯 بررسی ورود
${entryConditionsText(a)}
${a.entryConfirmed ? tradePlanText(a) : "\n⛔ ورود تأیید نشده است؛ فعلاً معامله نکن."}

CVD واقعی پیاده‌سازی نشده است.
SMC فعلی بررسی ساده شکار نقدینگی است و مدل کامل SMC نیست.

⚠️ درصدها سهم شواهد هستند، نه احتمال قطعی سود.`;

return report;
}

// ===============================
// RUN ANALYSIS
// ===============================

async function runAnalysis(chatId, assets, timeframe, detail, env) {
await send(
chatId,
"⏳ در حال دریافت داده‌های TrueTrade و بررسی کندل‌های بسته‌شده...",
env
);

for (const asset of assets) {
try {
const symbol = SYMBOLS[asset];
const candles = await getCandles(symbol, timeframe);
const closed = getClosedCandles(candles, timeframe);

const orderBook = await getOrderBook(symbol);
const result = analyze(closed, orderBook, timeframe);

const name = ASSET_NAMES[asset];

const report = detail
? detailReport(name, LABELS[timeframe], result)
: mainReport(name, LABELS[timeframe], result);

await send(
chatId,
report,
env,
resultKeyboard(asset, timeframe, detail)
);
} catch (error) {
await send(
chatId,
`❌ خطا در تحلیل ${ASSET_NAMES[asset] || asset}
${error.message}`,
env,
mainKeyboard()
);
}
}
}

// ===============================
// PROCESS TEXT
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
await send(chatId, "کدام ارز را تحلیل کنم؟", env, mainKeyboard());
return;
}

if (!timeframe) {
const selectedAsset = assets.length === 2 ? "ALL" : assets[0];

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
// CALLBACKS
// ===============================

async function processCallback(query, env) {
const chatId = query.message?.chat?.id;
const data = query.data || "";

if (!chatId) return;

await telegram("answerCallbackQuery", env, {
callback_query_id: query.id
});

if (data === "menu") {
await send(chatId, "🤖 Traid\n\nکدام ارز را تحلیل کنم؟", env, mainKeyboard());
return;
}

const parts = data.split(":");
const action = parts[0];
const asset = parts[1];

if (action === "asset") {
if (!["BTC", "ETH", "ALL"].includes(asset)) return;

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
if (!["BTC", "ETH", "ALL"].includes(asset)) return;

const assets = asset === "ALL" ? ["BTC", "ETH"] : [asset];

await runAnalysis(chatId, assets, timeframe, false, env);
return;
}

if (action === "detail" || action === "again") {
if (!["BTC", "ETH"].includes(asset)) return;

await runAnalysis(
chatId,
[asset],
timeframe,
action === "detail",
env
);
}
}

// ===============================
// CLOUDFLARE WORKER
// ===============================

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

if (update.callback_query) {
try {
await processCallback(update.callback_query, env);
} catch (error) {
console.error("Callback error:", error);
}
}

return response("OK");
}
};
