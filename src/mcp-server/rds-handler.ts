import mysql, { Connection, PoolConnection } from 'mysql2/promise';
import { Client as PgClient } from 'pg';
import AWS from 'aws-sdk';
import net from 'net';
import { Client as SSHClient } from 'ssh2';
import { Server as NetServer, Socket } from 'net';
import { MCPServer } from '../lib/mcp-server';

interface RdsInstance {
  identifier: string;
  engine: string;
  endpoint?: string;
  port?: number;
  status: string;
}

interface AuthTokenParams {
  hostname: string;
  port: number;
  username: string;
  region?: string;
}

interface TunnelParams {
  sshHost: string;
  sshPort?: number;
  sshUsername: string;
  sshPassword?: string;
  sshPrivateKey?: string | Buffer;
  dbHost: string;
  dbPort: number;
  localPort?: number;
}

interface TunnelInfo {
  sshClient: SSHClient;
  server: NetServer;
  localHost: string;
  localPort: number;
  dbHost: string;
  dbPort: number;
  tunnelId: string;
}

interface ConnectionInfo {
  connection: Connection | PgClient;
  engine: 'mysql' | 'postgres';
  tunnelId?: string;
}

interface MySqlConnectParams {
  host: string;
  port?: number;
  user: string;
  password: string;
  database: string;
  useIAM?: boolean;
  sshHost?: string;
  sshPort?: number;
  sshUsername?: string;
  sshPassword?: string;
  sshPrivateKey?: string | Buffer;
  ssl?: boolean;
}

interface PostgresConnectParams {
  host: string;
  port?: number;
  user: string;
  password: string;
  database: string;
  useIAM?: boolean;
  ssl?: boolean;
  sshHost?: string;
  sshPort?: number;
  sshUsername?: string;
  sshPassword?: string;
  sshPrivateKey?: string | Buffer;
}

interface QueryParams {
  connectionId: string;
  query: string;
  values?: any[];
}

interface TransactionParams {
  connectionId: string;
  queries: Array<{sql: string, values?: any[]}>;
}

interface ConnectionResult {
  connectionId: string;
  engine: 'mysql' | 'postgres';
  connected: boolean;
  viaTunnel: boolean;
  tunnelId?: string;
}

/**
 * Handler for AWS RDS database requests via Model Context Protocol
 * Hỗ trợ kết nối trực tiếp và qua SSH tunnel
 */
export class RdsHandler {
  private region: string;
  private rds: AWS.RDS;
  private connections: Record<string, ConnectionInfo>;
  private tunnels: Record<string, TunnelInfo>;

  constructor() {
    this.region = process.env.AWS_REGION || 'us-east-1';
    
    // Configure AWS SDK
    AWS.config.update({
      region: this.region,
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    });
    
    this.rds = new AWS.RDS();
    this.connections = {};
    this.tunnels = {};
  }

  /**
   * Get RDS instance information using AWS SDK
   */
  async getRdsInstances(): Promise<RdsInstance[]> {
    try {
      const data = await this.rds.describeDBInstances().promise();
      return data.DBInstances.map(instance => ({
        identifier: instance.DBInstanceIdentifier as string,
        engine: instance.Engine as string,
        endpoint: instance.Endpoint?.Address,
        port: instance.Endpoint?.Port,
        status: instance.DBInstanceStatus as string
      }));
    } catch (error) {
      console.error('Error retrieving RDS instances:', error);
      throw error;
    }
  }

  /**
   * Generate authentication token for IAM authentication to RDS
   */
  async getAuthToken(params: AuthTokenParams): Promise<string> {
    try {
      const { hostname, port, username, region } = params;
      
      const signer = new AWS.RDS.Signer({
        region: region || this.region,
        hostname,
        port,
        username
      });
      
      return new Promise((resolve, reject) => {
        signer.getAuthToken({}, (err, token) => {
          if (err) {
            reject(err);
          } else {
            resolve(token);
          }
        });
      });
    } catch (error) {
      console.error('Error generating RDS auth token:', error);
      throw error;
    }
  }

