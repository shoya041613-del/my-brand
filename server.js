/**
 * MAISON KUROE ブランドコンシェルジュ チャットAPIサーバー
 * Claude Haiku を使ったストリーミング応答を提供する
 */

const fs   = require('fs');
const path = require('path');

// .env ファイルを直接パースして環境変数に設定
// （シェルの dotenvx インターセプトを回避するため fs で直読み）
try {
  const envText = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  for (const line of envText.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    // 空文字の場合も含めて .env の値で上書きする
    if (key) process.env[key] = val;
  }
} catch {
  // .env が存在しない場合は既存の環境変数をそのまま使う
}

const express  = require('express');
const Anthropic = require('@anthropic-ai/sdk');

const app  = express();
app.use(express.json());

// Anthropic クライアントの初期化
const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

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
- 掲載されていない詳細については「ぜひ直接ストアへお越しください」とご案内ください
- 絵文字は使わず、品のある文体を維持してください
- MAISON KUROEのブランド価値観（洗練・静謐・上質）を体現したトーンでお話しください
- 価格帯に見合った、誠実で格調ある接客スタイルを心がけてください`;

/**
 * POST /api/chat
 * リクエストボディ: { messages: [{role, content}] }
 * レスポンス: SSE ストリーム（text/event-stream）
 */
app.post('/api/chat', async (req, res) => {
  const { messages } = req.body;

  // バリデーション
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages は必須の配列です' });
  }

  // APIキーの確認
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY が設定されていません' });
  }

  // SSE ヘッダーを設定
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    // Claude API にストリーミングリクエストを送信
    const stream = client.messages.stream({
      model: 'claude-haiku-4-5',
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      messages: messages,
    });

    // テキストデルタをSSEで順次送信
    for await (const event of stream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        res.write(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`);
      }
    }

    // ストリーム完了を通知
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error) {
    console.error('Claude API エラー:', error.status ?? '', error.message);

    // エラー内容に応じてユーザー向けメッセージを出し分ける
    let userMsg = '申し訳ございません。一時的な問題が発生しております。しばらくしてから再度お試しください。';

    const status  = error.status;
    const message = (error.message ?? '').toLowerCase();

    if (status === 429 || message.includes('rate_limit') || message.includes('you\'ve hit your limit') || message.includes('resets')) {
      // レート制限 / 利用上限超過
      userMsg = '現在、アクセスが集中しております。しばらく時間をおいてから再度お試しください。';
    } else if (status === 529 || message.includes('overloaded')) {
      // API サーバー過負荷
      userMsg = 'AIサービスが一時的に混雑しております。少し後ほど再度お試しください。';
    } else if (message.includes('credit balance') || message.includes('billing')) {
      // クレジット残高不足
      userMsg = '現在AIチャットをご利用いただけません。お問い合わせは下部のフォームをご利用ください。';
    } else if (message.includes('invalid_api_key') || message.includes('authentication')) {
      // APIキー不正
      userMsg = 'AIサービスの設定に問題があります。管理者にお問い合わせください。';
    }

    // SSE ヘッダー送信済みか確認してからレスポンスを書き込む
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();
    }
    res.write(`data: ${JSON.stringify({ error: userMsg })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  }
});

// ヘルスチェック用エンドポイント
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', model: 'claude-haiku-4-5' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`✅ MAISON KUROE コンシェルジュサーバー起動中: http://localhost:${PORT}`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('⚠️  ANTHROPIC_API_KEY が設定されていません。.env ファイルを確認してください。');
  }
});
