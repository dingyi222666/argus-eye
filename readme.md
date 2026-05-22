# argus-eye

> [`koishi-plugin-argus`](https://www.npmjs.com/package/koishi-plugin-argus) 的截图客户端 CLI。
> 在你自己电脑上跑一个，群里就能用 `/peek` 偷窥你了（自带模糊）。

## 立即使用

```bash
npx argus-eye \
  --server ws://your-koishi-host:5140/argus \
  --token  your-secret-token \
  --name   dingyi
```

## 命令行参数

```
argus-eye [options]

  -s, --server <url>       WebSocket 地址（必填，如 ws://host:5140/argus）
  -t, --token  <token>     鉴权 token（必填）
  -n, --name   <name>      上报给服务端的名字（默认: os.hostname()）
                            群里 /peek <name> 即用此名
      --list-displays      列出本机显示器后退出
  -d, --display <id>       默认截哪块屏（数字 id，缺省=主屏）
      --format <png|jpg>   传输格式（默认 jpg，更省流量）
      --no-reconnect       禁用断线重连
      --backoff <ms>       重连最大间隔（默认 30000）
      --no-detect-fullscreen
                           关闭"全屏即拒拍"行为（默认开启）
      --config <path>      JSON 配置文件
      --no-color           关闭着色输出
  -h, --help               显示帮助
  -v, --version            显示版本

## 全屏检测

CLI 默认开启全屏检测：当截屏时检测到当前焦点窗口是**真正的全屏**（典型如全屏游戏），
就向服务端返回一段「客户端正忙：xxx」的提示而不是真截图。
群友看到的是程序名（"League of Legends" / "Bilibili" 等），看不到画面。

判定规则（按优先级从高到低）：

1. `--busy-app` 显式黑名单命中 → 视为忙
2. `--allow-app` 命中（默认包含 chrome、edge、firefox、vscode、cursor、idea、
   终端、explorer、QQ、微信、Discord、Office 等常见应用）→ 永远不忙
3. 几何上是真全屏：起点贴 `(0, 0)`、`bounds == contentBounds`、覆盖整块显示器
   → 视为忙

第二条让最大化的 Chrome / VSCode 这种正常工作场景照常出图；
第三条用 `bounds == contentBounds` 区分"真全屏"和"最大化"
（最大化窗口在 Windows 上 `bounds.x = -7` 且 `contentBounds` 比 `bounds` 小一圈）。

例：

```bash
# 把 valorant / csgo / lol 直接列到黑名单
argus-eye -s ... -t ... --busy-app valorant --busy-app csgo --busy-app "league of legends"

# 把"魔兽世界"也加进白名单（如果你想被群友看到）
argus-eye -s ... -t ... --allow-app wow

# 关掉这个行为
argus-eye -s ... -t ... --no-detect-fullscreen
```

也可以写在 `~/.argus-eye.json`：

```json
{
    "busyApps": ["valorant", "csgo", "league of legends"],
    "allowApps": ["mygame"]
}
```

底层使用 [`get-windows`](https://www.npmjs.com/package/get-windows)（optional dependency）。
该包是原生 napi 模块，部分平台（Linux Wayland）不支持，加载失败时会自动降级为永远「不忙」。
```

## 配置文件

支持把常用参数写到 `~/.argus-eye.json` 或通过 `--config` 指定，命令行参数 > 环境变量 > 配置文件 > 默认值：

```json
{
    "server": "ws://my.box:5140/argus",
    "token": "xxx",
    "name": "dingyi-pc",
    "display": 0,
    "format": "jpg"
}
```

环境变量：`ARGUS_SERVER` / `ARGUS_TOKEN` / `ARGUS_NAME`。

## 加密

截图 buffer 走 WebSocket 之前会用 `AES-256-GCM` 加密，key 由 `--token`
经 scrypt 派生，IV 每帧随机。同一 token 的插件端会解出来；token 不对的
中间人 / 抓包工具拿到的都是密文。

## 平台说明

底层使用 [`screenshot-desktop`](https://www.npmjs.com/package/screenshot-desktop)：

- macOS：内置 `screencapture`，无需额外依赖。
- Windows：自带打包脚本，无需额外依赖。
- Linux：需要安装 `imagemagick` 或 `scrot`。

## 许可

MIT
