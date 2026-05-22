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
      --config <path>      JSON 配置文件
      --no-color           关闭着色输出
  -h, --help               显示帮助
  -v, --version            显示版本
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

## 平台说明

底层使用 [`screenshot-desktop`](https://www.npmjs.com/package/screenshot-desktop)：

- macOS：内置 `screencapture`，无需额外依赖。
- Windows：自带打包脚本，无需额外依赖。
- Linux：需要安装 `imagemagick` 或 `scrot`。

## 许可

MIT
