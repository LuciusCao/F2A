# F2A 快速开始

> 5 分钟上手 F2A P2P 网络

---

## 安装

### 方式一：NPM（推荐）

```bash
npm install -g @f2a/network
```

**适用场景**：已有 Node.js 18+ 环境

### 方式二：一键安装脚本

```bash
curl -fsSL https://raw.githubusercontent.com/LuciusCao/F2A/main/install.sh | bash
```

**适用场景**：无 Node.js 环境、生产服务器部署

---

## 初始化配置

```bash
f2a init
```

回答 3 个问题：

```
? 节点名称: my-agent
? 是否自动启动: Y
? 引导节点 (回车跳过): 
```

---

## 启动

```bash
# 前台运行（查看日志）
f2a daemon

# 后台运行
f2a daemon -d
```

---

## 验证

```bash
# 查看状态
f2a status

# 查看已连接节点
f2a peers

# 查看配置
f2a config
```

---

## 下一步

- [配置说明](./docs/configuration.md)
- [加入现有网络](./docs/join-network.md)
- [开发指南](./docs/development.md)

---

## 常见问题

### 1. 端口被占用

```bash
# 查看端口占用
lsof -i :9000

# 修改配置
f2a config set p2pPort 9001
```

### 2. 无法连接其他节点

- 检查防火墙是否开放端口
- 确认引导节点地址正确
- 检查网络连通性

### 3. 配置文件在哪里？

```
~/.f2a/config.json
```

---

## 需要帮助？

- [GitHub Issues](https://github.com/LuciusCao/F2A/issues)
- [Discord 社区](https://discord.gg/clawd)