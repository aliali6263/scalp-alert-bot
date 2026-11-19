const TELEGRAM_API = "https://api.telegram.org";
const TRUE_API = "https://apiv2.thetruetrade.io";

const SYMBOLS = {
BTC: "BTCUSDT",
ETH: "ETHUSDT"
};

const ASSET_NAMES = {
BTC: "بیت‌کوین",
ETH: "اتریوم"
};

const TIMEFRAMES = {
"1": 60,
"5": 300,
"15": 900
};

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

function percent(value) {
return `${Math.round(value)}%`;
}

function percentBar(value) {
const filled = Math.max(0, Math.min(10, Math.round(value / 10)));
return "█".repeat(filled) + "░".repeat(10 - filled);
}

function candleTimeText(time) {
if (!time) return "نامشخص";

return new Date(time * 1000)
.toISOString()
.replace("T", " ")
.slice(0, 16) + " UTC";
}

// ===============================
// TELEGRAM MENUS
// ===============================

function mainKeyboard() {
return {
inline_keyboard: [
[
{ text: "₿ تحلیل بیت‌کوین", callback_data: "scan:BTC" },
{ text: "Ξ تحلیل اتریوم", callback_data: "scan:ETH" }
],
[
{ text: "📊 تحلیل هر دو ارز", callback_data: "scan:ALL" }
]
]
};
}

function resultKeyboard(asset, detail = false) {
return {
inline_keyboard: [
[
detail
? { text: "📊 گزارش اصلی", callback_data: `again:${asset}` }
: { text: "🔍 جزئیات تحلیل", callback_data: `detail:${asset}` }
],
[
{ text: "🔄 تحلیل مجدد", callback_data: `scan:${asset}` },
{ text: "🏠 منوی اصلی", callback_data: "menu" }
]
]
};
}

// ===============================
// INPUT
// ===============================

function getAssets(text) {
const s = normalize(text);

const btc = /بیت.?کوین|bitcoin|\bbtc\b/.test(s);
const eth = /اتریوم|ethereum|\beth\b/.test(s);

if (btc && eth) return ["BTC", "ETH"];
if (btc) return ["BTC"];
if (eth) return ["ETH"];

if (/هر دو|همه ارزها|همه ارزها|همه بازار/.test(s)) {
return ["BTC", "ETH"];
}

return [];
}

