# Enterprise API

基于 NestJS、TypeScript、Prisma 和 MySQL 8 的模块化后端服务基础架构。

## 环境要求

- Node.js 20 或更高版本
- npm 10 或更高版本
- Docker Desktop（用于本地 MySQL）

## 快速开始

```bash
npm install
docker compose up -d mysql
npm run prisma:generate
npm run start:dev
```

服务默认运行于 `http://localhost:3000`，健康检查地址为 `GET /api/v1/health`。Prisma Studio 可通过 `npm run prisma:studio` 启动。

本地 `.env` 已配置 MySQL root 密码 `123456`，数据库名为 `devices`。`.env` 已加入 Git 忽略规则；部署环境请通过密钥管理系统设置 `DATABASE_URL`，并替换默认凭据。

## 项目结构

```text
src/
  health/       健康检查模块
  prisma/       全局 Prisma 服务与模块
  app.module.ts 应用模块与环境变量校验
  main.ts       启动入口与全局 HTTP 安全配置
prisma/
  schema.prisma Prisma 数据模型
```

## 用户表

认证模块使用已有的 `sys_user` 表，字段见下方 Prisma 模型说明。**密码列必须存储 bcrypt 哈希，不能保存明文密码。**

常用命令：

```bash
npm run prisma:migrate -- --name add_feature
npm run prisma:deploy
npm run build
npm run lint
```

生产环境使用 `prisma migrate deploy` 应用已提交的迁移。请不要将 `.env` 或生产密钥提交到版本库。

## 后台认证接口

认证模块针对已存在的 MySQL `sys_user` 表，不会生成或改名用户表。Prisma `SysUser` 使用 `@@map("sys_user")` 映射；`id` 按自增整数建模。若现有表的 `id` 类型不同，请同步调整 Prisma model 的 `id` 字段类型。密码列必须保存 bcrypt 哈希。

接口统一返回 `{ "code": 0, "msg": "success", "data": ... }`；错误响应也使用 `{ "code": <HTTP 状态码>, "msg": ..., "data": null }`。

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| POST | `/api/v1/auth/login` | 否 | 登录并返回 JWT |
| GET | `/api/v1/auth/profile` | Bearer JWT | 获取当前用户资料 |
| POST | `/api/v1/auth/logout` | Bearer JWT | 登出确认，客户端需删除 token |

错误密码通过数据库原子递增 `error_count`；第 5 次错误起设置 15 分钟 `lock_time`。账号不存在或已删除时返回统一凭据错误，禁用、锁定账号会拒绝登录。JWT 默认有效期 2 小时；当前登出接口为无状态 JWT 登出，服务端不建立黑名单，客户端删除 token 后即可完成登出，已有 token 在过期前仍可使用。

### 安装认证依赖

```bash
npm install @nestjs/jwt @nestjs/passport passport passport-jwt bcrypt
npm install -D @types/passport-jwt @types/bcrypt
```

在 `.env` / `.env.example` 中设置 `JWT_SECRET`（至少 32 个字符）和 `JWT_EXPIRES_IN`。生产环境请使用密钥管理系统注入随机密钥。已有 `sys_user` 表只需要生成 Prisma Client，不要对现有表执行初始化迁移：

```bash
npm run prisma:generate
npm run start:dev
```

### curl 示例

登录（将 `admin` 和密码替换成有效账号）：

```bash
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"your-password"}'
```

从登录响应的 `data.accessToken` 取出 token，获取个人信息：

```bash
curl http://localhost:3000/api/v1/auth/profile \
  -H "Authorization: Bearer <accessToken>"
```

登出：

```bash
curl -X POST http://localhost:3000/api/v1/auth/logout \
  -H "Authorization: Bearer <accessToken>"
```

## 按环境管理数据库配置

数据库连接配置集中在 [`config/database.yaml`](config/database.yaml)，由 `NODE_ENV` 选择 `development`、`test` 或 `production`，每个环境下的 `databases` 可以包含多个命名连接。`${变量名:-默认值}` 表示优先读取环境变量，未设置时使用冒号后的默认值；`${变量名}` 表示该环境必须提供该变量。

