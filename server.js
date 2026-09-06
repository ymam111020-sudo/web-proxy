const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// file:/// からのリクエストを全許可
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.get('/ping', (req, res) => res.status(200).send('pong'));
app.get('/', (req, res) => res.status(200).send('Proxy Gateway Live'));

// プロキシ中継ハンドラー
app.all('/proxy', async (req, res) => {
  let targetUrl = req.query.url;
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

    // レスポンスヘッダー転送（iframe制限ヘッダーを削除）
    Object.keys(response.headers).forEach(key => {
      const lower = key.toLowerCase();
      if (lower !== 'x-frame-options' && lower !== 'content-security-policy') {
        res.setHeader(key, response.headers[key]);
      }
    });

    let data = response.data;

    // HTMLの場合、すべてのリンクとフォームを自動で /proxy 経由に書き換える
    if (typeof data === 'string' && response.headers['content-type']?.includes('text/html')) {
      const parsed = new URL(targetUrl);
      const origin = parsed.origin;

      // 1. DuckDuckGoのPOSTフォームをGET形式で /proxy に流すよう書き換え
      data = data.replace(/<form\b([^>]*?)action="\/html\/"([^>]*?)method="post"/gi, 
        `<form$1action="/proxy" method="get"$2><input type="hidden" name="url" value="https://html.duckduckgo.com/html/">`
      );

      // 2. ページ内の全 a リンク (href) を /proxy?url=... に変換
      data = data.replace(/href="(\/[^"]*?)"/gi, (match, p1) => {
        return `href="/proxy?url=${encodeURIComponent(origin + p1)}"`;
      });
      data = data.replace(/href="(https?:\/\/[^"]*?)"/gi, (match, p1) => {
        // YouTube動画リンクを踏んだ場合はInvidiousに置換
        let dest = p1;
        if (dest.includes('youtube.com/watch') || dest.includes('youtu.be/')) {
          try {
            const u = new URL(dest);
            const vid = u.searchParams.get('v') || u.pathname.slice(1);
            dest = `https://yewtu.be/watch?v=${vid}`;
          } catch(e) {}
        }
        return `href="/proxy?url=${encodeURIComponent(dest)}"`;
      });
    }

    res.status(response.status).send(data);
  } catch (err) {
    res.status(500).send(`Proxy Routing Error: ${err.message}`);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy server listening on port ${PORT}`));
