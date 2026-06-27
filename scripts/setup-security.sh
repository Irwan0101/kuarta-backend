#!/bin/bash
# Setup security monitoring for Kuarta API
# Run as root on VPS

set -euo pipefail

echo "=== Installing security tools ==="

# 1. Fail2ban
apt install -y fail2ban

# Nginx jail
cat > /etc/fail2ban/jail.local << 'EOF'
[DEFAULT]
bantime = 3600
findtime = 600
maxretry = 5

[sshd]
enabled = true
port = ssh
logpath = %(sshd_log)s
maxretry = 3

[nginx-http-auth]
enabled = true
logpath = /var/log/nginx/error.log

[nginx-botsearch]
enabled = true
logpath = /var/log/nginx/access.log
maxretry = 10

[kuarta-api-login]
enabled = true
port = http,https
filter = kuarta-login
logpath = /var/log/nginx/access.log
maxretry = 5
findtime = 300
bantime = 7200
EOF

# Custom filter for Kuarta login failures
cat > /etc/fail2ban/filter.d/kuarta-login.conf << 'EOF'
[Definition]
failregex = ^<HOST>.*POST /api/auth/login.*HTTP/1\.[01]" 401
            ^<HOST>.*POST /api/auth/login.*HTTP/1\.[01]" 500
ignoreregex =
EOF

systemctl restart fail2ban
fail2ban-client status

# 2. ClamAV (daily scan)
apt install -y clamav clamav-daemon
systemctl stop clamav-freshclam || true
freshclam --stdout || true
systemctl start clamav-freshclam || true

# Daily scan cron
cat > /etc/cron.daily/clamav-scan << 'SCRIPT'
#!/bin/bash
clamscan -r /var/www/kuarta-v2 --exclude-dir='node_modules' --exclude-dir='.git' --log=/var/log/clamav/daily-scan.log --infected
SCRIPT
chmod +x /etc/cron.daily/clamav-scan

# 3. Lynis security audit (weekly)
cat > /etc/cron.weekly/lynis-audit << 'SCRIPT'
#!/bin/bash
lynis audit system --quiet --report-file /var/log/lynis-report.dat 2>/dev/null || true
SCRIPT
chmod +x /etc/cron.weekly/lynis-audit

echo "=== Security setup complete ==="
echo "Next steps:"
echo "  1. Deploy frontend & backend (git pull + npm run build + pm2 restart)"
echo "  2. Login admin → klik menu Security"
echo "  3. Setup Cloudflare in front of your domain for WAF"
echo ""
echo "Fail2ban jails active:"
fail2ban-client status
