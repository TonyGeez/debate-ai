const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const dotenv = require("dotenv");

dotenv.config();

// Use enhanced services
const balancedAIService = require("./services/balancedAIService");
const conversationService = require("./services/conversationService");
const flowService = require("./services/conversationFlowService");
const logger = require("./logger");

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: "1000mb" }));
app.use(express.static(path.join(__dirname, "public")));

const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 600000,
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  message: "Too many requests from this IP, please try again later."
});
app.use("/api", limiter);

logger.info("SERVER", "Flow-enhanced server initialization started");

app.get("/api/models", (req, res) => {
  logger.info("API", "GET /api/models called", { ip: req.ip });
  try {
    const models = balancedAIService.getAllAvailableModels();
    logger.info("API", "Models retrieved successfully", {
      count: models.length
    });
    res.json({ success: true, models });
  } catch (error) {
    logger.error("API", "Error retrieving models", { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get("/api/conversations", async (req, res) => {
  logger.info("API", "GET /api/conversations called", { ip: req.ip });
  try {
    const conversations = await conversationService.getAllConversations();
    logger.info("API", "Conversations retrieved successfully", {
      count: conversations.length
    });
    res.json({ success: true, conversations });
  } catch (error) {
    logger.error("API", "Error retrieving conversations", {
      error: error.message
    });
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get("/api/conversations/:id", async (req, res) => {
  const { id } = req.params;
  logger.info("API", "GET /api/conversations/:id called", { id, ip: req.ip });
  try {
    const details = await conversationService.getConversationDetails(id);
    if (!details) {
      logger.warn("API", "Conversation not found", { id });
      return res
        .status(404)
        .json({ success: false, error: "Conversation not found" });
    }

    const history = await conversationService.getConversationHistory(id);
    logger.info("API", "Conversation details retrieved successfully", {
      id,
      messageCount: history.length
    });
    res.json({
      success: true,
      conversation: details.conversation,
      participants: details.participants,
      messages: history
    });
  } catch (error) {
    logger.error("API", "Error retrieving conversation details", {
      id,
      error: error.message
    });
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete("/api/conversations/:id", async (req, res) => {
  const { id } = req.params;
  logger.info("API", "DELETE /api/conversations/:id called", {
    id,
    ip: req.ip
  });
  try {
    await conversationService.deleteConversation(id);
    flowService.cleanupConversation(id);
    logger.info("API", "Conversation deleted successfully", { id });
    res.json({ success: true });
  } catch (error) {
    logger.error("API", "Error deleting conversation", {
      id,
      error: error.message
    });
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/api/generate-personality", async (req, res) => {
  logger.info("API", "POST /api/generate-personality called", {
    ip: req.ip,
    body: req.body
  });
  try {
    const { modelId, provider, personalityName, personalityShortDetails } =
      req.body;
    const instruction = await balancedAIService.generatePersonalityInstruction(
      modelId,
      provider,
      personalityName,
      personalityShortDetails
    );
    logger.info("API", "Personality generated successfully", {
      modelId,
      provider
    });
    res.json({ success: true, instruction });
  } catch (error) {
    logger.error("API", "Error generating personality", {
      error: error.message
    });
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get("/api/conversations/:id/flow-stats", (req, res) => {
  const { id } = req.params;
  try {
    const stats = flowService.getFlowStatistics(id);
    res.json({ success: true, stats });
  } catch (error) {
    logger.error("API", "Error getting flow stats", { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get("/", (req, res) => {
  logger.info("SERVER", "Serving main page", { ip: req.ip });
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const activeConversations = new Map();

io.on("connection", socket => {
  logger.info("SOCKET", "User connected", { socketId: socket.id });

  socket.on("create-conversation", async data => {
    logger.info("SOCKET", "create-conversation event received", {
      socketId: socket.id
    });
    try {
      const { title, topic, participants, messageLimit } = data;

      const conversation = await conversationService.createConversation(
        title,
        topic,
        messageLimit
      );
      logger.info("SOCKET", "Conversation created", {
        conversationId: conversation.id
      });

      for (const participant of participants) {
        await conversationService.addAIParticipant(
          conversation.id,
          participant.modelId,
          participant.provider,
          participant.personalityName,
          participant.systemInstruction
        );
      }

      const dbParticipants =
        await conversationService.getConversationParticipants(conversation.id);

      flowService.initializeConversation(conversation.id, dbParticipants);

      activeConversations.set(conversation.id, {
        participants: dbParticipants,
        isActive: true,
        topic: topic,
        hasStarted: false
      });

      socket.join(conversation.id);
      socket.emit("conversation-created", {
        success: true,
        conversationId: conversation.id,
        conversation: conversation
      });
    } catch (error) {
      logger.error("SOCKET", "Error creating conversation", {
        error: error.message
      });
      socket.emit("conversation-created", {
        success: false,
        error: error.message
      });
    }
  });

  socket.on("join-conversation", async data => {
    logger.info("SOCKET", "join-conversation event received", {
      conversationId: data.conversationId
    });
    try {
      const { conversationId } = data;
      const details =
        await conversationService.getConversationDetails(conversationId);

      if (!details) {
        socket.emit("join-result", {
          success: false,
          error: "Conversation not found"
        });
        return;
      }

      socket.join(conversationId);
      logger.info("SOCKET", "User joined conversation room", {
        socketId: socket.id,
        conversationId
      });

      const dbParticipants =
        await conversationService.getConversationParticipants(conversationId);

      if (!activeConversations.has(conversationId)) {
        activeConversations.set(conversationId, {
          participants: dbParticipants,
          isActive: details.conversation.is_active,
          topic: details.conversation.topic,
          hasStarted: true
        });

        if (!flowService.getConversationState(conversationId)) {
          flowService.initializeConversation(conversationId, dbParticipants);
        }
      }

      const history =
        await conversationService.getConversationHistory(conversationId);

      socket.emit("join-result", {
        success: true,
        conversation: details.conversation,
        participants: details.participants,
        messages: history
      });
    } catch (error) {
      logger.error("SOCKET", "Error joining conversation", {
        error: error.message
      });
      socket.emit("join-result", { success: false, error: error.message });
    }
  });

  socket.on("send-message", async data => {
    const { conversationId, content } = data;
    logger.info("SOCKET", "send-message event received", {
      socketId: socket.id,
      conversationId,
      contentLength: content?.length
    });

    try {
      if (!conversationId || !content || content.trim().length === 0) {
        socket.emit("message-error", { error: "Message content is required" });
        return;
      }

      const limitCheck =
        await conversationService.checkMessageLimit(conversationId);
      if (limitCheck.limitReached) {
        socket.emit("message-error", { error: limitCheck.reason });
        return;
      }

      const message = await conversationService.addMessage(
        conversationId,
        "user",
        "User",
        null,
        content.trim()
      );

      logger.info("SOCKET", "User message saved to database", {
        conversationId,
        messageId: message.id
      });

      const messageData = {
        id: message.id,
        senderType: "user",
        senderName: "User",
        content: content.trim(),
        timestamp: message.created_at
      };

      // Broadcast to all clients in the room
      io.to(conversationId).emit("new-message", messageData);

      // Confirm to sender
      socket.emit("message-sent", {
        success: true,
        messageId: message.id,
        message: messageData
      });

      const conversationState = activeConversations.get(conversationId);
      if (conversationState && conversationState.isActive) {
        logger.info("SOCKET", "Triggering AI response after user message", {
          conversationId
        });

        // Trigger AI response immediately
        setTimeout(() => {
          processFlowBasedAITurn(conversationId, {
            sender_name: "User",
            content: content.trim(),
            sender_type: "user"
          });
        }, 1000);
      } else {
        logger.warn("SOCKET", "Conversation not active, AI will not respond", {
          conversationId,
          hasState: !!conversationState,
          isActive: conversationState?.isActive
        });
      }
    } catch (error) {
      logger.error("SOCKET", "Error processing user message", {
        socketId: socket.id,
        conversationId,
        error: error.message
      });
      socket.emit("message-error", {
        error: `Failed to send message: ${error.message}`
      });
    }
  });

  socket.on("start-conversation", async data => {
    logger.info("SOCKET", "start-conversation event received", {
      conversationId: data.conversationId
    });
    try {
      const { conversationId } = data;
      const conversationState = activeConversations.get(conversationId);

      if (conversationState) {
        conversationState.isActive = true;
        await conversationService.setConversationActive(conversationId, true);
        logger.info("SOCKET", "Conversation started", { conversationId });

        if (!conversationState.hasStarted) {
          conversationState.hasStarted = true;
          processFlowBasedAITurn(conversationId, null, true);
        } else {
          processFlowBasedAITurn(conversationId);
        }
      } else {
        socket.emit("conversation-error", {
          error: "Conversation state not found"
        });
      }
    } catch (error) {
      logger.error("SOCKET", "Error starting conversation", {
        error: error.message
      });
      socket.emit("conversation-error", { error: error.message });
    }
  });

  socket.on("stop-conversation", async data => {
    logger.info("SOCKET", "stop-conversation event received", {
      conversationId: data.conversationId
    });
    try {
      const { conversationId } = data;
      const conversationState = activeConversations.get(conversationId);

      if (conversationState) {
        conversationState.isActive = false;
        await conversationService.setConversationActive(conversationId, false);
        logger.info("SOCKET", "Conversation stopped", { conversationId });
        io.to(conversationId).emit("conversation-stopped");
      }
    } catch (error) {
      logger.error("SOCKET", "Error stopping conversation", {
        error: error.message
      });
      socket.emit("conversation-error", { error: error.message });
    }
  });

  socket.on("disconnect", () => {
    logger.info("SOCKET", "User disconnected", { socketId: socket.id });
  });
});

async function processFlowBasedAITurn(
  conversationId,
  lastMessage = null,
  isOpeningMessage = false
) {
  const conversationState = activeConversations.get(conversationId);
  logger.info("FLOW_AI_TURN", "Processing flow-based AI turn", {
    conversationId,
    isOpeningMessage,
    hasLastMessage: !!lastMessage,
    isActive: conversationState?.isActive
  });

  if (!conversationState || !conversationState.isActive) {
    logger.warn("FLOW_AI_TURN", "Conversation not active", { conversationId });
    return;
  }

  try {
    const limitCheck =
      await conversationService.checkMessageLimit(conversationId);
    if (limitCheck.limitReached) {
      logger.warn("FLOW_AI_TURN", "Message limit reached", { conversationId });
      conversationState.isActive = false;
      await conversationService.setConversationActive(conversationId, false);
      io.to(conversationId).emit("conversation-stopped", {
        reason: limitCheck.reason
      });
      return;
    }

    let nextSpeaker;
    if (isOpeningMessage) {
      const participants = conversationState.participants;
      nextSpeaker =
        participants[Math.floor(Math.random() * participants.length)];
    } else {
      nextSpeaker = flowService.getNextSpeaker(conversationId, lastMessage);
    }

    if (!nextSpeaker) {
      logger.error("FLOW_AI_TURN", "No next speaker found", { conversationId });
      return;
    }

    logger.info("FLOW_AI_TURN", "Next speaker selected by flow service", {
      conversationId,
      speakerName: nextSpeaker.personality_name,
      model: nextSpeaker.model_name
    });

    io.to(conversationId).emit("ai-thinking", {
      aiName: nextSpeaker.personality_name
    });

    const streamId = uuidv4();

    io.to(conversationId).emit("ai-stream-start", {
      id: streamId,
      senderName: nextSpeaker.personality_name,
      modelName: nextSpeaker.model_name,
      senderType: "ai",
      timestamp: new Date().toISOString()
    });

    const onChunk = chunk => {
      io.to(conversationId).emit("ai-stream-chunk", {
        id: streamId,
        content: chunk
      });
    };

    let response;

    if (isOpeningMessage) {
      logger.info("FLOW_AI_TURN", "Generating opening message", {
        conversationId,
        participant: nextSpeaker.personality_name
      });
      response = await balancedAIService.generateTopicOpeningMessage(
        nextSpeaker.model_name,
        nextSpeaker.model_provider,
        nextSpeaker.personality_name,
        nextSpeaker.system_instruction,
        conversationState.topic,
        onChunk
      );
    } else {
      const history =
        await conversationService.getConversationHistory(conversationId);
      logger.info("FLOW_AI_TURN", "Generating response with flow context", {
        conversationId,
        historyLength: history.length,
        participant: nextSpeaker.personality_name
      });

      response = await balancedAIService.generateResponse(
        nextSpeaker.model_name,
        nextSpeaker.model_provider,
        conversationId,
        nextSpeaker,
        history,
        conversationState.topic,
        onChunk
      );
    }

    logger.info("FLOW_AI_TURN", "AI response generated", {
      conversationId,
      responseLength: response.length,
      participant: nextSpeaker.personality_name
    });

    const message = await conversationService.addMessage(
      conversationId,
      "ai",
      nextSpeaker.personality_name,
      nextSpeaker.model_name,
      response
    );

    logger.info("FLOW_AI_TURN", "AI message saved to database", {
      conversationId,
      messageId: message.id
    });

    io.to(conversationId).emit("ai-stream-complete", {
      streamId: streamId,
      dbId: message.id,
      fullContent: response
    });

    const flowStats = flowService.getFlowStatistics(conversationId);
    logger.info("FLOW_AI_TURN", "Flow statistics", {
      conversationId,
      flowStats
    });

    if (conversationState.isActive) {
      const delay = Math.min(2000 + response.length * 20, 8000);
      logger.info("FLOW_AI_TURN", "Scheduling next flow-based AI turn", {
        conversationId,
        delay
      });
      setTimeout(() => {
        const aiMessage = {
          sender_name: nextSpeaker.personality_name,
          content: response,
          sender_type: "ai"
        };
        processFlowBasedAITurn(conversationId, aiMessage);
      }, delay);
    }
  } catch (error) {
    logger.error("FLOW_AI_TURN", "AI turn error", {
      conversationId,
      error: error.message,
      stack: error.stack
    });

    io.to(conversationId).emit("ai-error", {
      error: `AI encountered an error: ${error.message}`,
      aiName: "AI"
    });

    if (conversationState.isActive) {
      setTimeout(() => {
        processFlowBasedAITurn(conversationId);
      }, 3000);
    }
  }
}

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  logger.info("SERVER", `Flow-enhanced server running on port ${PORT}`);
  logger.info(
    "SERVER",
    `Available models: ${balancedAIService.getAllAvailableModels().length}`
  );
});

module.exports = { app, server };
