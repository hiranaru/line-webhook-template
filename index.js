const express = require("express");
const line = require("@line/bot-sdk");
const fs = require("fs");
const axios = require("axios");
const path = require("path");

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const app = express();
const client = new line.Client(config);

const API_KEY = process.env.VISION_API_KEY; // ここをRenderの環境変数に設定済みならOK！

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
            const imageBuffer = fs.readFileSync(filePath);
            const base64Image = imageBuffer.toString("base64");

            const visionRes = await axios.post(
              `https://vision.googleapis.com/v1/images:annotate?key=${API_KEY}`,
              {
                requests: [
                  {
                    image: { content: base64Image },
                    features: [{ type: "TEXT_DETECTION" }],
                  },
                ],
              }
            );

            const annotations =
              visionRes.data.responses[0].textAnnotations || [];
            const fullText = annotations.length > 0 ? annotations[0].description : "";

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
            console.error("OCR処理エラー:", error.message);
            await client.replyMessage(event.replyToken, {
              type: "text",
              text: "画像の解析中にエラーが発生しました。",
            });
          }
        });
      } catch (err) {
        console.error("画像取得エラー:", err.message);
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
