/**
 * Sequelize model for instructor-owned courses which group topics, questions, and assessments.
 * `userId` references the local users table (Core CUID string FK).
 * `coreCourseId` links to Core's Course.id; null until the course is linked to Core.
 */
import { DataTypes } from "sequelize";
import { sequelize } from "../config/database.js";

export const Course = sequelize.define(
  "Course",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        notEmpty: true,
      },
    },
    code: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    userId: {
      type: DataTypes.STRING,
      allowNull: false,
      field: "user_id",
      references: {
        model: "users",
        key: "id",
      },
    },
    coreCourseId: {
      type: DataTypes.STRING,
      allowNull: true,
      field: "core_course_id",
      comment: "Core Course CUID; null until linked to Core",
    },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      field: "created_at",
    },
    updatedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      field: "updated_at",
    },
  },
  {
    tableName: "courses",
    timestamps: true,
    underscored: true,
    indexes: [{ unique: true, fields: ["core_course_id"] }],
  }
);
