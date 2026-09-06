const express = require('express');
const axios = require('axios');
const app = express();

// フォーム送信（POST）のデータを受け取る設定
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

app.all('/proxy', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send('Target URL required');

  try {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept-Language': 'ja,ja-JP;q=0.9,en;q=0.8',
    };

    // 検索時のPOSTデータを中継するための処理
    let requestBody = req.body;
    if (req.method === 'POST') {
      if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type'];
      if (req.headers['content-type']?.includes('x-www-form-urlencoded')) {
        requestBody = new URLSearchParams(req.body).toString();
      }
    }

    const response = await axios({
      method: req.method,
      url: targetUrl,
      data: (req.method === 'POST') ? requestBody : undefined,
      headers: headers,
      responseType: 'arraybuffer', // 画像やフォントが壊れないようバイナリで取得
      validateStatus: () => true
    });

    // 邪魔なセキュリティヘッダーを消して手元に転送
    Object.keys(response.headers).forEach(key => {
      const lower = key.toLowerCase();
      if (!['x-frame-options', 'content-security-policy', 'access-control-allow-origin'].includes(lower)) {
        res.setHeader(key, response.headers[key]);
      }
    });

    const contentType = response.headers['content-type'] || '';
    let data = response.data;

    // HTMLやCSSの場合、中身のリンクや画像パスをすべて強制的にプロキシ経由に書き換える
    if (contentType.includes('text/html') || contentType.includes('text/css')) {
      let text = data.toString('utf-8');

      // href(リンク/CSS), src(画像/JS), action(フォーム) のパス書き換え
      text = text.replace(/(href|src|action)=["']([^"']+)["']/gi, (match, attr, url) => {
        // data:URIやページ内リンク(#)は除外
        if (url.startsWith('data:') || url.startsWith('javascript:') || url.startsWith('#')) return match;
        
        try {
          // 相対パスを絶対パスに自動計算
          let absoluteUrl = new URL(url, targetUrl).href;
          
          // YouTube動画リンクは自動でInvidiousへ置換
          if (absoluteUrl.includes('youtube.com/watch') || absoluteUrl.includes('youtu.be/')) {
            const u = new URL(absoluteUrl);
            const vid = u.searchParams.get('v') || u.pathname.slice(1);
            absoluteUrl = `https://yewtu.be/watch?v=${vid}`;
          }
          
          return `${attr}="/proxy?url=${encodeURIComponent(absoluteUrl)}"`;
        } catch (e) {
          return match;
        }
      });

      // CSS内の背景画像( url(...) )の書き換え
      text = text.replace(/url\(['"]?([^'"\)]+)['"]?\)/gi, (match, url) => {
        if (url.startsWith('data:')) return match;
        try {
          const absoluteUrl = new URL(url, targetUrl).href;
          return `url('/proxy?url=${encodeURIComponent(absoluteUrl)}')`;
        } catch (e) {
          return match;
        }
      });

      data = Buffer.from(text, 'utf-8');
    }

    res.status(response.status).send(data);
  } catch (err) {
    res.status(500).send(`Proxy Error: ${err.message}`);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Super Proxy live on port ${PORT}`));
