const express = require("express");
const line = require("@line/bot-sdk");
const vision = require("@google-cloud/vision");

// LINE bot の設定
const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const app = express();
app.use(line.middleware(config));
const client = new line.Client(config);

// Google Cloud Vision API クライアント
const visionClient = new vision.ImageAnnotatorClient({
  credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
});

// カテゴリ分類のキーワード
const categoryKeywords = {
  食費: [
    "パン", "弁当", "ジュース", "コーヒー", "おにぎり",
    "牛乳", "惣菜", "お菓子", "カレー", "カップ麺"
  ],
  日用品: ["洗剤", "ティッシュ", "トイレットペーパー", "歯ブラシ", "シャンプー"],
  医療費: ["風邪薬", "頭痛薬", "目薬", "マスク", "絆創膏"],
};

// 商品名からカテゴリを推定
function estimateCategory(itemName) {
  for (const [category, keywords] of Object.entries(categoryKeywords)) {
    if (keywords.some((word) => itemName.includes(word))) {
      return category;
    }
  }
  return "その他";
}

// OCRテキストから支出を分類
function classifyItems(text) {
  const lines = text.split("\n");
  const categorized = {};
  let total = 0;

  for (let line of lines) {
    line = line.replace(/　/g, ""); // 全角スペースを削除

    // 除外パターン
    if (
      /合計|小計|お預|預かり|釣銭|合計金額|合計\(税込\)|消費税|現金/.test(line) ||
      /〒|TEL|[0-9]{2,4}-[0-9]{2,4}-[0-9]{3,4}|[0-9]{4}\/[0-9]{1,2}\/[0-9]{1,2}/.test(line) ||
      /^[0-9]{2,5}$/.test(line.trim())
    ) {
      continue;
    }

    // 商品名 + 金額（末尾に「円」がある場合も対応）
    const match = line.match(/(.+?)\s*([0-9]{2,5})\s*(円)?$/);
    if (match) {
      const itemName = match[1].trim();
      const price = parseInt(match[2]);

      // 異常値の除外（例：1円や10万円超）
      if (price < 10 || price > 100000) continue;

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
  try {
    const result = await Promise.all(req.body.events.map(handleEvent));
    res.json(result);
  } catch (err) {
    console.error("Webhook Error:", err);
    res.status(500).end();
  }
});

// イベント処理
async function handleEvent(event) {
  // 画像以外のメッセージは無視
  if (event.type !== "message" || event.message.type !== "image") {
    return client.replyMessage(event.replyToken, {
      type: "text",
      text: "画像を送ってください！📸",
    });
  }

  try {
    // LINEの画像メッセージを取得
    const stream = await client.getMessageContent(event.message.id);
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(chunk));
    await new Promise((resolve) => stream.on("end", resolve));
    const buffer = Buffer.concat(chunks);

    // OCR解析（Google Cloud Vision）
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

    // 分類結果のメッセージ作成
    let summary = "📊 今日の支出を分類しました！\n";
    if (Object.keys(categorized).length === 0) {
      summary += "支出項目が見つかりませんでした。";
    } else {
      for (const [category, amount] of Object.entries(categorized)) {
        summary += `- ${category}：${amount.toLocaleString()}円\n`;
      }
      summary += `- 合計：${total.toLocaleString()}円`;
    }

    const ocrMessage = `🧾 レシート全文:\n${text}`;

    // 返信
    return client.replyMessage(event.replyToken, [
      { type: "text", text: ocrMessage },
      { type: "text", text: summary },
    ]);
  } catch (error) {
    console.error("OCR Error:", error);
    return client.replyMessage(event.replyToken, {
      type: "text",
      text: "画像の解析中にエラーが発生しました💥",
    });
  }
}

// サーバー起動
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`🚀 LINE Bot server running on port ${port}`);
});