  /**
   * Tạo SSH tunnel đến RDS 
   * @param {TunnelParams} params Thông số tunnel
   * @returns {Promise<TunnelInfo>} Thông tin tunnel
   */
  createTunnel(params: TunnelParams): Promise<TunnelInfo> {
    const { sshHost, sshPort, sshUsername, sshPassword, sshPrivateKey, 
            dbHost, dbPort, localPort } = params;

    return new Promise((resolve, reject) => {
      const sshClient = new SSHClient();
      
      // Thiết lập thông tin xác thực SSH
      const sshConfig: any = {
        host: sshHost,
        port: sshPort || 22,
        username: sshUsername
      };
      
      if (sshPassword) {
        sshConfig.password = sshPassword;
      } else if (sshPrivateKey) {
        sshConfig.privateKey = sshPrivateKey;
      } else {
        return reject(new Error('Thiếu mật khẩu hoặc private key SSH'));
      }
      
      // Xử lý sự kiện kết nối
      sshClient.on('ready', () => {
        // Thiết lập cổng chuyển tiếp: cổng local -> cổng DB thông qua SSH
        sshClient.forwardOut(
          '127.0.0.1', localPort || 0,  // Cổng nguồn (nếu 0, sẽ được tự động gán)
          dbHost, dbPort,                // Cổng đích (máy chủ DB)
          (err, stream) => {
            if (err) {
              sshClient.end();
              return reject(err);
            }
            
            // Bắt đầu lắng nghe trên cổng local
            const server = net.createServer((socket: Socket) => {
              // Kết nối socket với stream SSH
              socket.pipe(stream).pipe(socket);
              
              socket.on('error', (err) => {
                console.error('Lỗi socket:', err);
              });
            });
            
            // Lắng nghe trên cổng cục bộ
            server.listen(localPort || 0, '127.0.0.1', () => {
              const address = server.address() as net.AddressInfo;
              console.log(`SSH tunnel được thiết lập: 127.0.0.1:${address.port} -> ${dbHost}:${dbPort}`);
              
              // Lưu trữ thông tin tunnel
              const tunnelId = `tunnel_${Date.now()}`;
              this.tunnels[tunnelId] = {
                sshClient,
                server,
                localHost: '127.0.0.1',
                localPort: address.port,
                dbHost,
                dbPort,
                tunnelId
              };
              
              resolve(this.tunnels[tunnelId]);
            });
            
            server.on('error', (err) => {
              sshClient.end();
              reject(err);
            });
          }
        );
      });
      
      sshClient.on('error', (err) => {
        console.error('Lỗi kết nối SSH:', err);
        reject(err);
      });
      
      // Thiết lập kết nối SSH
      sshClient.connect(sshConfig);
    });
  }
  
  /**
   * Đóng tunnel SSH
   * @param {string} tunnelId ID của tunnel cần đóng
   */
  closeTunnel(tunnelId: string): void {
    if (!this.tunnels[tunnelId]) {
      console.warn(`Tunnel ${tunnelId} không tồn tại hoặc đã đóng`);
      return;
    }
    
    const tunnel = this.tunnels[tunnelId];
    
    if (tunnel.server) {
      tunnel.server.close(() => {
        console.log(`Đã đóng server cổng ${tunnel.localPort}`);
      });
    }
    
    if (tunnel.sshClient) {
      tunnel.sshClient.end();
      console.log('Đã đóng kết nối SSH client');
    }
    
    delete this.tunnels[tunnelId];
    console.log(`Đã đóng tunnel ${tunnelId}`);
  }

  /**
   * Kết nối đến MySQL RDS qua SSH tunnel
   */
  async connectToMySqlWithTunnel(params: MySqlConnectParams): Promise<ConnectionResult> {
    try {
      const { 
        host, port, user, password, database, useIAM,
        sshHost, sshPort, sshUsername, sshPassword, sshPrivateKey 
      } = params;

      if (!sshHost || !sshUsername) {
        throw new Error('Missing SSH connection parameters');
      }
      
      // Tạo SSH tunnel
      const tunnel = await this.createTunnel({
        sshHost, 
        sshPort, 
        sshUsername, 
        sshPassword, 
        sshPrivateKey,
        dbHost: host,
        dbPort: port || 3306,
        localPort: 0 // Tự động chọn cổng trống
      });
      
      // Thiết lập kết nối MySQL qua tunnel
      let authConfig: any;
      
      if (useIAM) {
        const token = await this.getAuthToken({
          hostname: host,
          port: port || 3306,
          username: user
        });
        
        authConfig = {
          host: tunnel.localHost,
          port: tunnel.localPort,
          user,
          password: token,
          database,
          ssl: { rejectUnauthorized: true },
          authPlugins: {
            mysql_clear_password: () => () => Buffer.from(token + '\0')
          }
        };
      } else {
        authConfig = {
          host: tunnel.localHost,
          port: tunnel.localPort,
          user,
          password,
          database
        };
      }
      
      // Thiết lập kết nối MySQL
      const connection = await mysql.createConnection(authConfig);
      const connectionId = `mysql_ssh_${host}_${database}_${Date.now()}`;
      
      // Lưu thông tin kết nối và tunnel
      this.connections[connectionId] = {
        connection,
        engine: 'mysql',
        tunnelId: tunnel.tunnelId
      };
      
      return {
        connectionId,
        engine: 'mysql',
        connected: true,
        viaTunnel: true,
        tunnelId: tunnel.tunnelId
      };
    } catch (error) {
      console.error('Lỗi kết nối MySQL qua SSH tunnel:', error);
      throw error;
    }
  }

