const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// file:/// からのリクエストを許可
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.get('/ping', (req, res) => res.status(200).send('pong'));
app.get('/', (req, res) => res.status(200).send('Proxy Gateway Live'));

// DuckDuckGoのフォーム送信（POST /html/）を受け止めて中継するハンドラー
app.post('/html/', (req, res) => {
  const query = req.body.q || '';
  res.redirect(`/proxy?url=${encodeURIComponent('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query))}`);
});

// プロトコル中継エンドポイント
app.all('/proxy', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send('Target URL required');

  try {
    const isPost = req.method === 'POST';
    const response = await axios({
      method: req.method,
      url: targetUrl,
      data: isPost ? req.body : undefined,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'ja,ja-JP;q=0.9,en;q=0.8'
      },
      responseType: 'text',
      validateStatus: () => true
    });

    // レスポンスヘッダーの転送（iframe制限ヘッダーのみ削除）
    Object.keys(response.headers).forEach(key => {
      const lower = key.toLowerCase();
      if (lower !== 'x-frame-options' && lower !== 'content-security-policy') {
        res.setHeader(key, response.headers[key]);
      }
    });

    let data = response.data;

    // HTMLコンテンツの場合、相対パスのフォームアクションやベースタグを補正
    if (typeof data === 'string' && response.headers['content-type']?.includes('text/html')) {
      const parsed = new URL(targetUrl);
      const origin = parsed.origin;
      // 相対パスのリンクやリソースを元のドメインに向ける
      if (!data.includes('<base ')) {
        data = data.replace(/<head[^>]*>/i, `$&<base href="${origin}/">`);
      }
    }

    res.status(response.status).send(data);
  } catch (err) {
    res.status(500).send(`Proxy Routing Error: ${err.message}`);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy server listening on port ${PORT}`));
