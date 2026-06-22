# TRAE Handoff - Runtime Dock / opencode

## 本轮目标

本轮工作在不触碰 `.git` 元数据的前提下，继续推进两件事：

1. 让 `Runtime Dock` 更接近真实终端使用体验。
2. 让 `opencode` 在本机已安装时，能从 Runtime Dock 更稳定地启动，并进入当前工作目录。

---

## 本轮已完成修改

### 1. Runtime Dock 交互体验增强

修改文件：

- `src/components/RuntimeDock/index.tsx`
- `src/store/runtimeDock.ts`
- `src/store/type.d.ts`
- `src/i18n/resources/zh.json`
- `src/i18n/resources/en.json`

已实现：

- 将原来的多行 `TextArea` 输入改成更接近终端的**单行 prompt 输入**。
- 针对不同 profile 显示不同 prompt：
  - `PS>`
  - `opencode>`
- 支持 `Enter` 发送命令。
- 支持 `↑ / ↓` 浏览当前 attachment 的本地命令历史。
- 增加“清屏”按钮，允许清空当前 attachment 的 transcript。
- transcript 区域增加自动滚动到底部逻辑。
- transcript 空状态增加明确提示。
- 终端配色继续保持高对比度，提升可读性。

### 2. 输出碎片与重复感优化

修改文件：

- `src/store/runtimeDock.ts`
- `electron/main/runtimeManage.ts`

已实现：

- 连续的 `stdout/stderr/system` 事件在短时间内做合并，减少“一条命令拆成很多块”的视觉碎片感。
- 前端不再额外记录一次 `input` 回显，避免与 PowerShell 自身回显重复。
- `started / stopped / exit` 统一按 `system` 处理，而不是混入普通 stdout。
- PowerShell 启动参数加入 `-NoProfile`，减少本机 profile 导致的额外输出和干扰。

### 3. opencode 启动策略增强

修改文件：

- `electron/main/runtimeManage.ts`
- `src/components/RuntimeDock/index.tsx`

已实现：

- Runtime Dock 的 `Add Terminal` 现在支持显式选择：
  - `PowerShell Terminal`
  - `opencode Terminal`
- `opencode Terminal` 启动时，会先在本机 PATH 中检测 `opencode`。
- 如果检测到 `opencode`：
  - 在当前工作目录启动 hosted PowerShell；
  - 自动执行 `opencode`；
  - 在 transcript 中打印检测到的 `opencode` 路径。
- 如果未检测到 `opencode`：
  - 保持在 hosted PowerShell；
  - 明确提示“未在 PATH 中找到 opencode”。

本次环境中，`where opencode` 已能找到可执行入口，因此当前机器具备从 Runtime Dock 继续拉起 `opencode` 的基础条件。

---

## 当前架构判断

### 目前仍然不是完整 PTY/xterm 终端

当前实现依然属于：

> Electron main 托管子进程 + stdout/stderr 流式转发 + 前端 transcript 展示

还不是：

- `node-pty`
- `xterm.js`
- 完整 TTY / PTY 语义
- 完整 ANSI 终端渲染

因此仍然存在天然限制：

- 一些交互式 CLI 的表现仍可能和系统原生终端不同。
- 光标控制、局部刷新、全屏 UI、ANSI 重绘等行为仍不完整。
- `opencode` 虽然可以启动，但体验仍受“非 PTY”架构限制。

### 目前已达到的状态

- Runtime Dock 已不只是 placeholder。
- PowerShell Hosted Terminal 的可用性比之前更好。
- `opencode Terminal` 已有明确入口，并具备“本机安装时自动启动”的能力。
- UI 层输入输出不再像之前那样明显混乱，终端区域已更接近实际使用习惯。

---

## 建议的后续实施顺序

### 近期优先

1. 引入 `node-pty`
   - 让 Runtime Dock 真正拥有 PTY 语义。
   - 解决交互式 CLI 与普通 pipe 模式差异过大的问题。

2. 引入 `xterm.js`
   - 让终端输出不再只是 transcript list，而是真正的 terminal surface。
   - 支持更自然的输入、选择、滚动、ANSI 渲染。

3. 将 `opencode Terminal` 从“hosted shell 中自动执行 opencode”继续推进为：
   - PTY 模式直接托管；
   - 保留工作目录；
   - 逐步补齐 stop / interrupt / restart 语义。

### 之后可做

1. 为每个 attachment 增加独立的工作目录显示与切换提示。
2. 增加复制 transcript、导出 transcript。
3. 增加 `Ctrl+C` / interrupt 能力。
4. 为 `opencode` 增加更明确的状态标识：
   - detected
   - launching
   - attached
   - fallback shell

---

## 验证结果

本轮修改后已验证：

- `npx.cmd tsc --noEmit` 通过
- `npm.cmd run lint -- --quiet` 通过

说明：

- lint 仍会打印项目已有的 `eslint-plugin-react` version warning，但不是本轮新增问题。

---

## 本轮变更文件

- `electron/main/runtimeManage.ts`
- `src/components/RuntimeDock/index.tsx`
- `src/i18n/resources/en.json`
- `src/i18n/resources/zh.json`
- `src/store/runtimeDock.ts`
- `src/store/type.d.ts`

---

## 交接说明

如果下一位继续接手，建议优先从这两个方向继续：

1. `Runtime Dock terminal surface`：
   从 transcript list 迁移到 `xterm.js`。

2. `Runtime PTY backend`：
   从普通 `spawn + pipe` 迁移到 `node-pty`。

只要这两步完成，当前“像终端但又不像”的大部分体验问题都会明显下降，`opencode`/`codex`/其他 CLI runtime 的挂载形态也会自然更完整。
