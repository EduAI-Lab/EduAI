# Topics Feature Setup

This document explains how to set up the topics feature for course management.

## Database Setup

1. **Configure Database URL**: Make sure your `.env` file has a valid `DATABASE_URL`:
   ```
   DATABASE_URL="postgresql://username:password@localhost:5432/database_name?schema=public"
   ```

2. **Run Migration**: Execute the following command to create the topics table:
   ```bash
   npx prisma migrate dev --name add_topics_model
   ```

3. **Generate Prisma Client**: After migration, regenerate the Prisma client:
   ```bash
   npx prisma generate
   ```

## Features Implemented

### Backend
- **Topic Model**: Added to Prisma schema with fields:
  - `id`: Unique identifier
  - `categoryId`: Foreign key to category
  - `name`: Topic name (required)
  - `description`: Optional description
  - `order`: Order for sorting (default: 0)
  - `createdAt`/`updatedAt`: Timestamps

- **API Endpoints**:
  - `GET /api/topics?categoryId=<id>`: Get all topics for a category
  - `POST /api/categories/:categoryId/topics`: Create a new topic
  - `PATCH /api/topics/<id>`: Update a topic
  - `DELETE /api/topics/<id>`: Delete a topic

- **Validation**: Using Zod schemas for input validation
- **Authorization**: Only admins and **category maintainers or instructors** can manage topics

### Frontend
- **Topics Tab**: Added to course detail page
- **CRUD Operations**:
  - Add new topics with name input
  - Edit existing topics inline
  - Delete topics with confirmation
  - View all topics in a clean list

- **UI Features**:
  - Input field for new topic names
  - Edit mode with save/cancel buttons
  - Delete confirmation dialog
  - Empty state when no topics exist
  - Permission-based access control

## Usage

1. Navigate to any course detail page
2. Click on the "Topics" tab
3. Use the "Add Topic" button to create new topics
4. Click the edit icon to modify topic names
5. Click the delete icon to remove topics

## Permissions

- **Admins**: Can manage topics for all courses
- **Professors**: Can manage topics for their own courses
- **TAs/Students**: Can view topics but cannot modify them

## Next Steps

To complete the setup:
1. Configure your database connection
2. Run the migration command
3. Test the functionality in the UI
