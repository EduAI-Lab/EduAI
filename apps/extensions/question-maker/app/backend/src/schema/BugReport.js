/**
 * Stores user-submitted bug reports with optional diagnostic payloads (console, network, screenshot).
 */
import { DataTypes } from 'sequelize';
import { sequelize } from '../config/database.js';

export const BugReport = sequelize.define(
  'BugReport',
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'user_id'
    },
    description: {
      type: DataTypes.STRING(2000),
      allowNull: false
    },
    status: {
      type: DataTypes.STRING(32),
      allowNull: false,
      defaultValue: 'unhandled'
    },
    consoleLogs: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: 'console_logs'
    },
    networkLogs: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: 'network_logs'
    },
    screenshot: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    pageUrl: {
      type: DataTypes.STRING(1000),
      allowNull: true,
      field: 'page_url'
    },
    userAgent: {
      type: DataTypes.STRING(500),
      allowNull: true,
      field: 'user_agent'
    },
    isAnonymous: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: 'is_anonymous'
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
  },
  {
    tableName: 'bug_reports',
    timestamps: true,
    underscored: true
  }
);
