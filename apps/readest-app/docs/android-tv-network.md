# Readest TV 联网清单

更新：2026-11-14，适用于 `tv/0.12.20` / `0.12.20-tv.2`。目的地由调用链核实；“源码/回归验证”不代表已经使用真实第三方账号联调，也不代表 ARMv7 真机抓包通过。

本地启动、界面、默认字体、解析器、书库、阅读和设置均随 APK 提供。没有 Readest 登录、权益获取或官方云初始化。没有按域名一刀切的网络封锁；下面的公共下载仍可按需访问。

## 公共资源

| 功能与目的地 | 触发/凭据 | 缓存与失败影响 | 验证 |
| --- | --- | --- | --- |
| 示例书 `cdn.readest.com/books/*` | 书库明确选择示例书下载；无需凭据 | 按普通本地书导入；失败只影响该次下载 | 8 个地址匿名范围 GET 206、ZIP 头；调用和显式入口回归；未全量下载所有书 |
| 公共字体 `storage.readest.com/public/font/dist/*`、`fonts.googleapis.com`/`fonts.gstatic.com`、`cdn.jsdelivr.net`、`cdnjs.cloudflare.com` | 字体设置的公共字体下载入口；无需 Readest 身份 | CSS 和字体分片下载到本地；打开书只挂载已缓存资源；失败保留本地默认字体 | 4 套官方 CSS 200，每套抽查 WOFF2；持久化/离线加载回归；未遍历所有第三方字体及分片 |
| Word Lens `cdn.readest.com/wordlens/manifest.json` 和词包 JSON | 设置 → 语言 → Word Lens；手动刷新/下载，或用户开启自动下载后缺包时获取；无需凭据 | 清单/词包/SHA 本地保存，缓存优先；关闭自动下载不请求清单；失败不逐章重试，手动可重试 | 17/17 词包完整 GET、SHA 和长度匹配；缓存、关闭下载、超时/失败回归 |
| 公开分享 `web.readest.com/api/share/{token}`、`/download`、`/cover` 及返回资源地址 | 用户打开有效分享链接；仅链接自身的访问凭证，无 Readest 账号 | 下载导入本地；失效只影响该链接；无账号云端复制/创建/管理 | 公开只读调用链已核实；没有有效分享链接做线上端到端测试 |

探测不发送 Cookie、Authorization、Readest token 或用户 API Key，见 [public-resource-probes.json](verification/public-resource-probes.json)。在线可访问不等于重新分发许可；额外字体继续由用户按需下载，没有打包第三方资源全集。

## 独立服务和自配连接

