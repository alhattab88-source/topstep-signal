const https = require("https");

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let raw = "";
      res.on("data", c => raw += c);
      res.on("end", () => {
        try { resolve(JSON.parse(raw)); }
        catch(e) { reject(new Error("Invalid JSON")); }
      });
    }).on("error", reject);
  });
}

function httpsPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname, path, method: "POST",
      headers: { ...headers, "Content-Length": Buffer.byteLength(body) }
    };
    const req = https.request(options, (res) => {
      let raw = "";
      res.on("data", c => raw += c);
      res.on("end", () => {
        try { resolve(JSON.parse(raw)); }
        catch(e) { reject(new Error("Invalid JSON from API")); }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ETF references for Twelve Data
const SYMBOLS = {
  MNQ: { etf: "QQQ",  name: "Micro Nasdaq (MNQ)",  pointVal: 2  },
  MES: { etf: "SPY",  name: "Micro S&P 500 (MES)", pointVal: 5  },
  MGC: { etf: "GLD",  name: "Micro Gold (MGC)",     pointVal: 10 },
};

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  const TWELVE_KEY    = process.env.TWELVE_DATA_API_KEY;
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY not set" });
  if (!TWELVE_KEY)    return res.status(500).json({ error: "TWELVE_DATA_API_KEY not set" });

  const { instrument, currentPrice, session, account, news, extra } = req.body;
  const sym = SYMBOLS[instrument];
  if (!sym) return res.status(400).json({ error: "Invalid instrument" });

  const manualPrice = parseFloat(currentPrice) || 0;
  if (!manualPrice) return res.status(400).json({ error: "يرجى إدخال السعر الحالي" });

  try {
    // ── 1. Twelve Data: daily candle for PDH/PDL ──────────────────────
    const dailyUrl = `https://api.twelvedata.com/time_series?symbol=${sym.etf}&interval=1day&outputsize=3&apikey=${TWELVE_KEY}`;
    const daily = await httpsGet(dailyUrl);

    let pdh = 0, pdl = 0;
    if (daily.values && daily.values.length >= 2) {
      pdh = parseFloat(daily.values[1].high);
      pdl = parseFloat(daily.values[1].low);
    }

    // ── 2. Twelve Data: 1H candles for VWAP + trend + ATR ─────────────
    const hourUrl = `https://api.twelvedata.com/time_series?symbol=${sym.etf}&interval=1h&outputsize=24&apikey=${TWELVE_KEY}`;
    const hourly = await httpsGet(hourUrl);

    let vwap = manualPrice, trend1h = "غير محدد";
    let support = 0, resistance = 0, atr = 0;

    if (hourly.values && hourly.values.length > 0) {
      const vals = hourly.values.map(c => ({
        h: parseFloat(c.high),
        l: parseFloat(c.low),
        c: parseFloat(c.close),
        v: parseFloat(c.volume || 1000000),
      }));

      // VWAP from today's candles (first 8 hours)
      const todayVals = vals.slice(0, 8);
      let sumPV = 0, sumV = 0;
      todayVals.forEach(c => {
        const tp = (c.h + c.l + c.c) / 3;
        sumPV += tp * c.v; sumV += c.v;
      });
      // Scale VWAP to match manual price ratio
      const etfVwap = sumV > 0 ? sumPV / sumV : vals[0].c;
      const etfPrice = vals[0].c;
      const ratio = manualPrice / etfPrice;
      vwap = etfVwap * ratio;

      // Trend
      const last3 = vals.slice(0, 3).map(c => c.c);
      if (last3[0] > last3[1] && last3[1] > last3[2]) trend1h = "صاعد";
      else if (last3[0] < last3[1] && last3[1] < last3[2]) trend1h = "هابط";
      else trend1h = "range";

      // Support / Resistance (scale to futures price)
      const highs = vals.map(c => c.h * ratio).sort((a,b) => b-a);
      const lows  = vals.map(c => c.l * ratio).sort((a,b) => a-b);
      resistance = highs[2];
      support    = lows[2];

      // PDH/PDL scaled
      pdh = pdh * ratio;
      pdl = pdl * ratio;

      // ATR scaled
      const atrVals = vals.slice(0, 14);
      const trs = atrVals.map((c, i) => {
        if (i === atrVals.length - 1) return (c.h - c.l) * ratio;
        const prevC = atrVals[i+1].c;
        return Math.max(c.h-c.l, Math.abs(c.h-prevC), Math.abs(c.l-prevC)) * ratio;
      });
      atr = trs.reduce((s,v) => s+v, 0) / trs.length;
    }

    const vwapPos = manualPrice > vwap ? "فوق VWAP" : manualPrice < vwap ? "تحت VWAP" : "عند VWAP";
    const pv = sym.pointVal;

    // ── 3. Claude Analysis ─────────────────────────────────────────────
    const prompt = `أنت خبير تداول Futures Scalping متخصص في حسابات Topstep Prop Firm.

== بيانات السوق ==
الأداة: ${instrument} — ${sym.name} (قيمة النقطة: $${pv}/نقطة)
الجلسة: ${session}
السعر الحالي (من المنصة): ${manualPrice.toFixed(2)}
VWAP (محسوب): ${vwap.toFixed(2)}
PDH (أعلى أمس): ${pdh.toFixed(2)}
PDL (أدنى أمس): ${pdl.toFixed(2)}
دعم رئيسي: ${support.toFixed(2)}
مقاومة رئيسية: ${resistance.toFixed(2)}
ATR (14): ${atr.toFixed(2)}
الاتجاه 1H: ${trend1h}
موقع السعر من VWAP: ${vwapPos}
حالة الحساب: ${account}
الأخبار: ${news}
ملاحظة: ${extra || "لا يوجد"}

== قواعد Topstep 50K ==
- مخاطرة لكل صفقة: $50-$100 كحد أقصى
- R:R لا يقل عن 1.5R (يفضل 2R)
- الستوب خلف Swing High/Low أو VWAP أو مستوى رئيسي
- لا تدخل إذا الأخبار قريبة أو الحساب قرب حد الخسارة
- قيمة نقطة ${instrument} = $${pv}
- السعر الحالي هو السعر الحقيقي من منصة التداول — استخدمه كمرجع أساسي

قرر: Trade أم No Trade، Long أم Short، وأعطني الأرقام الدقيقة.
أجب فقط بـ JSON صالح بدون أي نص إضافي أو backticks:
{"decision":"Trade أو No Trade","direction":"Long أو Short أو N/A","grade":"A+ أو B أو C","entry":0,"stopLoss":0,"tp1":0,"tp2":0,"stopPoints":0,"tp1Points":0,"tp2Points":0,"riskDollar":0,"tp1Dollar":0,"tp2Dollar":0,"rrRatio":"2R","contracts":1,"confidence":7,"mainReason":"جملتان واضحتان","entryLogic":"منطق الدخول","stopLogic":"منطق الستوب","targetLogic":"منطق الهدف","riskWarning":null,"psychNote":"ملاحظة نفسية"}`;

    const aiBody = JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }]
    });

    const aiData = await httpsPost("api.anthropic.com", "/v1/messages", {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01"
    }, aiBody);

    if (aiData.error) return res.status(400).json({ error: aiData.error.message });

    const text  = (aiData.content || []).map(b => b.text || "").join("");
    const clean = text.replace(/```json|```/g, "").trim();
    const result = JSON.parse(clean);

    return res.status(200).json({
      ...result,
      marketData: {
        price:      manualPrice.toFixed(2),
        vwap:       vwap.toFixed(2),
        pdh:        pdh.toFixed(2),
        pdl:        pdl.toFixed(2),
        support:    support.toFixed(2),
        resistance: resistance.toFixed(2),
        atr:        atr.toFixed(2),
        trend1h,
        vwapPos,
        fetchedAt:  new Date().toISOString()
      }
    });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
