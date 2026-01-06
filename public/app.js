class AIGroupChat {
  constructor() {
    this.socket = io();
    this.currentConversationId = null;
    this.availableModels = [];
    this.participantCount = 0;
    this.streamingMessageIds = new Set();

    marked.setOptions({
      breaks: true,
      gfm: true
    });

    this.initializeElements();
    this.setupEventListeners();
    this.loadAvailableModels();
    this.loadConversations();

    console.log("AI Group Chat initialized");
  }

  initializeElements() {
    this.offCanvas = document.getElementById("offcanvasExample");
    this.welcomeScreen = document.getElementById("welcome-screen");
    this.setupModal = document.getElementById("setup-modal");
    this.chatInterface = document.getElementById("chat-interface");
    this.loadingOverlay = document.getElementById("loading-overlay");
    this.notification = document.getElementById("notification");
    this.sidebar = document.getElementById("sidebar");
    this.mobileMenuToggle = document.getElementById("mobile-menu-toggle");
    this.sidebarOverlay = document.getElementById("sidebar-overlay");
    this.conversationsList = document.getElementById("conversations-list");
    this.newConversationBtn = document.getElementById("new-conversation-btn");
    this.welcomeNewBtn = document.getElementById("welcome-new-btn");
    this.closeModal = document.getElementById("close-modal");
    this.conversationTitle = document.getElementById("conversation-title");
    this.conversationTopic = document.getElementById("conversation-topic");
    this.messageLimit = document.getElementById("message-limit");
    this.participantsContainer = document.getElementById(
      "participants-container"
    );
    this.addParticipantBtn = document.getElementById("add-participant-btn");
    this.createConversationBtn = document.getElementById(
      "create-conversation-btn"
    );
    this.cancelBtn = document.getElementById("cancel-btn");
    this.chatTitle = document.getElementById("chat-title");
    this.chatTopic = document.getElementById("chat-topic");
    this.participantCountEl = document.getElementById("participant-count");
    this.messageCounter = document.getElementById("message-counter");
    this.participantsBar = document.getElementById("participants-bar");
    this.chatMessages = document.getElementById("chat-messages");
    this.messageInput = document.getElementById("message-input");
    this.sendBtn = document.getElementById("send-btn");
    this.startBtn = document.getElementById("start-btn");
    this.stopBtn = document.getElementById("stop-btn");
    this.leaveBtn = document.getElementById("leave-btn");
    this.aiStatus = document.getElementById("ai-status");
    this.notificationMessage = document.getElementById("notification-message");
    this.notificationClose = document.getElementById("notification-close");
  }

  setupEventListeners() {
    if (this.mobileMenuToggle) {
      this.mobileMenuToggle.addEventListener("click", () =>
        this.toggleSidebar()
      );
    }
    if (this.sidebarOverlay) {
      this.sidebarOverlay.addEventListener("click", () => this.closeSidebar());
    }

    this.newConversationBtn.addEventListener("click", e => {
      e.preventDefault();
      this.showSetupModal();
    });

    this.welcomeNewBtn.addEventListener("click", e => {
      e.preventDefault();
      this.showSetupModal();
    });

    this.closeModal.addEventListener("click", e => {
      e.preventDefault();
      this.hideSetupModal();
    });

    this.cancelBtn.addEventListener("click", e => {
      e.preventDefault();
      this.hideSetupModal();
    });

    this.addParticipantBtn.addEventListener("click", e => {
      e.preventDefault();
      this.addParticipant();
    });

    this.createConversationBtn.addEventListener("click", e => {
      e.preventDefault();
      this.createConversation();
    });

    this.sendBtn.addEventListener("click", e => {
      e.preventDefault();
      this.sendMessage();
    });

    this.messageInput.addEventListener("keypress", e => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });

    this.startBtn.addEventListener("click", e => {
      e.preventDefault();
      this.startConversation();
    });

    this.stopBtn.addEventListener("click", e => {
      e.preventDefault();
      this.stopConversation();
    });

    this.leaveBtn.addEventListener("click", e => {
      e.preventDefault();
      this.leaveConversation();
    });

    this.notificationClose.addEventListener("click", e => {
      e.preventDefault();
      this.hideNotification();
    });

    // Close modal when clicking backdrop
    const modal = document.getElementById("setup-modal");
    modal.addEventListener("click", e => {
      if (e.target.classList.contains("modal-backdrop")) {
        this.hideSetupModal();
      }
    });

    this.setupSocketListeners();
  }

  setupSocketListeners() {
    this.socket.on("conversation-created", data => {
      console.log("Socket event: conversation-created", data);
      this.hideLoading();
      if (data.success) {
        this.hideSetupModal();
        this.joinConversation(data.conversationId);
        this.loadConversations();
        this.showNotification(
          "Conversation created! Starting discussion...",
          "success"
        );
      } else {
        this.showNotification(`Error: ${data.error}`, "error");
      }
    });

    this.socket.on("join-result", data => {
      console.log("Socket event: join-result", data);
      this.hideLoading();
      if (data.success) {
        this.setupChatInterface(data);

        if (data.messages.length === 0) {
          setTimeout(() => {
            this.startConversation();
          }, 1000);
        }

        this.showNotification("Joined conversation successfully!", "success");
      } else {
        this.showNotification(`Error: ${data.error}`, "error");
      }
    });

    this.socket.on("new-message", message => {
      console.log("Socket event: new-message", message);
      if (!document.getElementById(`msg-${message.id}`)) {
        this.addMessageToChat(message);
        this.updateMessageCounter();
      }
    });

    this.socket.on("message-sent", data => {
      console.log("Socket event: message-sent", data);
      // Message was successfully sent and saved
    });

    this.socket.on("ai-stream-start", data => {
      console.log("Socket event: ai-stream-start", data);
      this.streamingMessageIds.add(data.id);
      this.addMessageToChat(
        {
          id: data.id,
          senderType: data.senderType,
          senderName: data.senderName,
          modelName: data.modelName,
          content: "",
          timestamp: data.timestamp
        },
        true
      );
    });

    this.socket.on("ai-stream-chunk", data => {
      const contentDiv = document.getElementById(`content-${data.id}`);
      if (contentDiv) {
        let currentRaw = contentDiv.dataset.raw || "";
        currentRaw += data.content;
        contentDiv.dataset.raw = currentRaw;
        contentDiv.innerHTML = marked.parse(currentRaw);
        this.scrollToBottom();
      }
    });

    this.socket.on("ai-stream-complete", data => {
      console.log("Socket event: ai-stream-complete", data);
      this.streamingMessageIds.delete(data.streamId);

      const messageRow = document.getElementById(`msg-${data.streamId}`);
      const contentDiv = document.getElementById(`content-${data.streamId}`);

      if (messageRow && contentDiv) {
        messageRow.id = `msg-${data.dbId}`;
        contentDiv.id = `content-${data.dbId}`;
        contentDiv.innerHTML = marked.parse(data.fullContent);
        contentDiv.dataset.raw = data.fullContent;

        // Highlight code blocks
        const codeBlocks = contentDiv.querySelectorAll("pre code");
        codeBlocks.forEach(block => {
          hljs.highlightElement(block);
        });
      }
      this.updateMessageCounter();
    });

    this.socket.on("ai-thinking", data => {
      console.log("Socket event: ai-thinking", data);
      this.showAIThinking(data.aiName);
    });

    this.socket.on("ai-error", data => {
      console.log("Socket event: ai-error", data);
      this.hideAIThinking();
      this.showNotification(data.error, "error");
    });

    this.socket.on("conversation-stopped", data => {
      console.log("Socket event: conversation-stopped", data);
      this.hideAIThinking();
      this.startBtn.style.display = "inline-block";
      this.stopBtn.style.display = "none";
      const reason = data?.reason ? ` (${data.reason})` : "";
      this.showNotification(`Conversation stopped${reason}`, "warning");
    });

    this.socket.on("message-error", data => {
      console.log("Socket event: message-error", data);
      this.showNotification(`Message error: ${data.error}`, "error");
    });

    this.socket.on("conversation-error", data => {
      console.log("Socket event: conversation-error", data);
      this.showNotification(`Conversation error: ${data.error}`, "error");
    });
  }

  async loadAvailableModels() {
    console.log("Loading available models...");
    try {
      const response = await fetch("/api/models");
      const data = await response.json();
      if (data.success) {
        this.availableModels = data.models;
        console.log("Models loaded:", this.availableModels.length);
      } else {
        this.showNotification("Failed to load available models", "error");
      }
    } catch (error) {
      console.error("Error loading models:", error);
      this.showNotification("Error loading models", "error");
    }
  }

  async loadConversations() {
    console.log("Loading conversations...");
    try {
      const response = await fetch("/api/conversations");
      const data = await response.json();
      if (data.success) {
        this.renderConversationsList(data.conversations);
        console.log("Conversations loaded:", data.conversations.length);
      }
    } catch (error) {
      console.error("Error loading conversations:", error);
    }
  }

  renderConversationsList(conversations) {
    this.conversationsList.innerHTML = "";

    conversations.forEach(conv => {
      const item = document.createElement("div");
      item.className = "conversation-item";
      item.dataset.conversationId = conv.id;

      const lastMessageTime = conv.last_message_at
        ? new Date(conv.last_message_at).toLocaleString()
        : "No messages";

      item.innerHTML = `
            <div class="conversation-head">
                <h4 class="conversation-head-title">${conv.title}</h4>
                <span class="delete-message-btn"><i class="fas fa-trash delete-message-icon"></i></span>
            </div>
                <p>${conv.topic.slice(0, 200) || "No topic set"}</p>
                <div class="conversation-meta">
                    <span>${conv.total_messages} messages</span>
                    <span>${lastMessageTime}</span>
                </div>
            `;

      const deleteBtn = item.querySelector(".delete-message-btn");
      deleteBtn.addEventListener("click", e => {
        e.stopPropagation(); // Prevent selecting the conversation
        this.deleteConversation(conv.id);
      });

      item.addEventListener("click", () => {
        this.selectConversation(conv.id);
      });

      this.conversationsList.appendChild(item);
    });
  }

  selectConversation(conversationId) {
    document.querySelectorAll(".conversation-item").forEach(item => {
      item.classList.remove("active");
    });
    document
      .querySelector(`[data-conversation-id="${conversationId}"]`)
      ?.classList.add("active");

    this.joinConversation(conversationId);
    this.closeSidebar();

    const myOffcanvas = document.getElementById("offcanvasExample");
    const bsOffcanvas = bootstrap.Offcanvas.getInstance(myOffcanvas);
    if (bsOffcanvas) {
      bsOffcanvas.hide();
    }
  }

  joinConversation(conversationId) {
    console.log("Joining conversation:", conversationId);
    this.showLoading();
    this.currentConversationId = conversationId;
    this.socket.emit("join-conversation", { conversationId });
  }

  setupChatInterface(data) {
    this.welcomeScreen.style.display = "none";
    this.chatInterface.style.display = "flex";

    this.chatTitle.textContent = data.conversation.title;
    this.chatTopic.textContent = `${data.conversation.topic.slice(0, 150) || "No topic set"}`;

    this.renderParticipants(data.participants);

    this.chatMessages.innerHTML = "";
    data.messages.forEach(message => {
      this.addMessageToChat({
        id: message.id,
        senderType: message.sender_type,
        senderName: message.sender_name,
        modelName: message.model_name,
        content: message.content,
        timestamp: message.created_at
      });
    });

    this.updateMessageCounter(
      data.conversation.message_count,
      data.conversation.message_limit
    );

    this.messageInput.disabled = false;
    this.sendBtn.disabled = false;

    if (data.conversation.is_active) {
      this.startBtn.style.display = "none";
      this.stopBtn.style.display = "inline-block";
    } else {
      this.startBtn.style.display = "inline-block";
      this.stopBtn.style.display = "none";
    }

    this.leaveBtn.style.display = "inline-block";

    this.scrollToBottom();
  }

  renderParticipants(participants) {
    this.participantsBar.innerHTML = "";
    this.participantsBar.style.display = "flex";
    this.participantCountEl.textContent = `${participants.length} participants`;

    participants.forEach(participant => {
      const badge = document.createElement("div");
      badge.className = "participant-badge";
      badge.innerHTML = `
                <span>${participant.personality_name}</span>
                <span class="model-name">${participant.model_name.split("/").pop()}</span>
            `;
      this.participantsBar.appendChild(badge);
    });
  }

  showSetupModal() {
    const modal = document.getElementById("setup-modal");
    modal.classList.add("show");
    document.body.classList.add("modal-open");
    this.resetSetupForm();
    this.addParticipant();
  }

  hideSetupModal() {
    const modal = document.getElementById("setup-modal");
    modal.classList.remove("show");
    document.body.classList.remove("modal-open");
  }

  resetSetupForm() {
    this.conversationTitle.value = "";
    this.conversationTopic.value = "";
    this.messageLimit.value = "20";
    this.participantsContainer.innerHTML = "";
    this.participantCount = 0;
  }

  addParticipant() {
    this.participantCount++;
    const participantCard = document.createElement("div");
    participantCard.className = "participant-card";
    participantCard.innerHTML = `
            <button type="button" class="remove-participant" onclick="this.parentElement.remove()">×</button>
            <div class="form-row">
                <div class="form-col">
                    <select class="model-select form-select" required>
                        <option value="">Select a model...</option>
                        ${this.availableModels
                          .map(
                            model =>
                              `<option value="${model.id}" data-provider="${model.provider}">${model.name} (${model.provider})</option>`
                          )
                          .join("")}
                    </select>
                </div>
                <div class="form-col">
                    <input type="text" class="personality-name form-control" placeholder="Name (e.g., Dr. Smith)" required>
                </div>
                <div class="form-col">
                    <input type="text" class="personality-short-details form-control" placeholder="Details (e.g., Friend doctor)" required>
                </div>
            </div>
            <div class="form-group">
                <textarea class="system-instruction form-control" placeholder="Describe the AI's personality and behavior..." rows="3"></textarea>
                <button type="button" class="btn btn-lg generate-personality-btn">Generate with AI</button>
            </div>
        `;

    const generateBtn = participantCard.querySelector(
      ".generate-personality-btn"
    );
    generateBtn.addEventListener("click", () =>
      this.generatePersonality(participantCard)
    );

    this.participantsContainer.appendChild(participantCard);
  }

  async generatePersonality(participantCard) {
    const modelSelect = participantCard.querySelector(".model-select");
    const personalityName = participantCard.querySelector(".personality-name");
    const personalityShortDetails = participantCard.querySelector(
      ".personality-short-details"
    );
    const personalityDetails = participantCard.querySelector(
      ".system-instruction"
    );

    if (!modelSelect.value || !personalityName.value) {
      this.showNotification(
        "Please select a model and enter a personality name first",
        "warning"
      );
      return;
    }

    const generateBtn = participantCard.querySelector(
      ".generate-personality-btn"
    );
    generateBtn.disabled = true;
    generateBtn.textContent = "Generating...";

    try {
      const response = await fetch("/api/generate-personality", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          modelId: modelSelect.value,
          provider: modelSelect.selectedOptions[0].dataset.provider,
          personalityName: personalityName.value,
          personalityShortDetails: personalityShortDetails.value
        })
      });

      const data = await response.json();
      if (data.success) {
        personalityDetails.value = data.instruction;
        this.showNotification("Personality generated successfully!", "success");
      } else {
        this.showNotification(`Error: ${data.error}`, "error");
      }
    } catch (error) {
      console.error("Error generating personality:", error);
      this.showNotification("Error generating personality", "error");
    } finally {
      generateBtn.disabled = false;
      generateBtn.textContent = "Generate with AI";
    }
  }

  async createConversation() {
    const title = this.conversationTitle.value.trim();
    const topic = this.conversationTopic.value.trim();
    const messageLimit = parseInt(this.messageLimit.value) || 0;

    if (!title || !topic) {
      this.showNotification("Please fill in title and topic", "warning");
      return;
    }

    const participants = [];
    const participantCards =
      this.participantsContainer.querySelectorAll(".participant-card");

    for (const card of participantCards) {
      const modelSelect = card.querySelector(".model-select");
      const personalityName = card
        .querySelector(".personality-name")
        .value.trim();
      const personalityShortDetails = card
        .querySelector(".personality-short-details")
        .value.trim();
      const personalityDetails = card
        .querySelector(".system-instruction")
        .value.trim();

      if (!modelSelect.value || !personalityName) {
        this.showNotification(
          "Please complete all participant information",
          "warning"
        );
        return;
      }

      participants.push({
        modelId: modelSelect.value,
        provider: modelSelect.selectedOptions[0].dataset.provider,
        personalityName,
        personalityShortDetails,
        systemInstruction: personalityDetails
      });
    }

    if (participants.length === 0) {
      this.showNotification(
        "Please add at least one AI participant",
        "warning"
      );
      return;
    }

    this.showLoading();
    console.log(
      "Creating conversation with participants:",
      participants.length
    );
    this.socket.emit("create-conversation", {
      title,
      topic,
      participants,
      messageLimit
    });
  }

  async deleteConversation(conversationId) {
    if (confirm("Are you sure you want to delete this chat?")) {
      try {
        const response = await fetch(`/api/conversations/${conversationId}`, {
          method: "DELETE"
        });
        const data = await response.json();
        if (data.success) {
          this.showNotification("Conversation deleted", "success");
          this.loadConversations();
          // If currently viewing this conversation, leave it
          if (this.currentConversationId === conversationId) {
            this.leaveConversation();
          }
        } else {
          this.showNotification("Error deleting conversation", "error");
        }
      } catch (error) {
        console.error("Error deleting conversation:", error);
        this.showNotification("Error deleting conversation", "error");
      }
    }
  }
  sendMessage() {
    const content = this.messageInput.value.trim();
    if (!content || !this.currentConversationId) return;

    console.log("Sending message:", content);
    this.socket.emit("send-message", {
      conversationId: this.currentConversationId,
      content
    });

    this.messageInput.value = "";
  }

  startConversation() {
    if (!this.currentConversationId) return;

    console.log("Starting conversation:", this.currentConversationId);
    this.socket.emit("start-conversation", {
      conversationId: this.currentConversationId
    });

    this.startBtn.style.display = "none";
    this.stopBtn.style.display = "inline-block";
  }

  stopConversation() {
    if (!this.currentConversationId) return;

    console.log("Stopping conversation:", this.currentConversationId);
    this.socket.emit("stop-conversation", {
      conversationId: this.currentConversationId
    });
  }

  leaveConversation() {
    console.log("Leaving conversation:", this.currentConversationId);
    this.currentConversationId = null;
    this.chatInterface.style.display = "none";
    this.welcomeScreen.style.display = "flex";
    this.messageInput.disabled = true;
    this.sendBtn.disabled = true;
    this.leaveBtn.style.display = "none";
    this.startBtn.style.display = "none";
    this.stopBtn.style.display = "none";

    document.querySelectorAll(".conversation-item").forEach(item => {
      item.classList.remove("active");
    });
  }

  addMessageToChat(message, isStreaming = false) {
    if (document.getElementById(`msg-${message.id}`)) return;

    const messageEl = document.createElement("div");
    messageEl.className = `message ${message.senderType}`;
    if (isStreaming) {
      messageEl.classList.add("streaming");
    }
    messageEl.id = `msg-${message.id}`;

    const timestamp = new Date(message.timestamp).toLocaleTimeString();
    const modelInfo = message.modelName
      ? `<span class="message-model">${message.modelName.split("/").pop()}</span>`
      : "";

    const renderedContent = isStreaming ? "" : marked.parse(message.content);

    messageEl.innerHTML = `
            <div class="message-header">
                <span class="message-sender">${message.senderName}</span>
                ${modelInfo}
                <span class="message-time">${timestamp}</span>
            </div>
            <div class="message-content" id="content-${message.id}" data-raw="${isStreaming ? "" : message.content.replace(/"/g, "&quot;")}">${renderedContent}</div>
        `;

    this.chatMessages.appendChild(messageEl);
    this.scrollToBottom();

    if (!isStreaming) {
      const codeBlocks = messageEl.querySelectorAll("pre code");
      codeBlocks.forEach(block => {
        hljs.highlightElement(block);
      });
    }
  }

  showAIThinking(aiName) {
    this.aiStatus.textContent = `${aiName} is thinking...`;

    const badges = this.participantsBar.querySelectorAll(".participant-badge");
    badges.forEach(badge => {
      badge.classList.remove("thinking");
      if (badge.textContent.includes(aiName)) {
        badge.classList.add("thinking");
      }
    });
  }

  hideAIThinking() {
    this.aiStatus.textContent = "";

    const badges = this.participantsBar.querySelectorAll(".participant-badge");
    badges.forEach(badge => badge.classList.remove("thinking"));
  }

  updateMessageCounter(current, limit) {
    if (current !== undefined && limit !== undefined) {
      const limitText = limit > 0 ? limit : "∞";
      this.messageCounter.textContent = `${current}/${limitText} messages`;
    }
  }

  scrollToBottom() {
    this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
  }

  showLoading() {
    this.loadingOverlay.style.display = "flex";
  }

  hideLoading() {
    this.loadingOverlay.style.display = "none";
  }

  showNotification(message, type = "info") {
    this.notificationMessage.textContent = message;
    this.notification.className = `notification ${type}`;
    this.notification.style.display = "flex";

    setTimeout(() => {
      this.hideNotification();
    }, 5000);
  }

  hideNotification() {
    this.notification.style.display = "none";
  }

  toggleSidebar() {
    if (this.sidebar && this.sidebar.classList.contains("open")) {
      this.closeSidebar();
    } else {
      this.openSidebar();
    }
  }

  openSidebar() {
    if (this.sidebar) {
      this.sidebar.classList.add("open");
    }
    if (this.sidebarOverlay) {
      this.sidebarOverlay.classList.add("show");
    }
    document.body.style.overflow = "hidden";
  }

  closeSidebar() {
    if (this.sidebar) {
      this.sidebar.classList.remove("open");
    }
    if (this.sidebarOverlay) {
      this.sidebarOverlay.classList.remove("show");
    }
    document.body.style.overflow = "";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  new AIGroupChat();
});
