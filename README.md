# 智域计时 (Zhiyu Timer)

> 一款带桌面宠物的轻量级 Electron 计时器/闹钟应用
> 作者：Ethan智域小店

## 功能

- **倒计时**：设定未来时间，自动响铃 + 通知
- **正计时**：秒表 / 番茄钟用法，支持 99 圈计次
- **闹钟**：每天固定时间响铃
- **桌面宠物**：右下角悬浮，西装少年立绘
- **新拟态设计**：玻璃感 + 紫色强调
- **自定义铃声**：支持 .wav / .mp3
- **本地持久化**：闹钟、计次、铃声和设置存于 `userData/timer-data.json`
- **开机自启**：默认关闭，可在设置或托盘中启用
- **熄屏保活**：默认关闭，可在设置或托盘中启用（`powerSaveBlocker`）
- **系统托盘**：单实例锁 + 菜单集成

## 技术栈

- **框架**：Electron 43
- **打包**：electron-builder 26 (portable 模式)
- **前端**：纯 HTML + CSS + 原生 JS（无框架）
- **存储**：JSON 文件
- **依赖**：0 运行时依赖（仅 electron + electron-builder 两个 devDep）

## 项目结构

```
desktop-timer-v3/
├── main.js              # 主进程：窗口/托盘/闹钟/自启
├── preload.js           # 上下文桥（IPC）
├── index.html           # 主窗口（三个标签页 + 设置面板）
├── pet.html             # 桌面宠物窗口
├── 使用说明.txt          # 买家解压后阅读
├── README.md            # 本文件（开发者向）
├── package.json         # 应用元数据 + 打包配置
├── assets/
│   ├── icon.ico         # 应用图标（多尺寸）
│   ├── icon.png         # 256x256 图标（窗口/托盘）
│   ├── pet-character.png  # 桌面宠物立绘
│   └── default-ringtone.wav  # 内置默认铃声
└── dist/                # 打包输出（gitignore）
    └── 智域计时 1.0.0.exe
```

## 开发

```bash
# 安装依赖
npm install

# 开发模式（带详细日志）
npm run dev

# 普通启动
npm start

# 打包 portable exe
npm run build-portable
```

## 打包（国内网络）

```powershell
$env:ELECTRON_MIRROR = "https://registry.npmmirror.com/-/binary/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://registry.npmmirror.com/-/binary/electron-builder-binaries/"
npm run build-portable
```

## 应用配置 (package.json `build`)

| 字段 | 值 | 备注 |
|------|----|------|
| `appId` | `cn.ethan.zhiyu-timer` | Windows 注册表/自启项用 |
| `productName` | `智域计时` | exe 显示名 |
| `target` | `portable` | 单文件免安装 |
| `icon` | `assets/icon.ico` | exe 嵌入图标（必须是真 ICO） |

## 关键设计决策

### 为什么用 portable 而不是 nsis 安装包？
- 闲鱼虚拟商品发网盘链接，portable 直接解压即用
- 无需考虑安装路径/卸载注册表
- 缺点：每次启动有 1-2s 解压延迟（108MB electron 运行时）

### 为什么 store 用 JSON 而不是 sqlite？
- 数据量极小（闹钟数 < 100）
- JSON 可读，用户可手改
- 0 依赖，portable 体积更小

### 单实例锁
- 用 `app.requestSingleInstanceLock()` 避免用户双开
- 第二次启动时自动唤回已有主窗口

## 待办 / 未来功能

- [ ] 数字签名（消除 SmartScreen 红框）
- [ ] 宠物多立绘/动画反馈
- [ ] 主题切换（深色/浅色/自定义）
- [ ] 数据导入导出
- [ ] 多语言

## License

私有项目，© Ethan智域小店
