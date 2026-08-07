module.exports = {
  apps: [
    {
      name: "aitutor-api",
      cwd: "./server",
      script: "src/index.js",
      interpreter: "node",
      instances: 1,
      autorestart: true,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
