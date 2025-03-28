const axios = require('axios');
const { spawn } = require('child_process');
const { Client } = require('ssh2');
const fs = require('fs');

/**
 * AWS RDS integration using Model Context Protocol
 */
class RdsMCP {
  constructor() {
    this.mcpServerProcess = null;
    this.mcpPort = process.env.MCP_PORT || 8080;
    this.baseUrl = `http://localhost:${this.mcpPort}`;
    this.serverReady = false;
    this.connections = {};
    
    // Thêm hỗ trợ SSH
    this.ssh = null;
    this.sshConfig = {
      host: process.env.MCP_SSH_HOST || 'localhost',
      port: process.env.MCP_SSH_PORT || 2222,
      username: process.env.MCP_SSH_USER || 'admin',
      password: process.env.MCP_SSH_PASSWORD,
      privateKey: process.env.MCP_SSH_KEY_PATH ? 
                 fs.readFileSync(process.env.MCP_SSH_KEY_PATH) : undefined
    };
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
   * Get list of RDS instances in your AWS account
   */
  async listInstances() {
    try {
      await this.ensureServerRunning();
      
      const response = await axios.post(`${this.baseUrl}/execute`, {
        action: 'rdsGetInstances',
        parameters: {}
      });

      if (response.data.error) {
        throw new Error(response.data.error);
      }

      return response.data.result;
    } catch (error) {
      console.error('Error listing RDS instances:', error.message);
      throw error;
    }
  }

  /**
   * Connect to MySQL RDS database
   * @param {Object} config Connection configuration
   * @returns {Promise<Object>} Connection information
   */
  async connectToMySql(config) {
    try {
      await this.ensureServerRunning();
      
      const response = await axios.post(`${this.baseUrl}/execute`, {
        action: 'rdsConnectMySql',
        parameters: config
      });

      if (response.data.error) {
        throw new Error(response.data.error);
      }

      const connectionInfo = response.data.result;
      this.connections[connectionInfo.connectionId] = connectionInfo;
      
      return connectionInfo;
    } catch (error) {
      console.error('Error connecting to MySQL RDS:', error.message);
      throw error;
    }
  }

  /**
   * Connect to PostgreSQL RDS database
   * @param {Object} config Connection configuration
   * @returns {Promise<Object>} Connection information
   */
  async connectToPostgres(config) {
    try {
      await this.ensureServerRunning();
      
      const response = await axios.post(`${this.baseUrl}/execute`, {
        action: 'rdsConnectPostgres',
        parameters: config
      });

      if (response.data.error) {
        throw new Error(response.data.error);
      }

      const connectionInfo = response.data.result;
      this.connections[connectionInfo.connectionId] = connectionInfo;
      
      return connectionInfo;
    } catch (error) {
      console.error('Error connecting to PostgreSQL RDS:', error.message);
      throw error;
    }
  }

  /**
   * Execute a SQL query on a connected RDS database
   * @param {string} connectionId The connection ID to use
   * @param {string} query SQL query to execute
   * @param {Array} values Query parameter values (optional)
   * @returns {Promise<Array>} Query results
   */
  async query(connectionId, query, values = []) {
    try {
      await this.ensureServerRunning();
      
      if (!this.connections[connectionId]) {
        throw new Error(`Connection ${connectionId} not found or closed`);
      }

      const response = await axios.post(`${this.baseUrl}/execute`, {
        action: 'rdsExecuteQuery',
        parameters: {
          connectionId,
          query,
          values
        }
      });

      if (response.data.error) {
        throw new Error(response.data.error);
      }

      return response.data.result;
    } catch (error) {
      console.error('Error executing RDS query:', error.message);
      throw error;
    }
  }

  /**
   * Execute a transaction with multiple SQL queries
   * @param {string} connectionId The connection ID to use
   * @param {Array<Object>} queries Array of query objects with sql and values properties
   * @returns {Promise<Array>} Transaction results
   */
  async transaction(connectionId, queries) {
    try {
      await this.ensureServerRunning();
      
      if (!this.connections[connectionId]) {
        throw new Error(`Connection ${connectionId} not found or closed`);
      }

      const response = await axios.post(`${this.baseUrl}/execute`, {
        action: 'rdsExecuteTransaction',
        parameters: {
          connectionId,
          queries
        }
      });

      if (response.data.error) {
        throw new Error(response.data.error);
      }

      return response.data.result;
    } catch (error) {
      console.error('Error executing RDS transaction:', error.message);
      throw error;
    }
  }

  /**
   * Close a database connection
   * @param {string} connectionId The connection ID to close
   * @returns {Promise<Object>} Closure result
   */
  async closeConnection(connectionId) {
    try {
      await this.ensureServerRunning();
      
      const response = await axios.post(`${this.baseUrl}/execute`, {
        action: 'rdsCloseConnection',
        parameters: {
          connectionId
        }
      });

      if (response.data.error) {
        throw new Error(response.data.error);
      }

      delete this.connections[connectionId];
      return response.data.result;
    } catch (error) {
      console.error('Error closing RDS connection:', error.message);
      throw error;
    }
  }

  /**
   * Clean up resources when done
   */
  async close() {
    try {
      // Close all open connections
      for (const connectionId of Object.keys(this.connections)) {
        try {
          await this.closeConnection(connectionId);
        } catch (err) {
          console.error(`Error closing connection ${connectionId}:`, err.message);
        }
      }

      // Shut down MCP server
      if (this.mcpServerProcess) {
        this.mcpServerProcess.kill();
        this.mcpServerProcess = null;
        this.serverReady = false;
      }
    } catch (error) {
      console.error('Error during RDS MCP cleanup:', error.message);
    }
  }

  /**
   * Kết nối đến MCP Server thông qua SSH
   * @param {Object} config Cấu hình SSH (tùy chọn, nếu khác mặc định)
   */
  async connectSsh(config = {}) {
    if (this.ssh) {
      return; // Đã kết nối
    }
    
    const sshConfig = {
      ...this.sshConfig,
      ...config
    };
    
    if (!sshConfig.host || !sshConfig.username) {
      throw new Error('Thiếu thông tin kết nối SSH. Vui lòng cấu hình MCP_SSH_HOST và MCP_SSH_USER.');
    }
    
    if (!sshConfig.password && !sshConfig.privateKey) {
      throw new Error('Thiếu thông tin xác thực SSH. Vui lòng cung cấp MCP_SSH_PASSWORD hoặc MCP_SSH_KEY_PATH.');
    }
    
    return new Promise((resolve, reject) => {
      this.ssh = new Client();
      
      this.ssh.on('ready', () => {
        console.log('SSH connection established to MCP server');
        resolve();
      }).on('error', (err) => {
        console.error('SSH connection error:', err);
        this.ssh = null;
        reject(err);
      }).connect(sshConfig);
    });
  }
  
  /**
   * Đóng kết nối SSH
   */
  async closeSsh() {
    if (this.ssh) {
      this.ssh.end();
      this.ssh = null;
      console.log('SSH connection closed');
    }
  }
  
  /**
   * Thực thi lệnh thông qua SSH
   * @param {string} command Lệnh cần thực thi
   * @returns {Promise<any>} Kết quả từ lệnh
   */
  async execSshCommand(command) {
    if (!this.ssh) {
      await this.connectSsh();
    }
    
    return new Promise((resolve, reject) => {
      this.ssh.exec(command, (err, stream) => {
        if (err) return reject(err);
        
        let data = '';
        let errorData = '';
        
        stream.on('data', (chunk) => {
          data += chunk.toString();
        });
        
        stream.stderr.on('data', (chunk) => {
          errorData += chunk.toString();
        });
        
        stream.on('close', (code) => {
          if (code !== 0) {
            return reject(new Error(`Command failed (code ${code}): ${errorData}`));
          }
          
          try {
            // Nếu dữ liệu là JSON, chuyển đổi nó
            const trimmedData = data.trim();
            if (trimmedData.startsWith('{') || trimmedData.startsWith('[')) {
              const result = JSON.parse(trimmedData);
              resolve(result);
            } else {
              resolve(data);
            }
          } catch (e) {
            // Nếu không phải là JSON, trả về dữ liệu gốc
            resolve(data);
          }
        });
      });
    });
  }
  
  /**
   * Kết nối đến MySQL thông qua SSH
   * @param {Object} config Cấu hình kết nối MySQL
   * @returns {Promise<Object>} Thông tin kết nối
   */
  async connectToMySqlSsh(config) {
    try {
      // Đảm bảo SSH đã kết nối
      await this.connectSsh();
      
      // Chuẩn bị lệnh kết nối
      const command = `rds-connect mysql ${config.host} ${config.port} ${config.user} ${config.password} ${config.database}`;
      const connectionInfo = await this.execSshCommand(command);
      
      // Lưu thông tin kết nối
      this.connections[connectionInfo.connectionId] = {
        ...connectionInfo,
        via: 'ssh'
      };
      
      return connectionInfo;
    } catch (error) {
      console.error('Error connecting to MySQL via SSH:', error.message);
      throw error;
    }
  }
  
  /**
   * Kết nối đến PostgreSQL thông qua SSH
   * @param {Object} config Cấu hình kết nối PostgreSQL
   * @returns {Promise<Object>} Thông tin kết nối
   */
  async connectToPostgresSsh(config) {
    try {
      // Đảm bảo SSH đã kết nối
      await this.connectSsh();
      
      // Chuẩn bị lệnh kết nối
      const command = `rds-connect postgres ${config.host} ${config.port} ${config.user} ${config.password} ${config.database}`;
      const connectionInfo = await this.execSshCommand(command);
      
      // Lưu thông tin kết nối
      this.connections[connectionInfo.connectionId] = {
        ...connectionInfo,
        via: 'ssh'
      };
      
      return connectionInfo;
    } catch (error) {
      console.error('Error connecting to PostgreSQL via SSH:', error.message);
      throw error;
    }
  }
  
  /**
   * Thực hiện truy vấn thông qua SSH
   * @param {string} connectionId ID kết nối
   * @param {string} query Câu truy vấn SQL
   * @param {Array} values Các tham số (tùy chọn)
   * @returns {Promise<any>} Kết quả truy vấn
   */
  async querySsh(connectionId, query, values = []) {
    try {
      // Kiểm tra kết nối
      if (!this.connections[connectionId]) {
        throw new Error(`Connection ${connectionId} not found or closed`);
      }
      
      if (this.connections[connectionId].via !== 'ssh') {
        throw new Error(`Connection ${connectionId} is not an SSH connection`);
      }
      
      // Chuẩn bị lệnh truy vấn
      let command = `rds-query ${connectionId} ${query}`;
      
      // Thêm tham số nếu có
      if (values && values.length > 0) {
        command += ` --params ${values.map(v => 
          typeof v === 'string' ? `"${v.replace(/"/g, '\\"')}"` : v
        ).join(' ')}`;
      }
      
      // Thực thi lệnh
      const result = await this.execSshCommand(command);
      return result;
    } catch (error) {
      console.error('Error executing query via SSH:', error.message);
      throw error;
    }
  }
  
  /**
   * Đóng kết nối cơ sở dữ liệu thông qua SSH
   * @param {string} connectionId ID kết nối cần đóng
   * @returns {Promise<Object>} Kết quả đóng kết nối
   */
  async closeConnectionSsh(connectionId) {
    try {
      // Kiểm tra kết nối
      if (!this.connections[connectionId]) {
        throw new Error(`Connection ${connectionId} not found or already closed`);
      }
      
      if (this.connections[connectionId].via !== 'ssh') {
        throw new Error(`Connection ${connectionId} is not an SSH connection`);
      }
      
      // Chuẩn bị lệnh đóng kết nối
      const command = `rds-close ${connectionId}`;
      
      // Thực thi lệnh
      const result = await this.execSshCommand(command);
      
      // Xóa thông tin kết nối đã lưu
      delete this.connections[connectionId];
      
      return result;
    } catch (error) {
      console.error('Error closing connection via SSH:', error.message);
      throw error;
    }
  }
}

// Export a singleton instance
const rds = new RdsMCP();
module.exports = { rds };
