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

// Import enhanced services for AI, conversation management, and flow control
const AIService = require("./services/ai-service");
const conversationService = require("./services/conversation-service");
const flowService = require("./services/flow-service");
const logger = require("./logger");

// Initialize Express application and HTTP server
const app = express();
const server = http.createServer(app);

// Configure Socket.IO with CORS settings for real-time communication
const io = socketIo(server, {
 cors: {
   origin: "*",
   methods: ["GET", "POST"]
 }
});

// ==================== MIDDLEWARE SETUP ====================

// Security middleware with CSP disabled for frontend compatibility
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: "1000mb" }));
app.use(express.static(path.join(__dirname, "public")));

// Rate limiting to prevent API abuse
const limiter = rateLimit({
 windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 600000, // 10 minutes default
 max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100, // 100 requests per window
 message: "Too many requests from this IP, please try again later."
});
app.use("/api", limiter);

logger.info("SERVER", "Flow-enhanced server initialization started");

// ==================== API ROUTES ====================

/**
* @description GET /api/models - Retrieves all available AI models from configured providers
* @route {GET} /api/models
* @returns {Object} JSON response with success status and models array
*/
app.get("/api/models", (req, res) => {
 logger.info("API", "GET /api/models called", { ip: req.ip });
 try {
   const models = AIService.getAllAvailableModels();
   logger.info("API", "Models retrieved successfully", {
     count: models.length
   });
   res.json({ success: true, models });
 } catch (error) {
   logger.error("API", "Error retrieving models", { error: error.message });
   res.status(500).json({ success: false, error: error.message });
 }
});

/**
* @description GET /api/conversations - Retrieves all conversations with aggregated statistics
* @route {GET} /api/conversations
* @returns {Object} JSON response with success status and conversations array
*/
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

/**
* @description GET /api/conversations/:id - Retrieves full conversation details including history
* @route {GET} /api/conversations/:id
* @param {string} req.params.id - Conversation UUID
* @returns {Object} JSON response with conversation details, participants, and message history
*/
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

/**
* @description DELETE /api/conversations/:id - Deletes a conversation and cleans up associated state
* @route {DELETE} /api/conversations/:id
* @param {string} req.params.id - Conversation UUID
* @returns {Object} JSON response with success status
*/
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

