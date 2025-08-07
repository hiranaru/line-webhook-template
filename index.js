const express = require("express");
const line = require("@line/bot-sdk");
const vision = require("@google-cloud/vision");

// LINE Bot の設定
const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const app = express();
app.use(line.middleware(config));
const client = new line.Client(config);

// Google Cloud Vision API の初期化
const visionClient = new vision.ImageAnnotatorClient({
  credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
});

// カテゴリ分類用のキーワード辞書（最低限）
const categoryKeywords = {
  食費: ["パン", "弁当", "ジュース", "コーヒー", "おにぎり", "牛乳", "惣菜", "お菓子", "カレー", "カップ麺"],
  日用品: ["洗剤", "ティッシュ", "トイレットペーパー", "歯ブラシ", "シャンプー"],
  医療費: ["風邪薬", "頭痛薬", "目薬", "マスク", "絆創膏"],
};

// カテゴリ推定ロジック
function estimateCategory(itemName) {
  for (const [category, keywords] of Object.entries(categoryKeywords)) {
    if (keywords.some((word) => itemName.includes(word))) {
      return category;
    }
  }
  return "その他";
}

// 金額抽出とカテゴリ分類
function classifyItems(text) {
  const lines = text.split("\n");
  const categorized = {};
  let total = 0;

  for (const line of lines) {
    const match = line.match(/(.+?)\s+(\d{2,5})円?/); // 例: パン 130円
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

// Webhookエンドポイント
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

    // OCR実行
    const [result] = await visionClient.textDetection({ image: { content: buffer } });
    const detections = result.textAnnotations;
    const text = detections.length ? detections[0].description : "";

    if (!text) {
      return client.replyMessage(event.replyToken, {
        type: "text",
        text: "レシートの文字を読み取れませんでした🙇‍♂️",
      });
    }

    // カテゴリ分類・集計
    const { categorized, total } = classifyItems(text);

    if (Object.keys(categorized).length === 0) {
      return client.replyMessage(event.replyToken, {
        type: "text",
        text: "支出項目が見つかりませんでした。",
      });
    }

    // 返信用メッセージ組み立て
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

// ポート指定
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`🚀 LINE Bot server running on port ${port}`);
});
