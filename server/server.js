// 简易版客服系统 - 服务端
const http = require('http');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const PORT = 3002;

// 初始化 SQLite 数据库
const db = new sqlite3.Database('./chat.db');

// 创建表
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    visitor_id TEXT NOT NULL,
    status TEXT DEFAULT 'ai',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL,
    sender_type TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

// Dify 配置
const DIFY_API_KEY = 'app-2wNgRmooOPx0GZevdxwKMYor';
const DIFY_API_URL = 'https://api.dify.ai/v1/chat-messages';

// 简单的 fetch
const https = require('https');
function fetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const client = urlObj.protocol === 'https:' ? https : http;
    
    const req = client.request(url, {
      method: options.method || 'GET',
      headers: options.headers || {}
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          json: () => Promise.resolve(JSON.parse(data)),
          text: () => Promise.resolve(data)
        });
      });
    });
    
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

// 调用 Dify AI
async function callDifyAI(message, userId) {
  try {
    const response = await fetch(`${DIFY_API_URL}/chat-messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${DIFY_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        inputs: {},
        query: message,
        response_mode: 'blocking',
        conversation_id: '',
        user: userId
      })
    });

    if (!response.ok) throw new Error('Dify API error');
    
    const data = await response.json();
    return data.answer;
  } catch (error) {
    console.error('Dify 调用失败:', error.message);
    return '抱歉，我暂时无法回答，请稍后再试。';
  }
}

// 静态文件服务
function serveStaticFile(res, filePath, contentType) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

// HTTP 服务
const server = http.createServer((req, res) => {
  const url = req.url;
  const method = req.method;

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  console.log(`${method} ${url}`);

  // 静态文件
  if (url === '/' || url === '/index.html') {
    serveStaticFile(res, path.join(__dirname, '../public/index.html'), 'text/html');
    return;
  }
  if (url === '/style.css') {
    serveStaticFile(res, path.join(__dirname, '../public/style.css'), 'text/css');
    return;
  }
  if (url === '/chat.js') {
    serveStaticFile(res, path.join(__dirname, '../public/chat.js'), 'application/javascript');
    return;
  }

  // API 路由
  if (url === '/api/conversation/create' && method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const visitorId = data.visitorId || 'user_' + Date.now();
        const conversationId = 'conv_' + Date.now();
        
        db.run('INSERT INTO conversations (id, visitor_id) VALUES (?, ?)', 
          [conversationId, visitorId], (err) => {
            if (err) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, error: err.message }));
              return;
            }
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              success: true,
              conversationId: conversationId
            }));
          });
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: e.message }));
      }
    });
    return;
  }

  if (url === '/api/message/send' && method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const data = JSON.parse(body);
        const { conversationId, senderType, content } = data;
        
        // 保存消息
        db.run('INSERT INTO messages (conversation_id, sender_type, content) VALUES (?, ?, ?)',
          [conversationId, senderType, content], async function(err) {
            if (err) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, error: err.message }));
              return;
            }
            
            // 如果是用户消息，调用 AI 回复
            if (senderType === 'user') {
              const aiReply = await callDifyAI(content, conversationId);
              
              // 检查是否转人工
              if (aiReply.includes('[TRANSFER]')) {
                // 更新会话状态为转人工
                db.run('UPDATE conversations SET status = ? WHERE id = ?', ['transfer', conversationId]);
                
                const cleanReply = aiReply.replace('[TRANSFER]', '').trim();
                db.run('INSERT INTO messages (conversation_id, sender_type, content) VALUES (?, ?, ?)',
                  [conversationId, 'ai', cleanReply]);
              } else {
                db.run('INSERT INTO messages (conversation_id, sender_type, content) VALUES (?, ?, ?)',
                  [conversationId, 'ai', aiReply]);
              }
            }
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, messageId: this.lastID }));
          });
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: e.message }));
      }
    });
    return;
  }

  if (url.startsWith('/api/messages/') && method === 'GET') {
    const conversationId = url.split('/')[3];
    
    db.all('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC',
      [conversationId], (err, rows) => {
        if (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
          return;
        }
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, messages: rows }));
      });
    return;
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
  console.log(`简易版客服系统已启动，端口: ${PORT}`);
});
