const AWS = require('aws-sdk');

/**
 * Handler for CloudWatch log requests via Model Context Protocol
 */
class CloudWatchHandler {
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
  async handleLogsQuery(params) {
    try {
      const { logGroupName, filterPattern, startTime, endTime, limit } = params;
      
      // Validate required parameters
      if (!logGroupName) {
        throw new Error('logGroupName is required');
      }

      // Build CloudWatch Logs filter parameters
      const filterParams = {
        logGroupName,
        filterPattern: filterPattern || '',
        startTime,
        endTime,
        limit: limit || 100
      };

      // Execute the filter
      const data = await this.cloudwatchLogs.filterLogEvents(filterParams).promise();
      return data.events;
    } catch (error) {
      console.error('Error querying CloudWatch logs:', error);
      throw error;
    }
  }

  /**
   * Handler for cloudwatchGetLogEvents MCP action
   */
  async handleGetLogEvents(params) {
    try {
      const { logGroupName, logStreamName, limit } = params;
      
      // Validate required parameters
      if (!logGroupName || !logStreamName) {
        throw new Error('logGroupName and logStreamName are required');
      }

      // Build CloudWatch Logs get events parameters
      const getParams = {
        logGroupName,
        logStreamName,
        limit: limit || 100,
        startFromHead: false
      };

      // Get the log events
      const data = await this.cloudwatchLogs.getLogEvents(getParams).promise();
      return data.events;
    } catch (error) {
      console.error('Error getting CloudWatch log events:', error);
      throw error;
    }
  }

  /**
   * Handler for cloudwatchFindErrors MCP action
   */
  async handleFindErrors(params) {
    try {
      const { logGroupNames, startTime, endTime } = params;
      
      // Validate required parameters
      if (!logGroupNames || !Array.isArray(logGroupNames) || logGroupNames.length === 0) {
        throw new Error('logGroupNames array is required');
      }

      const result = {};
      
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
        const filterParams = {
          logGroupName,
          filterPattern: errorPatterns.join('|'),
          startTime,
          endTime,
          limit: 100
        };

        // Execute the filter
        const data = await this.cloudwatchLogs.filterLogEvents(filterParams).promise();
        result[logGroupName] = data.events;
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
  registerHandlers(mcp) {
    mcp.registerHandler('cloudwatchLogsQuery', this.handleLogsQuery.bind(this));
    mcp.registerHandler('cloudwatchGetLogEvents', this.handleGetLogEvents.bind(this));
    mcp.registerHandler('cloudwatchFindErrors', this.handleFindErrors.bind(this));
  }
}

module.exports = { CloudWatchHandler };