  /**
   * Kết nối đến MySQL RDS trực tiếp (giữ nguyên hàm cũ)
   */
  async connectToMySql(params: MySqlConnectParams): Promise<ConnectionResult> {
    // Kiểm tra xem có sử dụng SSH tunnel không
    if (params.sshHost) {
      return this.connectToMySqlWithTunnel(params);
    }
    
    try {
      const { host, port, user, password, database, useIAM } = params;
      
      let authConfig: any;
      
      if (useIAM) {
        const token = await this.getAuthToken({
          hostname: host,
          port: port || 3306,
          username: user
        });
        
        authConfig = {
          host,
          port: port || 3306,
          user,
          password: token,
          database,
          ssl: { rejectUnauthorized: true },
          authPlugins: {
            mysql_clear_password: () => () => Buffer.from(token + '\0')
          }
        };
      } else {
        authConfig = {
          host,
          port: port || 3306,
          user,
          password,
          database
        };
      }
      
      const connection = await mysql.createConnection(authConfig);
      const connectionId = `mysql_${host}_${database}_${Date.now()}`;
      this.connections[connectionId] = {
        connection,
        engine: 'mysql'
      };
      
      return {
        connectionId,
        engine: 'mysql',
        connected: true,
        viaTunnel: false
      };
    } catch (error) {
      console.error('Error connecting to MySQL RDS:', error);
      throw error;
    }
  }

  /**
   * Kết nối đến PostgreSQL RDS qua SSH tunnel
   */
  async connectToPostgresWithTunnel(params: PostgresConnectParams): Promise<ConnectionResult> {
    try {
      const { 
        host, port, user, password, database, useIAM, ssl,
        sshHost, sshPort, sshUsername, sshPassword, sshPrivateKey 
      } = params;

      if (!sshHost || !sshUsername) {
        throw new Error('Missing SSH connection parameters');
      }
      
      // Tạo SSH tunnel
      const tunnel = await this.createTunnel({
        sshHost, 
        sshPort, 
        sshUsername, 
        sshPassword, 
        sshPrivateKey,
        dbHost: host,
        dbPort: port || 5432,
        localPort: 0 // Tự động chọn cổng trống
      });
      
      // Thiết lập kết nối PostgreSQL qua tunnel
      let authConfig: any;
      
      if (useIAM) {
        const token = await this.getAuthToken({
          hostname: host,
          port: port || 5432,
          username: user
        });
        
        authConfig = {
          host: tunnel.localHost,
          port: tunnel.localPort,
          user,
          password: token,
          database,
          ssl: { rejectUnauthorized: true }
        };
      } else {
        authConfig = {
          host: tunnel.localHost,
          port: tunnel.localPort,
          user,
          password,
          database,
          ssl: ssl || process.env.RDS_SSL === 'true'
        };
      }
      
      // Thiết lập kết nối PostgreSQL
      const connection = new PgClient(authConfig);
      await connection.connect();
      const connectionId = `postgres_ssh_${host}_${database}_${Date.now()}`;
      
      // Lưu thông tin kết nối và tunnel
      this.connections[connectionId] = {
        connection,
        engine: 'postgres',
        tunnelId: tunnel.tunnelId
      };
      
      return {
        connectionId,
        engine: 'postgres',
        connected: true,
        viaTunnel: true,
        tunnelId: tunnel.tunnelId
      };
    } catch (error) {
      console.error('Lỗi kết nối PostgreSQL qua SSH tunnel:', error);
      throw error;
    }
  }

  /**
   * Kết nối đến PostgreSQL RDS
   */
  async connectToPostgres(params: PostgresConnectParams): Promise<ConnectionResult> {
    // Kiểm tra xem có sử dụng SSH tunnel không
    if (params.sshHost) {
      return this.connectToPostgresWithTunnel(params);
    }
    
    try {
      const { host, port, user, password, database, useIAM, ssl } = params;
      
      let authConfig: any;
      
      if (useIAM) {
        const token = await this.getAuthToken({
          hostname: host,
          port: port || 5432,
          username: user
        });
        
        authConfig = {
          host,
          port: port || 5432,
          user,
          password: token,
          database,
          ssl: { rejectUnauthorized: true }
        };
      } else {
        authConfig = {
          host,
          port: port || 5432,
          user,
          password,
          database,
          ssl: ssl || process.env.RDS_SSL === 'true'
        };
      }
      
      const connection = new PgClient(authConfig);
      await connection.connect();
      const connectionId = `postgres_${host}_${database}_${Date.now()}`;
      this.connections[connectionId] = {
        connection,
        engine: 'postgres'
      };
      
      return {
        connectionId,
        engine: 'postgres',
        connected: true,
        viaTunnel: false
      };
    } catch (error) {
      console.error('Error connecting to PostgreSQL RDS:', error);
      throw error;
    }
  }

