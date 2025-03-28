import 'dotenv/config';
import { MCPServer } from '../lib/mcp-server';
import { RdsHandler } from './rds-handler';
import { CloudWatchHandler } from './cloudwatch-handler';
import { registerAthenaHandlers } from './athena-handler';

/**
 * Initialize and start the MCP server with all handlers
 */
async function initServer(): Promise<void> {
  try {
    // Create MCP server instance
    const mcpServer = new MCPServer();
    console.log('Created MCP server instance');
    
    // Initialize handlers
    const rdsHandler = new RdsHandler();
    const cloudWatchHandler = new CloudWatchHandler();
    
    console.log('Initializing handlers...');
    
    // Register RDS handlers
    mcpServer.registerHandler('rds.getRdsInstances', async (request) => {
      return await rdsHandler.getRdsInstances();
    });
    
    mcpServer.registerHandler('rds.connectToPostgres', async (request) => {
      return await rdsHandler.connectToPostgres(request.params);
    });
    
    mcpServer.registerHandler('rds.executeQuery', async (request) => {
      return await rdsHandler.executeQuery(request.params);
    });
    
    mcpServer.registerHandler('rds.executeTransaction', async (request) => {
      return await rdsHandler.executeTransaction(request.params);
    });
    
    // Register CloudWatch handlers
    mcpServer.registerHandler('cloudwatch.logsQuery', async (request) => {
      return await cloudWatchHandler.handleLogsQuery(request.params);
    });
    
    mcpServer.registerHandler('cloudwatch.getLogEvents', async (request) => {
      return await cloudWatchHandler.handleGetLogEvents(request.params);
    });
    
    // Register Athena handlers
    registerAthenaHandlers(mcpServer);
    
    console.log('All handlers registered');
    
    // Start the server
    const PORT = parseInt(process.env.PORT || '3000');
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
function setupGracefulShutdown(mcpServer: MCPServer, rdsHandler: RdsHandler): void {
  async function shutdown(signal: string): Promise<void> {
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
