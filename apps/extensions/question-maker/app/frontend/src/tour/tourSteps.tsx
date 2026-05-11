import { TourConfig } from './tourTypes';

export const tourSteps: TourConfig = {
  main: [
    {
      id: 'course-select',
      title: 'Select a course',
      content: 'Start here: Add a course to your account and start making questions.',
      placement: 'bottom'
    },
    {
      id: 'add-question-btn',
      title: 'Create a question',
      content: 'Create questions from scratch or generate with AI.',
      placement: 'right'
    },
    {
      id: 'upload-questions-btn',
      title: 'Upload Questions',
      content: 'Upload questions from an existing assignment to have them added to the question bank.',
      placement: 'right'
    },
    {
      id: 'question-list',
      title: 'Review your questions',
      content: 'View existing question variants from your question bank.',
      placement: 'top'
    },
    {
      id: 'assessment-tab',
      title: 'Switch to assessments',
      content: 'Use this tab switcher to switch between Questions and Assessments.',
      placement: 'bottom'
    },
    {
      id: 'add-assessment-btn',
      title: 'Create assessment',
      content: 'Create an assessment in this course.',
      placement: 'bottom'
    },
    {
      id: 'assessment-view-btn',
      title: 'Edit assessment',
      content: 'Edit assessments and export.',
      placement: 'bottom'
    }
  ],
  assessmentBuilder: [
    {
      id: 'builder-add-section-button',
      title: 'Build with sections',
      content:
        'Assessments are built one section at a time so you can stay organized by grouping related questions.',
      placement: 'bottom'
    },
    {
      id: 'builder-filters',
      title: 'Apply filters',
      content:
        'Choose question types, topics, reasoning focus, and difficulty to narrow down questions for this section.',
      placement: 'right'
    },
    {
      id: 'builder-topics',
      title: 'Primary, secondary, and excluded topics',
      content:
        'Primary topics are the main focus of the question, secondary topics demonstrate a secondary focus of the question , and excluded topics are questions that are to be left out.',
      placement: 'right'
    },
    {
      id: 'builder-matching-questions',
      title: 'Review filtered questions',
      content:
        'Here you can view matching questions, open their details, and create new variants when needed.',
      placement: 'left'
    },
    {
      id: 'builder-save-section',
      title: 'Save questions to the section',
      content: 'Select as many questions as you like, then use this button to save them into the section.',
      placement: 'left'
    },
    {
      id: 'export-canvas-btn',
      title: 'Export only reviewed questions',
      content:
        'Only when all questions are reviewed can the assessment be exported to Canvas. Clear drafts before exporting.',
      placement: 'bottom'
    }
  ]
};
