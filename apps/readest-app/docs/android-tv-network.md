# Readest TV 联网范围与验证记录

更新：2026-11-13。适用于 `Huuuhuuhu/readest` 的 `tv/0.12.20` 分支。
这是阶段 2 的实现清单；P1 APK 仍包含上游账号和官方服务代码，不能据此文档宣称已完成去依赖。
原遥控器、单栏、确认后编辑、无应用账号、独立 TTS、扫码上传/手机配置要求继续有效。

## 判断规则

- 本地启动、默认字体、界面、书库、阅读、设置和解析资源必须离线可用，不等待在线资源。
- 保留经核实免 **Readest** 登录/会员的公共资源，包括官方托管的资源。明确入口、按需获取、优先本地缓存。
- 独立第三方及自配服务可以要求其自己的账号、API Key 或费用；凭据不能绑定 Readest 身份或权益缓存。
- 真正删除 Readest 登录、订阅购买、权益校验、遥测、官方账号云服务、Readest Voice 和官方翻译/TTS 中转。不能伪造高级会员或仅隐藏按钮。
- 按服务、路径、用途检查调用链。保留 `cdn.readest.com/wordlens/` 不放开账号 API；移除账号存储也不删除 `storage.readest.com/public/font/dist/`。
- 不在产品中统一阻断 Readest 域名，也不为这次修正增加统一 NetworkPolicy/ServiceRegistry。全域名屏蔽只用于故障验收。
- 对性质不明的资源先保留待核实记录，不直接删除。更新仅使用本 fork 的发布渠道。

## 已核实的公共资源

匿名探测不发送 Cookie、Authorization、Readest token 或 API Key。下面的 HTTP 验证是本机经网络代理直接请求资源，**不是电视 APK 抓包或可用性验收**。可访问性不等于重新打包分发的许可。

| 功能与目的地 | 用途、触发条件 | 凭据 | 缓存与失败影响 | 验证和实现状态 |
| --- | --- | --- | --- | --- |
| 示例书：`https://cdn.readest.com/books/`；原版 en/zh JSON 中的 8 个 EPUB 地址 | 书库显式选书并下载导入；不在冷启动自动导入 | 无 | 导入完成按普通本地书保存；失败仅该下载报错，不能挡住导入自己的书 | 8/8 匿名范围 GET 返回 206、ZIP 文件头正确；未完整下载全部书，未验证新 TV 入口。现有 `useDemoBooks` 只在 Web 自动导入，Android 的明确入口待补 |
| 官方字体：`https://storage.readest.com/public/font/dist/{family}/result.css` 与其 WOFF2 分片；Huiwen-MinchoGBK、KingHwa_OldSong、Source Han Serif CN、GuanKiapTsingKhai-T | 用户选择公共字体后下载；默认 UI/阅读字体使用本地资源 | 无 | 目标为下载后本地使用，失败回本地字体且保留当前阅读位置；不为每段/每页重复请求 | 4/4 CSS 完整匿名 GET 200，每套抽查一个 WOFF2 分片返回 206、签名正确；未验证全部分片、CORS/Android 渲染及分发许可。现有自动挂载远程样式需改为显式下载并持久化，不能删掉字体功能 |
| Word Lens：`https://cdn.readest.com/wordlens/manifest.json` 与其中 `{pair}.json?v={sha前8位}` | 打开词包管理页获取清单、显式刷新/下载；只有启用 Word Lens 自动下载后才可在缺包时获取 | 无 | 清单、JSON 词包及 SHA sidecar 存在电视 Data/wordlens；本地优先；失败只影响提示词包，不影响正文；失败自动下载在当前进程内停止，用户可手动重试 | 清单 200，17/17 词包完整匿名 GET 200，长度与 SHA-256 均匹配。此批已修复缓存优先、禁止下载时不取清单、重复失败不随章节重试、手动刷新入口及下载脱离账号存储；Android 真机待验 |
| 其他公共字体：Google Fonts/gstatic、jsDelivr、cdnjs 等现有来源 | 明确选择对应资源后获取 | 原调用无 Readest 凭据 | 不得成为默认字体或启动的必要条件；缓存/本地导入保留 | 已发现 `styles/fonts.ts` 的调用线索，逐资源匿名访问、许可、持久化及 TV 入口尚未验证；不得仅凭域名删掉 |
| 用户提供的 Readest 公开分享链接：`/api/share/{token}`、`/download`、`/cover` | 仅用户打开有效分享链接时读取元数据/下载到本地 | 有效分享链接本身的访问凭证，不是 Readest 账号；不记录原始 token | 过期/撤销/服务不可达只影响该链接，已导入书籍保持本地可用 | 服务端 GET 调用链已核实为公开读取；没有有效分享链接可做在线验证。原 `POST /import` 是账号云端复制，必须删除；不得把公开 GET 和账号创建/导入一起误删，也不应恢复云端导入流程 |

