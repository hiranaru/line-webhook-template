const express = require('express');
const { Client, middleware } = require('@line/bot-sdk');
const vision = require('@google-cloud/vision');
const { GoogleAuth } = require('google-auth-library');

// LINE Bot設定
const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const app = express();
const lineClient = new Client(config);

// 追加: GOOGLE_CREDENTIALS 環境変数から Vision API クライアントを作成
const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
const visionClient = new vision.ImageAnnotatorClient({ credentials });

// LINEのWebhookを受け取る
app.post('/webhook', middleware(config), (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then((result) => res.json(result))
    .catch((err) => {
      console.error(err);
      res.status(500).end();
    });
});

// イベントハンドラー
const handleEvent = async (event) => {
  // 画像以外のメッセージは無視
  if (event.type !== 'message' || event.message.type !== 'image') {
    return Promise.resolve(null);
  }

  try {
    // 画像のバイナリ取得
    const stream = await lineClient.getMessageContent(event.message.id);
    const chunks = [];

    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    const imageBuffer = Buffer.concat(chunks);

    // Vision APIでOCR
    const [result] = await visionClient.textDetection({ image: { content: imageBuffer } });
    const detections = result.textAnnotations;
    const detectedText = detections[0]?.description || 'テキストが見つかりませんでした';

    // 結果を返信
    return lineClient.replyMessage(event.replyToken, [
      {
        type: 'text',
        text: `画像から読み取ったテキスト:\n${detectedText}`,
      },
    ]);
  } catch (err) {
    console.error('OCRエラー:', err);
    return lineClient.replyMessage(event.replyToken, [
      {
        type: 'text',
        text: '画像の解析中にエラーが発生しました。',
      },
    ]);
  }
};

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Listening on port ${port}`);
});
