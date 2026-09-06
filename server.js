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

// DuckDuckGoのPOSTフォーム検索をそのままGETのクエリに変換してプロキシへ回す
app.post('/proxy', (req, res) => {
  const q = req.body.q || '';
  const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
  res.redirect(`/proxy?url=${encodeURIComponent(searchUrl)}`);
});

app.get('/proxy', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send('Target URL required');

  try {
    const response = await axios({
      method: 'GET',
      url: targetUrl,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'ja,ja-JP;q=0.9,en;q=0.8'
      },
      responseType: 'arraybuffer', // 画像やフォントが壊れないようバイナリで取得
      validateStatus: () => true
    });

    // レスポンスヘッダー転送（iframe埋め込みブロックのみ削除）
    Object.keys(response.headers).forEach(key => {
      const lower = key.toLowerCase();
      if (lower !== 'x-frame-options' && lower !== 'content-security-policy') {
        res.setHeader(key, response.headers[key]);
      }
    });

    const contentType = response.headers['content-type'] || '';

    // HTMLファイルの場合のみ、CSS・画像・リンク・フォームのパスをプロキシ経由に書き換え
    if (contentType.includes('text/html')) {
      let html = response.data.toString('utf-8');
      const origin = new URL(targetUrl).origin;

      // 1. 相対パスの src (画像・スクリプト) をプロキシ経由へ
      html = html.replace(/src="(\/[^"]*?)"/gi, (match, p1) => {
        return `src="/proxy?url=${encodeURIComponent(origin + p1)}"`;
      });

      // 2. 相対パスの href (CSS・リンク) をプロキシ経由へ
      html = html.replace(/href="(\/[^"]*?)"/gi, (match, p1) => {
        return `href="/proxy?url=${encodeURIComponent(origin + p1)}"`;
      });

      // 3. 絶対パスリンクの書き換え (YouTube動画はInvidiousへ)
      html = html.replace(/href="(https?:\/\/[^"]*?)"/gi, (match, p1) => {
        let dest = p1;
        if (dest.includes('youtube.com/watch') || dest.includes('youtu.be/')) {
          try {
            const u = new URL(dest);
            const vid = u.searchParams.get('v') || u.pathname.slice(1);
            dest = `https://yewtu.be/watch?v=${vid}`;
          } catch (e) {}
        }
        return `href="/proxy?url=${encodeURIComponent(dest)}"`;
      });

      // 4. DuckDuckGoのPOSTフォームをプロキシ直行に書き換え
      html = html.replace(/<form\b([^>]*?)action="\/html\/"/gi, '<form$1action="/proxy"');

      res.status(response.status).send(html);
    } else {
      // 画像・CSS・フォントなどはバイナリのまま手元へ転送
      res.status(response.status).send(response.data);
    }
  } catch (err) {
    res.status(500).send(`Proxy Routing Error: ${err.message}`);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy server listening on port ${PORT}`));
