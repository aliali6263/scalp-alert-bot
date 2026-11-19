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

const closed = getClosedCandles(candles, resolution);

if (closed.length < 100) {
throw new Error(`کندل بسته‌شده کافی برای تایم‌فریم ${resolution} وجود ندارد.`);
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
result.push(values[i] * k + result[i - 1] * (1 - k));
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

const closes = candles.map(c => c.close);
const ema20 = emaSeries(closes, 20).at(-1);
const atr = calculateATR(candles);

if (atr <= 0) {
return {
direction: 0,
score: 0,
reasons: ["ATR معتبر نیست"],
atr,
ema20,
volume: { available: false, ratio: null, direction: 0 }
};
}

const reference = candles.slice(-21, -1);

const priorHigh = Math.max(...reference.map(c => c.high));
const priorLow = Math.min(...reference.map(c => c.low));

const breakoutCandles = candles.slice(-11, -1);
const breakoutHigh = Math.max(...breakoutCandles.map(c => c.high));
const breakoutLow = Math.min(...breakoutCandles.map(c => c.low));

const volume = analyzeVolume(candles);

const bullishSweep =
last.low < priorLow &&
last.close > priorLow &&
last.close > last.open;

const bearishSweep =
last.high > priorHigh &&
last.close < priorHigh &&
last.close < last.open;

const bullishBOS = last.close > breakoutHigh;
const bearishBOS = last.close < breakoutLow;

const nearEMA = Math.abs(last.close - ema20) <= atr * 0.35;

const bullishPullback =
nearEMA &&
last.close > last.open &&
last.close > ema20 &&
previous.close <= previous.open;

const bearishPullback =
nearEMA &&
last.close < last.open &&
last.close < ema20 &&
previous.close >= previous.open;

let longScore = 0;
let shortScore = 0;

const longReasons = [];
const shortReasons = [];

if (bullishSweep) {
longScore += 2;
longReasons.push("شکار نقدینگی زیر کف و بازگشت قیمت");
}

if (bearishSweep) {
shortScore += 2;
shortReasons.push("شکار نقدینگی بالای سقف و برگشت قیمت");
}

if (bullishBOS) {
longScore += 2;
longReasons.push("شکست ساختار کوتاه‌مدت صعودی");
}

if (bearishBOS) {
shortScore += 2;
shortReasons.push("شکست ساختار کوتاه‌مدت نزولی");
}

if (bullishPullback) {
longScore++;
longReasons.push("پولبک صعودی به EMA20");
}

if (bearishPullback) {
shortScore++;
shortReasons.push("پولبک نزولی به EMA20");
}

if (trendDirection === 1) {
longScore++;
longReasons.push("هم‌جهت با روند ۱۵ دقیقه");
}

if (trendDirection === -1) {
shortScore++;
shortReasons.push("هم‌جهت با روند ۱۵ دقیقه");
}

if (volume.available && volume.direction === 1) {
longScore++;
longReasons.push("حجم متمایل به خرید");
}

if (volume.available && volume.direction === -1) {
shortScore++;
shortReasons.push("حجم متمایل به فروش");
}

let direction = 0;
let score = 0;
let reasons = [];

if (longScore >= 2 && longScore > shortScore) {
direction = 1;
score = longScore;
reasons = longReasons;
} else if (shortScore >= 2 && shortScore > longScore) {
direction = -1;
score = shortScore;
reasons = shortReasons;
}

const counterTrend =
direction !== 0 &&
trendDirection !== 0 &&
direction !== trendDirection;

if (counterTrend) {
const hasSweep = direction === 1 ? bullishSweep : bearishSweep;

if (!hasSweep) {
direction = 0;
score = 0;
reasons = ["فرصت خلاف روند بدون شکار نقدینگی معتبر رد شد"];
} else {
reasons.push("معامله خلاف روند؛ نیازمند تأیید قوی‌تر");
}
}

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
bullishSweep,
bearishSweep,
bullishBOS,
bearishBOS,
bullishPullback,
bearishPullback,
counterTrend,
volume
};
}

// ===============================
// STAGE 3: 1 MINUTE ENTRY
// ===============================

