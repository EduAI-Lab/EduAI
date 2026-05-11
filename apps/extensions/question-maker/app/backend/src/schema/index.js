/**
 * Centralizes Sequelize model imports and associations for the backend data layer.
 * Exported models are wired together here so services can rely on eager/lazy relationships.
 */
import { sequelize } from '../config/database.js';
import { User } from './User.js';
import { Course } from './Course.js';
import { Topics } from './Topics.js';
import { Question_Metadata } from './Question_Metadata.js';
import { Assessments } from './Assessments.js';
import { Variants } from './Variants.js';
import { AssessmentSections } from './AssessmentSections.js';
import { SectionVariants } from './SectionVariants.js';
import { CanvasIntegration } from './CanvasIntegration.js';
import { CanvasCourseMapping } from './CanvasCourseMapping.js';
import { BugReport } from './BugReport.js';
import { VariantSelectionCursor } from './VariantSelectionCursor.js';

// Define associations

// User associations
User.hasMany(Course, { foreignKey: 'userId', as: 'courses' });
Course.belongsTo(User, { foreignKey: 'userId', as: 'user' });

// Course associations
Course.hasMany(Topics, { foreignKey: 'courseId', as: 'topics' });
Topics.belongsTo(Course, { foreignKey: 'courseId', as: 'course' });

Course.hasMany(Question_Metadata, { foreignKey: 'courseId', as: 'questionMetadata' });
Question_Metadata.belongsTo(Course, { foreignKey: 'courseId', as: 'course' });

// Topics associations
Topics.hasMany(Question_Metadata, { foreignKey: 'primaryTopicId', as: 'primaryQuestions' });
Question_Metadata.belongsTo(Topics, { foreignKey: 'primaryTopicId', as: 'primaryTopic' });

// Assessment and course associations
Course.hasMany(Assessments, { foreignKey: 'courseId', as: 'assessments' });
Assessments.belongsTo(Course, { foreignKey: 'courseId', as: 'course' });

Question_Metadata.hasMany(Variants, { foreignKey: 'questionMetadataId', as: 'variants' });
Variants.belongsTo(Question_Metadata, { foreignKey: 'questionMetadataId', as: 'questionMetadata' });

// Assessments associations
Assessments.hasMany(Variants, { foreignKey: 'assessmentId', as: 'variants' });
Variants.belongsTo(Assessments, { foreignKey: 'assessmentId', as: 'assessment' });

Assessments.hasMany(AssessmentSections, { foreignKey: 'assessmentId', as: 'sections' });
AssessmentSections.belongsTo(Assessments, { foreignKey: 'assessmentId', as: 'assessment' });

AssessmentSections.hasMany(SectionVariants, { foreignKey: 'sectionId', as: 'sectionVariants' });
SectionVariants.belongsTo(AssessmentSections, { foreignKey: 'sectionId', as: 'section' });

SectionVariants.belongsTo(Variants, { foreignKey: 'variantId', as: 'variant' });
Variants.hasMany(SectionVariants, { foreignKey: 'variantId', as: 'sectionLinks' });

// Variants self-reference for referenceId
Variants.hasMany(Variants, { foreignKey: 'referenceId', as: 'referencedVariants' });
Variants.belongsTo(Variants, { foreignKey: 'referenceId', as: 'originalVariant' });

// Canvas Integration associations
User.hasOne(CanvasIntegration, { foreignKey: 'userId', as: 'canvasIntegration' });
CanvasIntegration.belongsTo(User, { foreignKey: 'userId', as: 'user' });

User.hasMany(CanvasCourseMapping, { foreignKey: 'userId', as: 'canvasCourseMappings' });
CanvasCourseMapping.belongsTo(User, { foreignKey: 'userId', as: 'user' });

Course.hasOne(CanvasCourseMapping, { foreignKey: 'localCourseId', as: 'canvasMapping' });
CanvasCourseMapping.belongsTo(Course, { foreignKey: 'localCourseId', as: 'localCourse' });

User.hasMany(BugReport, { foreignKey: 'userId', as: 'bugReports' });
BugReport.belongsTo(User, { foreignKey: 'userId', as: 'user' });

Course.hasMany(VariantSelectionCursor, { foreignKey: 'courseId', as: 'variantSelectionCursors' });
VariantSelectionCursor.belongsTo(Course, { foreignKey: 'courseId', as: 'course' });

Question_Metadata.hasMany(VariantSelectionCursor, { foreignKey: 'questionMetadataId', as: 'selectionCursors' });
VariantSelectionCursor.belongsTo(Question_Metadata, { foreignKey: 'questionMetadataId', as: 'questionMetadata' });

Variants.hasMany(VariantSelectionCursor, { foreignKey: 'lastVariantId', as: 'selectionCursorLastPicked' });
VariantSelectionCursor.belongsTo(Variants, { foreignKey: 'lastVariantId', as: 'lastVariant' });

export {
  sequelize,
  User,
  Course,
  Topics,
  Question_Metadata,
  Assessments,
  Variants,
  AssessmentSections,
  SectionVariants,
  CanvasIntegration,
  CanvasCourseMapping,
  BugReport,
  VariantSelectionCursor
};