/**
* @description POST /api/generate-personality - Generates personality instructions for AI participants
* @route {POST} /api/generate-personality
* @param {Object} req.body - Contains modelId, provider, personalityName, and personalityShortDetails
* @returns {Object} JSON response with generated personality instruction
*/
app.post("/api/generate-personality", async (req, res) => {
 logger.info("API", "POST /api/generate-personality called", {
   ip: req.ip,
   body: req.body
 });
 try {
   const { modelId, provider, personalityName, personalityShortDetails } =
     req.body;
   const instruction = await AIService.generatePersonalityInstruction(
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

/**
* @description GET /api/conversations/:id/flow-stats - Retrieves flow statistics for debugging
* @route {GET} /api/conversations/:id/flow-stats
* @param {string} req.params.id - Conversation UUID
* @returns {Object} JSON response with flow statistics
*/
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

/**
* @description GET / - Serves the main application page
* @route {GET} /
*/
app.get("/", (req, res) => {
 logger.info("SERVER", "Serving main page", { ip: req.ip });
 res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ==================== SOCKET.IO EVENT HANDLERS ====================

/**
* @description Active conversations map storing real-time conversation states
* @type {Map<string, Object>}
*/
const activeConversations = new Map();

/**
* @description Socket.IO connection handler for real-time client communication
* @event connection
*/
io.on("connection", socket => {
 logger.info("SOCKET", "User connected", { socketId: socket.id });

 /**
  * @description Handles conversation creation with participants and flow initialization
  * @event create-conversation
  * @param {Object} data - Contains title, topic, participants, and messageLimit
  */
 socket.on("create-conversation", async data => {
   logger.info("SOCKET", "create-conversation event received", {
     socketId: socket.id
   });
   try {
     const { title, topic, participants, messageLimit } = data;

     // Create conversation record in database
     const conversation = await conversationService.createConversation(
       title,
       topic,
       messageLimit
     );
     logger.info("SOCKET", "Conversation created", {
       conversationId: conversation.id
     });

     // Add all AI participants to the conversation
     for (const participant of participants) {
       await conversationService.addAIParticipant(
         conversation.id,
         participant.modelId,
         participant.provider,
         participant.personalityName,
         participant.systemInstruction
       );
     }

     // Retrieve participants from database and initialize flow service
     const dbParticipants =
       await conversationService.getConversationParticipants(conversation.id);

     flowService.initializeConversation(conversation.id, dbParticipants);

     // Store conversation state for real-time management
     activeConversations.set(conversation.id, {
       participants: dbParticipants,
       isActive: true,
       topic: topic,
       hasStarted: false
     });

     // Join socket room for this conversation
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

 /**
  * @description Handles user joining an existing conversation
  * @event join-conversation
  * @param {Object} data - Contains conversationId
  */
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

     // Join socket room for real-time updates
     socket.join(conversationId);
     logger.info("SOCKET", "User joined conversation room", {
       socketId: socket.id,
       conversationId
     });

     const dbParticipants =
       await conversationService.getConversationParticipants(conversationId);

     // Initialize conversation state if not exists
     if (!activeConversations.has(conversationId)) {
       activeConversations.set(conversationId, {
         participants: dbParticipants,
         isActive: details.conversation.is_active,
         topic: details.conversation.topic,
         hasStarted: true
       });

       // Initialize flow service if not already done
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

 /**
  * @description Handles user message sending with AI response triggering
  * @event send-message
  * @param {Object} data - Contains conversationId and message content
  */
 socket.on("send-message", async data => {
   const { conversationId, content } = data;
   logger.info("SOCKET", "send-message event received", {
     socketId: socket.id,
     conversationId,
     contentLength: content?.length
   });

   try {
     // Validate message content
     if (!conversationId || !content || content.trim().length === 0) {
       socket.emit("message-error", { error: "Message content is required" });
       return;
     }

     // Check message limits before processing
     const limitCheck =
       await conversationService.checkMessageLimit(conversationId);
     if (limitCheck.limitReached) {
       socket.emit("message-error", { error: limitCheck.reason });
       return;
     }

     // Save user message to database
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

     // Broadcast to all clients in the conversation room
     io.to(conversationId).emit("new-message", messageData);

     // Confirm receipt to sender
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

       // Trigger AI response with slight delay for natural flow
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

 /**
  * @description Handles conversation start with optional opening message
  * @event start-conversation
  * @param {Object} data - Contains conversationId
  */
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

       // Generate opening message if this is the first start
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

 /**
  * @description Handles conversation stop request
  * @event stop-conversation
  * @param {Object} data - Contains conversationId
  */
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

 /**
  * @description Handles client disconnection
  * @event disconnect
  */
 socket.on("disconnect", () => {
   logger.info("SOCKET", "User disconnected", { socketId: socket.id });
 });
});

// ==================== AI TURN PROCESSING ====================

/**
* @description Processes AI turn with flow-based selection and streaming response
* @async
* @param {string} conversationId - Unique identifier for the conversation
* @param {Object|null} lastMessage - The most recent message in the conversation
* @param {boolean} [isOpeningMessage=false] - Whether this is the opening message
* @returns {Promise<void>}
*/
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
   // Check message limits before proceeding
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

   // Determine next speaker using flow service
   let nextSpeaker;
   if (isOpeningMessage) {
     // Random selection for opening message
     const participants = conversationState.participants;
     nextSpeaker =
       participants[Math.floor(Math.random() * participants.length)];
   } else {
     // Flow-based intelligent selection
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

   // Notify clients that AI is thinking
   io.to(conversationId).emit("ai-thinking", {
     aiName: nextSpeaker.personality_name
   });

   // Initialize streaming response
   const streamId = uuidv4();

   io.to(conversationId).emit("ai-stream-start", {
     id: streamId,
     senderName: nextSpeaker.personality_name,
     modelName: nextSpeaker.model_name,
     senderType: "ai",
     timestamp: new Date().toISOString()
   });

   // Streaming callback to send chunks to clients in real-time
   const onChunk = chunk => {
     io.to(conversationId).emit("ai-stream-chunk", {
       id: streamId,
       content: chunk
     });
   };

   let response;

   // Generate opening message or regular response based on context
   if (isOpeningMessage) {
     logger.info("FLOW_AI_TURN", "Generating opening message", {
       conversationId,
       participant: nextSpeaker.personality_name
     });
     response = await AIService.generateTopicOpeningMessage(
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

     response = await AIService.generateResponse(
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

   // Save AI response to database
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

   // Complete the streaming response
   io.to(conversationId).emit("ai-stream-complete", {
     streamId: streamId,
     dbId: message.id,
     fullContent: response
   });

   // Log flow statistics for debugging
   const flowStats = flowService.getFlowStatistics(conversationId);
   logger.info("FLOW_AI_TURN", "Flow statistics", {
     conversationId,
     flowStats
   });

   // Schedule next AI turn if conversation is still active
   if (conversationState.isActive) {
     // Dynamic delay based on response length (2-8 seconds)
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

   // Notify clients of AI error
   io.to(conversationId).emit("ai-error", {
     error: `AI encountered an error: ${error.message}`,
     aiName: "AI"
   });

   // Retry after 3 seconds if conversation is still active
   if (conversationState.isActive) {
     setTimeout(() => {
       processFlowBasedAITurn(conversationId);
     }, 3000);
   }
 }
}

// ==================== SERVER STARTUP ====================

const PORT = process.env.PORT || 3000;

/**
* @description Start HTTP server and begin listening on configured port
*/
server.listen(PORT, () => {
 logger.info("SERVER", `Flow-enhanced server running on port ${PORT}`);
 logger.info(
   "SERVER",
   `Available models: ${AIService.getAllAvailableModels().length}`
 );
});

// Export for testing purposes
module.exports = { app, server };