function isDetail(text) {
return /جزئیات|تحلیل کامل|اندیکاتور|توضیح بیشتر/.test(normalize(text));
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
url.searchParams.set("from", String(now - seconds * 400));
url.searchParams.set("to", String(now));
url.searchParams.set("countback", "400");
url.searchParams.set("resolution", resolution);

const r = await fetch(url.toString());

if (!r.ok) {
throw new Error(`خطای دریافت کندل ${resolution}: ${r.status}`);
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
throw new Error(`ساختار داده تایم‌فریم ${resolution} معتبر نیست.`);
}

const candles = data.t.map((time, i) => {
let timestamp = Number(time);

// پشتیبانی از timestamp میلی‌ثانیه‌ای
if (timestamp > 1000000000000) {
timestamp = Math.floor(timestamp / 1000);
}

return {
time: timestamp,
open: Number(data.o[i]),
high: Number(data.h[i]),
low: Number(data.l[i]),
close: Number(data.c[i]),
volume: Number(data.v?.[i] || 0)
};
}).filter(c =>
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

const closed = getClosedCandles(candles, resolution);

if (closed.length < 100) {
throw new Error(
`کندل بسته‌شده کافی برای تایم‌فریم ${resolution} وجود ندارد.`
);
}

return closed;
}

function getClosedCandles(candles, timeframe) {
const seconds = TIMEFRAMES[timeframe];
const now = Math.floor(Date.now() / 1000);

return candles.filter(c => c.time + seconds <= now);
}

// ===============================
// INDICATORS
// ===============================

function emaSeries(values, period) {
if (!values.length) return [];

const k = 2 / (period + 1);
const result = [values[0]];

for (let i = 1; i < values.length; i++) {
result.push(
values[i] * k + result[i - 1] * (1 - k)
);
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

avgGain =
(avgGain * (period - 1) + Math.max(change, 0)) / period;

avgLoss =
(avgLoss * (period - 1) + Math.max(-change, 0)) / period;
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

let value =
trs.slice(0, period).reduce((a, b) => a + b, 0) / period;

for (let i = period; i < trs.length; i++) {
value = (value * (period - 1) + trs[i]) / period;
}

return value;
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

if (isHigh) {
highs.push({ index: i, price: candles[i].high });
}

if (isLow) {
lows.push({ index: i, price: candles[i].low });
}
}

return { highs, lows };
}

function analyzeStructure(candles) {
const recent = candles.slice(-100);
const p = pivots(recent);

const highs = p.highs;
const lows = p.lows;

if (highs.length < 2 || lows.length < 2) {
return {
direction: 0,
text: "ساختار نامشخص",
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

const last = candles.at(-1);

if (last.close > h1) {
direction = 1;
text = "شکست سقف اخیر";
} else if (last.close < l1) {
direction = -1;
text = "شکست کف اخیر";
}

return {
direction,
text,
lastHigh: h1,
lastLow: l1
};
}

// ===============================
// STAGE 1: 15 MINUTE TREND
// ===============================

function analyzeTrend(candles) {
const closes = candles.map(c => c.close);
const price = closes.at(-1);

const ema20 = emaSeries(closes, 20).at(-1);
const ema50 = emaSeries(closes, 50).at(-1);

const rsi = calculateRSI(closes);
const macd = calculateMACD(closes);
const structure = analyzeStructure(candles);

let score = 0;
const reasons = [];

if (ema20 > ema50) {
score++;
reasons.push("EMA20 بالاتر از EMA50");
} else if (ema20 < ema50) {
score--;
reasons.push("EMA20 پایین‌تر از EMA50");
}

if (price > ema20) {
score++;
reasons.push("قیمت بالای EMA20");
} else if (price < ema20) {
score--;
reasons.push("قیمت زیر EMA20");
}

if (structure.direction !== 0) {
score += structure.direction * 2;
reasons.push(structure.text);
}

if (rsi >= 55) {
score++;
reasons.push("RSI متمایل به صعود");
} else if (rsi <= 45) {
score--;
reasons.push("RSI متمایل به نزول");
}

if (macd.histogram > 0) {
score++;
reasons.push("هیستوگرام MACD مثبت");
} else if (macd.histogram < 0) {
score--;
reasons.push("هیستوگرام MACD منفی");
}

let direction = 0;

if (score >= 2) direction = 1;
if (score <= -2) direction = -1;

return {
direction,
score,
price,
ema20,
ema50,
rsi,
macd,
structure,
reasons
};
}

// ===============================
// VOLUME
// ===============================

function analyzeVolume(candles) {
if (candles.length < 31) {
return {
available: false,
ratio: null,
direction: 0
};
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
return {
available: false,
ratio: null,
direction: 0
};
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

if (ratio > 1.15 && upVolume > downVolume * 1.2) {
direction = 1;
}

if (ratio > 1.15 && downVolume > upVolume * 1.2) {
direction = -1;
}

return {
available: true,
ratio,
direction,
upVolume,
downVolume
};
}

// ===============================
// STAGE 2: 5 MINUTE OPPORTUNITY
// ===============================

function analyzeOpportunity(candles, trendDirection) {
const last = candles.at(-1);
const previous = candles.at(-2);
const previous2 = candles.at(-3);

const closes = candles.map(c => c.close);
const ema20Series = emaSeries(closes, 20);
const ema20 = ema20Series.at(-1);

const atr = calculateATR(candles);
const volume = analyzeVolume(candles);

if (atr <= 0) {
return {
direction: 0,
score: 0,
reasons: ["ATR معتبر نیست"],
atr,
ema20,
volume,
counterTrend: false
};
}

const reference = candles.slice(-21, -1);

const priorHigh = Math.max(...reference.map(c => c.high));
const priorLow = Math.min(...reference.map(c => c.low));

// سطوح شکست بدون احتساب کندل فعلی و کندل قبلی
const breakoutCandles = candles.slice(-12, -2);

const breakoutHigh = Math.max(
...breakoutCandles.map(c => c.high)
);

const breakoutLow = Math.min(
...breakoutCandles.map(c => c.low)
);

// 1. Liquidity Sweep

const bullishSweep =
last.low < priorLow &&
last.close > priorLow &&
last.close > last.open;

const bearishSweep =
last.high > priorHigh &&
last.close < priorHigh &&
last.close < last.open;

// 2. Break of Structure

const bullishBOS = last.close > breakoutHigh;
const bearishBOS = last.close < breakoutLow;

// 3. EMA Pullback

const nearEMA =
Math.abs(last.close - ema20) <= atr * 0.5;

const bullishPullback =
nearEMA &&
last.low <= ema20 + atr * 0.2 &&
last.close > last.open &&
last.close > ema20 &&
previous.close <= previous.open;

const bearishPullback =
nearEMA &&
last.high >= ema20 - atr * 0.2 &&
last.close < last.open &&
last.close < ema20 &&
previous.close >= previous.open;

// 4. Breakout and Retest

const bullishRetest =
previous.close > breakoutHigh &&
last.low <= breakoutHigh + atr * 0.2 &&
last.close > breakoutHigh &&
last.close > last.open;

const bearishRetest =
previous.close < breakoutLow &&
last.high >= breakoutLow - atr * 0.2 &&
last.close < breakoutLow &&
last.close < last.open;

// 5. Consolidation Breakout

const rangeCandles = candles.slice(-13, -3);

const rangeHigh = Math.max(
...rangeCandles.map(c => c.high)
);

const rangeLow = Math.min(
...rangeCandles.map(c => c.low)
);

const rangeSize = rangeHigh - rangeLow;
const compactRange = rangeSize <= atr * 2.5;

const bullishConsolidationBreak =
compactRange &&
last.close > rangeHigh + atr * 0.05 &&
last.close > last.open;

const bearishConsolidationBreak =
compactRange &&
last.close < rangeLow - atr * 0.05 &&
last.close < last.open;

// 6. Momentum Candle

const body = Math.abs(last.close - last.open);
const candleRange = Math.max(
last.high - last.low,
0.00000001
);

const closePosition =
(last.close - last.low) / candleRange;

const bullishMomentum =
last.close > last.open &&
body >= atr * 0.55 &&
closePosition >= 0.75 &&
last.close > previous.high;

const bearishMomentum =
last.close < last.open &&
body >= atr * 0.55 &&
closePosition <= 0.25 &&
last.close < previous.low;

// 7. Trend Continuation

const bullishContinuation =
trendDirection === 1 &&
previous2.close < previous2.open &&
previous.close <= previous2.close &&
last.close > last.open &&
last.close > previous.high &&
last.close > ema20 &&
Math.abs(last.close - ema20) <= atr * 1.2;

const bearishContinuation =
trendDirection === -1 &&
previous2.close > previous2.open &&
previous.close >= previous2.close &&
last.close < last.open &&
last.close < previous.low &&
last.close < ema20 &&
Math.abs(last.close - ema20) <= atr * 1.2;

// امتیازدهی گروهی برای جلوگیری از دوباره‌شماری یک حرکت
let longSetupScore = 0;
let shortSetupScore = 0;

const longReasons = [];
const shortReasons = [];

if (bullishSweep) {
longSetupScore += 3;
longReasons.push("جمع‌آوری نقدینگی زیر کف و بازگشت قیمت");
}

if (bearishSweep) {
shortSetupScore += 3;
shortReasons.push("جمع‌آوری نقدینگی بالای سقف و برگشت قیمت");
}

if (bullishRetest) {
longSetupScore += 3;
longReasons.push("شکست مقاومت و پولبک موفق");
}

if (bearishRetest) {
shortSetupScore += 3;
shortReasons.push("شکست حمایت و پولبک موفق");
}

if (bullishPullback) {
longSetupScore += 2;
longReasons.push("پولبک صعودی به EMA20");
}

if (bearishPullback) {
shortSetupScore += 2;
shortReasons.push("پولبک نزولی به EMA20");
}

// BOS، شکست تراکم و مومنتوم در یک گروه شمرده می‌شوند
const bullishBreakGroup =
bullishBOS ||
bullishConsolidationBreak ||
bullishMomentum;

const bearishBreakGroup =
bearishBOS ||
bearishConsolidationBreak ||
bearishMomentum;

if (bullishBreakGroup) {
longSetupScore += 2;

if (bullishBOS) {
longReasons.push("شکست ساختار کوتاه‌مدت صعودی");
} else if (bullishConsolidationBreak) {
longReasons.push("خروج صعودی از محدوده تراکم");
} else {
longReasons.push("کندل مومنتوم صعودی");
}
}

if (bearishBreakGroup) {
shortSetupScore += 2;

if (bearishBOS) {
shortReasons.push("شکست ساختار کوتاه‌مدت نزولی");
} else if (bearishConsolidationBreak) {
shortReasons.push("خروج نزولی از محدوده تراکم");
} else {
shortReasons.push("کندل مومنتوم نزولی");
}
}

if (bullishContinuation && !bullishBreakGroup) {
longSetupScore += 2;
longReasons.push("ادامه حرکت صعودی پس از اصلاح");
}

if (bearishContinuation && !bearishBreakGroup) {
shortSetupScore += 2;
shortReasons.push("ادامه حرکت نزولی پس از اصلاح");
}

let longScore = longSetupScore;
let shortScore = shortSetupScore;

if (longSetupScore > 0 && trendDirection === 1) {
longScore++;
longReasons.push("هم‌جهت با روند ۱۵ دقیقه");
}

if (shortSetupScore > 0 && trendDirection === -1) {
shortScore++;
shortReasons.push("هم‌جهت با روند ۱۵ دقیقه");
}

if (
longSetupScore > 0 &&
volume.available &&
volume.direction === 1
) {
longScore++;
longReasons.push("حجم متمایل به خرید");
}

if (
shortSetupScore > 0 &&
volume.available &&
volume.direction === -1
) {
shortScore++;
shortReasons.push("حجم متمایل به فروش");
}

let direction = 0;
let score = 0;
let reasons = [];

const minimumSetupScore = 2;
const minimumScoreGap = 1;

if (
longSetupScore >= minimumSetupScore &&
longScore >= shortScore + minimumScoreGap
) {
direction = 1;
score = longScore;
reasons = [...longReasons];
} else if (
shortSetupScore >= minimumSetupScore &&
shortScore >= longScore + minimumScoreGap
) {
direction = -1;
score = shortScore;
reasons = [...shortReasons];
}

const counterTrend =
direction !== 0 &&
trendDirection !== 0 &&
direction !== trendDirection;

if (counterTrend) {
const hasSweep =
direction === 1 ? bullishSweep : bearishSweep;

const hasBOS =
direction === 1 ? bullishBOS : bearishBOS;

const hasMomentum =
direction === 1 ? bullishMomentum : bearishMomentum;

const hasRetest =
direction === 1 ? bullishRetest : bearishRetest;

const strongCounterSetup =
hasSweep ||
hasRetest ||
(hasBOS && hasMomentum);

if (!strongCounterSetup) {
direction = 0;
score = 0;
reasons = [
"فرصت خلاف روند قدرت کافی ندارد و رد شد"
];
} else {
reasons.push("معامله خلاف روند؛ شواهد قوی‌تر شناسایی شد");
}
}

if (direction === 0 && reasons.length === 0) {
reasons = ["هنوز الگوی معاملاتی کافی شناسایی نشده است"];
}

// قیمت شکست برای ورود بعد از بسته‌شدن کندل ۵ دقیقه
const entryTrigger = direction === 1
? last.high
: direction === -1
? last.low
: null;

// نزدیک‌ترین کف و سقف اخیر برای حد ضرر
const swingCandles = candles.slice(-9, -1);

const swingLow = Math.min(
...swingCandles.map(c => c.low)
);

const swingHigh = Math.max(
...swingCandles.map(c => c.high)
);

return {
direction,
score,
reasons,
atr,
ema20,
priorHigh,
priorLow,
breakoutHigh,
breakoutLow,
rangeHigh,
rangeLow,
bullishSweep,
bearishSweep,
bullishBOS,
bearishBOS,
bullishPullback,
bearishPullback,
bullishRetest,
bearishRetest,
bullishConsolidationBreak,
bearishConsolidationBreak,
bullishMomentum,
bearishMomentum,
bullishContinuation,
bearishContinuation,
longSetupScore,
shortSetupScore,
counterTrend,
volume,
entryTrigger,
swingLow,
swingHigh,
signalTime: last.time,
signalClose: last.close
};
}

// ===============================
// OPTIONAL 1 MINUTE ASSIST
// ===============================

function analyzeMicro(candles, direction) {
if (!candles || candles.length < 30) {
return {
available: false,
aligned: false,
text: "داده یک‌دقیقه در دسترس نیست"
};
}

const closes = candles.map(c => c.close);
const ema9 = emaSeries(closes, 9).at(-1);
const last = candles.at(-1);

const aligned = direction === 1
? last.close > ema9 && last.close > last.open
: direction === -1
? last.close < ema9 && last.close < last.open
: false;

return {
available: true,
aligned,
ema9,
price: last.close,
text: aligned
? "رفتار یک‌دقیقه با جهت فرصت هم‌راستاست"
: "تأیید یک‌دقیقه‌ای هم‌راستا نیست"
};
}

// ===============================
// DIRECTIONAL PERCENTAGES
// ===============================

function calculatePercentages(trend, opportunity) {
let bullish = 0;
let bearish = 0;
let neutral = 0;

// EMA: وزن 2
if (trend.ema20 > trend.ema50) bullish += 2;
else if (trend.ema20 < trend.ema50) bearish += 2;
else neutral += 2;

// قیمت نسبت به EMA20: وزن 1
if (trend.price > trend.ema20) bullish++;
else if (trend.price < trend.ema20) bearish++;
else neutral++;

// ساختار بازار: وزن 2
if (trend.structure.direction === 1) bullish += 2;
else if (trend.structure.direction === -1) bearish += 2;
else neutral += 2;

// RSI: وزن 1
if (trend.rsi >= 55) bullish++;
else if (trend.rsi <= 45) bearish++;
else neutral++;

// MACD: وزن 1
if (trend.macd.histogram > 0) bullish++;
else if (trend.macd.histogram < 0) bearish++;
else neutral++;

// فرصت 5 دقیقه: وزن حداکثر 4
const longSetup = Math.min(4, opportunity.longSetupScore || 0);
const shortSetup = Math.min(4, opportunity.shortSetupScore || 0);

if (longSetup > shortSetup) {
bullish += longSetup;
neutral += Math.max(0, 4 - longSetup);
} else if (shortSetup > longSetup) {
bearish += shortSetup;
neutral += Math.max(0, 4 - shortSetup);
} else {
neutral += 4;
}

const total = bullish + bearish + neutral || 1;

const bullPercent = bullish / total * 100;
const bearPercent = bearish / total * 100;
const neutralPercent = neutral / total * 100;

return {
bullish: bullPercent,
bearish: bearPercent,
neutral: neutralPercent
};
}

// ===============================
// TRADE PLAN
// ===============================

function buildTradePlan(direction, entry, opportunity) {
if (!direction || !Number.isFinite(entry)) return null;

const isLong = direction === 1;
const atr = opportunity.atr;

let stop;

if (isLong) {
stop = Math.min(
opportunity.swingLow - atr * 0.1,
entry - atr * 0.8
);
} else {
stop = Math.max(
opportunity.swingHigh + atr * 0.1,
entry + atr * 0.8
);
}

const risk = Math.abs(entry - stop);

if (
!Number.isFinite(risk) ||
risk <= 0 ||
risk > atr * 3
) {
return null;
}

const multipliers = [1, 1.5, 2, 2.5, 3];

const targets = multipliers.map(n =>
isLong
? entry + risk * n
: entry - risk * n
);

return {
entry,
stop,
risk,
targets,
multipliers,
counterTrend: opportunity.counterTrend
};
}

// ===============================
// COMPLETE ANALYSIS
// ===============================

function analyzeAll(trendCandles, opportunityCandles, microCandles) {
const trend = analyzeTrend(trendCandles);

const opportunity = analyzeOpportunity(
opportunityCandles,
trend.direction
);

const micro = analyzeMicro(
microCandles,
opportunity.direction
);

const percentages = calculatePercentages(
trend,
opportunity
);

// اگر الگوی شکست با کلوز کندل 5 دقیقه تأیید شده باشد،
// ورود می‌تواند در قیمت بسته‌شدن همان کندل بررسی شود.
const confirmedBreak =
opportunity.direction === 1
? (
opportunity.bullishBOS ||
opportunity.bullishConsolidationBreak ||
opportunity.bullishRetest
)
: opportunity.direction === -1
? (
opportunity.bearishBOS ||
opportunity.bearishConsolidationBreak ||
opportunity.bearishRetest
)
: false;

const entryPrice = confirmedBreak
? opportunity.signalClose
: opportunity.entryTrigger;

const tradePlan = opportunity.direction !== 0
? buildTradePlan(
opportunity.direction,
entryPrice,
opportunity
)
: null;

let entryStatus = "none";

if (opportunity.direction !== 0 && tradePlan) {
entryStatus = confirmedBreak ? "confirmed" : "waiting";
}

if (opportunity.direction !== 0 && !tradePlan) {
entryStatus = "invalid";
}

return {
trend,
opportunity,
micro,
percentages,
tradePlan,
entryStatus,
entryConfirmed: entryStatus === "confirmed"
};
}

// ===============================
// REPORT HELPERS
// ===============================

function directionText(direction) {
if (direction === 1) return "🟢 صعودی";
if (direction === -1) return "🔴 نزولی";
return "⚪ خنثی";
}

function sideText(direction) {
if (direction === 1) return "BUY";
if (direction === -1) return "SELL";
return "بدون جهت";
}

function trendStatus(a) {
if (a.entryStatus === "confirmed") {
return a.opportunity.direction === 1
? "🟢 شرط ورود BUY با کلوز ۵ دقیقه تأیید شده"
: "🔴 شرط ورود SELL با کلوز ۵ دقیقه تأیید شده";
}

if (a.entryStatus === "waiting") {
return "⏳ منتظر رسیدن قیمت و تأیید کندل ۵ دقیقه";
}

if (a.entryStatus === "invalid") {
return "⛔ فاصله حد ضرر مناسب نیست؛ ورود رد شد";
}

return "⚪ هنوز فرصت معاملاتی مناسبی پیدا نشده";
}

function percentageReport(p) {
return `📊 سهم شواهد تحلیلی

🟢 صعودی: ${percent(p.bullish)}
${percentBar(p.bullish)}

🔴 نزولی: ${percent(p.bearish)}
${percentBar(p.bearish)}

⚪ خنثی: ${percent(p.neutral)}
${percentBar(p.neutral)}`;
}

function tradePlanText(a) {
if (!a.tradePlan) return "";

const p = a.tradePlan;
const direction = a.opportunity.direction;

const entryCondition = a.entryStatus === "confirmed"
? "کندل ۵ دقیقه‌ای شرط شکست را تأیید کرده است."
: direction === 1
? `ورود BUY فقط پس از کلوز کندل ۵ دقیقه بالای ${format(p.entry)}`
: `ورود SELL فقط پس از کلوز کندل ۵ دقیقه پایین ${format(p.entry)}`;

const counterWarning = p.counterTrend
? "\n⚠️ این معامله خلاف روند ۱۵ دقیقه است."
: "";

return `📍 برنامه معامله

جهت: ${sideText(direction)}
قیمت ورود: ${format(p.entry)}
شرط ورود: ${entryCondition}

حد ضرر: ${format(p.stop)}

🟢 TP1: ${format(p.targets[0])} | 1R
🟢 TP2: ${format(p.targets[1])} | 1.5R
🟢 TP3: ${format(p.targets[2])} | 2R
🟢 TP4: ${format(p.targets[3])} | 2.5R
🟢 TP5: ${format(p.targets[4])} | 3R

${counterWarning}

⏱ اعتبار اولیه سیگنال: حداکثر ۳ کندل ۵ دقیقه‌ای از زمان کندل سیگنال.
اگر ساختار بازار تغییر کند، قبل از ورود دوباره تحلیل بگیر.

حد ضرر با کلوز کندل ۵ دقیقه‌ای آن‌طرف قیمت SL فعال‌شده تلقی می‌شود.`;
}

// ===============================
// MAIN REPORT
// ===============================

function mainReport(name, a) {
const trend = a.trend;
const opportunity = a.opportunity;
const p = a.percentages;

const price = opportunity.signalClose ?? trend.price;

const opportunityText = opportunity.direction === 0
? "⚪ فرصت معتبر پیدا نشد"
: `${sideText(opportunity.direction)} | امتیاز: ${opportunity.score}`;

const reasons = opportunity.reasons.length
? opportunity.reasons.map(x => `• ${x}`).join("\n")
: "• موقعیت مشخصی شناسایی نشد";

return `📊 ${name} | تحلیل Traid

💰 قیمت آخرین کندل ۵ دقیقه: ${format(price)}

━━━━━━━━━━━━━━
${percentageReport(p)}

━━━━━━━━━━━━━━
1️⃣ جهت بازار | ۱۵ دقیقه
${directionText(trend.direction)}
ساختار: ${trend.structure.text}
EMA20: ${format(trend.ema20)}
EMA50: ${format(trend.ema50)}
RSI: ${format(trend.rsi)}

━━━━━━━━━━━━━━
2️⃣ فرصت معاملاتی | ۵ دقیقه
${opportunityText}

${reasons}

━━━━━━━━━━━━━━
3️⃣ زمان‌بندی ورود
${trendStatus(a)}

${a.tradePlan
? `قیمت پیشنهادی ورود: ${format(a.tradePlan.entry)}`
: "فعلاً قیمت ورود معتبری تعیین نشده است."}

━━━━━━━━━━━━━━
4️⃣ بررسی کمکی | ۱ دقیقه
${a.micro.text}

${a.tradePlan
? tradePlanText(a)
: "⛔ در حال حاضر برنامه معامله صادر نشده است."}

━━━━━━━━━━━━━━
⚠️ ربات معامله را اجرا نمی‌کند و استاپ یا تارگت را زنده پایش نمی‌کند.
⚠️ درصدها سهم شواهد تحلیلی هستند، نه احتمال سود.`;
}

// ===============================
// DETAIL REPORT
// ===============================

function detailReport(name, a) {
const t = a.trend;
const o = a.opportunity;
const c = a.micro;
const p = a.percentages;

const trendReasons = t.reasons.length
? t.reasons.map(x => `• ${x}`).join("\n")
: "نشانه جهت‌دار کافی وجود ندارد";

const opportunityReasons = o.reasons.length
? o.reasons.map(x => `• ${x}`).join("\n")
: "موقعیت معاملاتی مشخصی شناسایی نشد";

const volumeText = o.volume?.available
? `نسبت حجم ۱۰ کندل اخیر به ۲۰ کندل قبل: ${format(o.volume.ratio)} برابر`
: "حجم معتبر در دسترس نیست";

return `🔬 جزئیات تحلیل ${name}

💰 قیمت: ${format(o.signalClose ?? t.price)}

━━━━━━━━━━━━━━
📊 سهم شواهد تحلیلی

صعودی: ${percent(p.bullish)}
${percentBar(p.bullish)}

نزولی: ${percent(p.bearish)}
${percentBar(p.bearish)}

خنثی: ${percent(p.neutral)}
${percentBar(p.neutral)}

━━━━━━━━━━━━━━
1️⃣ تحلیل جهت بازار | ۱۵ دقیقه

جهت: ${directionText(t.direction)}
امتیاز جهت: ${t.score}

EMA20: ${format(t.ema20)}
EMA50: ${format(t.ema50)}
RSI14: ${format(t.rsi)}
MACD: ${format(t.macd.line)}
MACD Signal: ${format(t.macd.signal)}
MACD Histogram: ${format(t.macd.histogram)}

ساختار بازار:
${t.structure.text}

دلایل:
${trendReasons}

━━━━━━━━━━━━━━
2️⃣ تحلیل فرصت | ۵ دقیقه

جهت فرصت: ${sideText(o.direction)}
امتیاز فرصت: ${o.score}

${opportunityReasons}

امتیاز الگوی صعودی: ${format(o.longSetupScore)}
امتیاز الگوی نزولی: ${format(o.shortSetupScore)}

سطح مرجع سقف: ${format(o.priorHigh)}
سطح مرجع کف: ${format(o.priorLow)}
سطح شکست سقف: ${format(o.breakoutHigh)}
سطح شکست کف: ${format(o.breakoutLow)}

EMA20: ${format(o.ema20)}
ATR14: ${format(o.atr)}

${volumeText}

━━━━━━━━━━━━━━
3️⃣ بررسی کمکی | ۱ دقیقه

${c.text}
قیمت: ${format(c.price)}
EMA9: ${format(c.ema9)}

این تایم‌فریم شرط اجباری ورود نیست.

━━━━━━━━━━━━━━
📍 نتیجه نهایی

${trendStatus(a)}

${a.tradePlan
? tradePlanText(a)
: "⛔ برنامه معامله صادر نشده است."}

━━━━━━━━━━━━━━
نکات:
• روند اصلی از ۱۵ دقیقه استخراج می‌شود.
• فرصت و قیمت ورود از ۵ دقیقه تعیین می‌شود.
• یک‌دقیقه فقط ابزار کمکی است.
• حجم عامل کمکی است و شرط اجباری ورود نیست.
• درصدها سهم وزنی شواهد تحلیلی هستند.
• CVD واقعی در این نسخه پیاده‌سازی نشده است.
• Order Book هنوز در محاسبه سیگنال استفاده نمی‌شود.

⚠️ این تحلیل تضمین‌کننده سود نیست.`;
}

// ===============================
// RUN ANALYSIS
// ===============================

async function runAnalysis(chatId, assets, detail, env) {
await send(
chatId,
"⏳ در حال دریافت داده‌های ۱۵ و ۵ دقیقه از TrueTrade...",
env
);

for (const asset of assets) {
try {
const symbol = SYMBOLS[asset];

const [candles15, candles5] = await Promise.all([
getCandles(symbol, "15"),
getCandles(symbol, "5")
]);

// یک‌دقیقه فقط ابزار کمکی است؛ نبودنش تحلیل را متوقف نمی‌کند.
let candles1 = [];

try {
candles1 = await getCandles(symbol, "1");
} catch (microError) {
console.warn("1m data unavailable:", microError.message);
}

const result = analyzeAll(
candles15,
candles5,
candles1
);

const name = ASSET_NAMES[asset];

const report = detail
? detailReport(name, result)
: mainReport(name, result);

await send(
chatId,
report,
env,
resultKeyboard(asset, detail)
);

} catch (error) {
console.error(`Analysis error for ${asset}:`, error);

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
`سلام! من Traid هستم 🤖

۱۵ دقیقه: تشخیص روند اصلی
۵ دقیقه: پیدا کردن فرصت و قیمت ورود
۱ دقیقه: ابزار کمکی برای بررسی دقیق‌تر ورود

ارز موردنظرت را انتخاب کن:`,
env,
mainKeyboard()
);
return;
}

if (text.startsWith("/help")) {
await send(
chatId,
"برای تحلیل، نام ارز را بفرست یا از منوی زیر انتخاب کن:",
env,
mainKeyboard()
);
return;
}

const assets = getAssets(originalText);

if (!assets.length) {
await send(
chatId,
"برای شروع تحلیل، ارز موردنظرت را انتخاب کن:",
env,
mainKeyboard()
);
return;
}

await runAnalysis(
chatId,
assets,
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
await send(
chatId,
`🤖 Traid

کدام ارز را تحلیل کنم؟`,
env,
mainKeyboard()
);
return;
}

const parts = data.split(":");
const action = parts[0];
const asset = parts[1];

if (action === "scan") {
if (!["BTC", "ETH", "ALL"].includes(asset)) return;

const assets = asset === "ALL"
? ["BTC", "ETH"]
: [asset];

await runAnalysis(chatId, assets, false, env);
return;
}

if (action === "detail" || action === "again") {
if (!["BTC", "ETH"].includes(asset)) return;

await runAnalysis(
chatId,
[asset],
action === "detail",
env
);
}
}

// ===============================
// CLOUDFLARE WORKER
// ===============================

export default {
async fetch(request, env, ctx) {
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

// پاسخ فوری به تلگرام؛ پردازش در پس‌زمینه
// تا به دلیل طولانی‌شدن تحلیل، وب‌هوک دوباره ارسال نشود.
const task = (async () => {
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
})();

if (ctx && typeof ctx.waitUntil === "function") {
ctx.waitUntil(task);
} else {
await task;
}

return response("OK");
}
};

