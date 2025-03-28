require('dotenv').config();
const { MCPServer } = require('../lib/mcp-server');
const { RdsHandler } = require('./rds-handler');
const { CloudWatchHandler } = require('./cloudwatch-handler');
const { executeAthenaQuery } = require('./authena-auditlog');

/**
 * Initialize and start the MCP server with all handlers
 */
async function initServer() {
  try {
    // Create MCP server instance
    const mcpServer = new MCPServer();
    console.log('Created MCP server instance');
    
    // Initialize handlers
    const rdsHandler = new RdsHandler();
    const cloudWatchHandler = new CloudWatchHandler();
    
    console.log('Initializing handlers...');
    
    // Register all handlers with MCP server
    rdsHandler.registerHandlers(mcpServer);
    cloudWatchHandler.registerHandlers(mcpServer);
    
    // Register Athena query handler
    mcpServer.registerHandler('athenaQuery', async (request) => {
      const { query } = request.params;
      if (!query) {
        return { success: false, error: 'Query parameter is required' };
      }
      
      try {
        const results = await executeAthenaQuery(query);
        return { success: true, data: results };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });
    
    console.log('All handlers registered');
    
    // Start the server
    const PORT = process.env.PORT || 3000;
    mcpServer.start(PORT, () => {
      console.log(`MCP Server is running on port ${PORT}`);
      console.log(`Environment: ${process.env.NODE_ENV}`);
    });
    
    // Setup graceful shutdown
    setupGracefulShutdown(mcpServer, rdsHandler);
    
  } catch (error) {
    console.error('Failed to initialize MCP server:', error);
    process.exit(1);
  }
}

/**
 * Setup handlers for graceful shutdown
 */
function setupGracefulShutdown(mcpServer, rdsHandler) {
  async function shutdown(signal) {
    console.log(`\n${signal} received. Shutting down gracefully...`);
    
    try {
      // Close all database connections
      await rdsHandler.close();
      console.log('Database connections closed');
      
      // Stop the MCP server
      mcpServer.stop();
      
      console.log('Shutdown completed');
      process.exit(0);
    } catch (error) {
      console.error('Error during shutdown:', error);
      process.exit(1);
    }
  }
  
  // Listen for termination signals
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  
  console.log('Graceful shutdown handlers configured');
}

// Start the server
initServer().catch(error => {
  console.error('Server initialization failed:', error);
  process.exit(1);
});
