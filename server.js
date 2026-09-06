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

        // 🌟 親フレームからの「戻る・進む・更新」指示を直接ネイティブ履歴で実行するスクリプト
        const injectScript = `
          <script>
            try { window.parent.postMessage({ type: 'pageLoaded', url: '${finalUrl}' }, '*'); } catch(e) {}
            
            window.addEventListener('message', function(e) {
              if (e.data === 'goBack') window.history.back();
              if (e.data === 'goForward') window.history.forward();
              if (e.data === 'reload') window.location.reload();
            });

            document.addEventListener('submit', function(e) {
              if(e.target && (!e.target.method || e.target.method.toLowerCase() === 'get')) {
                e.preventDefault();
                const formData = new FormData(e.target);
                const params = new URLSearchParams(formData);
                let actionUrl;
                try { actionUrl = new URL(e.target.action || window.location.href); } catch(err){ return; }
                const urlParam = actionUrl.searchParams.get('url');
                if (urlParam) {
                   const targetUrlObj = new URL(urlParam);
                   for(let [k,v] of params) { targetUrlObj.searchParams.append(k,v); }
                   window.location.href = "${proxyPrefix}" + encodeURIComponent(targetUrlObj.href);
                }
              }
            });

            document.addEventListener('click', function(e) {
               const a = e.target.closest('a');
               if(a && a.href && !a.href.includes('/proxy?url=') && !a.href.startsWith('javascript:') && !a.href.startsWith('data:') && !a.href.startsWith('#')) {
                   e.preventDefault();
                   window.location.href = "${proxyPrefix}" + encodeURIComponent(a.href);
               }
            });
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
