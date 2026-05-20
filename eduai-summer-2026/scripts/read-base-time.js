#!/usr/bin/env node

const fs = require("fs");

function parseCsvLine(line) {
  const values = [];
  let value = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const nextChar = line[index + 1];

    if (char === '"' && inQuotes && nextChar === '"') {
      value += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      values.push(value);
      value = "";
      continue;
    }

    value += char;
  }

  values.push(value);
  return values.map((entry) => entry.trim());
}

function readBaseTime(filePath) {
  const entries = new Map();
  const warnings = [];

  if (!filePath || !fs.existsSync(filePath)) {
    return { entries, warnings };
  }

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length === 0) {
    return { entries, warnings };
  }

  const headers = parseCsvLine(lines[0]).map((header) => header.toLowerCase());
  const usernameIndex = headers.indexOf("github_username");
  const baseHoursIndex = headers.indexOf("base_hours");
  const notesIndex = headers.indexOf("notes");

  if (usernameIndex === -1 || baseHoursIndex === -1) {
    warnings.push({
      type: "invalid-base-time-header",
      message: "Base time CSV must include github_username and base_hours columns.",
    });
    return { entries, warnings };
  }

  lines.slice(1).forEach((line, offset) => {
    const lineNumber = offset + 2;
    const row = parseCsvLine(line);
    const username = String(row[usernameIndex] || "").trim().replace(/^@/, "");
    const baseHoursRaw = row[baseHoursIndex];
    const notes = notesIndex === -1 ? "" : String(row[notesIndex] || "").trim();

    if (!username) {
      warnings.push({
        type: "invalid-base-time-row",
        lineNumber,
        message: "Base time row is missing github_username.",
      });
      return;
    }

    const baseHours = Number(baseHoursRaw);
    if (!Number.isFinite(baseHours) || baseHours < 0) {
      warnings.push({
        type: "invalid-base-hours",
        lineNumber,
        username,
        message: "Base time row has an invalid base_hours value.",
      });
      return;
    }

    const key = username.toLowerCase();
    if (entries.has(key)) {
      warnings.push({
        type: "duplicate-base-time",
        lineNumber,
        username,
        message: "Duplicate base time row found; keeping the first value and excluding this duplicate.",
      });
      return;
    }

    entries.set(key, {
      username,
      baseHours,
      notes,
    });
  });

  return { entries, warnings };
}

module.exports = {
  parseCsvLine,
  readBaseTime,
};

if (require.main === module) {
  const result = readBaseTime(process.argv[2]);
  process.stdout.write(
    JSON.stringify(
      {
        entries: Array.from(result.entries.values()),
        warnings: result.warnings,
      },
      null,
      2,
    ),
  );
}
