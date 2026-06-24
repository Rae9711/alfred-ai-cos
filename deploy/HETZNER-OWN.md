# 自己开 Hetzner 部署 Albert

在**你自己的** Hetzner VPS 上跑 Albert（不依赖 `89.167.84.193` 那台共享机器）。

推荐方案：**Docker Compose**（仓库里已有 `docker-compose.prod.yml`）+ **Caddy** 自动 HTTPS。

预计时间：约 30–45 分钟（含等 DNS 生效）。

---

## 你需要准备

| 项目 | 说明 |
|------|------|
| Hetzner 账号 | [console.hetzner.cloud](https://console.hetzner.cloud) |
| 域名（子域名即可） | 例如 `albert.yourdomain.com`，DNS 能改 A 记录或走 Cloudflare |
| Google OAuth | Cloud Console 里 Albert 的 Client ID / Secret |
| Anthropic API Key | 分类、摘要、起草邮件 |
| SSH 公钥 | 创建 VPS 时挂上，用密钥登录 |

**服务器规格建议：** CX22（2 vCPU / 4 GB RAM / 40 GB）或 CPX21，系统选 **Ubuntu 24.04**。

---

## 架构

```
手机 App  →  https://albert.yourdomain.com
                    ↓
              Caddy (:443, Let's Encrypt)
                    ↓
         Docker albert_web (:8011 on loopback)
                    ↓
    albert_postgres + albert_redis + worker + beat
```

---

## 1. 创建 VPS

1. Hetzner Cloud → **Add Server**
2. Location 任选（离用户近即可）
3. Image: **Ubuntu 24.04**
4. Type: **CX22** 或以上
5. SSH key: 选你的公钥
6. **Cloud config（推荐）** — 见下一节；可代替手动 SSH 初始化
7. 记下 **公网 IP**（下文 `$SERVER_IP`）

防火墙（Hetzner Cloud Firewall 或服务器上 `ufw`）至少放行：

- `22/tcp` — SSH
- `80/tcp` — Caddy HTTP（证书申请）
- `443/tcp` — HTTPS

### Cloud config（创建时自动初始化）

Hetzner 创建页有一项 **Cloud config**，可粘贴最多 **32 KiB** 的 [cloud-init](https://cloud-init.io/) 脚本，开机自动跑。

1. 打开仓库里的 **`deploy/hetzner-cloud-init.yaml`**
2. **粘贴前改两处**（文件里有 `EDIT` 注释）：
   - `ALBERT_DOMAIN` → 你的域名，如 `albert.yourdomain.com`
   - `ALBERT_REPO` → 默认 `Rae9711/alfred-ai-cos`；merge 后可改成 `Azzbee`
3. 全选复制，贴进 Hetzner **Cloud config** 文本框
4. 创建服务器，等 3–5 分钟
5. SSH 登录检查：

```bash
ssh root@$SERVER_IP
tail -50 /var/log/cloud-init-output.log    # 或 /var/log/albert-first-boot.log
cat /root/ALBERT-NEXT-STEPS.txt
```

成功后会装好 Docker + Caddy，代码在 `/opt/albert/repo`。  
**仍需你手动：** 填 `.env`、Google redirect、跑 `./deploy/albert-deploy.sh`（域名和密钥不能写进 cloud-init 提交到 Git）。

若不用 Cloud config，用下面第 2 节手动初始化。

---

## 2. 服务器初始化（手动，无 cloud-init 时）

SSH 登录后执行（把仓库 clone 下来再跑，或先 scp 脚本）：

```bash
ssh root@$SERVER_IP

# 方式 A：从 GitHub 拉仓库
apt-get update && apt-get install -y git
git clone https://github.com/Rae9711/alfred-ai-cos.git /opt/albert/repo
bash /opt/albert/repo/deploy/hetzner-bootstrap.sh

# 方式 B：你本机已有仓库 — 见下文「从本机推送部署」
```

`hetzner-bootstrap.sh` 会安装：Docker、Docker Compose 插件、Caddy，并创建 `/opt/albert/backups`。

---

## 3. DNS

在域名服务商添加 **A 记录**：

```
albert.yourdomain.com  →  $SERVER_IP
```

等解析生效（`dig +short albert.yourdomain.com` 应返回 VPS IP）。

若用 **Cloudflare**：代理（橙色云）可以开；Caddy 仍可通过 HTTP-01 或你改用 Cloudflare DNS challenge（本指南默认 HTTP-01，橙云有时需关代理或换 DNS API）。

---

## 4. Caddy 反向代理

```bash
export ALBERT_DOMAIN=albert.yourdomain.com

cp /opt/albert/repo/deploy/Caddyfile.example /etc/caddy/Caddyfile
# 编辑：把 ALBERT_DOMAIN 换成你的域名
sed -i "s/ALBERT_DOMAIN/${ALBERT_DOMAIN}/g" /etc/caddy/Caddyfile

systemctl enable caddy
systemctl reload caddy
```

Caddy 会把 `https://$ALBERT_DOMAIN` 转到 `127.0.0.1:8011`（Docker 里的 web）。

---

## 5. 生产环境变量 `.env`

```bash
cd /opt/albert/repo
cp .env.production.example .env
chmod 600 .env
nano .env   # 或 vim
```

**必须改的项：**

```bash
ENVIRONMENT=production
APP_BASE_URL=https://albert.yourdomain.com

# 生成密码与密钥（在服务器上执行）：
#   openssl rand -base64 24          → POSTGRES_PASSWORD + DATABASE_URL
#   python3 -c "import secrets; print(secrets.token_urlsafe(48))"  → JWT_SECRET
#   python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"  → TOKEN_ENCRYPTION_KEY

DATABASE_URL=postgresql+psycopg://albert:<同 POSTGRES_PASSWORD>@albert_postgres:5432/albert
POSTGRES_PASSWORD=<强密码>
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_OAUTH_REDIRECT_URI=https://albert.yourdomain.com/api/v1/auth/google/callback
ANTHROPIC_API_KEY=sk-ant-...
```

`DATABASE_URL` 里的 host 必须是 **`albert_postgres`**（Docker 服务名），不是 `localhost`。

---

## 6. Google Cloud Console

在现有 OAuth 客户端 → **Authorized redirect URIs** 增加：

```
https://albert.yourdomain.com/api/v1/auth/google/callback
```

**Test users** 里加上要登录的 Gmail。

若换了 `JWT_SECRET` / 新库，旧手机 token 会失效，重新登录即可。

---

## 7. 首次部署

在服务器上：

```bash
cd /opt/albert/repo
./deploy/albert-deploy.sh
```

或从**你本机**一条命令推送（见 `deploy/hetzner-ship.sh`）：

```bash
export HETZNER_HOST=root@$SERVER_IP
./deploy/hetzner-ship.sh
```

验证：

```bash
curl -sS https://albert.yourdomain.com/health
# 期望: {"status":"ok"} 或类似 200 JSON
```

看日志：

```bash
docker compose -p albert -f docker-compose.prod.yml logs -f albert_web --tail 50
```

---

## 8. 手机 App 指向你的 API

当前 `mobile/app.json` 写的是 `https://albert.alfredassistants.com`。

**二选一：**

### A. 改代码 + OTA（推荐）

```bash
# mobile/app.json → extra.apiBaseUrl = "https://albert.yourdomain.com"
cd mobile && bun run update:preview -- "Point API to my Hetzner"
```

手机上强制退出 App 再打开，拉 OTA。

### B. 继续用旧域名

只有当你把 **DNS `albert.alfredassistants.com` 指到你的 VPS**，或在 Cloudflare 把该子域名指过来时才行（需和 Adam 协调，避免两台机器抢域名）。

---

## 9. 日常更新代码

**在服务器上 git pull：**

```bash
cd /opt/albert/repo && git pull && ./deploy/albert-deploy.sh
```

**从你本机推送（不依赖服务器 git）：**

```bash
export HETZNER_HOST=root@$SERVER_IP
./deploy/hetzner-ship.sh
```

`hetzner-ship.sh` 会 `git archive` 打包、`scp`、在远端 `docker compose build` + `alembic upgrade head` + restart。

---

## 10. 备份（建议）

```bash
# crontab -e
0 3 * * * /opt/albert/repo/deploy/albert-backup.sh >> /var/log/albert-backup.log 2>&1
```

备份目录默认 `/opt/albert/backups`，保留 7 天。

---

## 11. 合并 Azzbee 代码之后

若 partner merge 了 PR #5，在服务器：

```bash
cd /opt/albert/repo
git remote add azzbee https://github.com/Azzbee/alfred-ai-cos.git 2>/dev/null || true
git fetch azzbee && git merge azzbee/master   # 或 checkout 合并后的 master
./deploy/albert-deploy.sh
```

新 migration 会由 `albert-deploy.sh` 里的 `alembic upgrade head` 自动跑。

---

## 12. 常见问题

| 现象 | 处理 |
|------|------|
| OAuth 登录后报错 redirect_uri_mismatch | Console 里 redirect URI 必须与 `.env` 完全一致 |
| `/health` 502 | `docker compose ps` 看 `albert_web` 是否 healthy；`logs albert_web` |
| 收件箱空 | 登录后 App 下拉刷新；看 `albert_worker` 日志是否在 sync |
| 分类还是旧的 | 跑 `docker compose run --rm albert_web python scripts/classify_inbox_sample.py --account YOU@email.com --reclassify` |
| Caddy 证书失败 | 确认 80/443 可达、DNS 已指向本机、域名拼写正确 |

---

## 与共享机器 `89.167.84.193` 的区别

| | 共享机 (HETZNER.md) | 你自己的 VPS (本文) |
|--|---------------------|---------------------|
| 权限 | 需要 Adam 的 SSH | 你 root 全权 |
| 运行时 | systemd + uv（无 Docker） | Docker Compose |
| 域名 | `albert.alfredassistants.com` | 你自己的子域名 |
| 文档 | `deploy/HETZNER.md` | `deploy/HETZNER-OWN.md` |

两套不要同时指同一个域名，除非你做迁移并停掉旧服务。

---

## 快速命令备忘

```bash
# 状态
docker compose -p albert -f /opt/albert/repo/docker-compose.prod.yml ps

# 重启
docker compose -p albert -f /opt/albert/repo/docker-compose.prod.yml restart albert_web albert_worker albert_beat

# 迁移
docker compose -p albert -f /opt/albert/repo/docker-compose.prod.yml run --rm --no-deps albert_web alembic upgrade head
```
