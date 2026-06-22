# TRAE Handoff - Runtime Dock / opencode

## Latest Update - PTY / xterm

在上一轮 hosted terminal 改造之后，继续完成了下一步工作：

1. Electron main 已从普通 `spawn + pipe` 切到 `node-pty`。
2. Runtime Dock 前端已接入 `@xterm/xterm` + `@xterm/addon-fit`。
3. 新增 `runtime:resize` IPC，用于把前端 terminal 尺寸同步给 PTY。
4. `opencode Terminal` 在本机 PATH 可用时，会优先直接以 PTY 方式拉起 `opencode`；否则回退到 PowerShell hosted shell。

额外修改文件：

- `electron/constants/index.ts`
- `electron/main/ipcHandlerManage.ts`
- `src/types/globalExpose.d.ts`
- `src/components/RuntimeDock/TerminalSurface.tsx`
- `package.json`

已验证：

- `node-pty` 依赖安装成功
- `@xterm/xterm` / `@xterm/addon-fit` 接入完成
- `npx.cmd tsc --noEmit` 通过
- `npm.cmd run lint -- --quiet` 通过

说明：

- Electron main 的新逻辑需要完整重启 Electron 才会生效，单纯前端 HMR 不够。

---

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

### 当前已进入 PTY/xterm 阶段

当前实现依然属于：

> Electron main 使用 `node-pty` 托管终端进程 + 前端使用 `xterm.js` 作为 terminal surface + transcript 作为持久化/回放日志

仍未完成的部分：

- 真正的多标签 terminal 会话管理
- `Ctrl+C` / interrupt / restart 的完整语义
- 更细致的 ANSI/状态解析
- 对 `opencode` 生命周期的更完整状态管理

因此仍然存在天然限制：

- transcript 与 xterm surface 目前是双轨并存，仍偏工程过渡态。
- `opencode` 已经可以走 PTY 直启，但还没有补齐 attach / fallback / interrupt 的专门 UI 状态。
- 还没有做到真正“像独立终端应用那样”的所有行为细节。

### 目前已达到的状态

- Runtime Dock 已不只是 placeholder。
- PowerShell 与 opencode 都已进入 PTY 托管链路。
- Runtime Dock 已经从 transcript 面板升级到真正的 `xterm.js` terminal surface。
- `opencode Terminal` 已有明确入口，并具备“本机安装时优先直接启动”的能力。
- UI 层输入输出体验相比最初版本已明显接近真实终端。

---

## 建议的后续实施顺序

### 近期优先

1. 补齐 `interrupt / Ctrl+C / restart` 语义
   - 让 PTY 模式下的会话控制更接近真实终端。

2. 为 `opencode Terminal` 增加更明确的运行状态
   - detected / launching / attached / fallback shell。

3. 优化 transcript 与 xterm 的边界
   - 明确哪些用于持久化、哪些只用于显示。

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

1. `PTY control refinement`：
   完成 interrupt / restart / status 语义收口。

2. `Runtime profile expansion`：
   在当前 PTY 链路稳定后，再接 `codex` / 其他 CLI runtime。

当前已经跨过“只有 transcript、没有真实 terminal”的阶段，后续重点会转到控制语义和 runtime profile 扩展上。
