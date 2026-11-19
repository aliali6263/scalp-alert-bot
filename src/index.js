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

if (/هر دو|همه ارزها|همه بازار/.test(s)) {
return ["BTC", "ETH"];
}

return [];
}

function isDetail(text) {
return /جزئیات|تحلیل کامل|توضیح بیشتر/.test(normalize(text));
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
// RSI
// ===============================

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

function rsiDirection(rsi) {
if (rsi >= 55) return 1;
if (rsi <= 45) return -1;
return 0;
}

function rsiText(rsi) {
if (rsi >= 70) return "قدرت خرید بالا؛ احتمال اشباع خرید";
if (rsi >= 55) return "قدرت نسبی خریداران";
if (rsi <= 30) return "قدرت فروش بالا؛ احتمال اشباع فروش";
if (rsi <= 45) return "قدرت نسبی فروشندگان";
return "تعادل نسبی خریداران و فروشندگان";
}

// ===============================
// VOLUME
// ===============================

function analyzeVolume(candles) {
if (candles.length < 31) {
return {
available: false,
ratio: null,
direction: 0,
upVolume: 0,
downVolume: 0
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
direction: 0,
upVolume: 0,
downVolume: 0
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

if (ratio > 1.1 && upVolume > downVolume * 1.15) {
direction = 1;
}

if (ratio > 1.1 && downVolume > upVolume * 1.15) {
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
lastHigh: highs.at(-1)?.price ?? null,
lastLow: lows.at(-1)?.price ?? null,
bos: 0
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
let bos = 0;

if (last.close > h1) {
direction = 1;
bos = 1;
text = "شکست سقف اخیر";
} else if (last.close < l1) {
direction = -1;
bos = -1;
text = "شکست کف اخیر";
}

return {
direction,
text,
lastHigh: h1,
lastLow: l1,
bos
};
}

// ===============================
// STAGE 1: 15 MINUTE TREND
// ===============================

function analyzeTrend(candles) {
const closes = candles.map(c => c.close);
const price = closes.at(-1);

const rsi = calculateRSI(closes);
const structure = analyzeStructure(candles);
const volume = analyzeVolume(candles);

let score = 0;
const reasons = [];

// ساختار بازار، عامل اصلی جهت
if (structure.direction !== 0) {
score += structure.direction * 3;
reasons.push(structure.text);
} else {
reasons.push("ساختار بازار جهت مشخصی ندارد");
}

// RSI فقط عامل کمکی
const rsiSide = rsiDirection(rsi);

if (rsiSide !== 0) {
score += rsiSide;
reasons.push(rsiText(rsi));
} else {
reasons.push("RSI در محدوده تعادل");
}

// حجم فقط عامل تأییدی
if (volume.available && volume.direction !== 0) {
score += volume.direction;
reasons.push(
volume.direction === 1
? "حجم معاملات به نفع خریداران"
: "حجم معاملات به نفع فروشندگان"
);
}

let direction = 0;

if (score >= 2) direction = 1;
if (score <= -2) direction = -1;

return {
direction,
score,
price,
rsi,
structure,
volume,
reasons
};
}

// ===============================
// STAGE 2: 5 MINUTE OPPORTUNITY
// ===============================

function analyzeOpportunity(candles, trendDirection) {
const last = candles.at(-1);
const previous = candles.at(-2);

const closes = candles.map(c => c.close);
const rsi = calculateRSI(closes);
const volume = analyzeVolume(candles);

// سطوح مرجع، بدون احتساب کندل فعلی
const reference = candles.slice(-21, -1);

const priorHigh = Math.max(...reference.map(c => c.high));
const priorLow = Math.min(...reference.map(c => c.low));

// سطوح شکست، بدون کندل فعلی و قبلی
const breakoutCandles = candles.slice(-22, -2);

const breakoutHigh = Math.max(
...breakoutCandles.map(c => c.high)
);

const breakoutLow = Math.min(
...breakoutCandles.map(c => c.low)
);

// آخرین پیوت‌های تأییدشده
const p = pivots(candles.slice(-80));

const resistance = p.highs.length
? p.highs.at(-1).price
: priorHigh;

const support = p.lows.length
? p.lows.at(-1).price
: priorLow;

// 1. Liquidity Sweep
const bullishSweep =
last.low < priorLow &&
last.close > priorLow &&
last.close > last.open;

const bearishSweep =
last.high > priorHigh &&
last.close < priorHigh &&
last.close < last.open;

// 2. BOS
const bullishBOS =
last.close > breakoutHigh &&
previous.close <= breakoutHigh;

const bearishBOS =
last.close < breakoutLow &&
previous.close >= breakoutLow;

// 3. Breakout and Retest
const bullishRetest =
previous.close > breakoutHigh &&
last.low <= breakoutHigh &&
last.close > breakoutHigh &&
last.close > last.open;

const bearishRetest =
previous.close < breakoutLow &&
last.high >= breakoutLow &&
last.close < breakoutLow &&
last.close < last.open;

// 4. قدرت کندل؛ فقط بر اساس نسبت بدنه به دامنه خودش
const candleRange = Math.max(
last.high - last.low,
0.00000001
);

const body = Math.abs(last.close - last.open);
const bodyRatio = body / candleRange;

const closePosition =
(last.close - last.low) / candleRange;

const bullishMomentum =
last.close > last.open &&
bodyRatio >= 0.65 &&
closePosition >= 0.75 &&
last.close > previous.high;

const bearishMomentum =
last.close < last.open &&
bodyRatio >= 0.65 &&
closePosition <= 0.25 &&
last.close < previous.low;

// گروه شکست؛ BOS، پولبک و مومنتوم دوباره‌شماری نمی‌شوند
const bullishBreakGroup =
bullishRetest || bullishBOS || bullishMomentum;

const bearishBreakGroup =
bearishRetest || bearishBOS || bearishMomentum;

let longSetupScore = 0;
let shortSetupScore = 0;

const longReasons = [];
const shortReasons = [];

// نقدینگی یک گروه مستقل است
if (bullishSweep) {
longSetupScore += 3;
longReasons.push("جمع‌آوری نقدینگی زیر کف و بازگشت قیمت");
}

if (bearishSweep) {
shortSetupScore += 3;
shortReasons.push("جمع‌آوری نقدینگی بالای سقف و برگشت قیمت");
}

// شکست و پولبک یک گروه مستقل هستند
if (bullishBreakGroup) {
longSetupScore += bullishRetest ? 3 : 2;

if (bullishRetest) {
longReasons.push("شکست مقاومت و پولبک موفق");
} else if (bullishBOS) {
longReasons.push("شکست ساختار کوتاه‌مدت صعودی");
} else {
longReasons.push("کندل قدرتمند صعودی");
}
}

if (bearishBreakGroup) {
shortSetupScore += bearishRetest ? 3 : 2;

if (bearishRetest) {
shortReasons.push("شکست حمایت و پولبک موفق");
} else if (bearishBOS) {
shortReasons.push("شکست ساختار کوتاه‌مدت نزولی");
} else {
shortReasons.push("کندل قدرتمند نزولی");
}
}

// امتیازهای کمکی
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

if (longSetupScore > 0 && rsi >= 55) {
longScore++;
longReasons.push("RSI تأییدکننده قدرت خریداران");
}

if (shortSetupScore > 0 && rsi <= 45) {
shortScore++;
shortReasons.push("RSI تأییدکننده قدرت فروشندگان");
}

if (
longSetupScore > 0 &&
volume.available &&
volume.direction === 1
) {
longScore++;
longReasons.push("حجم معاملات متمایل به خرید");
}

if (
shortSetupScore > 0 &&
volume.available &&
volume.direction === -1
) {
shortScore++;
shortReasons.push("حجم معاملات متمایل به فروش");
}

let direction = 0;
let score = 0;
let reasons = [];

const minimumSetupScore = 2;

if (
longSetupScore >= minimumSetupScore &&
longScore > shortScore
) {
direction = 1;
score = longScore;
reasons = [...longReasons];
} else if (
shortSetupScore >= minimumSetupScore &&
shortScore > longScore
) {
direction = -1;
score = shortScore;
reasons = [...shortReasons];
}

// کنترل معامله خلاف روند
const counterTrend =
direction !== 0 &&
trendDirection !== 0 &&
direction !== trendDirection;

if (counterTrend) {
const hasSweep =
direction === 1 ? bullishSweep : bearishSweep;

const hasRetest =
direction === 1 ? bullishRetest : bearishRetest;

const hasBOS =
direction === 1 ? bullishBOS : bearishBOS;

const hasMomentum =
direction === 1 ? bullishMomentum : bearishMomentum;

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

// قیمت ورود بر اساس بسته‌شدن کندل سیگنال
const entryPrice = direction !== 0
? last.close
: null;

return {
direction,
score,
reasons,
rsi,
volume,

priorHigh,
priorLow,
breakoutHigh,
breakoutLow,

support,
resistance,

bullishSweep,
bearishSweep,
bullishBOS,
bearishBOS,
bullishRetest,
bearishRetest,
bullishMomentum,
bearishMomentum,

longSetupScore,
shortSetupScore,
counterTrend,

entryPrice,
signalClose: last.close,
signalTime: last.time,

// برای مدیریت ریسک
swingLow: Math.min(
...candles.slice(-9, -1).map(c => c.low)
),
swingHigh: Math.max(
...candles.slice(-9, -1).map(c => c.high)
)
};
}

// ===============================
// DIRECTIONAL PERCENTAGES
// ===============================

function calculatePercentages(trend, opportunity) {
let bullish = 0;
let bearish = 0;
let neutral = 0;

// ساختار بازار ۱۵ دقیقه: وزن 3
if (trend.structure.direction === 1) bullish += 3;
else if (trend.structure.direction === -1) bearish += 3;
else neutral += 3;

// RSI پانزده دقیقه: وزن 1
if (trend.rsi >= 55) bullish++;
else if (trend.rsi <= 45) bearish++;
else neutral++;

// حجم پانزده دقیقه: وزن 1
if (trend.volume.available && trend.volume.direction === 1) {
bullish++;
} else if (
trend.volume.available &&
trend.volume.direction === -1
) {
bearish++;
} else {
neutral++;
}

// ساختار فرصت پنج دقیقه: حداکثر 3
if (opportunity.longSetupScore > opportunity.shortSetupScore) {
bullish += Math.min(3, opportunity.longSetupScore);
} else if (
opportunity.shortSetupScore > opportunity.longSetupScore
) {
bearish += Math.min(3, opportunity.shortSetupScore);
} else {
neutral += 3;
}

// RSI پنج دقیقه: وزن 1
if (opportunity.rsi >= 55) bullish++;
else if (opportunity.rsi <= 45) bearish++;
else neutral++;

// حجم پنج دقیقه: وزن 1
if (
opportunity.volume.available &&
opportunity.volume.direction === 1
) {
bullish++;
} else if (
opportunity.volume.available &&
opportunity.volume.direction === -1
) {
bearish++;
} else {
neutral++;
}

const total = bullish + bearish + neutral || 1;

return {
bullish: bullish / total * 100,
bearish: bearish / total * 100,
neutral: neutral / total * 100
};
}

// ===============================
// ATR - ONLY FOR SL AND TP
// ===============================

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
// TRADE PLAN
// ===============================

function buildTradePlan(direction, entry, opportunity, candles) {
if (!direction || !Number.isFinite(entry)) return null;

// ATR فقط از این قسمت به بعد استفاده می‌شود.
const atr = calculateATR(candles);

if (!Number.isFinite(atr) || atr <= 0) return null;

const isLong = direction === 1;

let stop;

if (isLong) {
const structuralStop =
opportunity.swingLow < entry
? opportunity.swingLow - atr * 0.2
: entry - atr * 1.2;

stop = Math.min(
structuralStop,
entry - atr * 0.8
);
} else {
const structuralStop =
opportunity.swingHigh > entry
? opportunity.swingHigh + atr * 0.2
: entry + atr * 1.2;

stop = Math.max(
structuralStop,
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
atr,
targets,
multipliers,
counterTrend: opportunity.counterTrend
};
}

// ===============================
// COMPLETE ANALYSIS
// ===============================

function analyzeAll(trendCandles, opportunityCandles) {
const trend = analyzeTrend(trendCandles);

const opportunity = analyzeOpportunity(
opportunityCandles,
trend.direction
);

const percentages = calculatePercentages(
trend,
opportunity
);

const tradePlan = opportunity.direction !== 0
? buildTradePlan(
opportunity.direction,
opportunity.entryPrice,
opportunity,
opportunityCandles
)
: null;

let entryStatus = "none";

if (opportunity.direction !== 0 && tradePlan) {
entryStatus = "ready";
}

if (opportunity.direction !== 0 && !tradePlan) {
entryStatus = "invalid";
}

return {
trend,
opportunity,
percentages,
tradePlan,
entryStatus
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
if (a.entryStatus === "ready") {
return a.opportunity.direction === 1
? "🟢 فرصت BUY شناسایی شده؛ بررسی ورود پس از بسته‌شدن کندل سیگنال"
: "🔴 فرصت SELL شناسایی شده؛ بررسی ورود پس از بسته‌شدن کندل سیگنال";
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

const entryCondition =
"مبنای قیمت ورود، بسته‌شدن آخرین کندل سیگنال ۵ دقیقه است. پیش از ورود، اعتبار سطح و قیمت جاری را بررسی کن.";

const counterWarning = p.counterTrend
? "\n⚠️ این معامله خلاف روند ۱۵ دقیقه است."
: "";

return `📍 برنامه معامله

جهت: ${sideText(direction)}
قیمت مرجع ورود: ${format(p.entry)}
شرط ورود: ${entryCondition}

حد ضرر: ${format(p.stop)}

🟢 TP1: ${format(p.targets[0])} | 1R
🟢 TP2: ${format(p.targets[1])} | 1.5R
🟢 TP3: ${format(p.targets[2])} | 2R
🟢 TP4: ${format(p.targets[3])} | 2.5R
🟢 TP5: ${format(p.targets[4])} | 3R

فاصله ریسک: ${format(p.risk)}
ATR14 برای مدیریت معامله: ${format(p.atr)}
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
RSI14: ${format(trend.rsi)}
وضعیت RSI: ${rsiText(trend.rsi)}

━━━━━━━━━━━━━━
2️⃣ فرصت معاملاتی | ۵ دقیقه

${opportunityText}

RSI14: ${format(opportunity.rsi)}

${reasons}

━━━━━━━━━━━━━━
3️⃣ سطوح مهم قیمت

مقاومت: ${format(opportunity.resistance)}
حمایت: ${format(opportunity.support)}
سطح شکست سقف: ${format(opportunity.breakoutHigh)}
سطح شکست کف: ${format(opportunity.breakoutLow)}

━━━━━━━━━━━━━━
4️⃣ نتیجه نهایی

${trendStatus(a)}

${a.tradePlan
? tradePlanText(a)
: "⛔ در حال حاضر برنامه معامله صادر نشده است."}

━━━━━━━━━━━━━━
• روند اصلی از ۱۵ دقیقه استخراج می‌شود.
• فرصت و قیمت ورود از ۵ دقیقه تعیین می‌شود.
• RSI عامل کمکی تحلیل است، نه سیگنال مستقل.
• ATR فقط برای حد ضرر و تارگت‌ها استفاده می‌شود.
• درصدها سهم شواهد تحلیلی هستند، نه احتمال سود.
• تحلیل خودکار و پایش زنده معامله فعال نیست.

⚠️ این تحلیل تضمین‌کننده سود نیست.`;
}

// ===============================
// DETAIL REPORT
// ===============================

function detailReport(name, a) {
const t = a.trend;
const o = a.opportunity;
const p = a.percentages;

const trendReasons = t.reasons.length
? t.reasons.map(x => `• ${x}`).join("\n")
: "نشانه جهت‌دار کافی وجود ندارد";

const opportunityReasons = o.reasons.length
? o.reasons.map(x => `• ${x}`).join("\n")
: "موقعیت معاملاتی مشخصی شناسایی نشد";

const volumeText = volume => {
if (!volume?.available) {
return "حجم معتبر در دسترس نیست";
}

return `نسبت حجم ۱۰ کندل اخیر به ۲۰ کندل قبل: ${format(volume.ratio)} برابر
جهت حجم: ${directionText(volume.direction)}`;
};

const sweepText = o.bullishSweep
? "جمع‌آوری نقدینگی زیر کف شناسایی شد"
: o.bearishSweep
? "جمع‌آوری نقدینگی بالای سقف شناسایی شد"
: "جمع‌آوری نقدینگی مشخصی شناسایی نشد";

const bosText = o.bullishBOS
? "شکست ساختار صعودی"
: o.bearishBOS
? "شکست ساختار نزولی"
: "شکست ساختار تأیید نشده";

const retestText = o.bullishRetest
? "پولبک صعودی موفق"
: o.bearishRetest
? "پولبک نزولی موفق"
: "پولبک معتبر شناسایی نشد";

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

RSI14: ${format(t.rsi)}
وضعیت RSI: ${rsiText(t.rsi)}

ساختار بازار:
${t.structure.text}

آخرین سقف ساختاری: ${format(t.structure.lastHigh)}
آخرین کف ساختاری: ${format(t.structure.lastLow)}

دلایل:
${trendReasons}

حجم:
${volumeText(t.volume)}

━━━━━━━━━━━━━━
2️⃣ تحلیل فرصت | ۵ دقیقه

جهت فرصت: ${sideText(o.direction)}
امتیاز فرصت: ${o.score}

RSI14: ${format(o.rsi)}
وضعیت RSI: ${rsiText(o.rsi)}

${opportunityReasons}

امتیاز الگوی صعودی: ${format(o.longSetupScore)}
امتیاز الگوی نزولی: ${format(o.shortSetupScore)}

━━━━━━━━━━━━━━
3️⃣ بررسی ساختار و نقدینگی

${sweepText}
${bosText}
${retestText}

سطح مرجع سقف: ${format(o.priorHigh)}
سطح مرجع کف: ${format(o.priorLow)}

سطح شکست سقف: ${format(o.breakoutHigh)}
سطح شکست کف: ${format(o.breakoutLow)}

حمایت: ${format(o.support)}
مقاومت: ${format(o.resistance)}

━━━━━━━━━━━━━━
4️⃣ بررسی حجم معاملات | ۵ دقیقه

${volumeText(o.volume)}

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
• RSI فقط عامل کمکی تحلیل است.
• ATR فقط برای محاسبه حد ضرر و تارگت‌هاست.
• EMA، MACD و CHoCH در تحلیل استفاده نمی‌شوند.
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

const result = analyzeAll(candles15, candles5);
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
۵ دقیقه: شناسایی فرصت و قیمت ورود

ابزارهای تحلیل:
ساختار بازار، BOS، نقدینگی، حجم و RSI

ATR فقط برای حد ضرر و تارگت‌ها استفاده می‌شود.

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