`src/config/database-config.ts` 负责加载 `.env.<环境>` 和 `.env`、展开每个命名连接的占位符并组装连接 URL。NestJS 的 `PrismaService.getClient(name)` 可按名称获取已配置的 Client；Prisma CLI 默认仍使用 `devices` 连接，便于保留现有 `prisma/schema.prisma` 的生成和迁移命令。认证使用 `devices`，监控大屏使用 `networkMonitor`。

旧配置中的 `DATABASE_URL` 仍可作为 `devices` 的连接覆盖；其他数据库使用各自的环境变量。开发环境默认连接 `localhost:3306/devices`；测试环境默认使用独立数据库 `devices_test`。

- **开发**：默认主机 `localhost:3306`，数据库 `devices`，用户 `root`，连接数 10。`.env` 示例密码为 `123456`。
- **测试**：默认使用独立数据库 `devices_test`，避免测试数据写入开发库。按需配置 `TEST_DB_*` 变量，并预先创建该数据库。
- **生产**：必须通过环境变量或密钥管理系统提供 `PROD_DB_HOST`、`PROD_DB_NAME`、`PROD_DB_USERNAME`、`PROD_DB_PASSWORD`；端口默认为 3306，连接数默认为 20。

### 增加并调用另一个数据库

在 `config/database.yaml` 的 `development.databases`、`test.databases` 和 `production.databases` 下，分别增加同名配置块，并在 `.env` / `.env.<环境>` 中提供对应变量。例如增加 `audit` 后，业务 Service 可以注入全局 `PrismaService` 并调用 `getClient('audit')`。不同库的强类型模型可以各用独立 Prisma schema；只读统计也可像监控大屏一样通过参数化 `$queryRaw` 查询。

Prisma Client 会在应用启动时连接所有已配置数据库，因此不要在配置中加入不可用的连接。MySQL 的 `MYSQL_DATABASE` 只在 Docker 数据卷首次初始化时创建一个数据库；添加新库后，要在 MySQL 中单独创建它。

可在 `.env` 设置开发参数，也可创建被 Git 忽略的 `.env.test` 或 `.env.production` 覆盖对应环境配置。模板见 `.env.example`。生产密码不要写入 YAML 或提交到 Git。

PowerShell 切换到测试环境：

```powershell
$env:NODE_ENV = 'test'
npm run start:dev
```

Linux/macOS 切换到测试环境：

```bash
NODE_ENV=test npm run start:dev
```

切换环境前，请先确认所选配置的数据库已经创建并可连接。该项目映射现有 `sys_user` 表，初次运行时使用 `npm run prisma:generate` 生成 Prisma Client；不要对已有业务库直接执行初始化迁移。

## 网络运行监控大屏接口

接口实现位于 `src/dashboard/`，通过 `PrismaService.getClient('networkMonitor')` 读取独立的 `network_monitor` 数据库。表结构与初始化样例见前端仓库 `database/network_dashboard_mysql.sql`；导入该 SQL 后会创建数据库、12 张快照表和演示数据。当前开发环境默认使用 `localhost:3306/network_monitor`，凭据变量见 `.env.example`。

| 方法 | 路径 | 主要参数 |
| --- | --- | --- |
| GET | `/api/dashboard/network/status` | 无 |
| GET | `/api/dashboard/network/service-metrics` | 无 |
| GET | `/api/dashboard/network/tickets/summary` | 无 |
| GET | `/api/dashboard/network/health/provinces` | `limit`、`order` |
| GET | `/api/dashboard/network/subscribers/provinces` | `date` |
| GET | `/api/dashboard/network/changes/summary` | `window=past7d\|next7d` |
| GET | `/api/dashboard/network/capacity/summary` | 无 |
| GET | `/api/dashboard/network/scale` | `category=element\|device\|server` |
| GET | `/api/dashboard/network/split-ratio` | `date`、`limit`、`order` |
| GET | `/api/dashboard/network/capabilities` | `category=interface\|system`、`from`、`to` |

所有大屏接口需要 `Authorization: Bearer <accessToken>`。成功响应使用 `{ "code": 200, "msg": "success", "data": ... }`。日期型快照表没有精确更新时间，`updatedAt` 用统计日 `00:00:00+08:00` 表示；含采集时间或更新时间的表返回数据库实际时间。站点 `points` 没有对应数据表，因此签约用户接口暂不返回该字段。
