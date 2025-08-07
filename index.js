const express = require("express");
const line = require("@line/bot-sdk");
const vision = require("@google-cloud/vision");
const fs = require("fs");
const axios = require("axios");
const path = require("path");

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const app = express();
const client = new line.Client(config);
const visionClient = new vision.ImageAnnotatorClient();

app.post("/webhook", line.middleware(config), async (req, res) => {
  const events = req.body.events;

  for (const event of events) {
    if (event.type === "message" && event.message.type === "image") {
      try {
        const messageId = event.message.id;
        const stream = await client.getMessageContent(messageId);
        const filePath = path.join(__dirname, "temp.jpg");

        const writable = fs.createWriteStream(filePath);
        stream.pipe(writable);

        writable.on("finish", async () => {
          try {
            const [result] = await visionClient.textDetection(filePath);
            const detections = result.textAnnotations;
            const fullText = detections.length > 0 ? detections[0].description : "";

            // 💡 金額抽出：¥や円が付いてるもの、数字っぽいものを正規表現で抜き出し
            const prices = fullText.match(/(?:¥|￥)?\d{1,3}(?:,\d{3})*(?:円)?/g) || [];

            const replyText = prices.length > 0
              ? `🧾 金額らしきものを見つけました：\n${prices.join("\n")}`
              : "金額らしきものが見つかりませんでした。";

            await client.replyMessage(event.replyToken, {
              type: "text",
              text: replyText,
            });

            fs.unlinkSync(filePath);
          } catch (error) {
            console.error("OCR処理エラー:", error);
            await client.replyMessage(event.replyToken, {
              type: "text",
              text: "画像の解析中にエラーが発生しました。",
            });
          }
        });
      } catch (err) {
        console.error("画像取得エラー:", err);
        await client.replyMessage(event.replyToken, {
          type: "text",
          text: "画像を取得できませんでした。",
        });
      }
    }
  }

  res.sendStatus(200);
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`LINE bot is running on port ${port}`);
});
