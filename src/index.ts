import express from 'express'
import path from 'path'
import { fileURLToPath } from 'url'
import { JSDOM, VirtualConsole } from 'jsdom'
import axios from 'axios'
import * as cheerio from 'cheerio'
import { TextEncoder, TextDecoder } from 'util'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()

// Home route - HTML
app.get('/', (req, res) => {
  res.type('html').send(`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8"/>
        <title>Express on Vercel</title>
        <link rel="stylesheet" href="/style.css" />
      </head>
      <body>
        <nav>
          <a href="/">Home</a>
          <a href="/about">About</a>
          <a href="/api-data">API Data</a>
          <a href="/healthz">Health</a>
        </nav>
        <h1>Welcome to Express on Vercel 🚀</h1>
        <p>This is a minimal example without a database or forms.</p>
        <img src="/logo.png" alt="Logo" width="120" />
      </body>
    </html>
  `)
})

app.get('/about', function (req, res) {
  res.sendFile(path.join(__dirname, '..', 'components', 'about.htm'))
})

// Example API endpoint - JSON
app.get('/api-data', (req, res) => {
  res.json({
    message: 'Here is some sample API data',
    items: ['apple', 'banana', 'cherry'],
  })
})

// Health check
app.get('/healthz', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() })
})

class VideoLinkExtractor {
  config: any;
  foundUrls: Set<string>;

  constructor(config = {}) {
    this.config = {
      timeout: 5000,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      maxRetries: 2,
      ...config
    };
    this.foundUrls = new Set();
  }

  async fetchHtml(url: string) {
    try {
      const res = await axios.get(url, {
        headers: { 'User-Agent': this.config.userAgent },
        timeout: this.config.timeout
      });
      return res.data;
    } catch (e) {
      throw e;
    }
  }

  async processSingleUrl(url: string, retry = 0): Promise<{ masterLink: string | null, plyrLink: string | null }> {
    try {
      const html = await this.fetchHtml(url);
      const $ = cheerio.load(html);

      let plyrLink: string | null = null;

      const onclickElement = $('li[onclick]').first();
      if (onclickElement.length > 0) {
        const onclickContent = onclickElement.attr('onclick');
        const match = onclickContent?.match(/player_iframe\.location\.href\s*=\s*'(.*?)'/);
        if (match && match[1]) {
          plyrLink = match[1];
        }
      }

      let masterLink: string | null = null;

      if (plyrLink) {
        try {
          const plyrHtml = await this.fetchHtml(plyrLink);

          const virtualConsole = new VirtualConsole();
          virtualConsole.on("error", () => { });
          virtualConsole.on("warn", () => { });
          virtualConsole.on("log", () => { });

          const dom = new JSDOM(plyrHtml, {
            url: plyrLink,
            runScripts: "dangerously",
            resources: "usable",
            virtualConsole,
            beforeParse(window) {
              // @ts-ignore
              window.TextEncoder = TextEncoder;
              // @ts-ignore
              window.TextDecoder = TextDecoder;
              // @ts-ignore
              window.jwplayer = () => ({ setup: () => { }, on: () => { } });
            }
          });

          await new Promise(resolve => setTimeout(resolve, 1000));

          const doc = dom.window.document;

          const htmlContent = doc.documentElement.innerHTML;
          const matchA = htmlContent.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/);
          if (matchA) this.addVideoUrl(matchA[0]);

          doc.querySelectorAll('script').forEach(s => {
            const t = s.textContent || '';
            const matches = t.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/gi);
            if (matches) matches.forEach(m => this.addVideoUrl(m));
          });

          dom.window.close();

        } catch (e) {
          // Ignore JSDOM errors
        }
      }

      return {
        masterLink: this.getMasterLink(),
        plyrLink: plyrLink
      };

    } catch (err) {
      if (retry < this.config.maxRetries) {
        return this.processSingleUrl(url, retry + 1);
      }
      return { masterLink: null, plyrLink: null };
    }
  }

  addVideoUrl(videoUrl: string) {
    if (!videoUrl || !videoUrl.includes('.m3u8')) return;
    this.foundUrls.add(videoUrl);
  }

  getMasterLink() {
    const urls = Array.from(this.foundUrls);
    return urls.find(u => u.includes('master.m3u8')) || urls[0] || null;
  }
}

app.get('/api/extract', async (req, res) => {
  const url = req.query.url;

  if (!url || typeof url !== 'string') {
    res.status(400).json({ error: 'Missing or invalid url query parameter' });
    return;
  }

  try {
    const extractor = new VideoLinkExtractor();
    const result = await extractor.processSingleUrl(url);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
});

if (!process.env.VERCEL) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
  });
}

export default app