来源：[示例书清单](../src/data/demo/library.zh.json)、[示例书调用](../src/app/library/hooks/useDemoBooks.ts)、[字体](../src/styles/fonts.ts)、[Word Lens 下载](../src/services/wordlens/glossPacks.ts)、[词包设置页](../src/components/settings/WordLensPanel.tsx)。
匿名验证明细见 [public-resource-probes.json](verification/public-resource-probes.json)。书籍和字体只做的范围抽查，不应写成全量内容验证。

## 保留的独立服务与集成

以下为既定保留范围。目的地来自原源码/前期审计；除另有说明，**尚未完成去账号调用链、实际请求和 ARMv7 真机验证**。用户自配地址、重定向和系统 TTS 引擎的目的地须在最终验收补齐。

| 功能 | 目的地 | 触发条件与凭据 | 失败影响 / 当前待办 |
| --- | --- | --- | --- |
| Edge TTS | 微软 `speech.platform.bing.com` 的 read-aloud WebSocket | 用户选择 Edge 朗读/试听/词语发音；无需 Readest 账号 | 仅朗读错误或使用已缓存音频；保留直接微软路径，删除 Web/试听/词语发音中的官方 HTTP fallback 和 `tts-need-auth` 事件。未在本批实际合成验证 |
| Android 系统 TTS / 本地朗读 | 本地 Android TTS 引擎、本地录音/媒体叠层/音频缓存；在线系统声音由其引擎决定 | 用户选择播放；系统引擎自身可能需联网/安装声音 | 无声音时提示引擎问题，不影响阅读；不能承诺所有系统声音都离线。设备验证待用户测试 |
| 自配 TTS | 用户保存的接口地址、模型/音色目录与合成路径 | 添加/测试/试听/朗读时；仅给该服务 API Key | 只影响该服务；去掉 `isCustomTTSAllowed(getAccessToken())`、Readest Voice 及自动代理；保留现有兼容客户端。待独立配置/错误回归 |
| 翻译与在线词典 | Google/Bing(Yandex) 等原生直连、Wiktionary/Wikipedia、自配 DeepL/兼容接口或词典 | 用户查询或开启全文翻译；提供方要求时使用其 key | 本地词典和阅读继续；移除官方翻译中转及账号门槛，不因保留公共资源而放回中转。各提供方逐项待验证 |
| AI | 用户选择的模型提供方地址或自建 Ollama/兼容接口 | 用户发送查询/测试/使用 AI 功能；相应服务 key（如需要） | 仅 AI 任务失败；不请求 Readest 权益或改变本地功能。网络出口与凭据隔离待验证 |
| OPDS / 公共书源 / 网页小说 / RSS / 播客 | 用户所选目录、来源及其明确链接的下载/封面/音频 URL | 浏览/搜索/下载/播放；自动更新需单独开启；来源可有自己的账号 | 已下载书籍离线可读；本地书库可返回；Android 保留原生直连，官方 Web 代理需拆除。公共预设逐项核实 |
| 元数据 / 封面 | 计划直接使用 `openlibrary.org`、`covers.openlibrary.org`、Google Books 或用户配置服务 | 明确搜索/确认批量补全；提供方需要时用其 key | 保留手工编辑和已有封面；原 `/metadata/search` 官方中转需替换，不能随书架渲染反复查询。直连替换待实现 |
| WebDAV / S3 / KOSync | 用户服务器、桶端点；KOSync 公共服务可作明确预设 | 测试、手动同步；显式启用后自动同步；该服务用户名/密码/key | 只报同步失败，本地数据保留；删除官方默认回落、账号副本通道和客户端会员限制。自有凭据不上传官方 |
| Google Drive / OneDrive | Google OAuth/Drive 与 Microsoft OAuth/Graph 及文件下载地址 | 用户主动连接与同步；其 OAuth 凭据，自动刷新仅限已配置连接 | 仅该连接失效；核对可独立使用的 OAuth client/回跳配置，不冒用上游应用注册，不与 Readest 登录绑定。待核实 |
| Audiobookshelf / BookOrbit / Grimmory | 用户自有服务器和其媒体主机 | 用户配置后浏览、播放、下载、同步；该服务凭据 | 缓存内容/本地书仍可用；去除 Readest 会员门槛、官方代理；真实服务待联调 |
| Readwise / Notion / Hardcover / Pagebound | 对应独立服务 API 与授权端点；Pagebound 还包括其 Firebase 身份和搜索端点 | 用户分别配置后导出/查询/同步；各自 token/账号 | 仅该集成失败；第三方身份不是应用账号。OAuth 依赖及所有动态目的地待核实 |
| Anki / Obsidian | 本地文件，或用户 AnkiConnect/同步地址 | 用户导出或显式启用同步；端点所需凭据 | 本地导出开放，网络导出失败不锁本地功能；待移除权益判断 |
| 手机协助 / LocalSend | 电视实际 LAN IP:实际端口 `/assist/`；另有用户开启的 LocalSend 局域网发现/传输 | 遥控器显式开启；短期设备授权，无应用账号；手机表单凭据只保存电视并发给所属服务 | 关闭/过期/网络变化撤销；已导入文件与已保存配置保留。依原阶段 3 实现；本批不增加新协议层 |
| 本 fork 更新 | `github.com/Huuuhuuhu/readest/releases`、`api.github.com` 及发布资产重定向地址 | 手动检查、确认下载；无需 GitHub 登录 | 失败保留当前版本，不回退上游。P1 已从此渠道发布，应用内 updater 替换尚未完成 |
| 书内远程资源 / 外链 | 该书引用或用户确认打开的具体 URL | 明确启用该书的远程资源，或确认外链；不携带服务密钥 | 缺失资源提示局限于该书；核心渲染仍本地。按用途核实，不能统一排除 Readest 托管的公共资源 |