function confirmEntry(candles, direction, opportunity) {
if (!direction || !opportunity) {
return {
confirmed: false,
reason: "فرصت معاملاتی در تایم‌فریم ۵ دقیقه پیدا نشد."
};
}

const last = candles.at(-1);
const recent = candles.slice(-5, -1);

const recentHigh = Math.max(...recent.map(c => c.high));
const recentLow = Math.min(...recent.map(c => c.low));

const atr = calculateATR(candles);

if (atr <= 0) {
return {
confirmed: false,
reason: "ATR تایم‌فریم یک دقیقه معتبر نیست."
};
}

const body = Math.abs(last.close - last.open);

const bullishCandle =
last.close > last.open &&
body >= atr * 0.15;

const bearishCandle =
last.close < last.open &&
body >= atr * 0.15;

const bullishBreak = last.close > recentHigh;
const bearishBreak = last.close < recentLow;

let confirmed = false;
let reason = "";

if (direction === 1) {
confirmed = bullishCandle && bullishBreak;

reason = confirmed
? "کندل صعودی و شکست سقف کوتاه‌مدت تأیید شد"
: "منتظر کندل صعودی و شکست سقف کوتاه‌مدت";
}

if (direction === -1) {
confirmed = bearishCandle && bearishBreak;

reason = confirmed
? "کندل نزولی و شکست کف کوتاه‌مدت تأیید شد"
: "منتظر کندل نزولی و شکست کف کوتاه‌مدت";
}

if (opportunity.counterTrend && confirmed) {
const strongerBody = body >= atr * 0.3;

if (!strongerBody) {
confirmed = false;
reason = "معامله خلاف روند است؛ قدرت کندل تأییدی کافی نیست";
}
}

return {
confirmed,
reason,
price: last.close,
atr,
candleTime: last.time,
recentHigh,
recentLow,
bullishCandle,
bearishCandle,
bullishBreak,
bearishBreak
};
}

// ===============================
// TRADE PLAN
// ===============================

