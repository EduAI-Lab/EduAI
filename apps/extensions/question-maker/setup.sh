#!/bin/bash

# EduQuery.ai Setup Script
echo "🚀 Setting up EduQuery.ai..."

# Check if .env already exists
if [ -f ".env" ]; then
    echo "⚠️  .env file already exists. Backing up to .env.backup"
    cp .env .env.backup
fi

# Copy environment template
echo "📋 Creating .env file from template..."
cp .env.example .env

# Make .env file readable only by owner
chmod 600 .env

echo "✅ Environment file created successfully!"
echo ""
echo "📝 Next steps:"
echo "1. Edit .env file with your API keys:"
echo "   nano .env"
echo ""
echo "2. Install dependencies:"
echo "   cd app/backend && npm install"
echo "   cd ../frontend && npm install"
echo ""
echo "3. Start the application:"
echo "   # Development with Docker"
echo "   docker-compose -f docker-compose.dev.yml up -d"
echo ""
echo "   # Or local development"
echo "   # Backend: cd app/backend && npm run dev"
echo "   # Frontend: cd app/frontend && npm run dev"
echo ""
echo "🔑 Don't forget to add your API keys to the .env file!"
echo "   - GROQ_API_KEY"
echo "   - OPENAI_API_KEY" 
echo "   - DEEPSEEK_API_KEY"