## 删除/替换的调用关系

| 模块 | 实际要删除/替换的内容 | 保留边界 |
| --- | --- | --- |
| 身份、权益、支付 | AuthProvider/Supabase 会话刷新、登录注册/个人中心、套餐/配额/entitlement 缓存与校验、Stripe/商店购买及 BILLING 权限 | 本地记录、设备 PIN、独立服务连接凭据 |
| 官方云/私有对象存储 | Readest cloud provider、账号 replica、用户私有 signed-URL 查询、官方收件箱/设备授权、分享创建/管理和账号云端导入及后台任务 | WebDAV/S3 等自配同步、本地序列化/导出、公共下载；公开分享只读路径单独核实，不能复用云端导入。Word Lens 本批已不再导入 `libs/storage` |
| 语音/翻译 | Readest Voice、官方 Edge HTTP proxy、官方翻译中转、自配服务的会员判断与 auth 事件 | 直接微软、系统 TTS、本地音频、自配/独立第三方接口 |
| 遥测/远程配置 | PostHog、Sentry 的可执行 SDK/自动初始化/上传、账号与官方付费 API 配置 | 本地日志、主动导出的脱敏诊断；公共资源 URL 本身允许保留 |
| 更新 | `download.readest.com` 上游 stable/nightly 清单与安装包、官方更新 fallback | 本 fork 的签名 APK 和发布渠道 |

上述删除仍按阶段 2 逐模块实现；本批没有把登录按钮隐藏或伪造会员，也没有声称整个应用已经停止官方后台调用。

## 受影响的验收

1. **全新安装、全官方阻断**：无缓存/无 Readest 登录，DNS 失败、拒绝连接、超时分别测试。启动、本地管理/阅读/设置、独立自配服务可用，默认字体和解析不等远端。
2. **主动公共下载失败**：上述阻断下分别请求示例书、公共字体、Word Lens；仅对应下载报错，无登录/会员提示、回锁或持续后台重试。浏览/翻页和设置保持可用。
3. **网络恢复后显式重试**：刷新清单、选书/字体/词包下载；请求无 Readest token，不能因此恢复官方云或付费代理；完成后不抢阅读焦点。
4. **缓存与重启**：完成下载后重启、断网再使用书籍/字体/词包。Word Lens 的本地读取不能等待另一窗口未结束的网络请求；网络下载关闭时连清单都不得下载。
5. **独立服务失败**：Edge、自配 TTS、翻译/词典等分别 401/限额/超时，局部报错；绝不 fallback Readest。第三方自己的账号/费用不应被误删。
6. **遥控可达**：用方向/确认/返回完成公共资源入口、选择、刷新/重试、下载状态查看和返回；确认后编辑和不穿透正文继续适用。Word Lens 已有设置页复用，示例书/字体的明确入口还待实现和电视走查。
7. **发布证据**：联网表逐行记录最终 commit/APK、目的地、用途、触发、凭据、失败影响、实际验证方式和未测部分；静态字符串、匿名 HTTP 和真机抓包分别记载。

此批的 Word Lens 回归涵盖本地优先、失败后显式重试、关闭下载时不取清单、不等待在途下载、词包校验和设置页刷新。最终 APK 的冷启动流量、电视按键及独立服务联调仍待后续阶段验收。
