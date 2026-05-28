// PM2 config — run with: pm2 start ecosystem.config.js
module.exports = {
  apps: [{
    name: 'gpu-fund',
    script: 'server.js',
    watch: false,
    max_memory_restart: '300M',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    error_file: './logs/err.log',
    out_file:   './logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    restart_delay: 3000,
    max_restarts: 10
  }]
};
