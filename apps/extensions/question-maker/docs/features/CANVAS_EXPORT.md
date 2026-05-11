# Canvas LMS Export Guide

This guide explains how to export assessments from Question Maker to Canvas LMS as quizzes.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Step 1: Create Instructor Account](#step-1-create-instructor-account)
- [Step 2: Generate Canvas API Key](#step-2-generate-canvas-api-key)
- [Step 3: Create a Course in Canvas](#step-3-create-a-course-in-canvas)
- [Step 4: Export Assessment from Question Maker](#step-4-export-assessment-from-question-maker)
- [Step 5: Find Exported Quiz in Canvas](#step-5-find-exported-quiz-in-canvas)
- [Testing Without Canvas Access](#testing-without-canvas-access)
- [Troubleshooting](#troubleshooting)

## Prerequisites

Before exporting to Canvas, ensure you have:

- ✅ A Canvas LMS account with instructor permissions
- ✅ An assessment created in Question Maker with at least one section containing questions
- ✅ Access to your Canvas instance (e.g., `https://canvas.instructure.com` or your institution's Canvas URL)

## Step 1: Create Instructor Account

If you don't already have a Canvas instructor account:

1. **For Institutional Canvas:**
   - Contact your institution's Canvas administrator
   - Request instructor access to a course
   - You may need to be enrolled as a teacher in at least one course

2. **For Canvas Free-for-Teacher:**
   - Visit [Canvas Free-for-Teacher](https://www.instructure.com/canvas/free-for-teacher)
   - Sign up for a free account
   - You'll automatically have instructor permissions

3. **For Canvas Test Instance:**
   - Some institutions provide test/sandbox instances
   - Contact your Canvas administrator for access

## Step 2: Generate Canvas API Key

Canvas API keys allow Question Maker to interact with your Canvas account programmatically.

### Steps to Generate API Key:

1. **Log in to Canvas**
   - Navigate to your Canvas instance
   - Log in with your instructor account

2. **Access Account Settings**
   - Click on your profile picture/avatar in the top-right corner
   - Select **"Settings"** from the dropdown menu

3. **Navigate to Approved Integrations**
   - Scroll down to the **"Approved Integrations"** section
   - Click **"+ New Access Token"** button

4. **Create Access Token**
   - **Purpose/Description**: Enter a descriptive name (e.g., "Question Maker Export")
   - **Expires**: Set expiration date (optional, leave blank for no expiration)
   - Click **"Generate Token"**

5. **Copy the API Key**
   - ⚠️ **IMPORTANT**: Copy the token immediately - it will only be shown once!
   - Store it securely (you'll need it in Step 4)
   - The token format looks like: `1234~aBcDeFgHiJkLmNoPqRsTuVwXyZ...`

### Security Notes:

- API keys have full access to your Canvas account
- Never share your API key publicly
- If compromised, delete the token and generate a new one
- Consider setting an expiration date for additional security

## Step 3: Create a Course in Canvas

If you don't already have a course to export to:

1. **Access Canvas Dashboard**
   - Log in to your Canvas instance
   - You should see your dashboard

2. **Create New Course**
   - Click **"+ Course"** or **"Start a New Course"** button
   - Fill in course details:
     - **Course Name**: e.g., "COSC 211 - Machine Architecture"
     - **Course Code**: e.g., "COSC 211"
     - **Term**: Select appropriate term
   - Click **"Create Course"**

3. **Note the Course ID**
   - The course ID appears in the URL: `https://canvas.example.com/courses/12345`
   - The number `12345` is your course ID
   - You don't need to manually enter this - Question Maker will list your courses

4. **Publish the Course (Optional)**
   - Courses can be unpublished, but quizzes can still be created
   - Publishing is not required for export

## Step 4: Export Assessment from Question Maker

Now you're ready to export your assessment to Canvas.

### 4.1 Navigate to Assessment

1. **Open Question Maker**
   - Log in to your Question Maker account
   - Navigate to the **Assessments** page

2. **Select Assessment**
   - Click on the assessment you want to export
   - Ensure the assessment has:
     - At least one section
     - Questions added to sections
     - Variants for each question

### 4.2 Initiate Export

1. **Click Export Button**
   - In the assessment view page, click the **"Export to Canvas"** button
   - Located in the top-right area, next to the "Delete Assessment" button

2. **Connect Canvas Account (First Time)**

   If this is your first time exporting:
   
   a. **Choose Connection Method:**
      - **Test Mode**: Check "Use Test Mode" to test without a real Canvas account
      - **Real Connection**: Leave unchecked to connect to your actual Canvas instance
   
   b. **Enter Canvas Details:**
      - **Canvas Instance URL**: 
        - For Canvas Cloud: `https://canvas.instructure.com`
        - For institutional Canvas: Your institution's Canvas URL
        - Example: `https://canvas.ubc.ca`
      - **API Key**: Paste the API key you generated in Step 2
   
   c. **Connect**:
      - Click **"Connect Canvas"** (or **"Enable Test Mode"** for test mode)
      - Wait for connection confirmation

3. **Select Canvas Course**

   After connecting:
   
   a. **View Available Courses**
      - Question Maker will load your Canvas courses
      - You'll see a dropdown list of courses where you have instructor access
   
   b. **Select Target Course**
      - Choose the course where you want to create the quiz
      - Course names appear as: `[Course Code] - [Course Name]`
      - Example: `COSC 211 - Machine Architecture`

4. **Export Assessment**

   a. **Review Selection**
      - Verify you've selected the correct course
      - The assessment name will be used as the quiz title
   
   b. **Click Export**
      - Click **"Export to Canvas"** button
      - Wait for the export process to complete
      - Progress indicators will show during export

5. **Export Confirmation**

   Upon successful export, you'll see:
   - ✅ Success message
   - Number of questions created
   - Quiz ID
   - Link to view the quiz in Canvas (if not in test mode)

### 4.3 What Gets Exported

The export process creates:

- **Quiz**: A new quiz in Canvas with:
  - Title: Same as your assessment name
  - Description: Assessment description (if provided)
  - Type: Assignment quiz
  - Status: Unpublished (you can publish it later in Canvas)

- **Questions**: Each question variant becomes a Canvas question:
  - **MCQ Questions**: Converted to multiple choice questions
    - Options parsed from question text (A, B, C, D format)
    - Correct answer marked based on variant answer field
  - **Short Answer Questions**: Converted to short answer questions
    - Answer text from variant answer field

- **Question Order**: Questions maintain their section order and display order

## Step 5: Find Exported Quiz in Canvas

After successful export, locate your quiz in Canvas:

1. **Navigate to Course**
   - Log in to Canvas
   - Open the course you selected during export

2. **Access Quizzes**
   - In the course navigation menu, click **"Quizzes"**
   - If you don't see Quizzes, enable it in course settings:
     - Go to **Settings** → **Navigation** tab
     - Drag "Quizzes" to enabled items
     - Click **"Save"**

3. **Locate Your Quiz**
   - Find the quiz with your assessment name
   - It will be marked as **"Unpublished"** (gray icon)
   - Click on the quiz name to open it

4. **Review Quiz**
   - Verify all questions are present
   - Check question formatting
   - Review correct answers for MCQ questions

5. **Publish Quiz (When Ready)**
   - Click **"Publish"** button to make it available to students
   - Or keep it unpublished until you're ready

6. **Edit if Needed**
   - You can edit questions, points, and settings directly in Canvas
   - Changes in Canvas won't sync back to Question Maker

## Testing Without Canvas Access

If you don't have Canvas instructor access, you can test the export functionality using **Test Mode**:

### Using Test Mode

1. **Enable Test Mode**
   - When connecting Canvas, check **"Use Test Mode (no Canvas account needed)"**
   - No API key or Canvas URL required
   - Click **"Enable Test Mode"**

2. **Mock Courses Available**
   - Test mode provides mock Canvas courses:
     - COSC 101 - Introduction to Computer Science
     - COSC 201 - Data Structures and Algorithms
     - COSC 211 - Machine Architecture
     - COSC 121 - Computer Programming II

3. **Test Export**
   - Select any mock course
   - Export your assessment
   - The export will simulate successfully
   - No actual quiz is created in Canvas

4. **What Test Mode Shows**
   - Simulated API responses
   - Mock quiz creation confirmation
   - Test mode indicator in the UI
   - All export logic works the same way

### Benefits of Test Mode

- ✅ Test export functionality without Canvas access
- ✅ Verify question conversion logic
- ✅ Practice the export workflow
- ✅ Debug export issues safely
- ✅ No risk of creating unwanted quizzes

## Troubleshooting

### Common Issues and Solutions

#### 1. "Canvas integration not configured"

**Problem**: You haven't connected your Canvas account yet.

**Solution**: 
- Click "Export to Canvas" and complete the connection process
- Enter your Canvas URL and API key

#### 2. "No courses found"

**Problem**: Canvas API can't find courses where you have instructor access.

**Solutions**:
- Verify you're enrolled as an instructor (not just a student) in at least one course
- Check that your API key has the correct permissions
- Ensure you're using the correct Canvas instance URL
- Try refreshing the courses list

#### 3. "Failed to export assessment"

**Problem**: Export process failed.

**Solutions**:
- Verify your API key is still valid (not expired)
- Check that the assessment has questions in sections
- Ensure you have permission to create quizzes in the selected course
- Check browser console for detailed error messages

#### 4. "Canvas API error: 401 Unauthorized"

**Problem**: Invalid API key or expired token.

**Solutions**:
- Generate a new API key in Canvas Settings
- Verify you copied the entire token (they're very long)
- Check that the token hasn't expired
- Ensure no extra spaces were copied with the token

#### 5. "Canvas API error: 403 Forbidden"

**Problem**: API key doesn't have required permissions.

**Solutions**:
- Verify you have instructor/teacher role in the course
- Check that you can manually create quizzes in Canvas
- Contact Canvas administrator if permissions seem incorrect

#### 6. Questions not appearing correctly

**Problem**: MCQ options or answers not formatted correctly.

**Solutions**:
- **MCQ Format**: Ensure questions use format:
  ```
  Question text here?
  A) Option A text
  B) Option B text
  C) Option C text
  D) Option D text
  ```
- **Answer Format**: Answer should be like "B) Option B" or just "B"
- **Short Answer**: Ensure answer field contains the expected answer text

#### 7. Quiz created but questions missing

**Problem**: Export succeeded but quiz is empty.

**Solutions**:
- Verify your assessment has sections with questions
- Check that questions have variants
- Ensure variants are linked to sections (not just in question bank)
- Review export confirmation message for number of questions created

### Getting Help

If you encounter issues not covered here:

1. **Check Browser Console**
   - Open browser developer tools (F12)
   - Check Console tab for error messages
   - Check Network tab for failed API requests

2. **Verify Canvas API Key**
   - Test your API key using Canvas API directly
   - Use a tool like Postman or curl to verify access

3. **Contact Support**
   - Check Question Maker documentation
   - Review Canvas API documentation
   - Contact your Canvas administrator

## Best Practices

### Before Exporting

- ✅ Review all questions in your assessment
- ✅ Verify question variants are correct
- ✅ Check MCQ answer formatting
- ✅ Ensure assessment has a clear name (becomes quiz title)
- ✅ Test with a small assessment first

### After Exporting

- ✅ Review quiz in Canvas before publishing
- ✅ Check question formatting and answers
- ✅ Adjust point values if needed
- ✅ Set quiz settings (time limits, attempts, etc.)
- ✅ Publish when ready for students

### Security

- ✅ Never share your Canvas API key
- ✅ Use test mode for development/testing
- ✅ Set API key expiration dates
- ✅ Rotate API keys periodically
- ✅ Delete unused API keys

## Additional Resources

- [Canvas API Documentation](https://canvas.instructure.com/doc/api/)
- [Canvas Quiz API](https://canvas.instructure.com/doc/api/quizzes.html)
- [Canvas Question API](https://canvas.instructure.com/doc/api/quiz_questions.html)
- [Question Maker Documentation](../README.md)

---

**Last Updated**: 2024
**Version**: 1.0

