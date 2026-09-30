# 智能成绩录入

面向教师的微信小程序：拍摄或上传手写成绩表，经视觉模型识别后人工核对，保存到微信云数据库，并按日期查询、预览、导出 Excel。

## 部署

1. 使用微信开发者工具导入仓库根目录，开通云开发并选择云环境。`project.config.json` 中的 `appid` 是模板项目原值；正式使用时请改为自己的小程序 AppID。
2. 在 `miniprogram/app.js` 的 `globalData.env` 中填写云环境 ID。若项目已设置默认云环境，也可留空使用默认环境。
3. 在云开发数据库中建立集合 `settings` 和 `scoreRecords`。建议将这两个集合的前端访问权限设为**不可读写**；所有读写均通过云函数进行。建议为 `scoreRecords` 建立 `ownerOpenId + date` 组合索引，以提高日期范围查询速度。
4. 在开发者工具中右键 `cloudfunctions/gradeService`，选择“上传并部署：云端安装依赖”。云函数运行时使用 Node.js 16 或更新版本。
5. 在该云函数的环境变量中配置：

   - `AI_API_URL`：兼容 Chat Completions 视觉消息格式的 HTTPS 接口完整地址，例如服务商的 `/v1/chat/completions` 地址。
   - `AI_MODEL`：支持图片输入的模型名称。
   - `AI_API_KEY`：对应的服务端密钥。

   云函数通过 HTTPS 发送图片的 base64 数据；密钥不会进入小程序代码。请按所用模型服务商的要求配置云函数外网访问和超时时间（建议至少 60 秒）。未配置 AI 时仍可手动录入成绩。

6. 在开发者工具中编译并用真机测试拍照、云存储、识别、查询及文件分享。

## 数据结构

- `settings`：以当前用户 OpenID 为文档 ID，保存 `classSize`、`updateTime`。
- `scoreRecords`：保存 `ownerOpenId`、`date`、`subject`、`scores`、`imageFileID`、`createTime`、`updateTime`。`scores` 为 `{ studentNo: "01", score: 95 }` 数组；未填写成绩保存为 `null`。
- 原图上传到云存储 `score-sheets/`；导出的 Excel 暂存于 `exports/<OpenID>/`。可根据运营需要在云存储设置清理策略。

成绩按当前微信用户隔离，云函数从微信上下文取得 OpenID，不接受前端传入身份。单次查询最多 300 条成绩表记录；超过时会提示缩小日期范围。

## 使用

先在“设置”页保存班级人数。在“录入”页拍照或选图，等待识别并校对日期、科目与每位学生成绩，然后提交保存。空成绩可保留，至少填写一位学生。到“导出”页选日期并查询；确认导出后可在微信中预览 Excel、保存到小程序，或分享文件到微信聊天。预览页右上角菜单也可转存文件。

`cloudfunctions/quickstartFunctions` 和 `miniprogram/pages/example` 是仓库原有云开发示例，当前小程序不再引用，可供参考。