  /**
   * Execute query on RDS database
   */
  async executeQuery(params: QueryParams): Promise<any> {
    try {
      const { connectionId, query, values } = params;
      
      if (!this.connections[connectionId]) {
        throw new Error(`Connection ${connectionId} not found or closed`);
      }
      
      const connInfo = this.connections[connectionId];
      const connection = connInfo.connection;
      let result;
      
      if (connInfo.engine === 'mysql') {
        // MySQL query
        const mysqlConn = connection as Connection;
        const [rows] = await mysqlConn.query(query, values || []);
        result = rows;
      } else {
        // PostgreSQL query
        const pgConn = connection as PgClient;
        const res = await pgConn.query(query, values || []);
        result = res.rows;
      }
      
      return result;
    } catch (error) {
      console.error('Error executing query on RDS:', error);
      throw error;
    }
  }

  /**
   * Execute transaction on RDS database
   */
  async executeTransaction(params: TransactionParams): Promise<any[]> {
    try {
      const { connectionId, queries } = params;
      
      if (!this.connections[connectionId]) {
        throw new Error(`Connection ${connectionId} not found or closed`);
      }
      
      const connInfo = this.connections[connectionId];
      const connection = connInfo.connection;
      let results: any[] = [];
      
      if (connInfo.engine === 'mysql') {
        // MySQL transaction
        const mysqlConn = connection as Connection;
        await mysqlConn.beginTransaction();
        try {
          for (const query of queries) {
            const [rows] = await mysqlConn.query(query.sql, query.values || []);
            results.push(rows);
          }
          await mysqlConn.commit();
        } catch (err) {
          await mysqlConn.rollback();
          throw err;
        }
      } else {
        // PostgreSQL transaction
        const pgConn = connection as PgClient;
        await pgConn.query('BEGIN');
        try {
          for (const query of queries) {
            const res = await pgConn.query(query.sql, query.values || []);
            results.push(res.rows);
          }
          await pgConn.query('COMMIT');
        } catch (err) {
          await pgConn.query('ROLLBACK');
          throw err;
        }
      }
      
      return results;
    } catch (error) {
      console.error('Error executing transaction on RDS:', error);
      throw error;
    }
  }

  /**
   * Close database connection
   */
  async closeConnection(connectionId: string): Promise<{success: boolean, message: string}> {
    try {
      if (!this.connections[connectionId]) {
        throw new Error(`Connection ${connectionId} not found or already closed`);
      }
      
      const connInfo = this.connections[connectionId];
      const connection = connInfo.connection;
      
      // Đóng kết nối DB
      if (connInfo.engine === 'mysql') {
        const mysqlConn = connection as Connection;
        await mysqlConn.end();
      } else {
        const pgConn = connection as PgClient;
        await pgConn.end();
      }
      
      // Đóng tunnel nếu có
      if (connInfo.tunnelId && this.tunnels[connInfo.tunnelId]) {
        this.closeTunnel(connInfo.tunnelId);
      }
      
      delete this.connections[connectionId];
      
      return { success: true, message: `Đã đóng kết nối ${connectionId}` };
    } catch (error) {
      console.error('Error closing RDS connection:', error);
      throw error;
    }
  }

  /**
   * Register MCP handlers
   */
  registerHandlers(mcp: MCPServer): void {
    mcp.registerHandler('rdsGetInstances', this.getRdsInstances.bind(this));
    mcp.registerHandler('rdsConnectMySql', this.connectToMySql.bind(this));
    mcp.registerHandler('rdsConnectPostgres', this.connectToPostgres.bind(this));
    mcp.registerHandler('rdsExecuteQuery', this.executeQuery.bind(this));
    mcp.registerHandler('rdsExecuteTransaction', this.executeTransaction.bind(this));
    mcp.registerHandler('rdsCloseConnection', this.closeConnection.bind(this));
  }

  /**
   * Đóng tất cả kết nối và giải phóng tài nguyên
   */
  async close(): Promise<{success: boolean, message: string}> {
    try {
      // Đóng tất cả kết nối DB
      for (const connectionId of Object.keys(this.connections)) {
        try {
          await this.closeConnection(connectionId);
        } catch (err) {
          console.error(`Lỗi đóng kết nối ${connectionId}:`, err);
        }
      }
      
      // Đóng tất cả tunnel còn lại nếu có
      for (const tunnelId of Object.keys(this.tunnels)) {
        try {
          this.closeTunnel(tunnelId);
        } catch (err) {
          console.error(`Lỗi đóng tunnel ${tunnelId}:`, err);
        }
      }
      
      return { success: true, message: 'Đã đóng tất cả kết nối và tunnel' };
    } catch (error) {
      console.error('Error closing all RDS connections:', error);
      throw error;
    }
  }
}
