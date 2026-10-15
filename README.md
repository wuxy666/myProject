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
npm run prisma:migrate -- --name init
npm run start:dev
```

服务默认运行于 `http://localhost:3000`，健康检查地址为 `GET /api/v1/health`。Prisma Studio 可通过 `npm run prisma:studio` 启动。

本地 `.env` 已配置 MySQL root 密码 `123456`，数据库名为 `enterprise_api`。`.env` 已加入 Git 忽略规则；部署环境请通过密钥管理系统设置 `DATABASE_URL`，并替换默认凭据。

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

`users` 表包含用户 ID、唯一邮箱、用户名、密码哈希字段、显示名称、唯一手机号、头像、状态、最近登录时间、创建/更新时间和软删除时间。**应用注册和登录逻辑应存储经过 Argon2 或 bcrypt 处理的密码哈希，不能保存明文密码。**

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
