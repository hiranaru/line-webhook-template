// 追加: visionとjson読み込み
const vision = require('@google-cloud/vision');
const { GoogleAuth } = require('google-auth-library');

// GOOGLE_CREDENTIALS環境変数からクレデンシャルを作成
const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
const client = new vision.ImageAnnotatorClient({
  credentials,
});

// Webhookハンドラーの中で画像が来たら処理する
const handleEvent = async (event) => {
  // 画像メッセージ以外は無視
  if (event.message.type !== 'image') {
    return Promise.resolve(null);
  }

  try {
    // LINEサーバーから画像のバイナリを取得
    const stream = await clientConfig.getMessageContent(event.message.id);
    const chunks = [];

    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    const imageBuffer = Buffer.concat(chunks);

    // Vision APIでOCR
    const [result] = await client.textDetection({ image: { content: imageBuffer } });
    const detections = result.textAnnotations;
    const detectedText = detections[0]?.description || 'テキストが見つかりませんでした';

    // OCR結果を返信
    return clientConfig.replyMessage(event.replyToken, [
      {
        type: 'text',
        text: `画像から読み取ったテキスト:\n${detectedText}`,
      },
    ]);
  } catch (err) {
    console.error('OCRエラー:', err);
    return clientConfig.replyMessage(event.replyToken, [
      {
        type: 'text',
        text: '画像の解析中にエラーが発生しました。',
      },
    ]);
  }
};
