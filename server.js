const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

function unescapeHtml(str) {
  return str.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

app.get('/ping', (req, res) => res.status(200).send('pong'));

app.all('/proxy', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send('Target URL required');

  try {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept-Language': 'ja,ja-JP;q=0.9,en;q=0.8',
    };

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
      responseType: 'arraybuffer',
      maxRedirects: 10,
      validateStatus: () => true
    });

    const finalUrl = response.request?.res?.responseUrl || targetUrl;

    Object.keys(response.headers).forEach(key => {
      const lower = key.toLowerCase();
      if (!['x-frame-options', 'content-security-policy', 'access-control-allow-origin'].includes(lower)) {
        res.setHeader(key, response.headers[key]);
      }
    });

    const contentType = response.headers['content-type'] || '';
    let data = response.data;

    if (contentType.includes('text/html') || contentType.includes('text/css')) {
      let text = data.toString('utf-8');

      // iframe内でのページ遷移を検知してURLバーに同期させるスクリプト
      const injectScript = `<script>window.parent.postMessage({ type: 'pageLoaded', url: '${finalUrl}' }, '*');</script>`;
      if (contentType.includes('text/html')) {
        text = text.replace(/<head[^>]*>/i, `$&${injectScript}`);
      }

      // 1. 通常のリンクや画像パスの書き換え
      text = text.replace(/(href|src|action)=["']([^"']+)["']/gi, (match, attr, url) => {
        if (url.startsWith('data:') || url.startsWith('javascript:') || url.startsWith('#')) return match;
        try {
          url = unescapeHtml(url);
          let absoluteUrl = new URL(url, finalUrl).href; 
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

      // 2. CSS内の画像の書き換え
      text = text.replace(/url\(['"]?([^'"\)]+)['"]?\)/gi, (match, url) => {
        if (url.startsWith('data:')) return match;
        try {
          url = unescapeHtml(url);
          const absoluteUrl = new URL(url, finalUrl).href;
          return `url('/proxy?url=${encodeURIComponent(absoluteUrl)}')`;
        } catch (e) {
          return match;
        }
      });

      // 3. 🌟 1秒ループの原因（<meta refresh>）をプロキシ経由に修正
      text = text.replace(/content=["']([0-9]+;\s*url=)([^"']+)["']/gi, (match, prefix, url) => {
        try {
          url = unescapeHtml(url);
          const absoluteUrl = new URL(url, finalUrl).href;
          return `content="${prefix}/proxy?url=${encodeURIComponent(absoluteUrl)}"`;
        } catch (e) {
          return match;
        }
      });

      // 4. 🌟 DuckDuckGoなら、Botにバレないよう「透明なセーフサーチOFFボタン」をフォームに仕込む
      if (finalUrl.includes('duckduckgo.com')) {
        text = text.replace(/(<form[^>]+>)/gi, '$1<input type="hidden" name="kp" value="-2">');
      }

      data = Buffer.from(text, 'utf-8');
    }

    res.status(response.status).send(data);
  } catch (err) {
    res.status(500).send(`Proxy Error: ${err.message}`);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Super Proxy live on port ${PORT}`));
