module.exports = {
  apps: [
    {
      name: 'question-maker-backend',
      script: 'app/backend/src/index.js',
      cwd: '/srv/www/question-maker',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 8000
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 8000
      },
      error_file: '/var/log/pm2/question-maker-backend-error.log',
      out_file: '/var/log/pm2/question-maker-backend-out.log',
      log_file: '/var/log/pm2/question-maker-backend.log',
      time: true,
      max_memory_restart: '1G',
      restart_delay: 4000,
      max_restarts: 10,
      min_uptime: '10s'
    },
    {
      name: 'question-maker-frontend',
      script: 'serve',
      args: '-s app/frontend/dist -l 5173',
      cwd: '/srv/www/question-maker',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 5173
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 5173
      },
      error_file: '/var/log/pm2/question-maker-frontend-error.log',
      out_file: '/var/log/pm2/question-maker-frontend-out.log',
      log_file: '/var/log/pm2/question-maker-frontend.log',
      time: true,
      max_memory_restart: '500M',
      restart_delay: 4000,
      max_restarts: 10,
      min_uptime: '10s'
    }
  ]
};
