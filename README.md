# 🐱 智域计时 (Zhiyu Timer)

<p align="center">
  <img src="https://img.shields.io/github/v/release/EthanZhao02/desktop-timer-v3?style=flat-square&color=6c5ce7" alt="Version">
  <img src="https://img.shields.io/github/license/EthanZhao02/desktop-timer-v3?style=flat-square&color=6c5ce7" alt="License">
  <img src="https://img.shields.io/github/stars/EthanZhao02/desktop-timer-v3?style=flat-square&color=6c5ce7" alt="Stars">
  <img src="https://img.shields.io/github/forks/EthanZhao02/desktop-timer-v3?style=flat-square&color=6c5ce7" alt="Forks">
  <img src="https://img.shields.io/badge/Platform-Windows-blue?style=flat-square" alt="Platform">
  <img src="https://img.shields.io/badge/Electron-43-6c5ce7?style=flat-square" alt="Electron">
</p>

<p align="center">
  <b>一款会「感知你状态」的桌面宠物计时器</b><br>
  ⏱️ 番茄钟 + ⏰ 闹钟 + 🐱 桌面宠物三合一 · 右下角悬浮 · 自动换姿势
</p>

---

## 🧸 它的名字叫「星野」

> 不是那种点一下动一下的静态桌面宠物——**星野会根据你的状态自动换姿势**。
> 你写代码它认真敲键盘，你刷微信它摸手机，你锁屏它说晚安🛏️，你回来它说欢迎~

<p align="center">
  <img src="assets/pet-idle.png" width="80" alt="idle">
  <img src="assets/pet-laptop.png" width="80" alt="coding">
  <img src="assets/pet-reading.png" width="80" alt="reading">
  <img src="assets/pet-sleeping.png" width="80" alt="sleeping">
  <img src="assets/pet-phone.png" width="80" alt="phone">
  <img src="assets/pet-celebrating.png" width="80" alt="celebrating">
</p>

---

## ⭐ 核心功能

| 功能 | 说明 |
|------|------|
| 🍅 **番茄钟 / 倒计时** | 25分钟专注，自动响铃 + 记录今日专注次数 |
| ⏰ **闹钟** | 每天定时响铃，自定义铃声（.wav/.mp3） |
| ⏸️ **秒表 / 计次** | 支持99圈计时记录 |
| 🐱 **12种实时姿态** | 编程/摸鱼/发呆/睡觉自动切换 |
| 🔒 **锁屏关怀** | 锁屏说晚安，解锁说欢迎回来 |
| 📊 **窗口感知** | 自动识别活动窗口（VSCode→敲代码，微信→摸鱼） |
| 🌙 **深色模式** | 自动跟随系统主题 |
| 🛡️ **系统托盘** | 最小化不占地方，开机自启可选 |
| 💾 **本地持久化** | 所有数据存本地，无隐私担忧 |

---

## 🚀 快速开始

### 下载即用（推荐）

> 下载 releases 中的 `智域计时 1.0.x.exe`，双击运行，无需安装

```powershell
# 国内网络打包（可选）
$env:ELECTRON_MIRROR = "https://registry.npmmirror.com/-/binary/electron/"
npm install
npm run build-portable
```

### 开发调试

```bash
git clone https://github.com/EthanZhao02/desktop-timer-v3.git
cd desktop-timer-v3
npm install
npm start        # 普通启动
npm run dev      # 开发模式（带详细日志）
```

---

## 🎯 实时姿态感知

星野会监控你的活动窗口，自动切换对应姿势：

| 检测到 | 姿态 | 气泡 |
|--------|------|------|
| VSCode / Cursor | 🖥️ 编程 | "VSCode 编程中..." |
| 微信 / QQ / 钉钉 | 📱 聊天 | "在微信聊天..." |
| Chrome / Edge / Firefox | 📖 浏览 | "浏览网页中..." |
| 网易云 / Spotify | 🎵 听歌 | "♪ 听歌中 ♪" |
| Word / Excel / PPT | ✍️ 写文档 | "Word 写文档..." |
| 锁屏 / 空闲>5分钟 | 💤 睡觉 | "Zzz..." |
| 空闲 2~5 分钟 | 🤔 发呆 | "在想什么呢..." |

---

## 🛠️ 技术栈

- ⚡ **Electron 43** — 跨平台桌面框架
- 🎨 **纯 HTML/CSS/JS** — 无框架依赖，轻量快速
- 📦 **electron-builder** — portable 单文件打包
- 💾 **JSON 本地存储** — 0 依赖，数据可读可改

---

## 📁 项目结构

```
desktop-timer-v3/
├── main.js              # 主进程：窗口/托盘/IPC/闹钟
├── preload.js           # 上下文桥
├── index.html           # 主窗口（番茄钟/闹钟/秒表）
├── pet.html             # 桌面宠物窗口
├── pet.js               # 宠物逻辑：姿态/动画/气泡
├── pet.css              # 宠物样式
├── renderer.js          # 主窗口渲染逻辑
├── timer-core.js        # 计时器核心算法
├── styles.css          # 主窗口样式
├── assets/              # 资源文件
│   ├── icon.ico        # 应用图标
│   ├── pet-*.png       # 12种宠物姿态图
│   └── default-ringtone.wav
├── tests/               # 单元测试
└── 使用说明.txt          # 用户使用指南
```

---

## 🗺️ 未来规划

- [ ] 数字签名（消除 Windows SmartScreen 警告）
- [ ] 自定义宠物立绘（用户上传自己的角色）
- [ ] 更多宠物姿态和动画
- [ ] 数据导入/导出
- [ ] 多语言支持（中文/English）

---

## 📜 License

MIT License · © Ethan智域小店

**如果你觉得这个项目有意思，点个 ⭐ 支持一下吧！**

---

<p align="center">
  <a href="https://github.com/EthanZhao02/desktop-timer-v3">🌟 Star 本项目</a>
  ·
  <a href="https://github.com/EthanZhao02">👤 作者主页</a>
  ·
  <a href="https://ycyc.win">🌐 个人博客</a>
</p>
