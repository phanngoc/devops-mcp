const axios = require('axios');
const AWS = require('aws-sdk');
const { spawn } = require('child_process');

/**
 * CloudWatch Logs integration using Model Context Protocol
 */
class CloudWatchMCP {
  constructor() {
    this.mcpServerProcess = null;
    this.mcpPort = process.env.MCP_PORT || 8080;
    this.baseUrl = `http://localhost:${this.mcpPort}`;
    this.serverReady = false;
    
    // AWS CloudWatch configuration
    this.region = process.env.AWS_REGION || 'us-east-1';
    this.cloudwatchLogs = null;
  }

  /**
   * Initialize the AWS CloudWatch Logs client
   */
  initCloudWatch() {
    if (this.cloudwatchLogs) return;
    
    // Configure AWS SDK
    AWS.config.update({
      region: this.region,
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    });
    
    this.cloudwatchLogs = new AWS.CloudWatchLogs();
  }

  /**
   * Start the MCP server if it's not already running
   */
  async ensureServerRunning() {
    if (this.serverReady) {
      return;
    }

    // Start the Playwright MCP server if not already running
    if (!this.mcpServerProcess) {
      console.log('Starting Playwright MCP server...');
      this.mcpServerProcess = spawn('npx', [
        '@executeautomation/playwright-mcp-server',
        '--port', this.mcpPort.toString()
      ]);

      this.mcpServerProcess.stdout.on('data', (data) => {
        const output = data.toString();
        console.log(`MCP Server: ${output}`);
        if (output.includes('Server is running')) {
          this.serverReady = true;
        }
      });

      this.mcpServerProcess.stderr.on('data', (data) => {
        console.error(`MCP Server Error: ${data}`);
      });

      // Wait for server to be ready
      let attempts = 0;
      while (!this.serverReady && attempts < 10) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        attempts++;
      }
      
      if (!this.serverReady) {
        throw new Error('Failed to start MCP Server');
      }
    }
  }

  /**
   * Query CloudWatch logs using MCP server
   * @param {string} logGroupName - The CloudWatch log group name
   * @param {string} filterPattern - Filter pattern to search for in logs
   * @param {number} startTime - Start time in milliseconds since epoch
   * @param {number} endTime - End time in milliseconds since epoch
   * @param {number} limit - Maximum number of log events to return
   * @returns {Promise<Array>} - The matching log events
   */
  async queryLogs(logGroupName, filterPattern = '', startTime, endTime, limit = 100) {
    try {
      await this.ensureServerRunning();
      
      // Use MCP to query CloudWatch logs
      const response = await axios.post(`${this.baseUrl}/execute`, {
        action: 'cloudwatchLogsQuery',
        parameters: {
          logGroupName,
          filterPattern,
          startTime: startTime || (Date.now() - 24 * 60 * 60 * 1000), // Default to last 24 hours
          endTime: endTime || Date.now(),
          limit
        }
      });

      if (response.data.error) {
        throw new Error(response.data.error);
      }

      return response.data.result;
    } catch (error) {
      console.error(`CloudWatch logs query error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get the most recent log events from a specific log stream
   * @param {string} logGroupName - The CloudWatch log group name
   * @param {string} logStreamName - The CloudWatch log stream name
   * @param {number} limit - Maximum number of log events to return
   * @returns {Promise<Array>} - The log events
   */
  async getLogEvents(logGroupName, logStreamName, limit = 100) {
    try {
      await this.ensureServerRunning();
      
      // Use MCP to get log events
      const response = await axios.post(`${this.baseUrl}/execute`, {
        action: 'cloudwatchGetLogEvents',
        parameters: {
          logGroupName,
          logStreamName,
          limit
        }
      });

      if (response.data.error) {
        throw new Error(response.data.error);
      }

      return response.data.result;
    } catch (error) {
      console.error(`CloudWatch get log events error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Find error logs across multiple log groups
   * @param {Array<string>} logGroupNames - List of CloudWatch log group names to search
   * @param {number} startTime - Start time in milliseconds since epoch
   * @param {number} endTime - End time in milliseconds since epoch
   * @returns {Promise<Object>} - Object with log groups as keys and arrays of error logs as values
   */
  async findErrorLogs(logGroupNames, startTime, endTime) {
    try {
      await this.ensureServerRunning();
      
      // Use MCP to find error logs
      const response = await axios.post(`${this.baseUrl}/execute`, {
        action: 'cloudwatchFindErrors',
        parameters: {
          logGroupNames,
          startTime: startTime || (Date.now() - 24 * 60 * 60 * 1000), // Default to last 24 hours
          endTime: endTime || Date.now()
        }
      });

      if (response.data.error) {
        throw new Error(response.data.error);
      }

      return response.data.result;
    } catch (error) {
      console.error(`CloudWatch find error logs error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Clean up resources when done
   */
  async close() {
    if (this.mcpServerProcess) {
      this.mcpServerProcess.kill();
      this.mcpServerProcess = null;
      this.serverReady = false;
    }
  }

  /**
   * Direct access to CloudWatch API (without MCP)
   * For situations where direct API access is needed
   * @returns {AWS.CloudWatchLogs} - CloudWatch Logs AWS SDK instance
   */
  getCloudWatchClient() {
    this.initCloudWatch();
    return this.cloudwatchLogs;
  }
}

// Export a singleton instance
const cloudwatch = new CloudWatchMCP();
module.exports = { cloudwatch };
