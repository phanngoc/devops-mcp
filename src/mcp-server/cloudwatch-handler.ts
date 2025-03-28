import AWS from 'aws-sdk';
import { MCPServer } from '../lib/mcp-server';

interface LogsQueryParams {
  logGroupName: string;
  filterPattern?: string;
  startTime?: number;
  endTime?: number;
  limit?: number;
}

interface GetLogEventsParams {
  logGroupName: string;
  logStreamName: string;
  limit?: number;
}

interface FindErrorsParams {
  logGroupNames: string[];
  startTime?: number;
  endTime?: number;
}

/**
 * Handler for CloudWatch log requests via Model Context Protocol
 */s
export class CloudWatchHandler {
  private region: string;
  private cloudwatchLogs: AWS.CloudWatchLogs;

  constructor() {
    this.region = process.env.AWS_REGION || 'us-east-1';
    
    // Configure AWS SDK
    AWS.config.update({
      region: this.region,
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    });
    
    this.cloudwatchLogs = new AWS.CloudWatchLogs();
  }

  /**
   * Handler for cloudwatchLogsQuery MCP action
   */
  async handleLogsQuery(params: LogsQueryParams): Promise<AWS.CloudWatchLogs.FilteredLogEvent[]> {
    try {
      const { logGroupName, filterPattern, startTime, endTime, limit } = params;
      
      // Validate required parameters
      if (!logGroupName) {
        throw new Error('logGroupName is required');
      }

      // Build CloudWatch Logs filter parameters
      const filterParams: AWS.CloudWatchLogs.FilterLogEventsRequest = {
        logGroupName,
        filterPattern: filterPattern || '',
        startTime,
        endTime,
        limit: limit || 100
      };

      // Execute the filter
      const data = await this.cloudwatchLogs.filterLogEvents(filterParams).promise();
      return data.events || [];
    } catch (error) {
      console.error('Error querying CloudWatch logs:', error);
      throw error;
    }
  }

  /**
   * Handler for cloudwatchGetLogEvents MCP action
   */
  async handleGetLogEvents(params: GetLogEventsParams): Promise<AWS.CloudWatchLogs.OutputLogEvent[]> {
    try {
      const { logGroupName, logStreamName, limit } = params;
      
      // Validate required parameters
      if (!logGroupName || !logStreamName) {
        throw new Error('logGroupName and logStreamName are required');
      }

      // Build CloudWatch Logs get events parameters
      const getParams: AWS.CloudWatchLogs.GetLogEventsRequest = {
        logGroupName,
        logStreamName,
        limit: limit || 100,
        startFromHead: false
      };

      // Get the log events
      const data = await this.cloudwatchLogs.getLogEvents(getParams).promise();
      return data.events || [];
    } catch (error) {
      console.error('Error getting CloudWatch log events:', error);
      throw error;
    }
  }

  /**
   * Handler for cloudwatchFindErrors MCP action
   */
  async handleFindErrors(params: FindErrorsParams): Promise<Record<string, AWS.CloudWatchLogs.FilteredLogEvent[]>> {
    try {
      const { logGroupNames, startTime, endTime } = params;
      
      // Validate required parameters
      if (!logGroupNames || !Array.isArray(logGroupNames) || logGroupNames.length === 0) {
        throw new Error('logGroupNames array is required');
      }

      const result: Record<string, AWS.CloudWatchLogs.FilteredLogEvent[]> = {};
      
      // Search for error patterns in each log group
      for (const logGroupName of logGroupNames) {
        // Common error patterns
        const errorPatterns = [
          'error',
          'exception',
          'fail',
          'fatal',
          'critical'
        ];
        
        // Build CloudWatch Logs filter parameters with error patterns
        const filterParams: AWS.CloudWatchLogs.FilterLogEventsRequest = {
          logGroupName,
          filterPattern: errorPatterns.join('|'),
          startTime,
          endTime,
          limit: 100
        };

        // Execute the filter
        const data = await this.cloudwatchLogs.filterLogEvents(filterParams).promise();
        result[logGroupName] = data.events || [];
      }

      return result;
    } catch (error) {
      console.error('Error finding errors in CloudWatch logs:', error);
      throw error;
    }
  }

  /**
   * Register MCP handlers
   */
  registerHandlers(mcp: MCPServer): void {
    mcp.registerHandler('cloudwatchLogsQuery', async (request) => this.handleLogsQuery(request.params));
    mcp.registerHandler('cloudwatchGetLogEvents', async (request) => this.handleGetLogEvents(request.params));
    mcp.registerHandler('cloudwatchFindErrors', async (request) => this.handleFindErrors(request.params));
  }
}