function buildTradePlan(direction, entry, opportunity, confirmation) {
if (!confirmation.confirmed) return null;

const isLong = direction === 1;
const atr = opportunity.atr;

let stop;

if (isLong) {
const referenceLow = Math.min(
opportunity.priorLow,
confirmation.recentLow
);

stop = Math.min(
referenceLow - atr * 0.15,
entry - atr * 0.8
);
} else {
const referenceHigh = Math.max(
opportunity.priorHigh,
confirmation.recentHigh
);

stop = Math.max(
referenceHigh + atr * 0.15,
entry + atr * 0.8
);
}

const risk = Math.abs(entry - stop);

if (!Number.isFinite(risk) || risk <= 0) return null;

if (risk > atr * 3) return null;

const multipliers = [1, 1.5, 2, 3];

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
// COMPLETE THREE-STAGE ANALYSIS
// ===============================

function analyzeAll(trendCandles, opportunityCandles, entryCandles) {
const trend = analyzeTrend(trendCandles);

const opportunity = analyzeOpportunity(
opportunityCandles,
trend.direction
);

const confirmation = confirmEntry(
entryCandles,
opportunity.direction,
opportunity
);

const tradePlan = confirmation.confirmed
? buildTradePlan(
opportunity.direction,
confirmation.price,
opportunity,
confirmation
)
: null;

// اگر حد ضرر معتبر نباشد، ورود تأییدشده محسوب نمی‌شود.
if (confirmation.confirmed && !tradePlan) {
confirmation.confirmed = false;
confirmation.reason =
"ورود از نظر کندل تأیید شد، اما فاصله حد ضرر بیش از حد مجاز است؛ معامله رد شد.";
}

const entryConfirmed = Boolean(
confirmation.confirmed && tradePlan
);

return {
trend,
opportunity,
confirmation,
tradePlan,
entryConfirmed
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
if (direction === 1) return "LONG";
if (direction === -1) return "SHORT";
return "بدون جهت";
}

function trendStatus(a) {
if (a.entryConfirmed) {
return a.opportunity.direction === 1
? "🟢 ورود LONG تأیید شده"
: "🔴 ورود SHORT تأیید شده";
}

if (a.opportunity.direction !== 0) {
return a.confirmation.reason;
}

return "⚪ هنوز فرصت معاملاتی مناسبی پیدا نشده";
}

function tradePlanText(a) {
if (!a.entryConfirmed || !a.tradePlan) return "";

const p = a.tradePlan;

const counterWarning = p.counterTrend
? "\n⚠️ این معامله خلاف روند ۱۵ دقیقه است؛ ریسک آن بیشتر است."
: "";

return `
📍 برنامه معامله
جهت: ${sideText(a.opportunity.direction)}
قیمت ورود: ${format(p.entry)}
حد ضرر: ${format(p.stop)}

TP1: ${format(p.targets[0])} | R:R 1:1
TP2: ${format(p.targets[1])} | R:R 1:1.5
TP3: ${format(p.targets[2])} | R:R 1:2
TP4: ${format(p.targets[3])} | R:R 1:3
${counterWarning}

حد ضرر بر اساس ساختار ۵ دقیقه و نوسان محاسبه شده است.`;
}

// ===============================
// MAIN REPORT
// ===============================

function mainReport(name, a) {
const trend = a.trend;
const opportunity = a.opportunity;

return `📊 ${name} | تحلیل اسکالپ Traid

💰 قیمت آخرین کندل ۱ دقیقه: ${format(a.confirmation.price ?? trend.price)}

━━━━━━━━━━━━━━
1️⃣ جهت بازار | ۱۵ دقیقه
${directionText(trend.direction)}
ساختار: ${trend.structure.text}
EMA20: ${format(trend.ema20)}
EMA50: ${format(trend.ema50)}
RSI: ${format(trend.rsi)}

━━━━━━━━━━━━━━
2️⃣ فرصت معاملاتی | ۵ دقیقه
${opportunity.direction === 0
? "⚪ فرصت معتبر پیدا نشد"
: `${sideText(opportunity.direction)} | امتیاز فرصت: ${opportunity.score}`}
${opportunity.reasons.map(x => `• ${x}`).join("\n")}

━━━━━━━━━━━━━━
3️⃣ تأیید ورود | ۱ دقیقه
${trendStatus(a)}

${a.entryConfirmed
? tradePlanText(a)
: "⛔ هنوز ورود تأیید نشده است."}

━━━━━━━━━━━━━━
⚠️ این ربات معامله را اجرا یا حد ضرر را زنده پایش نمی‌کند.
⚠️ تحلیل بر اساس کندل‌های بسته‌شده انجام شده است.`;
}

// ===============================
// DETAIL REPORT
// ===============================

function detailReport(name, a) {
const t = a.trend;
const o = a.opportunity;
const c = a.confirmation;

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

💰 قیمت: ${format(c.price ?? t.price)}

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

سطح مرجع سقف: ${format(o.priorHigh)}
سطح مرجع کف: ${format(o.priorLow)}
EMA20: ${format(o.ema20)}
ATR14: ${format(o.atr)}

${volumeText}

━━━━━━━━━━━━━━
3️⃣ تأیید ورود | ۱ دقیقه

وضعیت: ${c.confirmed ? "تأیید شده" : "تأیید نشده"}

${c.reason}

شکست سقف کوتاه‌مدت: ${c.bullishBreak ? "بله" : "خیر"}
شکست کف کوتاه‌مدت: ${c.bearishBreak ? "بله" : "خیر"}

کندل صعودی معتبر: ${c.bullishCandle ? "بله" : "خیر"}
کندل نزولی معتبر: ${c.bearishCandle ? "بله" : "خیر"}

━━━━━━━━━━━━━━
📍 نتیجه نهایی

${trendStatus(a)}

${a.entryConfirmed
? tradePlanText(a)
: "⛔ برنامه معامله صادر نشده است."}

نکات:
• جهت ۱۵ دقیقه، جهت غالب را مشخص می‌کند.
• فرصت ۵ دقیقه می‌تواند در شرایط خاص خلاف روند باشد.
• ورود ۱ دقیقه با شکست و کندل تأییدی بررسی می‌شود.
• حجم فقط عامل کمکی است و شرط اجباری ورود نیست.
• CVD واقعی در این نسخه پیاده‌سازی نشده است.
• SMC در این نسخه شامل بررسی ساده شکار نقدینگی است.

⚠️ این تحلیل احتمال قطعی سود را نشان نمی‌دهد.`;
}

// ===============================
// RUN ANALYSIS
// ===============================

async function runAnalysis(chatId, assets, detail, env) {
await send(
chatId,
"⏳ در حال دریافت داده‌های ۱۵، ۵ و ۱ دقیقه از TrueTrade...",
env
);

for (const asset of assets) {
try {
const symbol = SYMBOLS[asset];

const [candles15, candles5, candles1] = await Promise.all([
getCandles(symbol, "15"),
getCandles(symbol, "5"),
getCandles(symbol, "1")
]);

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

سیستم تحلیل من سه مرحله دارد:
۱۵ دقیقه: جهت بازار
۵ دقیقه: فرصت معاملاتی
۱ دقیقه: تأیید ورود

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

if (!assets.length) {
await send(
chatId,
"کدام ارز را تحلیل کنم؟",
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

