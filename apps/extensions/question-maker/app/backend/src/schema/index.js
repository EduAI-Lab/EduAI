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
import { VariantSelectionCursor } from './VariantSelectionCursor.js';

// Define associations

// User associations
User.hasMany(Course, { foreignKey: 'userId', as: 'courses' });
Course.belongsTo(User, { foreignKey: 'userId', as: 'user' });

// Creator (RBAC §16/§19 TA own-only) associations
User.hasMany(Question_Metadata, { foreignKey: 'createdBy', as: 'createdQuestions' });
Question_Metadata.belongsTo(User, { foreignKey: 'createdBy', as: 'creator' });

User.hasMany(Variants, { foreignKey: 'createdBy', as: 'createdVariants' });
Variants.belongsTo(User, { foreignKey: 'createdBy', as: 'creator' });

// Course associations
Course.hasMany(Topics, { foreignKey: 'courseId', as: 'topics' });
Topics.belongsTo(Course, { foreignKey: 'courseId', as: 'course' });

Course.hasMany(Question_Metadata, { foreignKey: 'courseId', as: 'questionMetadata' });
Question_Metadata.belongsTo(Course, { foreignKey: 'courseId', as: 'course' });

// Topics associations
Topics.hasMany(Question_Metadata, { foreignKey: 'primaryTopicId', as: 'primaryQuestions' });
Question_Metadata.belongsTo(Topics, { foreignKey: 'primaryTopicId', as: 'primaryTopic' });

// Assessment and course associations. courseId is nullable (an assessment can be
// created before the course is linked to Core), so Sequelize's implicit onDelete
// default would be SET NULL — explicit CASCADE here matches Topics/Question_Metadata
// so deleting a course never leaves an orphaned Assessments row (§802).
Course.hasMany(Assessments, { foreignKey: 'courseId', as: 'assessments', onDelete: 'CASCADE' });
Assessments.belongsTo(Course, { foreignKey: 'courseId', as: 'course', onDelete: 'CASCADE' });

Question_Metadata.hasMany(Variants, { foreignKey: 'questionMetadataId', as: 'variants' });
Variants.belongsTo(Question_Metadata, { foreignKey: 'questionMetadataId', as: 'questionMetadata' });

// Assessments associations
Assessments.hasMany(Variants, { foreignKey: 'assessmentId', as: 'variants' });
Variants.belongsTo(Assessments, { foreignKey: 'assessmentId', as: 'assessment' });

Assessments.hasMany(AssessmentSections, { foreignKey: 'assessmentId', as: 'sections' });
AssessmentSections.belongsTo(Assessments, { foreignKey: 'assessmentId', as: 'assessment' });

AssessmentSections.hasMany(SectionVariants, { foreignKey: 'sectionId', as: 'sectionVariants' });
SectionVariants.belongsTo(AssessmentSections, { foreignKey: 'sectionId', as: 'section' });

// Sequelize's implicit onDelete inference does not reliably resolve to CASCADE for
// every NOT NULL belongsTo (verified empirically: this pair defaulted to NO ACTION,
// which blocks a course-delete cascade the moment Postgres tries to remove the
// Variant while a SectionVariants row still references it) — declared explicitly.
SectionVariants.belongsTo(Variants, { foreignKey: 'variantId', as: 'variant', onDelete: 'CASCADE' });
Variants.hasMany(SectionVariants, { foreignKey: 'variantId', as: 'sectionLinks', onDelete: 'CASCADE' });

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
  VariantSelectionCursor
};
