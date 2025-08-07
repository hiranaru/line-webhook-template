const express = require("express");
const line = require("@line/bot-sdk");
const vision = require("@google-cloud/vision");
const fs = require("fs");
const path = require("path");
const axios = require("axios");

// LINE Bot の設定（環境変数から読み取る）
const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET
};

const app = express();
app.use(line.middleware(config));

const client = new line.Client(config);

// Google Cloud Visionクライアントの初期化（環境変数 GOOGLE_CREDENTIALS 必須）
const visionClient = new vision.ImageAnnotatorClient({
  credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS)
});

// メインハンドラー
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
      text: "画像を送ってください！📸"
    });
  }

  try {
    // LINE画像のコンテンツを取得
    const stream = await client.getMessageContent(event.message.id);
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(chunk));
    await new Promise((resolve) => stream.on("end", resolve));
    const buffer = Buffer.concat(chunks);

    // OCRでテキストを抽出
    const [result] = await visionClient.textDetection({ image: { content: buffer } });
    const detections = result.textAnnotations;
    const text = detections.length ? detections[0].description : "テキストが認識できませんでした。";

    return client.replyMessage(event.replyToken, {
      type: "text",
      text: `🧾 読み取ったテキスト:\n${text}`
    });
  } catch (error) {
    console.error("OCR Error:", error);
    return client.replyMessage(event.replyToken, {
      type: "text",
      text: "画像の解析中にエラーが発生しました💥"
    });
  }
}

// ポート指定（Render上ではPORTが自動設定される）
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`🚀 LINE Bot server running on port ${port}`);
});
