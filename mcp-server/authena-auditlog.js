const { AthenaClient, StartQueryExecutionCommand, GetQueryResultsCommand, GetQueryExecutionCommand } = require('@aws-sdk/client-athena');
const { MCPServer } = require('../lib/mcp-server');

// Configuration - use environment variables or defaults
const config = {
  region: process.env.AWS_REGION || 'us-east-1',
  database: process.env.ATHENA_DATABASE || 'default',
  outputLocation: process.env.ATHENA_OUTPUT_LOCATION || 's3://aws-athena-query-results/',
  queryTimeout: parseInt(process.env.QUERY_TIMEOUT_MS || '60000')
};

// Initialize Athena client
const athenaClient = new AthenaClient({ region: config.region });

/**
 * Execute Athena query and wait for results
 */
async function executeAthenaQuery(query, timeout = config.queryTimeout) {
  try {
    // Start query execution
    const startCommand = new StartQueryExecutionCommand({
      QueryString: query,
      QueryExecutionContext: { Database: config.database },
      ResultConfiguration: { OutputLocation: config.outputLocation }
    });

    const { QueryExecutionId } = await athenaClient.send(startCommand);
    console.log(`Query started with ID: ${QueryExecutionId}`);
    
    // Wait for query completion
    let status;
    const startTime = Date.now();
    
    do {
      if (Date.now() - startTime > timeout) {
        throw new Error('Query execution timed out');
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const statusCommand = new GetQueryExecutionCommand({ QueryExecutionId });
      const response = await athenaClient.send(statusCommand);
      status = response.QueryExecution.Status.State;
      
      if (status === 'FAILED') {
        throw new Error(`Query failed: ${response.QueryExecution.Status.StateChangeReason}`);
      }
    } while (status !== 'SUCCEEDED');
    
    // Get results
    const resultsCommand = new GetQueryResultsCommand({ QueryExecutionId });
    const results = await athenaClient.send(resultsCommand);
    
    return formatResults(results);
  } catch (error) {
    console.error('Athena query error:', error);
    throw error;
  }
}

/**
 * Format query results into a structured object
 */
function formatResults(results) {
  const rows = results.ResultSet.Rows;
  
  if (rows.length === 0) {
    return { columns: [], data: [] };
  }
  
  // Extract column names from first row
  const columns = rows[0].Data.map(col => col.VarCharValue);
  
  // Convert remaining rows to objects
  const data = rows.slice(1).map(row => {
    const rowData = {};
    row.Data.forEach((cell, index) => {
      rowData[columns[index]] = cell.VarCharValue;
    });
    return rowData;
  });
  
  return { columns, data };
}

// Initialize MCP server
const mcpServer = new MCPServer();

// Register MCP handlers
mcpServer.registerHandler('queryAthenaLogs', async (request) => {
  try {
    const { query, filters, timeRange } = request.params;
    
    if (!query) {
      return { 
        success: false, 
        error: 'Query parameter is required' 
      };
    }
    
    // Apply any filters or time ranges to the query if provided
    let finalQuery = query;
    if (filters || timeRange) {
      // Logic to modify query with filters and time range
      console.log('Applying filters:', filters);
      console.log('Applying time range:', timeRange);
    }
    
    const results = await executeAthenaQuery(finalQuery);
    
    return {
      success: true,
      data: results
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
});

// Start MCP server
const PORT = process.env.PORT || 3000;
mcpServer.start(PORT, () => {
  console.log(`Athena Log Query MCP server running on port ${PORT}`);
});

module.exports = {
  executeAthenaQuery,
  formatResults
};
