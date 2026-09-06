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
    const proxyPrefix = `https://${req.get('host')}/proxy?url=`;

    Object.keys(response.headers).forEach(key => {
      const lower = key.toLowerCase();
      if (!['x-frame-options', 'content-security-policy', 'access-control-allow-origin', 'strict-transport-security', 'x-xss-protection'].includes(lower)) {
        res.setHeader(key, response.headers[key]);
      }
    });

    const contentType = response.headers['content-type'] || '';
    let data = response.data;

    if (contentType.includes('text/html') || contentType.includes('text/css')) {
      let text = data.toString('utf-8');

      if (contentType.includes('text/html')) {
        text = text.replace(/<base[^>]*>/gi, '');
        text = text.replace(/target\s*=\s*(["']?)_blank\1/gi, '');

        // 🌟 サイト独自のJSを「強制停止（stopImmediatePropagation）」させてプロキシへ誘導
        const injectScript = `
          <script>
            try { window.parent.postMessage({ type: 'pageLoaded', url: '${finalUrl}' }, '*'); } catch(e) {}
            
            document.addEventListener('submit', function(e) {
              e.preventDefault();
              e.stopPropagation();
              e.stopImmediatePropagation(); // サイト側のJSを強制ストップ
              
              const form = e.target;
              const method = (form.method || 'get').toLowerCase();
              let actionUrl = form.action || window.location.href;
              
              let realUrl = actionUrl;
              try {
                 const u = new URL(actionUrl);
                 if (u.searchParams.has('url')) realUrl = u.searchParams.get('url');
              } catch(err){}

              if (method === 'get') {
                 const targetUrlObj = new URL(realUrl, window.location.href);
                 const formData = new FormData(form);
                 for(let [k,v] of formData) { targetUrlObj.searchParams.append(k,v); }
                 window.location.href = "${proxyPrefix}" + encodeURIComponent(targetUrlObj.href);
              } else {
                 form.action = "${proxyPrefix}" + encodeURIComponent(realUrl);
                 form.submit();
              }
            }, true); // true（キャプチャフェーズで最優先実行）

            document.addEventListener('click', function(e) {
               const a = e.target.closest('a');
               if(a && a.href && !a.href.includes('/proxy?url=') && !a.href.startsWith('javascript:') && !a.href.startsWith('data:') && !a.href.startsWith('#')) {
                   e.preventDefault();
                   e.stopPropagation();
                   e.stopImmediatePropagation(); // リンククリック時もサイト側JSを強制ストップ
                   window.location.href = "${proxyPrefix}" + encodeURIComponent(a.href);
               }
            }, true);
          </script>
        `;
        text = text.replace(/<head[^>]*>/i, `$&${injectScript}`);
      }

      text = text.replace(/(href|src|action)\s*=\s*(?:["']([^"']+)["']|([^\s>]+))/gi, (match, attr, quoted, unquoted) => {
        let url = quoted || unquoted;
        if (!url || url.startsWith('data:') || url.startsWith('javascript:') || url.startsWith('#')) return match;
        try {
          url = unescapeHtml(url);
          let absoluteUrl = new URL(url, finalUrl).href; 
          if (absoluteUrl.includes('youtube.com/watch') || absoluteUrl.includes('youtu.be/')) {
            const u = new URL(absoluteUrl);
            const vid = u.searchParams.get('v') || u.pathname.slice(1);
            absoluteUrl = `https://yewtu.be/watch?v=${vid}`;
          }
          return `${attr}="${proxyPrefix}${encodeURIComponent(absoluteUrl)}"`;
        } catch (e) {
          return match;
        }
      });

      text = text.replace(/url\(\s*(?:["']([^'"\)]+)["']|([^'"\)]+))\s*\)/gi, (match, quoted, unquoted) => {
        let url = quoted || unquoted;
        if (!url || url.startsWith('data:')) return match;
        try {
          url = unescapeHtml(url);
          const absoluteUrl = new URL(url, finalUrl).href;
          return `url("${proxyPrefix}${encodeURIComponent(absoluteUrl)}")`;
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