| 功能 | 目的地 | 触发和凭据 | 失败影响/验证 |
| --- | --- | --- | --- |
| Edge TTS | `wss://api.msedgeservices.com/tts/cognitiveservices/websocket/v1` | 选择 Edge 朗读/试听/发音；使用原客户端的公开协议参数，无 Readest 身份 | 只影响朗读，绝无 Readest HTTP fallback。实际合成中文得到 17,424 字节音频、5 个词边界；见 [直接连接探测](verification/edge-direct-probe.json)。测试经本机代理连接微软，未测电视网络 |
| Android 系统 TTS、本地朗读 | 系统安装的语音引擎；本地录音、EPUB 媒体叠层、下载音频 | 用户播放；系统在线音色由该引擎决定目的地/授权 | 本地阅读不受影响；离线引擎初始化回归，实物声音未测 |
| 自配 TTS | 保存的接口根地址及 `/audio/speech` 等兼容路径；支持 OpenAI 兼容/MiMo | 手机或电视测试/试听/朗读；API Key 只发该服务，支持无需 key 的本地服务 | 401/限额/超时局部报错，响应正文不回显凭据；持久化、回滚、草稿试听、音频格式、删改回归；未使用用户真实服务凭据 |
| 翻译 | `translate.googleapis.com`、`www.bing.com`、`translate.yandex.ru`/`.net`；`api-free.deepl.com`/`api.deepl.com`；自配兼容地址 | 用户查询/开启全文翻译；DeepL/自配服务可有自己的 key | 只影响翻译；官方代理删除；直连调用及适配器回归，未逐一线上联调 |
| 词典/网页搜索 | Wiktionary/Wikipedia 各语言站点；自配字典 URL；用户选择的 Google、Merriam-Webster、Urban Dictionary、Goodreads 等搜索页 | 查询词语/打开搜索；来源需要时使用自己的凭据 | 本地词典/阅读继续；源码/回归核实，未遍历所有网站 |
| AI | `openrouter.ai/api/v1`、Vercel AI Gateway、用户 Ollama/兼容地址（默认 Ollama 为本机 11434，电视可修改） | 用户发送/测试/启用 AI 功能；该服务 API Key | AI 任务局部失败，不校验 Readest 会员；源码/回归，未使用真实付费账户 |
| OPDS / 网页小说 / RSS / 播客 | 用户选择的目录、来源及返回的下载/封面/音频 URL | 浏览/搜索/下载/播放；自动更新需开启；来源可有自己账号 | 已下载书离线可读；原生直连、去代理、表单保存回归；未遍历各公共目录 |
| 元数据和封面 | `openlibrary.org`、`covers.openlibrary.org`；`www.googleapis.com/books/v1`；用户打开的 Bing/Google/DuckDuckGo 封面搜索 | 明确查找/批量补全；Google Books 如配置则带自己的 key | 手工编辑、现有封面继续；OpenLibrary 直连替换官方中转，适配器回归；未逐条验证所有书目 |
| WebDAV / S3 | 用户服务器或桶端点 | 测试/手动同步；启用后按原设置自动同步；该服务用户名/密码/key | 本地数据保留，状态显示同步失败；独立同步、完整刷新、手机保存回归；真实服务器未联调 |
| Google Drive | Google OAuth、`oauth2.googleapis.com`、`www.googleapis.com`、文件下载主机 | 主动连接后同步/令牌刷新；用户的 Google 授权 | 无 Readest 会话/权益依赖；保留原公开 OAuth 客户端和构建时替换入口，注册/第三方回跳规则仍可能限制可用性；未真实授权联调 |
| OneDrive | `login.microsoftonline.com`、`graph.microsoft.com` 及下载主机 | 主动连接后同步/刷新；Microsoft 授权 | 同上；可用 `NEXT_PUBLIC_MICROSOFT_CLIENT_ID` 构建自己的客户端，未真实授权联调 |
| KOSync | 用户地址，预设 `sync.koreader.rocks`/`kosync.ak-team.com` | 配置并连接/同步；该服务账号 | 仅同步失败；直连/配置回归，未真实账号验证 |
| Audiobookshelf / BookOrbit / Grimmory | 用户服务器及其媒体主机 | 配置后浏览、播放、下载、同步；该服务凭据 | 缓存/本地书可用；直连、独立账号、去官方门槛回归，未真实服务器联调 |
| Readwise / Notion / Hardcover | `readwise.io`、`api.notion.com`、`api.hardcover.app` 及 Hardcover 授权端点 | 用户配置后导出/查询/同步；各自 token/OAuth | 集成局部失败；无 Readest 账号绑定；Hardcover 保留公开 OAuth 客户端及独立 API token 方式；未真实账号联调 |
| Pagebound | `pagebound.co`、`prod-pagebound-api.onrender.com`、`identitytoolkit.googleapis.com`、`securetoken.googleapis.com`、其 Typesense 搜索主机 | 用户主动连接 Pagebound/查询/同步；Pagebound 账号 | 此第三方身份独立于应用；源码/回归，未真实账号联调 |
| Anki / Obsidian | 用户 AnkiConnect 地址（默认本机 8765）/本地文件 | 明确导出或开启集成；如配置则用该端点凭据 | 本地导出保留；去门槛与源码/回归，未 Anki 实机联调 |
| LocalSend | 本地发现与选中设备的局域网 HTTPS | 用户开启/选择设备并确认；无 Readest 身份 | 只影响本次局域网传输；保留证书/设备确认，未两台实机测试 |
| 手机助手 | 电视当前私有 IPv4:实际端口 `/`、`/api/*` | 遥控器开启后 15 分钟随机能力授权；二维码 fragment 不含服务 key | 无网络/关闭/过期/网络变更使旧授权无效；Rust 实际 HTTP、手机表单和电视 RPC 分层验证，未手机→电视完整实物测试 |
| 项目归属/帮助外链 | `readest.com`、`mailto:support@readest.com` 等保留的上游介绍/帮助链接 | 只有用户明确打开链接才交给浏览器/邮件应用；不会自动发送邮件 | 不参与启动/阅读/鉴权；保留的静态链接已检查，未执行联系操作 |
| 本 fork 更新 | `github.com/Huuuhuuhu/readest/releases` 及 GitHub 资产重定向主机 | 关于页面主动打开发布页/下载；无需应用账号 | 无自动上游检查/回落，失败保留当前安装；发布流水线和签名验证 |
| 书内远程资源 / 外链 | 书籍引用或用户确认的 URL及其重定向目标 | 明确允许该书远程资源、或用户打开外链；不附带应用服务密钥 | 只缺少相关外部资源，核心渲染本地；源码/既有回归 |

Google/OneDrive 的公开 OAuth client ID 不是用户密钥，也不是 Readest 登录凭据；依赖第三方应用注册可用性。自行构建可设置 `NEXT_PUBLIC_GOOGLE_CLIENT_ID`、`NEXT_PUBLIC_GOOGLE_WEB_CLIENT_ID`、`NEXT_PUBLIC_MICROSOFT_CLIENT_ID`，Google 原生回跳 scheme 须与自己的 client ID 同步注册。不能把未实际授权的 OAuth 流程声称为已验证。

用户自配 URL、书内链接、OPDS/播客返回的媒体 URL 会决定额外主机，因此不存在固定的全主机白名单。第三方服务自身的费用和账号政策不由这个 fork 绕过。

## 已删除或替换

- Auth/Supabase、登录/注册/个人中心、套餐/配额/权益、购买和商店 BILLING、Stripe/Apple 服务端 SDK、PostHog/Sentry 初始化和依赖。
- 官方账号云 provider、replica 后台通道、私有 signed URL、Readest 收件箱/设备登录、分享创建管理和账号云端复制。旧同步队列不会恢复官方上传。
- Readest Voice、Edge 官方代理 fallback、官方翻译中转、元数据代理、自配功能会员限制。元数据改独立查询，独立同步不等待登录。
- 官方更新 URL。无新应用账号，无伪造高级身份。

## 故障验收边界

默认启动不发官方账号请求，公共资源默认按需并优先本地。缓存、失败隔离、无隐式官方后端、无会员状态的服务调用已有回归。**全新 APK + 在电视网络屏蔽全部 Readest 域名**、网络恢复后公共资源下载、重启/切网及实际系统 TTS 尚需实物验收；公共资源被屏蔽时下载失败属于预期，本地功能不得跟随失效。
