#!/bin/bash

# EC2 MCP Server Deployment Script
# This script deploys the MCP server to an EC2 instance

# Configuration variables - should be set by the user or passed as environment variables
EC2_HOST="${EC2_HOST:-}"
EC2_USER="${EC2_USER:-ec2-user}"
EC2_KEY_FILE="${EC2_KEY_FILE:-}"
REMOTE_DIR="${REMOTE_DIR:-/opt/mcp-server}"
APP_NAME="mcp-server"
NODE_ENV="${NODE_ENV:-production}"

# AWS environment variables to be set on the server
AWS_REGION="${AWS_REGION:-us-east-1}"
AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-}"
AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-}"

# Validate required variables
if [ -z "$EC2_HOST" ]; then
  echo "Error: EC2_HOST environment variable is required"
  echo "Usage: EC2_HOST=your-ec2-instance EC2_KEY_FILE=path/to/key.pem ./deploy.sh"
  exit 1
fi

if [ -z "$EC2_KEY_FILE" ]; then
  echo "Error: EC2_KEY_FILE environment variable is required"
  echo "Usage: EC2_HOST=your-ec2-instance EC2_KEY_FILE=path/to/key.pem ./deploy.sh"
  exit 1
fi

if [ -z "$AWS_ACCESS_KEY_ID" ] || [ -z "$AWS_SECRET_ACCESS_KEY" ]; then
  echo "Warning: AWS credentials not provided. Make sure they are configured on the target server."
fi

# Local project directory
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==== MCP Server Deployment ===="
echo "Deploying to: $EC2_USER@$EC2_HOST"
echo "Project directory: $PROJECT_DIR"
echo "Remote directory: $REMOTE_DIR"

# Create a temp directory for packaging
TEMP_DIR=$(mktemp -d)
echo "Created temporary directory: $TEMP_DIR"

# Copy project files to temp directory
echo "Copying project files..."
cp -R "$PROJECT_DIR"/* "$TEMP_DIR"/

# Create a systemd service file
cat > "$TEMP_DIR/mcp-server.service" << EOF
[Unit]
Description=MCP Server
After=network.target

[Service]
Environment=NODE_ENV=$NODE_ENV
Environment=AWS_REGION=$AWS_REGION
Environment=AWS_ACCESS_KEY_ID=$AWS_ACCESS_KEY_ID
Environment=AWS_SECRET_ACCESS_KEY=$AWS_SECRET_ACCESS_KEY
Type=simple
User=ec2-user
WorkingDirectory=$REMOTE_DIR
ExecStart=/usr/bin/node index.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# Create deployment archive
echo "Creating deployment archive..."
cd "$TEMP_DIR"
zip -r "$TEMP_DIR/deploy.zip" .
echo "Archive created at $TEMP_DIR/deploy.zip"

# Deploy to EC2
echo "Connecting to EC2 instance..."
ssh -i "$EC2_KEY_FILE" "$EC2_USER@$EC2_HOST" "mkdir -p $REMOTE_DIR"

echo "Transferring files to EC2 instance..."
scp -i "$EC2_KEY_FILE" "$TEMP_DIR/deploy.zip" "$EC2_USER@$EC2_HOST:$REMOTE_DIR/deploy.zip"

echo "Setting up application on EC2 instance..."
ssh -i "$EC2_KEY_FILE" "$EC2_USER@$EC2_HOST" << EOF
    cd $REMOTE_DIR
    unzip -o deploy.zip
    rm deploy.zip
    
    # Install Node.js if not already installed
    if ! command -v node &> /dev/null; then
        echo "Installing Node.js..."
        curl -sL https://rpm.nodesource.com/setup_16.x | sudo -E bash -
        sudo yum install -y nodejs
    fi
    
    # Install dependencies
    npm install --production
    
    # Setup systemd service
    sudo cp mcp-server.service /etc/systemd/system/
    sudo systemctl daemon-reload
    sudo systemctl enable mcp-server
    sudo systemctl restart mcp-server
    
    # Check status
    echo "Service status:"
    sudo systemctl status mcp-server --no-pager
EOF

echo "Cleaning up..."
rm -rf "$TEMP_DIR"

echo "==== Deployment completed ===="
echo "MCP Server has been deployed to $EC2_HOST"
echo "You can check the service status with: ssh -i $EC2_KEY_FILE $EC2_USER@$EC2_HOST 'sudo systemctl status mcp-server'"
echo "View logs with: ssh -i $EC2_KEY_FILE $EC2_USER@$EC2_HOST 'sudo journalctl -u mcp-server -f'"
