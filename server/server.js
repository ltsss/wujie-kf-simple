// 简易版客服系统 - 服务端（内存版）
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3002;

// 内存存储
const storage = {
  conversations: new Map(),
  messages: []
};

// 元器配置
const YUANQI_CONFIG = {
  apiUrl: 'https://yuanqi.tencent.com/openapi/v1/agent/chat/completions',
  appId: '2039767576540908736',
  appKey: 'gYksTp9ipJQisQ2OXwWkneF5Dq74p6ds'
};

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

// 调用元器 AI
async function callYuanqiAI(message, userId) {
  try {
    const response = await fetch(YUANQI_CONFIG.apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${YUANQI_CONFIG.appKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        assistant_id: YUANQI_CONFIG.appId,
        user_id: userId,
        stream: false,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: message
              }
            ]
          }
        ]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`元器 API error: ${errorText}`);
    }
    
    const data = await response.json();
    if (data.choices && data.choices[0] && data.choices[0].message) {
      return data.choices[0].message.content;
    }
    return '抱歉，我暂时无法回答，请稍后再试。';
  } catch (error) {
    console.error('元器调用失败:', error.message);
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
        
        storage.conversations.set(conversationId, {
          id: conversationId,
          visitorId: visitorId,
          status: 'ai',
          createdAt: new Date()
        });
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          conversationId: conversationId
        }));
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
        
        const messageId = storage.messages.length + 1;
        const message = {
          id: messageId,
          conversationId,
          senderType,
          content,
          createdAt: new Date()
        };
        storage.messages.push(message);
        
        // 如果是用户消息，调用 AI 回复
        if (senderType === 'user') {
          const aiReply = await callYuanqiAI(content, conversationId);
          
          const aiMessageId = storage.messages.length + 1;
          const aiMessage = {
            id: aiMessageId,
            conversationId,
            senderType: 'ai',
            content: aiReply,
            createdAt: new Date()
          };
          storage.messages.push(aiMessage);
        }
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, messageId }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: e.message }));
      }
    });
    return;
  }

  if (url.startsWith('/api/messages/') && method === 'GET') {
    const conversationId = url.split('/')[3];
    const messages = storage.messages.filter(m => m.conversationId === conversationId);
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, messages }));
    return;
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
  console.log(`简易版客服系统已启动，端口: ${PORT}`);
});
