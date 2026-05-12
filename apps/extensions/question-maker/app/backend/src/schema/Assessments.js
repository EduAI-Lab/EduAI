/**
 * Sequelize model for assessment blueprints (midterm, quiz, etc.) tied to a course.
 * Stores metadata like type, semester, description, and optional blueprint configuration JSON.
 */
import { DataTypes } from 'sequelize';
import { sequelize } from '../config/database.js';

export const Assessments = sequelize.define('Assessments', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  courseId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'course_id',
    references: {
      model: 'courses',
      key: 'id'
    }
  },
  type: {
    type: DataTypes.ENUM('Assignment', 'Lab', 'Quiz', 'Midterm', 'Final'),
    allowNull: false
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: {
      notEmpty: true
    }
  },
  semester: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: {
      notEmpty: true
    }
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  blueprintConfig: {
    type: DataTypes.JSONB,
    allowNull: true,
    field: 'blueprint_config'
  },
  createdAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
    field: 'created_at'
  },
  updatedAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
    field: 'updated_at'
  }
}, {
  tableName: 'assessments',
  timestamps: true,
  underscored: true
});
