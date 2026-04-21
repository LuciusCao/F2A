# RFC009: Plugin Skills 自动加载机制

**状态**: 已实现 (OpenClaw 内置)
**日期**: 2026-04-21
**作者**: LuciusCao

## 背景

OpenClaw 插件需要携带 skills（知识文档），让 Agent 在安装插件后自动获得相关技能知识，无需用户手动复制或配置。

## 发现

通过分析 `@larksuite/openclaw-lark` 插件，发现 OpenClaw 已内置 skills 自动加载机制。

### 关键配置

**openclaw.plugin.json** 中声明 `skills` 字段：

```json
{
  "id": "openclaw-lark",
  "channels": ["feishu"],
  "skills": ["./skills"],    // ← 关键：声明 skills 目录
  "configSchema": { ... }
}
```

**package.json** 的 `files` 字段包含 skills：

```json
{
  "files": ["bin/", "dist/", "skills/", "openclaw.plugin.json", "README.md"]
}
```

### 加载流程

```
OpenClaw Gateway 启动
  ↓
扫描 ~/.openclaw/extensions/ 目录
  ↓
解析每个插件的 openclaw.plugin.json
  ↓
检测 skills 字段 → resolvePluginSkillDirs()
  ↓
从插件目录直接加载: ~/.openclaw/extensions/{plugin-id}/skills/
  ↓
Agent 可用 skills (无需复制到用户目录)
```

### 源码位置

- `src/agents/skills/plugin-skills.ts`: `resolvePluginSkillDirs()` 函数
- `src/plugins/path-safety.ts`: `resolveCodexSkillDirs()` 等辅助函数

核心逻辑：

```typescript
function resolvePluginSkillDirs(params) {
  // 遍历插件 registry
  for (const record of registry.plugins) {
    if (!record.skills || record.skills.length === 0) continue;
    
    // 解析 skills 路径
    for (const raw of record.skills) {
      const candidate = path.resolve(record.rootDir, raw);
      // 验证路径安全（防止逃逸）
      if (!isPathInside(record.rootDir, candidate)) continue;
      resolved.push(candidate);
    }
  }
  return resolved;
}
```

## 设计原则

1. **零复制**: Skills 直接从插件目录加载，不复制到用户目录
2. **路径安全**: 强制验证 skills 路径必须在插件根目录内
3. **自动清理**: 插件卸载时 skills 自然消失
4. **声明式配置**: 只需在 `openclaw.plugin.json` 添加一行

## 对 openclaw-f2a 的应用

### 修改步骤

1. **创建 skills 目录结构**：

   ```
   packages/openclaw-f2a/
     ├── skills/
     │   ├── f2a-p2p-messaging/SKILL.md
     │   └── f2a-agent-messaging/SKILL.md
     └── ...
   ```

2. **修改 openclaw.plugin.json**：

   ```json
   {
     "id": "openclaw-f2a",
     "skills": ["./skills"],
     "configSchema": { ... }
   }
   ```

3. **修改 package.json**：

   ```json
   {
     "files": ["dist", "skills", "openclaw.plugin.json", "README.md"]
   }
   ```

### Skills 同步机制

**单一源文件 + 发布时复制**：

```
F2A/skills/                           ← 唯一编辑源
  ├── f2a-p2p-messaging/SKILL.md
  └── f2a-agent-messaging/SKILL.md

packages/openclaw-f2a/skills/          ← prepack hook 复制
  └── (自动同步)
```

**实现**：

```json
// packages/openclaw-f2a/package.json
{
  "scripts": {
    "prepack": "cp -r ../../skills ./skills"
  }
}
```

## 对 Hermes Agent 的支持

Hermes Agent 用户（不使用 OpenClaw）可手动下载 skills：

```bash
# 从 GitHub raw 下载
curl -sSL https://raw.githubusercontent.com/LuciusCao/F2A/develop/skills/f2a-p2p-messaging/SKILL.md \
  -o ~/.hermes/skills/devops/f2a-p2p-messaging/SKILL.md
```

或从 npm 包解压：

```bash
npm pack @f2a/openclaw-f2a
tar -xzf f2a-openclaw-f2a-*.tgz
cp -r package/skills ~/.hermes/skills/devops/f2a/
```

## 参考

- `@larksuite/openclaw-lark`: 首个使用此机制的插件
- OpenClaw 源码: `src/agents/skills/plugin-skills.ts`