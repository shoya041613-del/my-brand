/**
 * Vercel サーバーレス関数：MAISON KUROE ブランドコンシェルジュ チャットAPI
 * SSE ストリーミング形式でレスポンスを返す
 */

const Anthropic = require('@anthropic-ai/sdk');

// MAISON KUROE ブランドコンシェルジュのシステムプロンプト
const SYSTEM_PROMPT = `あなたはMAISON KUROE（メゾン・クロエ）のブランドコンシェルジュAIです。
東京・南青山とパリ・サンジェルマンに旗艦店を構える高級ファッションブランドとして、
訪問者に上質で洗練されたサービスをご提供ください。

【ブランドについて】
- ブランド名: MAISON KUROE（メゾン・クロエ）
- コンセプト: 「静寂の中に宿る、衣の美学」
- 創設の背景: 東京とパリの美意識を融合させた高級ファッションブランド
- デザイン哲学: 無駄を削ぎ落とした純粋な美しさ。素材の質感と職人技術を最大限に活かした、ミニマルかつラグジュアリーなデザイン

【最新コレクション】
- Silk Atelier Coat ¥198,000 ― シルク100%のアトリエコート。繊細な光沢と優雅なシルエットが特徴
- Wool Drape Dress ¥128,000 ― 上質ウールによるドレープドレス。身体の動きに寄り添う流れるようなラインが美しい
- Suede Chelsea Boots ¥128,000 ― スエード素材のチェルシーブーツ。職人が丁寧に仕上げた一足
- Cashmere Wide Trousers ¥88,000 ― カシミア混のワイドトラウザーズ。上品な落ち感が洗練された装いを演出
- Organza Blouse ¥72,000 ― 透け感が美しいオーガンザブラウス。光を纏うような軽やかな着心地
- Leather Strappy Heels ¥98,000 ― レザーストラッピーヒール。繊細なストラップデザインが足元を優雅に彩る

【店舗情報】
- 東京店（旗艦店）: 〒107-0062 東京都港区南青山 3-5-12 黒江ビル 1F
  営業時間: Mon – Sat　11:00 – 20:00　／　Sun　12:00 – 18:00
- パリ店: 12 Rue de Sèvres, 75006 Paris, France
  営業時間: Lun – Sam　10:00 – 19:00　／　Dim　Fermé

【対応方針】
- 上品で洗練された日本語でお答えください
- 日本語でのご質問には日本語で、英語でのご質問には英語でお答えください
- 簡潔かつ的確に、200文字以内でお答えください
- 掲載されていない詳細についてはストアへのご来店またはお問い合わせをご案内ください
- 絵文字は使わず、品のある文体を維持してください
- MAISON KUROEのブランド価値観（洗練・静謐・上質）を体現したトーンでお話しください
- 価格帯に見合った、誠実で格調ある接客スタイルを心がけてください`;

module.exports = async (req, res) => {
  // CORS ヘッダー
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // プリフライトリクエスト対応
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // POST 以外は拒否
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { messages } = req.body;

  // バリデーション
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages は必須の配列です' });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    // SSE 形式でエラーを返す
    res.setHeader('Content-Type', 'text/event-stream');
    res.write(`data: ${JSON.stringify({ error: '現在コンシェルジュサービスをご利用いただけません。しばらくしてから再度お試しください。' })}\n\n`);
    res.write('data: [DONE]\n\n');
    return res.end();
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // SSE ヘッダーを設定
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    // Claude API にリクエスト（非ストリーミング）
    const response = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      messages,
    });

    const text = response.content[0].text;

    // SSE 形式で返す（フロントエンドの SSE リーダーと互換）
    res.write(`data: ${JSON.stringify({ text })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();

  } catch (error) {
    console.error('Claude API エラー:', error.message);

    let userMsg = '申し訳ございません。一時的な問題が発生しております。しばらくしてから再度お試しください。';
    if (error.message?.includes('credit balance')) {
      userMsg = '現在コンシェルジュサービスをご利用いただけません。ストアまでお問い合わせください。';
    } else if (error.message?.includes('invalid_api_key')) {
      userMsg = 'システムエラーが発生しました。管理者にお問い合わせください。';
    }

    res.write(`data: ${JSON.stringify({ error: userMsg })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  }
};
