const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>Python Bot Generated</title>
      </head>
      <body style="font-family: monospace; padding: 3rem; background: #0a0a0a; color: #e5e5e5; max-width: 800px; margin: 0 auto; line-height: 1.6;">
        <h2 style="color: #60a5fa; border-bottom: 1px solid #333; padding-bottom: 1rem;">✅ Python CLI Trading Bot Generated</h2>
        <p>I have completely replaced the web application workspace with your requested exact Python script as requested.</p>
        
        <div style="background: #111; padding: 1.5rem; border-radius: 8px; border: 1px solid #333; margin-top: 2rem;">
            <p style="margin-top: 0; color: #a1a1aa;">The following files have been created in the workspace:</p>
            <ul style="color: #fff; font-weight: bold;">
                <li style="margin-bottom: 0.5rem">nifty_trader.py</li>
                <li>requirements.txt</li>
            </ul>
        </div>

        <h3 style="margin-top: 2.5rem; color: #a1a1aa;">How to use it locally:</h3>
        <p>You can export this project via the <strong>Settings -> Export to ZIP</strong> / <strong>Export to GitHub</strong> menu in AI Studio.</p>
        <p>Or locally on your computer:</p>
        <pre style="background: #111; padding: 1.5rem; border-radius: 8px; border: 1px solid #333; overflow-x: auto; font-size: 14px; font-weight: bold;">
pip install -r requirements.txt

# Remember to edit CONFIG values: client_code, password, api_key!
# Then run:
python nifty_trader.py
        </pre>
      </body>
    </html>
  `);
});

app.listen(port, '0.0.0.0', () => {
  console.log(\`Python Wrapper Server listening on port \${port}\`);
});
