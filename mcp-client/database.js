const axios = require('axios');

/**
 * Database integration using Model Context Protocol
 */
class DatabaseMCP {
  constructor() {
    this.mcpPort = process.env.MCP_PORT || 8080;
    this.baseUrl = `http://localhost:${this.mcpPort}`;
    this.dbType = process.env.DB_TYPE || 'postgres'; // postgres or mysql
  }

  /**
   * Executes a database query using the appropriate MCP server
   * @param {string} queryString - SQL query to execute
   * @returns {Promise<any>} - Query results
   */
  async query(queryString) {
    try {
      // Determine which database MCP server to use based on configuration
      const mcpAction = this.dbType === 'mysql' ? 'mysqlQuery' : 'postgresQuery';
      
      const response = await axios.post(`${this.baseUrl}/execute`, {
        action: mcpAction,
        parameters: {
          query: queryString,
          host: process.env.DB_HOST,
          port: process.env.DB_PORT,
          user: process.env.DB_USER,
          password: process.env.DB_PASSWORD,
          database: process.env.DB_NAME
        }
      });

      if (response.data.error) {
        throw new Error(response.data.error);
      }

      return response.data.result;
    } catch (error) {
      console.error(`Database query error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Execute a database transaction with multiple queries
   * @param {string[]} queries - Array of SQL queries to execute in transaction
   * @returns {Promise<any>} - Transaction results
   */
  async transaction(queries) {
    try {
      const response = await axios.post(`${this.baseUrl}/execute`, {
        action: this.dbType === 'mysql' ? 'mysqlTransaction' : 'postgresTransaction',
        parameters: {
          queries: queries,
          host: process.env.DB_HOST,
          port: process.env.DB_PORT,
          user: process.env.DB_USER,
          password: process.env.DB_PASSWORD,
          database: process.env.DB_NAME
        }
      });

      if (response.data.error) {
        throw new Error(response.data.error);
      }

      return response.data.result;
    } catch (error) {
      console.error(`Database transaction error: ${error.message}`);
      throw error;
    }
  }
}

// Export a singleton instance
const db = new DatabaseMCP();
module.exports = { db };
