const express = require("express");
const line = require("@line/bot-sdk");
const vision = require("@google-cloud/vision");

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const app = express();
app.use(line.middleware(config));
const client = new line.Client(config);

const visionClient = new vision.ImageAnnotatorClient({
  credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
});

// カテゴリ分類キーワード（最低限）
const categoryKeywords = {
  食費: ["パン", "弁当", "ジュース", "コーヒー", "おにぎり", "牛乳", "惣菜", "お菓子", "カレー", "カップ麺"],
  日用品: ["洗剤", "ティッシュ", "トイレットペーパー", "歯ブラシ", "シャンプー"],
  医療費: ["風邪薬", "頭痛薬", "目薬", "マスク", "絆創膏"],
};

// カテゴリ推定
function estimateCategory(itemName) {
  for (const [category, keywords] of Object.entries(categoryKeywords)) {
    if (keywords.some((word) => itemName.includes(word))) {
      return category;
    }
  }
  return "その他";
}

// 商品行の分類
function classifyItems(text) {
  const lines = text.split("\n");
  const categorized = {};
  let total = 0;

  for (let line of lines) {
    line = line.replace(/　/g, ""); // 全角スペース除去

    // 「合計」「小計」「お預り」「釣銭」などのワードが入っている行はスキップ
    if (/合計|小計|お預|預かり|釣銭|合計金額|合計(税込)|消費税/.test(line)) continue;

    // 数字が2〜5桁、円の直前または後にある場合にマッチ
    const match = line.match(/(.+?)(\d{2,5})円?/);

    if (match) {
      const itemName = match[1].trim();
      const price = parseInt(match[2]);
      const category = estimateCategory(itemName);

      if (!categorized[category]) categorized[category] = 0;
      categorized[category] += price;
      total += price;
    }
  }

  return { categorized, total };
}

// Webhook
app.post("/webhook", async (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then((result) => res.json(result))
    .catch((err) => {
      console.error("Webhook Error:", err);
      res.status(500).end();
    });
});

// イベント処理
async function handleEvent(event) {
  if (event.type !== "message" || event.message.type !== "image") {
    return client.replyMessage(event.replyToken, {
      type: "text",
      text: "画像を送ってください！📸",
    });
  }

  try {
    const stream = await client.getMessageContent(event.message.id);
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(chunk));
    await new Promise((resolve) => stream.on("end", resolve));
    const buffer = Buffer.concat(chunks);

    const [result] = await visionClient.textDetection({ image: { content: buffer } });
    const detections = result.textAnnotations;
    const text = detections.length ? detections[0].description : "";

    if (!text) {
      return client.replyMessage(event.replyToken, {
        type: "text",
        text: "レシートの文字を読み取れませんでした🙇‍♂️",
      });
    }

    const { categorized, total } = classifyItems(text);

    if (Object.keys(categorized).length === 0) {
      return client.replyMessage(event.replyToken, {
        type: "text",
        text: "支出項目が見つかりませんでした。",
      });
    }

    let message = "📊 今日の支出を分類しました！\n";
    for (const [category, amount] of Object.entries(categorized)) {
      message += `- ${category}：${amount.toLocaleString()}円\n`;
    }
    message += `- 合計：${total.toLocaleString()}円`;

    return client.replyMessage(event.replyToken, {
      type: "text",
      text: message,
    });
  } catch (error) {
    console.error("OCR Error:", error);
    return client.replyMessage(event.replyToken, {
      type: "text",
      text: "画像の解析中にエラーが発生しました💥",
    });
  }
}

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`🚀 LINE Bot server running on port ${port}`);
});
