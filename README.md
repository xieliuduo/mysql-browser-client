# MySQL Browser Client

一个本地优先的 Chrome / Edge MySQL 浏览器扩展。它不包含 AI 功能，也不会把数据库密码或查询内容发送到远程服务。

## 功能

- MySQL 连接新增、编辑、测试和删除
- 数据库、表和视图浏览
- 单击表名称即可选择该表，并自动填写及运行 `SELECT * FROM \`表名\` LIMIT 20`
- 字段、索引和外键查看
- SQL 多页签编辑与查询
- `EXPLAIN` 执行计划
- SELECT、INSERT、UPDATE、DELETE 和常用 DDL
- 写操作确认、生产环境双重确认
- 查询结果 CSV 导出和完整表格复制
- 支持下一次查询临时使用 `500`、`1000` 或自定义 `1–1000` 行上限，执行后自动恢复默认
- SQL 审计摘要
- 表置顶、表下沉、表名颜色
- 点击扩展图标直接打开独立大工作台
- 数据源、库表、字段/索引面板可折叠
- 面板宽度和工作区高度可拖拽调整
- 翡翠暗色、深海蓝、琥珀暗色、明亮灰白主题切换
- 表名、字段名、别名、SQL 关键字自动补全
- 结果行右键复制 JSON、INSERT、UPDATE、DELETE SQL
- 表名右键可直接“选择此表”
- 结果行右键可复制为“字段标题行 + 数据值行”的表格
- 结果表头字段右键可按时间、数值、文本类型快捷写入 WHERE、LIKE、IN、BETWEEN、ORDER BY 等 SQL
- 支持安全只读 SQL 脚本：同一连接内依次执行 `SET @用户变量`、`SELECT`、`SHOW`、`DESCRIBE`

## 架构

```text
Chrome / Edge Extension
        │ Native Messaging
        ▼
Local Node.js Native Host
        │ mysql2
        ▼
MySQL
```

浏览器扩展不直接保存数据库密码。macOS 默认优先使用系统钥匙串；钥匙串不可用或其他系统会降级到：

```text
~/.mysql-browser-client/credentials.json
```

该文件权限会设置为 `0600`。

## 环境要求

- Node.js 20+
- Chrome、Edge 或 Chromium
- 可访问目标 MySQL 的本机网络环境

## 安装

### 1. 安装本地依赖

```bash
cd /Users/neolix/Documents/mycode/mysql-browser-client
npm install
```

### 2. 注册 Native Messaging Host

```bash
npm run native:install
```

固定扩展 ID：

```text
mlnpedajfbpmplknfkdeiedddnjldman
```

### 3. 加载扩展

1. 打开 `chrome://extensions`
2. 开启“开发者模式”
3. 点击“加载已解压的扩展程序”
4. 选择：

```text
/Users/neolix/Documents/mycode/mysql-browser-client/extension
```

5. 点击扩展图标，浏览器会直接打开完整工作台

Edge 使用 `edge://extensions`，其他步骤相同。

## 开发命令

```bash
npm test
npm run check
npm run package
```

打包产物：

```text
dist/unpacked
dist/mysql-browser-client.zip
```

## 本地数据

```text
~/.mysql-browser-client/connections.json
~/.mysql-browser-client/credentials.json
~/.mysql-browser-client/workspace.json
~/.mysql-browser-client/native-host/
```

查询页签、表排序和颜色偏好会保存在 `~/.mysql-browser-client/workspace.json`，并同时缓存到
`chrome.storage.local`。因此即使删除后重新安装扩展，只要本地数据目录仍在，这些设置也会自动恢复。

升级本地扩展时，优先在 `chrome://extensions` 中点击“重新加载”，不要先删除旧扩展。即使误删，
重新安装并执行 `npm run native:install` 后也会从 Native Host 的工作区文件恢复。

## 安全限制

- 普通查询和写操作每次只允许执行一条 SQL
- 多语句仅开放安全只读脚本模式，禁止 `SET SESSION/GLOBAL`、系统变量、动态 SQL 和任何写操作
- 执行前过滤 SQL 注释，并禁止锁表语句、`LOAD_FILE`、`SLEEP`、`BENCHMARK` 等高风险能力
- 查询行数受连接配置限制
- 生产环境进入前确认
- 写操作执行前确认，生产写操作双重确认
- Native Host 只允许固定扩展 ID 调用

## Windows

当前自动注册脚本支持 macOS 和 Linux。Windows 版本需要将 Native Host 包装成可执行文件，并在以下注册表位置注册主机清单：

```text
HKEY_CURRENT_USER\Software\Google\Chrome\NativeMessagingHosts\com.mysql_browser_client.host
HKEY_CURRENT_USER\Software\Microsoft\Edge\NativeMessagingHosts\com.mysql_browser_client.host
```
