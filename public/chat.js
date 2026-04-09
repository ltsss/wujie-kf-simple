// 访客端聊天逻辑
class ChatApp {
  constructor() {
    this.userId = this.getUserId();
    this.conversationId = null;
    this.apiUrl = '/api';
    this.lastMessageId = 0;
    
    this.initElements();
    this.bindEvents();
    this.initConversation();
  }

  getUserId() {
    let userId = localStorage.getItem('chat_user_id');
    if (!userId) {
      userId = 'user_' + Date.now();
      localStorage.setItem('chat_user_id', userId);
    }
    return userId;
  }

  initElements() {
    this.messagesEl = document.getElementById('messages');
    this.inputEl = document.getElementById('messageInput');
    this.sendBtn = document.getElementById('sendBtn');
  }

  bindEvents() {
    this.sendBtn.addEventListener('click', () => this.sendMessage());
    this.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.sendMessage();
    });
  }

  async initConversation() {
    try {
      const response = await fetch(`${this.apiUrl}/conversation/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visitorId: this.userId })
      });
      
      const data = await response.json();
      if (data.success) {
        this.conversationId = data.conversationId;
        this.addMessage('您好！我是無界茶台AI客服，有什么可以帮您？', 'bot');
        this.startPolling();
      }
    } catch (error) {
      console.error('创建会话失败:', error);
    }
  }

  async sendMessage() {
    const content = this.inputEl.value.trim();
    if (!content || !this.conversationId) return;

    this.inputEl.value = '';
    this.addMessage(content, 'user');

    try {
      await fetch(`${this.apiUrl}/message/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: this.conversationId,
          senderType: 'user',
          content: content
        })
      });
    } catch (error) {
      console.error('发送失败:', error);
    }
  }

  startPolling() {
    // 每2秒轮询新消息
    setInterval(async () => {
      if (!this.conversationId) return;
      
      try {
        const response = await fetch(`${this.apiUrl}/messages/${this.conversationId}`);
        const data = await response.json();
        
        if (data.success && data.messages) {
          data.messages.forEach(msg => {
            if (msg.id > this.lastMessageId && msg.sender_type !== 'user') {
              this.lastMessageId = msg.id;
              
              // 显示 AI 或客服消息
              const type = msg.sender_type === 'ai' ? 'bot' : 'bot';
              this.addMessage(msg.content, type);
              
              // 如果是转人工，显示提示
              if (msg.content.includes('转接人工')) {
                this.showTransferNotice();
              }
            }
          });
        }
      } catch (error) {
        console.error('轮询失败:', error);
      }
    }, 2000);
  }

  addMessage(content, type) {
    const messageEl = document.createElement('div');
    messageEl.className = `message ${type}`;
    
    const avatar = type === 'bot' ? '🍵' : '👤';
    
    messageEl.innerHTML = `
      <div class="avatar">${avatar}</div>
      <div class="content">${this.escapeHtml(content)}</div>
    `;
    
    this.messagesEl.appendChild(messageEl);
    this.scrollToBottom();
  }

  showTransferNotice() {
    const notice = document.createElement('div');
    notice.className = 'welcome';
    notice.innerHTML = '<span style="color: #ff6b6b;">已转接人工客服，请稍候...</span>';
    this.messagesEl.appendChild(notice);
    this.scrollToBottom();
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  scrollToBottom() {
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }
}

// 启动
document.addEventListener('DOMContentLoaded', () => {
  new ChatApp();
});
