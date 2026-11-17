
const TG = "https://api.telegram.org";

async function send(env, chat, text) {
  return fetch(`${TG}/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({chat_id: chat, text})
  });
}

async function candles(symbol, interval) {
  const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=100`;
  const r = await fetch(url);
  if (!r.ok) throw new Error("Market data unavailable: " + symbol);
  return r.json();
}

function ema(values, period) {
  const k = 2 / (period + 1);
  let result = values[0];
  for (let i = 1; i < values.length; i++)
    result = values[i] * k + result * (1 - k);
  return result;
}

async function signal(symbol) {
  const [a,b,c] = await Promise.all([
    candles(symbol,"15m"),
    candles(symbol,"5m"),
    candles(symbol,"1m")
  ]);

  const closes = x => x.slice(0,-1).map(v => Number(v[4]));
  const x = closes(a), y = closes(b);
  const trend = ema(x.slice(-50),20) > ema(x.slice(-50),50);
  const trend5 = ema(y.slice(-50),20) > ema(y.slice(-50),50);

  const prev = c[c.length-3], last = c[c.length-2];
  const entry = Number(last[4]);
  const high = Number(prev[2]);
  const low = Number(prev[3]);

  let side = "";
  if (trend && trend5 && entry > high) side = "LONG";
  if (!trend && !trend5 && entry < low) side = "SHORT";
  if (!side) return null;

  const ranges = c.slice(-16,-1).map(v =>
    Number(v[2]) - Number(v[3])
  );
  const atr = ranges.reduce((s,v)=>s+v,0)/ranges.length;
  const risk = Math.max(atr*1.5, entry*0.0008);
  const sl = side === "LONG" ? entry-risk : entry+risk;
  const targets = [1,1.5,2,3].map(r =>
    side === "LONG" ? entry+r*risk : entry-r*risk
  );

  return {
    side, entry, sl, targets,
    id: String(last[0])
  };
}

async function scan(env, chat) {
  for (const symbol of ["BTCUSDT","ETHUSDT"]) {
    try {
      const s = await signal(symbol);
      if (!s) continue;

      const key = "last_" + symbol;
      if (await env.BOT_STATE.get(key) === s.id) continue;
      await env.BOT_STATE.put(key,s.id);

      const fmt = n => Number(n).toFixed(4);
      const msg =
        `⚡ SCALP ALERT — ${symbol}\n` +
        `Direction: ${s.side}\n` +
        `Entry: ${fmt(s.entry)}\n` +
        `Stop Loss: ${fmt(s.sl)}\n` +
        `TP1: ${fmt(s.targets[0])}\n` +
        `TP2: ${fmt(s.targets[1])}\n` +
        `TP3: ${fmt(s.targets[2])}\n` +
        `TP4: ${fmt(s.targets[3])}\n\n` +
        `Reference: Binance Futures\n` +
        `Check price and spread on your exchange before entry.`;
      await send(env,chat,msg);
    } catch(e) {
      await send(env,chat,`Error scanning ${symbol}: ${e.message}`);
    }
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/register") {
      if (!env.SETUP_SECRET ||
          url.searchParams.get("key") !== env.SETUP_SECRET)
        return new Response("Unauthorized",{status:401});

      const r = await fetch(
        `${TG}/bot${env.TELEGRAM_BOT_TOKEN}/setWebhook`,
        {
          method:"POST",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({
            url: url.origin + "/telegram",
            secret_token: env.WEBHOOK_SECRET
          })
        }
      );
      return new Response(await r.text());
    }

    if (url.pathname === "/telegram" && request.method === "POST") {
      if (env.WEBHOOK_SECRET &&
          request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.WEBHOOK_SECRET)
        return new Response("Forbidden",{status:403});

      const update = await request.json();
      const msg = update.message;
      if (!msg || !msg.text) return new Response("OK");

      const chat = String(msg.chat.id);
      const command = msg.text.trim().split(" ")[0].toLowerCase();
      await env.BOT_STATE.put("chat_id",chat);

      if (command === "/start") {
        await env.BOT_STATE.put("active","yes");
        await send(env,chat,"Scalp bot is ON. Use /scan for a manual scan or /stop to pause.");
      } else if (command === "/stop") {
        await env.BOT_STATE.put("active","no");
        await send(env,chat,"Scalp bot is OFF.");
      } else if (command === "/scan") {
        await send(env,chat,"Scanning BTC and ETH...");
        await scan(env,chat);
      } else {
        await send(env,chat,"Commands:\n/start - Start automatic scans\n/stop - Stop automatic scans\n/scan - Scan now");
      }
      return new Response("OK");
    }

    return new Response("Scalp alert bot is running.");
  },

  async scheduled(event, env, ctx) {
    const active = await env.BOT_STATE.get("active");
    const chat = await env.BOT_STATE.get("chat_id");
    if (active === "yes" && chat)
      ctx.waitUntil(scan(env,chat));
  }
};
