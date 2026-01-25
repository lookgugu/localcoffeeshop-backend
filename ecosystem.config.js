/**
 * PM2 Ecosystem Configuration
 *
 * This file configures PM2 process management for the Local Coffee Shop application.
 *
 * Usage:
 *   Development: pm2 start ecosystem.config.js
 *   Production:  pm2 start ecosystem.config.js --env production
 *   Stop:        pm2 stop ecosystem.config.js
 *   Restart:     pm2 restart ecosystem.config.js
 *   Logs:        pm2 logs local-coffee-shop
 *   Monitoring:  pm2 monit
 *
 * Installation:
 *   npm install -g pm2
 */

module.exports = {
  apps: [{
    // Application name
    name: 'local-coffee-shop',

    // Application entry point
    script: './server.js',

    // Instances
    instances: process.env.PM2_INSTANCES || 'max', // 'max' = CPU cores
    exec_mode: 'cluster', // Enable cluster mode for load balancing

    // Auto-restart configuration
    autorestart: true,
    watch: false, // Set to true in development if you want auto-reload on file changes
    max_memory_restart: '500M', // Restart if memory exceeds 500MB

    // Environment variables for development
    env: {
      NODE_ENV: 'development',
      PORT: 3000,
      LOG_LEVEL: 'info'
    },

    // Environment variables for production
    env_production: {
      NODE_ENV: 'production',
      PORT: 3000,
      LOG_LEVEL: 'warn' // Less verbose logging in production
    },

    // Logging configuration
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true, // Merge logs from all instances

    // Process management
    min_uptime: '10s', // Minimum uptime to consider app as stable
    max_restarts: 10, // Maximum consecutive restarts before giving up
    restart_delay: 4000, // Delay between restarts (ms)

    // Graceful shutdown
    kill_timeout: 5000, // Time to wait for graceful shutdown (ms)
    listen_timeout: 3000, // Time to wait for app to listen (ms)

    // Advanced features
    instance_var: 'INSTANCE_ID', // Environment variable name for instance ID

    // Source map support
    source_map_support: true,

    // Time zone
    time: true
  }],

  /**
   * Deployment configuration (OPTIONAL - requires configuration)
   *
   * NOTE: This project uses Digital Ocean App Platform for deployment.
   * The PM2 deploy configuration below is for alternative VPS deployments.
   *
   * If you want to use PM2 deploy, you MUST update these placeholder values:
   * - user: Your SSH username on the target server
   * - host: Your server hostname(s) or IP address(es)
   * - repo: Your Git repository URL
   * - path: Deployment path on the server
   *
   * Usage:
   *   pm2 deploy production setup   # First-time setup
   *   pm2 deploy production         # Deploy latest changes
   */
  deploy: {
    production: {
      // SSH connection - UPDATE THESE VALUES
      user: process.env.PM2_DEPLOY_USER || 'CONFIGURE_ME',
      host: [process.env.PM2_DEPLOY_HOST || 'CONFIGURE_ME.example.com'],
      ref: 'origin/main',
      repo: process.env.PM2_DEPLOY_REPO || 'git@github.com:CONFIGURE_ME/localcoffeeshop.co.git',
      path: process.env.PM2_DEPLOY_PATH || '/var/www/localcoffeeshop.co',

      // Pre-deployment commands (runs locally before deployment)
      'pre-deploy-local': '',

      // Post-deployment commands (runs on server after deployment)
      'post-deploy': 'npm install && pm2 reload ecosystem.config.js --env production',

      // Pre-setup commands (runs on server before first setup)
      'pre-setup': '',

      // Post-setup commands (runs on server after first setup)
      'post-setup': 'npm install'
    }
  }
};
