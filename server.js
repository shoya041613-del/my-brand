/**
 * TAMOTOホームページ用 チャットAPIサーバー
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

// 株式会社TAMOTO のシステムプロンプト
const SYSTEM_PROMPT = `あなたは株式会社TAMOTOのAIサポートアシスタントです。
以下の自社情報をもとに、訪問者の質問に丁寧かつ簡潔にお答えください。
記載されていない情報については「詳しくはお問い合わせください」とご案内ください。

【サービス名】
（あなたのサービス名を入力）

【サービス内容】
（提供しているサービス・商品の説明を入力）

【料金】
- LIGHT：¥50,000/年
- STANDARD：¥150,000/年
- EXECUTIVE：¥500,000/年

【営業時間・連絡先】
- 営業時間：9:00〜18:00（平日）
- メールアドレス：shoya041613@gmail.com
- お問い合わせフォーム：ページ下部からも受け付けています

【よくある質問と回答】
Q. AIチャットボットとは何ですか？
A. AIチャットボットとは、ユーザーからの問い合わせに対して自動で回答するプログラムです。24時間対応が可能で、問い合わせ対応の効率化や人件費削減に貢献します。

Q. どのような企業に向いていますか？
A. 問い合わせ対応が多い企業や、人手不足に課題を感じている企業に特におすすめです。業種を問わず導入可能です。

Q. 導入すると何が改善されますか？
A. 問い合わせ対応の自動化により、対応時間の短縮、業務負担の軽減、顧客満足度の向上が期待できます。

Q. どんな質問に対応できますか？
A. よくある質問（FAQ）、商品・サービスの案内、予約受付、問い合わせ一次対応など幅広く対応可能です。

Q. 自社の情報を学習させることはできますか？
A. はい、可能です。マニュアルやFAQデータをもとに最適化された回答を生成します。

Q. LINEやWebサイトに設置できますか？
A. はい、Webサイト・LINE・その他SNSなどに対応可能です。

Q. 導入費用はいくらですか？
A. ご要望や機能によって異なりますが、最適なプランをご提案いたします。まずはお気軽にご相談ください。

Q. 導入までどれくらいかかりますか？
A. 最短で〇日〜〇週間程度で導入可能です。内容により前後します。

Q. 初期費用はかかりますか？
A. プランにより異なりますが、初期費用あり・なしどちらもご用意可能です。

Q. 導入後のサポートはありますか？
A. はい、運用サポートや改善提案など継続的にサポートいたします。

Q. 回答内容の修正はできますか？
A. はい、いつでも更新可能です。運用しながら改善していけます。

Q. AIの回答精度はどのくらいですか？
A. 初期段階でも高精度ですが、運用データをもとに継続的に改善されていきます。

Q. セキュリティは大丈夫ですか？
A. データ管理・通信の安全性に配慮し、安心してご利用いただける環境を提供しています。

Q. 個人情報の取り扱いはどうなりますか？
A. 適切な管理体制のもとで取り扱い、外部に漏れることはありません。

【会社情報】
- 会社名：株式会社TAMOTO
- 代表者：田本翔也

【対応方針】
- 常に丁寧で親しみやすい日本語でお答えください
- 専門用語は分かりやすく説明してください
- 料金・プラン・詳細な相談はページ下部のお問い合わせフォームへご案内ください
- 営業時間外の問い合わせには「平日9:00〜18:00、またはメール（shoya041613@gmail.com）にてご連絡ください」とお伝えください
- 回答は簡潔に（長くても200文字程度）まとめてください
- 絵文字を適度に使って親しみやすい雰囲気を演出してください`;

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
    console.error('Claude API エラー:', error.message);

    // エラー内容に応じてユーザー向けメッセージを出し分ける
    let userMsg = '⚠️ エラーが発生しました。しばらくしてから再度お試しください。';
    if (error.message && error.message.includes('credit balance')) {
      userMsg = '⚠️ 現在AIチャットをご利用いただけません。お問い合わせは下部のフォームをご利用ください。';
    } else if (error.message && error.message.includes('invalid_api_key')) {
      userMsg = '⚠️ APIキーの設定に問題があります。管理者にお問い合わせください。';
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
  console.log(`✅ TAMOTOチャットサーバー起動中: http://localhost:${PORT}`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('⚠️  ANTHROPIC_API_KEY が設定されていません。.env ファイルを確認してください。');
  }
});
