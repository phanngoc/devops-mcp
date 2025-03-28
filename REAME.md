# DevOps Model Context Protocol (MCP) Server

A Model Context Protocol implementation for DevOps automation, AWS service management, and database operations.

## Features

- **RDS Database Management**: Connect to AWS RDS MySQL and PostgreSQL instances, execute queries and transactions
- **SSH Tunneling**: Support for connecting to databases through SSH tunnels
- **CloudWatch Integration**: Query and monitor CloudWatch logs
- **Athena Integration**: Execute SQL queries against data in Amazon S3 using Athena

## Setup

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy the environment variables example file and configure it:
   ```bash
   cp .env.example .env
   ```
4. Edit the `.env` file with your AWS credentials and other configuration

## Starting the Server

```bash
# Development mode
npm run dev

# Production mode
npm start
```

## Client Usage

The MCP clients are available in the `mcp-client` directory:

```javascript
// RDS example
const { rds } = require('./mcp-client/rds');

async function queryDatabase() {
  const connection = await rds.connectToMySql({
    host: 'your-rds-instance.amazonaws.com',
    port: 3306,
    user: 'username',
    password: 'password',
    database: 'dbname'
  });
  
  const results = await rds.query(
    connection.connectionId,
    'SELECT * FROM users WHERE status = ?',
    ['active']
  );
  
  console.log(results);
  
  await rds.closeConnection(connection.connectionId);
}
```

## Deployment

To deploy to an EC2 instance:

```bash
EC2_HOST=your-ec2-instance EC2_KEY_FILE=~/.ssh/key.pem ./mcp-server/deploy.sh
```

## Architecture

This project uses the Model Context Protocol to provide a standardized interface for DevOps operations. It consists of:

- MCP Server: Core server that registers and routes requests to handlers
- Handlers: Specialized modules for different AWS services and operations
- MCP Clients: JavaScript clients for consuming the MCP server

## Environment Variables

See `.env.example` for all configurable options.
