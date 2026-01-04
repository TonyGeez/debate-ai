const fs = require('fs');
const path = require('path');

class Logger {
  constructor() {
    this.logFile = path.join(__dirname, 'logs/logs.txt');
    this.ensureLogFileExists();
  }

  ensureLogFileExists() {
    const logDir = path.dirname(this.logFile);
    
    // Create directory if it doesn't exist
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    
    // Create file if it doesn't exist
    if (!fs.existsSync(this.logFile)) {
      fs.writeFileSync(this.logFile, '');
    }
  }

  log(level, context, message, data = null) {
    const timestamp = new Date().toISOString();
    let logEntry = `[${timestamp}] [${level}] [${context}] ${message}`;
    
    if (data) {
      const sanitizedData = this.sanitizeData(data);
      logEntry += `\n[${timestamp}] [${level}] [${context}] Data: ${JSON.stringify(sanitizedData, null, 2)}`;
    }
    
    logEntry += '\n';
    
    try {
      fs.appendFileSync(this.logFile, logEntry);
    } catch (error) {
      console.error('Failed to write to log file:', error);
    }
  }

  sanitizeData(data) {
    if (typeof data !== 'object' || data === null) {
      return data;
    }
    
    const sensitiveFields = ['apiKey', 'api_key', 'password', 'token', 'secret', 'DB_PASSWORD', 'DEEPINFRA_API_KEY', 'FIREWORKS_API_KEY', 'Authorization'];
    const sanitized = Array.isArray(data) ? [...data] : { ...data };
    
    for (const key in sanitized) {
      if (sensitiveFields.some(field => key.toLowerCase().includes(field.toLowerCase()))) {
        sanitized[key] = '[REDACTED]';
      } else if (typeof sanitized[key] === 'object' && sanitized[key] !== null) {
        sanitized[key] = this.sanitizeData(sanitized[key]);
      }
    }
    
    return sanitized;
  }

  info(context, message, data) {
    this.log('INFO', context, message, data);
  }

  error(context, message, data) {
    this.log('ERROR', context, message, data);
  }

  warn(context, message, data) {
    this.log('WARN', context, message, data);
  }

  debug(context, message, data) {
    this.log('DEBUG', context, message, data);
  }

  // Special method for API calls - logs EXACT messages sent/received
  apiMessage(provider, modelId, direction, messageData) {
    const timestamp = new Date().toISOString();
    const sanitizedData = this.sanitizeData(messageData);
    const logEntry = `[${timestamp}] [API_MESSAGE] [${provider.toUpperCase()}] [${modelId}] [${direction}] ${JSON.stringify(sanitizedData, null, 2)}\n`;
    
    try {
      fs.appendFileSync(this.logFile, logEntry);
    } catch (error) {
      console.error('Failed to write API message to log file:', error);
    }
  }
}

module.exports = new Logger();
