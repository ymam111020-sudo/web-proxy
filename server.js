const express = require('express');
const axios = require('axios');
const app = express();

// file:/// からのリクエストを許可するCORS設定
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.get('/ping', (req, res) => res.status(200).send('pong'));
app.get('/', (req, res) => res.status(200).send('Proxy Gateway Running'));

// プロトコル中継エンドポイント
app.get('/proxy', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send('Target URL required');

  try {
    const response = await axios({
      method: 'get',
      url: targetUrl,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'ja,ja-JP;q=0.9,en;q=0.8'
      },
      responseType: 'arraybuffer',
      validateStatus: () => true
    });

    // レスポンスヘッダーを転送（iframe制限ヘッダーのみ破棄）
    Object.keys(response.headers).forEach(key => {
      const lower = key.toLowerCase();
      if (lower !== 'x-frame-options' && lower !== 'content-security-policy') {
        res.setHeader(key, response.headers[key]);
      }
    });

    res.status(response.status).send(response.data);
  } catch (err) {
    res.status(500).send(`Proxy Routing Error: ${err.message}`);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy server listening on port ${PORT}`));
