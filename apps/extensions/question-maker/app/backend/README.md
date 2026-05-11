# EduQuery.ai Backend API

A modern Node.js/Express backend API for the EduQuery.ai question generation platform.

## Features

- **Authentication**: JWT-based user authentication with bcrypt password hashing
- **Question Management**: CRUD operations for questions with AI-powered generation
- **Class Management**: Organize questions by classes/courses
- **AI Integration**: Support for multiple AI providers (Groq, OpenAI, DeepSeek)
- **File Upload**: Upload and process text files for question generation
- **Database**: PostgreSQL with Sequelize ORM
- **Security**: Rate limiting, CORS, helmet security headers
- **Validation**: Input validation and error handling

## Tech Stack

- **Runtime**: Node.js 18+
- **Framework**: Express.js
- **Database**: PostgreSQL with Sequelize ORM
- **Authentication**: JWT + bcrypt
- **File Upload**: Multer
- **AI APIs**: Groq, OpenAI, DeepSeek
- **Security**: Helmet, CORS, Rate Limiting

## Project Structure

```
src/
├── index.js                 # Application entry point
├── config/
│   ├── database.js         # Database configuration
│   └── settings.js         # Environment settings
├── models/
│   ├── index.js            # Model associations
│   ├── User.js             # User model
│   ├── Question.js         # Question model
│   ├── Class.js            # Class model
│   └── Draft.js            # Draft model
├── services/
│   ├── authService.js      # Authentication logic
│   ├── questionService.js  # Question management
│   └── aiService.js        # AI integration
├── routes/
│   ├── auth.js             # Authentication routes
│   ├── questions.js        # Question routes
│   ├── classes.js          # Class routes
└── middleware/
    ├── auth.js             # JWT authentication
    └── errorHandler.js     # Error handling
```

## Installation

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Environment Setup**
   ```bash
   # Copy the environment file from project root
   cp ../../env.example ../../.env
   # Edit .env with your configuration
   ```

3. **Database Setup**
   - Install PostgreSQL
   - Create a database named `eduquery`
   - Update `DATABASE_URL` in the root `.env` file

4. **API Keys**
   - Get API keys from Groq, OpenAI, and/or DeepSeek
   - Add them to the root `.env` file

## Running the Application

### Development
```bash
npm run dev
```

### Production
```bash
npm start
```

The API will be available at `http://localhost:8000`

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register a new user
- `POST /api/auth/login` - Login user
- `GET /api/auth/me` - Get current user

### Questions
- `GET /api/questions` - Get all questions
- `POST /api/questions` - Create a question
- `GET /api/questions/:id` - Get specific question
- `PUT /api/questions/:id` - Update question
- `DELETE /api/questions/:id` - Delete question
- `POST /api/questions/generate` - Generate questions with AI
- `POST /api/questions/approve` - Approve generated questions

### Classes
- `GET /api/classes` - Get all classes
- `POST /api/classes` - Create a class
- `GET /api/classes/:id` - Get specific class
- `PUT /api/classes/:id` - Update class
- `DELETE /api/classes/:id` - Delete class


## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `NODE_ENV` | Environment | `development` |
| `PORT` | Server port | `8000` |
| `DATABASE_URL` | PostgreSQL connection string | Required |
| `JWT_SECRET` | JWT secret key | Required |
| `JWT_EXPIRES_IN` | JWT expiration time | `24h` |
| `CORS_ORIGINS` | Allowed CORS origins | `http://localhost:5173` |
| `GROQ_API_KEY` | Groq API key | Optional |
| `OPENAI_API_KEY` | OpenAI API key | Optional |
| `DEEPSEEK_API_KEY` | DeepSeek API key | Optional |

## Database Schema

### Users
- `id` (Primary Key)
- `email` (Unique)
- `password_hash`
- `created_at`
- `updated_at`

### Questions
- `id` (Primary Key)
- `user_id` (Foreign Key)
- `class_id` (Foreign Key, Optional)
- `content`
- `difficulty` (easy/medium/hard)
- `bloom_level` (remember/understand/apply/analyze/evaluate/create)
- `created_at`
- `updated_at`

### Classes
- `id` (Primary Key)
- `user_id` (Foreign Key)
- `name`
- `subject`
- `course_code`
- `semester`
- `year`
- `description`
- `department`
- `created_at`
- `updated_at`

### Drafts
- `id` (Primary Key)
- `user_id` (Foreign Key)
- `class_id` (Foreign Key, Optional)
- `content`
- `status` (draft/published/archived)
- `last_edited`
- `created_at`
- `updated_at`

## Development

### Adding New Features
1. Create models in `src/models/`
2. Add services in `src/services/`
3. Create routes in `src/routes/`
4. Update associations in `src/models/index.js`

### Testing
```bash
npm test
```

### Linting
```bash
npm run lint
```

## Deployment

The application is ready for deployment with:
- Docker support
- Environment-based configuration
- Production-ready security settings
- Database migrations

## License

MIT License - see LICENSE file for details
