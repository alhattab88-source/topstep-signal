const https = require("https");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "API key not configured on Vercel" });

  const {
    instrument, session, price, vwap, pdh, pdl,
    support, resistance, atr, trend1h, vwapPos,
    account, news, extra
  } = req.body;

  const pointVals = { MNQ: 2, MES: 5, MGC: 10 };
  const pv = pointVals[instrument] || 2;

  const prompt = `أنت خبير تداول Futures Scalping متخصص في حسابات Topstep Prop Firm.

== بيانات السوق ==
الأداة: ${instrument} (قيمة النقطة: $${pv}/نقطة)
الجلسة: ${session}
السعر الحالي: ${price}
VWAP: ${vwap}
PDH: ${pdh} | PDL: ${pdl}
دعم: ${support || "غير محدد"} | مقاومة: ${resistance || "غير محدد"}
ATR: ${atr || "غير محدد"}
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

قرر: Trade أم No Trade، Long أم Short، وأعطني الأرقام الدقيقة.
أجب فقط بـ JSON صالح بدون أي نص إضافي أو backticks:
{"decision":"Trade أو No Trade","direction":"Long أو Short أو N/A","grade":"A+ أو B أو C","entry":0,"stopLoss":0,"tp1":0,"tp2":0,"stopPoints":0,"tp1Points":0,"tp2Points":0,"riskDollar":0,"tp1Dollar":0,"tp2Dollar":0,"rrRatio":"2R","contracts":1,"confidence":7,"mainReason":"جملتان واضحتان","entryLogic":"منطق الدخول","stopLogic":"منطق الستوب","targetLogic":"منطق الهدف","riskWarning":null,"psychNote":"ملاحظة نفسية"}`;

  const body = JSON.stringify({
    model: "claude-sonnet-4-6",
    max_tokens: 1000,
    messages: [{ role: "user", content: prompt }]
  });

  const options = {
    hostname: "api.anthropic.com",
    path: "/v1/messages",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Length": Buffer.byteLength(body)
    }
  };

  try {
    const data = await new Promise((resolve, reject) => {
      const r = https.request(options, (resp) => {
        let raw = "";
        resp.on("data", chunk => raw += chunk);
        resp.on("end", () => {
          try { resolve(JSON.parse(raw)); }
          catch(e) { reject(new Error("Invalid JSON from Anthropic")); }
        });
      });
      r.on("error", reject);
      r.write(body);
      r.end();
    });

    if (data.error) return res.status(400).json({ error: data.error.message });

    const text = (data.content || []).map(b => b.text || "").join("");
    const clean = text.replace(/```json|```/g, "").trim();
    const result = JSON.parse(clean);
    return res.status(200).json(result);

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
