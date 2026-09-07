const express = require('express');
const axios = require('axios');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// 静的ファイルの配信（browser.html, transcribe.html など）
app.use(express.static(path.join(__dirname, 'public')));

// 🌟 Google検索などの相対パス（/search など）を直前のRefererから復元して中継する
app.use((req, res, next) => {
  if (req.path.startsWith('/proxy') || req.path.includes('.') || req.path === '/') {
    return next();
  }

  const referer = req.headers['referer'];
  if (referer && referer.includes('/proxy?url=')) {
    try {
      const prevTarget = decodeURIComponent(referer.split('/proxy?url=')[1]);
      const prevUrlObj = new URL(prevTarget);
      const fixedTarget = new URL(req.originalUrl, prevUrlObj.origin).toString();
      return res.redirect(`/proxy?url=${encodeURIComponent(fixedTarget)}`);
    } catch (e) {
      console.error('URL rewrite error:', e);
    }
  }
  next();
});

// 🌟 プロキシ本体処理
app.get('/proxy', async (req, res) => {
  let targetUrl = req.query.url;

  if (!targetUrl) {
    return res.status(400).send('Target URL required');
  }

  if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
    targetUrl = 'https://' + targetUrl;
  }

  try {
    const urlObj = new URL(targetUrl);

    // 🌟 メモリに溜め込まずストリームで受け取る設定（巨大ファイル・ダウンロード保護）
    const response = await axios({
      method: 'GET',
      url: targetUrl,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
        'Referer': urlObj.origin
      },
      responseType: 'stream',
      validateStatus: () => true
    });

    const contentType = response.headers['content-type'] || '';

    // HTMLファイルの場合：URLの書き換えと<base>タグの注入を行う
    if (contentType.includes('text/html')) {
      let chunks = [];
      response.data.on('data', chunk => chunks.push(chunk));
      response.data.on('end', () => {
        let html = Buffer.concat(chunks).toString('utf-8');

        // 相対リンクの解決用 <base> タグを挿入
        const baseTag = `<base href="${urlObj.origin}/">`;
        if (html.includes('<head>')) {
          html = html.replace('<head>', `<head>${baseTag}`);
        } else {
          html = baseTag + html;
        }

        // フォームやリンクの遷移先をプロキシ経由に差し替え
        html = html.replace(/href="(http[^"]+)"/g, (match, p1) => `href="/proxy?url=${encodeURIComponent(p1)}"`);
        html = html.replace(/src="(http[^"]+)"/g, (match, p1) => `src="/proxy?url=${encodeURIComponent(p1)}"`);

        res.set('Content-Type', 'text/html; charset=utf-8');
        res.status(response.status).send(html);
      });
      response.data.on('error', (err) => {
        console.error('HTML stream error:', err);
        res.status(500).send('Stream error');
      });
    } else {
      // 🌟 画像・音声・zip・exe等のファイル：メモリに載せず直通パイプで流す
      if (response.headers['content-disposition']) {
        res.set('Content-Disposition', response.headers['content-disposition']);
      }
      res.set('Content-Type', contentType);
      res.status(response.status);
      response.data.pipe(res);
    }
  } catch (error) {
    console.error('Proxy Error:', error.message);
    res.status(500).send('Proxy Connection Failed');
  }
});

// ルートアクセス時はブラウザUIを表示
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'browser.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
