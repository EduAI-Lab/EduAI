/**
 * Mock data for courses, questions, and assessments used in development/testing.
 */
import { Question } from '../types/question';
import { Assessment } from '../types/assessment';
import { Course } from '../types/assessment';

// Mock courses data
export const mockCourses: Course[] = [
  {
    id: 1,
    name: 'Computer Science 449',
    code: 'COSC 449',
    subject: 'Computer Science',
    semester: 'Fall',
    year: 2024
  },
  {
    id: 2,
    name: 'Biology 101',
    code: 'BIOL 101',
    subject: 'Biology',
    semester: 'Fall',
    year: 2024
  },
  {
    id: 3,
    name: 'Mathematics 200',
    code: 'MATH 200',
    subject: 'Mathematics',
    semester: 'Fall',
    year: 2024
  }
];

// Mock questions data
export const mockQuestions: Question[] = [
  {
    id: 1,
    content: 'What is the time complexity of binary search?',
    difficulty: 'medium',
    bloomLevel: 'understand',
    createdAt: '2024-01-15T10:30:00Z',
    userId: 1,
    classId: 1,
    class: {
      id: 1,
      name: 'Computer Science 449',
      subject: 'Computer Science'
    }
  },
  {
    id: 2,
    content: 'Explain the difference between stack and queue data structures.',
    difficulty: 'easy',
    bloomLevel: 'understand',
    createdAt: '2024-01-16T14:20:00Z',
    userId: 1,
    classId: 1,
    class: {
      id: 1,
      name: 'Computer Science 449',
      subject: 'Computer Science'
    }
  },
  {
    id: 3,
    content: 'Design an algorithm to find the longest common subsequence between two strings.',
    difficulty: 'hard',
    bloomLevel: 'create',
    createdAt: '2024-01-17T09:15:00Z',
    userId: 1,
    classId: 1,
    class: {
      id: 1,
      name: 'Computer Science 449',
      subject: 'Computer Science'
    }
  },
  {
    id: 4,
    content: 'What is the process of photosynthesis?',
    difficulty: 'easy',
    bloomLevel: 'remember',
    createdAt: '2024-01-18T11:45:00Z',
    userId: 1,
    classId: 2,
    class: {
      id: 2,
      name: 'Biology 101',
      subject: 'Biology'
    }
  },
  {
    id: 5,
    content: 'Calculate the derivative of x² + 3x + 2',
    difficulty: 'medium',
    bloomLevel: 'apply',
    createdAt: '2024-01-19T16:30:00Z',
    userId: 1,
    classId: 3,
    class: {
      id: 3,
      name: 'Mathematics 200',
      subject: 'Mathematics'
    }
  }
];

// Mock assessments data
export const mockAssessments: Assessment[] = [
  {
    id: 1,
    name: 'Lab Assignment 1',
    type: 'Lab',
    courseId: 1,
    questions: [1, 2],
    createdAt: '2024-01-15T10:00:00Z',
    updatedAt: '2024-01-15T10:00:00Z'
  },
  {
    id: 2,
    name: 'Midterm Exam',
    type: 'Midterm',
    courseId: 1,
    questions: [1, 2, 3],
    createdAt: '2024-01-20T09:00:00Z',
    updatedAt: '2024-01-20T09:00:00Z'
  },
  {
    id: 3,
    name: 'Quiz 1',
    type: 'Quiz',
    courseId: 2,
    questions: [4],
    createdAt: '2024-01-18T11:00:00Z',
    updatedAt: '2024-01-18T11:00:00Z'
  },
  {
    id: 4,
    name: 'Final Exam',
    type: 'Final',
    courseId: 3,
    questions: [5],
    createdAt: '2024-01-25T14:00:00Z',
    updatedAt: '2024-01-25T14:00:00Z'
  }
];
