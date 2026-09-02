# MySQL Browser Client

一个本地优先的 Chrome / Edge MySQL 浏览器扩展。它不包含 AI 功能，也不会把数据库密码或查询内容发送到远程服务。

## 功能

- MySQL 连接新增、编辑、测试和删除
- 数据库、表和视图浏览
- 双击表名称自动填写并运行 SELECT 查询
- 字段、索引和外键查看
- SQL 多页签编辑与查询
- `EXPLAIN` 执行计划
- SELECT、INSERT、UPDATE、DELETE 和常用 DDL
- 写操作确认、生产环境双重确认
- 查询结果 CSV / 文本导出
- SQL 审计摘要
- 表置顶、表下沉、表名颜色
- 点击扩展图标直接打开独立大工作台
- 数据源、库表、字段/索引面板可折叠
- 面板宽度和工作区高度可拖拽调整
- 翡翠暗色、深海蓝、琥珀暗色、明亮灰白主题切换
- 表名、字段名、别名、SQL 关键字自动补全
- 结果行右键复制 JSON、INSERT、UPDATE、DELETE SQL

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
~/.mysql-browser-client/native-host/
```

扩展侧的查询页签、表排序和颜色偏好保存在 `chrome.storage.local`。

## 安全限制

- 每次只允许执行一条 SQL
- 禁止 SQL 注释、锁表语句、`LOAD_FILE`、`SLEEP`、`BENCHMARK` 等高风险能力
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
