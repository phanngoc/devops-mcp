import { AthenaClient, StartQueryExecutionCommand, GetQueryResultsCommand, GetQueryExecutionCommand } from '@aws-sdk/client-athena';
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
    Tool,
  } from "@modelcontextprotocol/sdk/types.js";

  import { Server } from "@modelcontextprotocol/sdk/server/index.js";



// Configuration interface
interface AthenaConfig {
  region: string;
  database: string;
  outputLocation: string;
  queryTimeout: number;
}

// Query results interface
interface AthenaQueryResult {
  columns: string[];
  data: Record<string, string>[];
}

// Configuration - use environment variables or defaults
const config: AthenaConfig = {
  region: process.env.AWS_REGION || 'us-east-1',
  database: process.env.ATHENA_DATABASE || 'default',
  outputLocation: process.env.ATHENA_OUTPUT_LOCATION || 's3://aws-athena-query-results/',
  queryTimeout: parseInt(process.env.QUERY_TIMEOUT_MS || '60000')
};

// Initialize Athena client
const athenaClient = new AthenaClient({ region: config.region });

// Server implementation
const server = new Server(
    {
      name: "example-servers/athena-handler",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

/**
 * Execute Athena query and wait for results
 */
async function executeAthenaQuery(query: string, timeout: number = config.queryTimeout): Promise<AthenaQueryResult> {
  try {
    // Start query execution
    const startCommand = new StartQueryExecutionCommand({
      QueryString: query,
      QueryExecutionContext: { Database: config.database },
      ResultConfiguration: { OutputLocation: config.outputLocation }
    });

    const startResponse = await athenaClient.send(startCommand);
    const QueryExecutionId = startResponse.QueryExecutionId;
    
    if (!QueryExecutionId) {
      throw new Error('Failed to start query execution - no execution ID returned');
    }
    
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
      status = response.QueryExecution?.Status?.State;
      
      if (status === 'FAILED') {
        throw new Error(`Query failed: ${response.QueryExecution?.Status?.StateChangeReason || 'Unknown error'}`);
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
function formatResults(results: any): AthenaQueryResult {
  if (!results.ResultSet?.Rows || results.ResultSet.Rows.length === 0) {
    return { columns: [], data: [] };
  }
  
  const rows = results.ResultSet.Rows;
  
  // Extract column names from first row
  const columns = rows[0].Data?.map((col: any) => col.VarCharValue) || [];
  
  // Convert remaining rows to objects
  const data = rows.slice(1).map((row: any) => {
    const rowData: Record<string, string> = {};
    if (row.Data) {
      row.Data.forEach((cell: any, index: number) => {
        rowData[columns[index]] = cell.VarCharValue || '';
      });
    }
    return rowData;
  });
  
  return { columns, data };
}

const QUERY_TOOL = {
  name: "query_like",
  description: "Executes a query against Athena",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string" },
      range_time: { 
        type: "object",
        properties: {
          start_time: { type: "string", description: "Start time for query range (format: YYYY-MM-DD HH:MM:SS)" },
          end_time: { type: "string", description: "End time for query range (format: YYYY-MM-DD HH:MM:SS)" }
        },
        required: ["start_time", "end_time"],
        description: "Time range for filtering query results"
      }
    },
    required: ["query"],
  },
  outputSchema: {
    type: "object",
    properties: {
      content: {
        type: "array",
        items: {
          type: "object",
          properties: {
            type: { type: "string" },
            text: { type: "string" },
          },
        },
      },
      isError: { type: "boolean" },
    },
  },
};

/**
 * Register Athena handlers with MCP server
 */

// Tool handlers
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [QUERY_TOOL],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const { name, arguments: args } = request.params;

    if (!args) {
      throw new Error("No arguments provided");
    }

    switch (name) {
      case "query_like": {
        if (!args.query || typeof args.query !== 'string') {
          throw new Error("Invalid or missing 'query' parameter");
        }
        
        // Type check for range_time
        const rangeTime = args.range_time as { start_time?: string; end_time?: string } | undefined;
        if (!rangeTime?.start_time || !rangeTime?.end_time) {
          throw new Error("Invalid or missing time range parameters");
        }

        console.log(`Executing Athena query: ${args.query}`);
        const querySql = `
          SELECT 
              from_unixtime(CAST(SUBSTR(audit.timestamp, 1, 13) AS BIGINT) / 1000) AS readable_datetime,
              audit.timestamp,
              audit.sql_query,
              audit.user
          FROM default.rds_audit_logs_2025_03_22 AS audit
          WHERE 
          sql_query like '%${args.query}%'
          and TRY_CAST(SUBSTR(audit.timestamp, 1, 13) AS BIGINT) IS NOT NULL
            AND from_unixtime(CAST(SUBSTR(audit.timestamp, 1, 13) AS BIGINT) / 1000)
              BETWEEN TIMESTAMP '${rangeTime.start_time}' AND TIMESTAMP '${rangeTime.end_time}'
          LIMIT 20`
        const queryResults = await executeAthenaQuery(querySql);

        // Format results as a string for display
        const columnHeaders = queryResults.columns.join(' | ');
        const separator = columnHeaders.replace(/[^|]/g, '-').replace(/\|/g, '|');
        const rows = queryResults.data.map(row => 
          queryResults.columns.map(col => row[col] || '').join(' | ')
        );

        const results = [
          columnHeaders,
          separator,
          ...rows
        ].join('\n');

        if (rows.length === 0) {
          return {
            content: [{ type: "text", text: "Query executed successfully but returned no results." }],
            isError: false,
          };
        } else {
          return {
            content: [{ type: "text", text: results }],
            isError: false,
          };
        }
      }

      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
});

async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Brave Search MCP Server running on stdio");
}

runServer().catch((error) => {
  console.error("Fatal error running server:", error);
  process.exit(1);
});